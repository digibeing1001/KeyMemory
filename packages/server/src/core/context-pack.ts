import { createHash, randomUUID } from 'crypto';
import type { AgentContextItem, AgentContextPack, AgentContextPackRequest, Memory, MemoryKind, SearchResult } from '@keymemory/shared';
import { getMemory, listMemories } from './atom.js';
import { searchHybrid } from './query.js';
import { findProjectRef, getProject } from './project.js';
import { getDatabase } from '../db/sqlite.js';
import { findRelatedMemories } from '../graph/entity.js';
import { getPendingTodosForContext } from './dreaming.js';
import { getPendingInjectionForProject, getLatestProjectJournal } from './project-journal.js';

const KIND_ORDER: MemoryKind[] = [
  'preference',
  'constraint',
  'decision',
  'task',
  'procedure',
  'project_fact',
  'project_journal',
  'relationship',
  'concept',
  'event',
  'raw_note',
];

const KIND_TITLES: Record<MemoryKind, string> = {
  preference: 'User Preferences',
  constraint: 'Constraints And Rules',
  decision: 'Decisions',
  task: 'Open Tasks',
  procedure: 'Procedures',
  project_fact: 'Project Facts',
  project_journal: 'Project Journal',
  relationship: 'Relationships',
  concept: 'Concepts',
  event: 'Events',
  raw_note: 'Other Notes',
};

const KIND_WEIGHT = new Map<MemoryKind, number>(KIND_ORDER.map((kind, index) => [kind, (KIND_ORDER.length - index) * 0.01]));

function memoryKindOf(memory: Memory): MemoryKind {
  const metaKind = (memory.metadata as Record<string, unknown> | undefined)?.memoryKind;
  if (typeof metaKind === 'string' && KIND_ORDER.includes(metaKind as MemoryKind)) return metaKind as MemoryKind;
  const tagKind = memory.tags?.find(tag => tag.startsWith('kind:'))?.slice('kind:'.length);
  if (tagKind && KIND_ORDER.includes(tagKind as MemoryKind)) return tagKind as MemoryKind;
  return 'raw_note';
}

function layerWeight(memory: Memory): number {
  if (memory.layer === 'long') return 0.012;
  if (memory.layer === 'entity') return 0.01;
  if (memory.layer === 'short') return 0.004;
  return 0;
}

function projectPathOf(memory: Memory): string | undefined {
  if (!memory.projectId) return undefined;
  return getProject(memory.projectId)?.path;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function addCandidate(map: Map<string, AgentContextItem>, memory: Memory, score = 0, accessibleSpaces?: Set<string>): void {
  // 隔离过滤：若指定了可见空间集合，非可见记忆一律不进入候选池。
  // 这覆盖了 search/list/related/superseders 所有引入路径，防止跨 agent 私有空间泄露。
  if (accessibleSpaces && !accessibleSpaces.has(memory.agentSpace)) return;
  const kind = memoryKindOf(memory);
  const finalScore = score + (KIND_WEIGHT.get(kind) ?? 0) + layerWeight(memory) + Math.min(0.01, Math.log1p(memory.hitCount) * 0.002);
  const existing = map.get(memory.id);
  if (existing && existing.score >= finalScore) return;
  map.set(memory.id, {
    id: memory.id,
    title: memory.title,
    content: memory.content,
    layer: memory.layer,
    memoryKind: kind,
    projectId: memory.projectId,
    projectPath: projectPathOf(memory),
    tags: memory.tags,
    source: memory.source,
    updatedAt: memory.updatedAt,
    score: Number(finalScore.toFixed(6)),
  });
}

function activeSuperseders(): Map<string, string> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT r.target_memory_id as targetId, r.source_memory_id as sourceId
    FROM memory_relations r
    JOIN memories source ON source.id = r.source_memory_id
    WHERE r.relation_type = 'supersedes'
      AND source.status = 'active'
    ORDER BY r.strength DESC, r.created_at DESC
  `).all() as { targetId: string; sourceId: string }[];

  const map = new Map<string, string>();
  for (const row of rows) {
    if (!map.has(row.targetId)) map.set(row.targetId, row.sourceId);
  }
  return map;
}

function promoteSupersedingMemories(candidates: Map<string, AgentContextItem>, superseders: Map<string, string>, accessibleSpaces?: Set<string>): void {
  for (const item of Array.from(candidates.values())) {
    const sourceId = superseders.get(item.id);
    if (!sourceId || candidates.has(sourceId)) continue;
    const source = getMemory(sourceId);
    if (source?.status === 'active') addCandidate(candidates, source, item.score + 0.05, accessibleSpaces);
  }
}

function expandRelatedMemories(candidates: Map<string, AgentContextItem>, accessibleSpaces?: Set<string>): void {
  const seeds = Array.from(candidates.values());
  for (const item of seeds) {
    const related = findRelatedMemories(item.id)
      .filter(rel => ['relates_to', 'derived_from', 'references', 'part_of'].includes(rel.relationType))
      .slice(0, 4);
    for (const rel of related) {
      if (candidates.has(rel.memoryId)) continue;
      const memory = getMemory(rel.memoryId);
      if (memory?.status !== 'active') continue;
      addCandidate(candidates, memory, item.score + Math.min(0.04, rel.strength * 0.04), accessibleSpaces);
    }
  }
}

function enrichRelations(items: AgentContextItem[]): AgentContextItem[] {
  return items.map(item => {
    const relations = findRelatedMemories(item.id)
      .filter(rel => ['supersedes', 'relates_to', 'derived_from', 'references', 'part_of'].includes(rel.relationType))
      .slice(0, 4)
      .map(rel => ({
        memoryId: rel.memoryId,
        title: rel.title,
        relationType: rel.relationType,
        direction: rel.direction,
        strength: rel.strength,
        reason: rel.reason,
      }));
    return relations.length > 0 ? { ...item, relations } : item;
  });
}

function relationLine(item: AgentContextItem): string {
  if (!item.relations || item.relations.length === 0) return '';
  return `\n  Relations: ${item.relations.map(rel => `${rel.direction} ${rel.relationType} ${rel.title} (${rel.memoryId.slice(0, 8)})`).join('; ')}`;
}

function estimateChars(items: AgentContextItem[]): number {
  return items.reduce((sum, item) => sum + item.title.length + item.content.length + relationLine(item).length + 80, 0);
}

function formatItem(item: AgentContextItem): string {
  const source = item.projectPath ? `, project=${item.projectPath}` : '';
  const shortId = item.id.slice(0, 8);
  return `- [${item.layer}, ${shortId}${source}] ${item.title}: ${item.content}${relationLine(item)}`;
}

function formatMarkdown(pack: Omit<AgentContextPack, 'markdown'>, handoff?: { instruction?: string; lastJournal?: { id: string; title: string; content: string; createdAt: string } | null }): string {
  const lines = ['# KeyMemory Context'];
  if (pack.project) lines.push(`Project: ${pack.project}`);
  if (pack.query) lines.push(`Query: ${pack.query}`);
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push('');

  if (pack.sections.length === 0) {
    lines.push('No relevant memories found.');
  } else {
    for (const section of pack.sections) {
      lines.push(`## ${section.title}`);
      for (const item of section.items) lines.push(formatItem(item));
      lines.push('');
    }
  }

  // 注入项目接龙：上次工作日志 + 本次接龙指令
  // 设计目的：让用户在新会话中能从上次工作的进展继续，避免重复劳动
  if (handoff?.lastJournal) {
    lines.push('## Last Session Journal (Project Handoff)');
    lines.push(`以下是该项目最近一次的工作日志（${handoff.lastJournal.createdAt.slice(0, 10)}），请基于此接力工作：`);
    lines.push(`- [${handoff.lastJournal.id.slice(0, 8)}] ${handoff.lastJournal.title}`);
    lines.push(handoff.lastJournal.content);
    lines.push('');
  }

  if (handoff?.instruction) {
    lines.push(handoff.instruction);
    lines.push('');
  }

  // 注入待确认项：让 Agent 在对话中自然地提醒用户
  const pendingTodos = getPendingTodosForContext(undefined, pack.projectId);
  if (pendingTodos.length > 0) {
    lines.push('## Pending Review Items');
    lines.push('The following memory management actions were auto-executed or need your confirmation:');
    for (const todo of pendingTodos) {
      const statusTag = todo.status === 'pending' ? '[NEEDS REVIEW]' : '[AUTO-DONE]';
      lines.push(`- ${statusTag} ${todo.type}: ${todo.description || todo.reason} (${todo.title})`);
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

export async function buildAgentContextPack(input: AgentContextPackRequest = {}): Promise<AgentContextPack> {
  const maxItems = Math.max(1, Math.min(input.maxItems ?? 12, 40));
  const maxChars = Math.max(800, Math.min(input.maxChars ?? 6000, 30000));
  const includeDescendants = input.includeDescendants !== false;
  const project = input.projectId ? getProject(input.projectId) : input.project ? findProjectRef(input.project) : null;
  const projectMissing = Boolean((input.projectId || input.project) && !project);
  const projectId = input.projectId ?? project?.id;
  const projectName = project?.path ?? input.project;
  const allowedKinds = input.memoryKinds && input.memoryKinds.length > 0 ? new Set(input.memoryKinds) : null;
  // 隔离过滤：若调用方传入 agentSpaces，则 search/list/扩展路径都只接受这些空间的记忆。
  // accessibleSpaces 是 Set 形式供 addCandidate O(1) 判断；agentSpaces 原数组透传给 SQL 层。
  const accessibleSpaces = input.agentSpaces && input.agentSpaces.length > 0 ? new Set(input.agentSpaces) : undefined;

  const candidates = new Map<string, AgentContextItem>();
  const superseders = activeSuperseders();

  if (input.query?.trim() && !projectMissing) {
    const results = await searchHybrid(input.query, {
      projectId,
      includeDescendants,
      limit: maxItems * 3,
      agentSpaces: input.agentSpaces,
    });
    for (const result of results) addCandidate(candidates, result.memory, result.score, accessibleSpaces);
  }

  if (!projectMissing) {
    const scoped = listMemories({
      projectId,
      includeDescendants,
      status: 'active',
      limit: maxItems * 5,
      agentSpaces: input.agentSpaces,
    });
    for (const memory of scoped) addCandidate(candidates, memory, 0, accessibleSpaces);
  }

  promoteSupersedingMemories(candidates, superseders, accessibleSpaces);
  expandRelatedMemories(candidates, accessibleSpaces);

  const sorted = Array.from(candidates.values())
    .filter(item => !allowedKinds || allowedKinds.has(item.memoryKind))
    .filter(item => !superseders.has(item.id))
    .sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));

  const selectedBase: AgentContextItem[] = [];
  let usedChars = 0;
  for (const item of sorted) {
    if (selectedBase.length >= maxItems) break;
    const remaining = maxChars - usedChars;
    if (remaining <= 0) break;
    const contentBudget = Math.min(900, Math.max(180, remaining - item.title.length - 80));
    const next = { ...item, content: truncate(item.content, contentBudget) };
    const cost = next.title.length + next.content.length + 80;
    if (usedChars + cost > maxChars && selectedBase.length > 0) continue;
    selectedBase.push(next);
    usedChars += cost;
  }

  let selected = enrichRelations(selectedBase);
  usedChars = estimateChars(selected);
  while (usedChars > maxChars && selected.length > 1) {
    selected = selected.slice(0, -1);
    usedChars = estimateChars(selected);
  }

  const sections = KIND_ORDER
    .map(kind => ({
      kind,
      title: KIND_TITLES[kind],
      items: selected.filter(item => item.memoryKind === kind),
    }))
    .filter(section => section.items.length > 0);

  const packBase = {
    query: input.query,
    project: projectName,
    projectId,
    generatedAt: new Date().toISOString(),
    totalItems: selected.length,
    usedChars,
    sections,
  };

  // 项目接龙：当 agent 命中某项目时，注入"上次工作日志"和"写日志指令"
  // 设计目的：跨会话工作连续性。新窗口能从上次进展接力，并在结束时写新日志供下次接力。
  // 注意：getPendingInjectionForProject 有副作用（pending→injected），且受冷却时间保护
  let handoff: { instruction?: string; lastJournal?: { id: string; title: string; content: string; createdAt: string } | null } | undefined;
  if (projectId) {
    try {
      const lastJournal = getLatestProjectJournal(projectId);
      const injection = getPendingInjectionForProject(projectId);
      if (lastJournal || injection) {
        handoff = {
          lastJournal,
          instruction: injection?.instruction,
        };
      }
    } catch (err) {
      // 接龙机制失败不应阻塞 context pack 生成
      console.error('[context-pack] Project journal handoff failed (non-fatal):', (err as Error).message);
    }
  }

  const result = {
    ...packBase,
    markdown: formatMarkdown(packBase, handoff),
  };

  // 记录 agent 活动到 loop_runs 表，让使用动态页能看到智能体何时访问了记忆库。
  recordAgentActivity(input, result);

  return result;
}

/**
 * 记录 agent 活动到 loop_runs 表。
 *
 * 设计目的：让使用动态页的"智能体活动"列有真实数据。当 agent 通过 MCP/REST
 * 调用 buildAgentContextPack 时，自动创建/更新一条 loop_run 记录。
 *
 * 避免噪声：同一 agent 在 60 秒内的多次请求只更新同一条记录（bump updated_at
 * 和 checkpoint_version），超过 60 秒才创建新记录。这样既保留活动历史，又不会刷屏。
 *
 * 失败不阻塞：记录活动是可观测性增强，任何失败只记日志不影响 context pack 返回。
 */
function recordAgentActivity(input: AgentContextPackRequest, pack: AgentContextPack): void {
  try {
    const db = getDatabase();

    // 从 agentSpaces 推断 agentId（如 ['global', 'agent:foo'] → 'foo'）
    const agentSpace = input.agentSpaces?.find(s => s.startsWith('agent:'));
    const agentId = agentSpace ? agentSpace.slice('agent:'.length) : 'default-agent';

    // 构造 objective：优先用查询文本，其次用项目名，最后用通用描述
    let objective: string;
    if (input.query?.trim()) {
      objective = input.query.trim().slice(0, 200);
    } else if (pack.project) {
      objective = `Context retrieval (${pack.project})`;
    } else {
      objective = 'Memory context retrieval';
    }

    const now = new Date().toISOString();
    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();

    // 检查 60 秒内是否有同一 agent 的记录，有则更新，无则新建
    const recent = db.prepare(`
      SELECT id FROM loop_runs
      WHERE agent_id = ? AND updated_at > ?
      ORDER BY updated_at DESC LIMIT 1
    `).get(agentId, oneMinuteAgo) as { id: string } | undefined;

    if (recent) {
      db.prepare(`
        UPDATE loop_runs
        SET objective = ?, updated_at = ?, checkpoint_version = checkpoint_version + 1
        WHERE id = ?
      `).run(objective, now, recent.id);
    } else {
      const runId = randomUUID();
      const traceId = createHash('sha256').update(`${runId}:${now}`).digest('hex').slice(0, 32);
      const idempotencyKey = `auto:${agentId}:${now}`;

      db.prepare(`
        INSERT INTO loop_runs (
          id, idempotency_key, objective, project_id, project_path, agent_id, status,
          checkpoint_version, last_event_sequence, trace_id, lease_owner, lease_expires_at,
          created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, 'completed',
          1, 0, ?, ?, ?,
          ?, ?
        )
      `).run(
        runId,
        idempotencyKey,
        objective,
        pack.projectId ?? null,
        pack.project ?? null,
        agentId,
        traceId,
        'keymemory-auto',
        now,
        now,
        now,
      );
    }
  } catch (err) {
    console.error('[context-pack] recordAgentActivity failed (non-fatal):', (err as Error).message);
  }
}
