import { createHash, randomUUID } from 'crypto';
import type { AgentContextItem, AgentContextPack, AgentContextPackRequest, HistoricalReference, MailThreadContext, Memory, MemoryKind, SearchResult } from '@keymemory/shared';
import { MEMORY_POLICY } from '@keymemory/shared';
import { tokensToCharsBudget } from './token-estimate.js';
import { getMemory, listMemories } from './atom.js';
import { searchHybrid } from './query.js';
import { findProjectRef, getProject } from './project.js';
import { getDatabase } from '../db/sqlite.js';
import { findRelatedMemories } from '../graph/entity.js';
import { getPendingTodosForContext } from './dreaming.js';
import { getPendingInjectionForProject, getLatestProjectJournal } from './project-journal.js';
import { isMemoryValidAt, resolveAsOf } from './temporal.js';
import { listMailThreads, getMailThreadContext } from './mailbox.js';

const MAILBOX_OPERATING_GUIDE = `## Mailbox Continuity Rule

- A concrete project, task, or event belongs to one email subject. Continue by replying to that thread instead of creating folders or duplicate subjects.
- Read the matching thread before planning. Use atomic memories only to add reusable preferences, rules, facts, people, tools, knowledge, and lessons.
- At a meaningful milestone, pause, handoff, or finish, reply to the thread with progress, current state, blockers, deliverables, and next steps.
- Write for humans and Agents together: use ordinary written language. Put code, logs, JSON, stack traces, and hardware output in collapsed attachments.
- KeyMemory stores mail for the Agent to read later; it never wakes or starts an Agent.`;

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

// KM-102/D1：结构性权重（类型/层级/热度）归一化到 [0,1] 后只做乘性微调，
// 不再加性盖过检索主分。无检索分的候选（list 路径）以 LIST_BASE_SCORE 为基底，
// 保证它们仍能按结构质量排序，但绝不可能压过有真实检索分的候选（基底×1.15 < RRF 首位分≈0.0082）。
const LIST_BASE_SCORE = 0.002;

function structuralBoost(memory: Memory): number {
  const kind = memoryKindOf(memory);
  const kindNorm = (KIND_WEIGHT.get(kind) ?? 0) / 0.1;
  const layerNorm = layerWeight(memory) / 0.012;
  const hitNorm = Math.min(0.01, Math.log1p(memory.hitCount) * 0.002) / 0.01;
  return Math.max(0, Math.min(1, (kindNorm + layerNorm + hitNorm) / 3));
}

function candidateScore(memory: Memory, searchScore: number): number {
  const base = searchScore > 0 ? searchScore : LIST_BASE_SCORE;
  return base * (1 + MEMORY_POLICY.rankBoostFactor * structuralBoost(memory));
}

function projectPathOf(memory: Memory): string | undefined {
  if (!memory.projectId) return undefined;
  return getProject(memory.projectId)?.path;
}

function sourceProjectPathOf(memory: Memory): string | undefined {
  const metadata = memory.metadata as Record<string, unknown> | undefined;
  if (typeof metadata?.sourceProjectPath === 'string') return metadata.sourceProjectPath;
  const legacy = metadata?.legacyProject;
  if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
    const path = (legacy as Record<string, unknown>).path;
    if (typeof path === 'string') return path;
  }
  return undefined;
}

function matchesSourceProject(memory: Memory, scope: string | undefined, includeDescendants: boolean): boolean {
  if (!scope) return true;
  // 打散到共享池的记忆以原始来源为准；仍由旧 Loop/MCP 显式绑定项目 ID
  // 的记忆没有来源元数据，此时才退回实际项目路径。两者都只是兼容检索边界。
  const contextPath = sourceProjectPathOf(memory) ?? projectPathOf(memory);
  if (!contextPath) return false;
  return contextPath === scope || (includeDescendants && contextPath.startsWith(`${scope}/`));
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function addCandidate(
  map: Map<string, AgentContextItem>,
  memory: Memory,
  score = 0,
  accessibleSpaces?: Set<string>,
  temporal?: { asOf: string; includeExpired: boolean },
  scope?: { path: string; includeDescendants: boolean },
  expansionIds?: Set<string>,
): void {
  // 隔离过滤：若指定了可见空间集合，非可见记忆一律不进入候选池。
  // 这覆盖了 search/list/related/superseders 所有引入路径，防止跨 agent 私有空间泄露。
  if (accessibleSpaces && !accessibleSpaces.has(memory.agentSpace)) return;
  if (temporal && !temporal.includeExpired && !isMemoryValidAt(memory, temporal.asOf)) return;
  // 项目来源过滤：邮箱化后记忆统一回到共享池，项目归属以来源线索为准，
  // 确保其他项目的记忆不会混入当前项目的上下文包。
  if (scope && !matchesSourceProject(memory, scope.path, scope.includeDescendants)) return;
  const kind = memoryKindOf(memory);
  // KM-102：检索主分为准，结构权重只做乘性微调（见 candidateScore）。
  const finalScore = candidateScore(memory, score);
  const existing = map.get(memory.id);
  if (existing && existing.score >= finalScore) return;
  map.set(memory.id, {
    id: memory.id,
    title: memory.title,
    content: memory.content,
    layer: memory.layer,
    memoryKind: kind,
    projectId: memory.projectId,
    projectPath: sourceProjectPathOf(memory) ?? projectPathOf(memory),
    tags: memory.tags,
    source: memory.source,
    validFrom: memory.validFrom,
    validTo: memory.validTo,
    updatedAt: memory.updatedAt,
    score: Number(finalScore.toFixed(6)),
  });
  expansionIds?.add(memory.id);
}

function activeSuperseders(asOf: string): Map<string, string> {
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
    const source = getMemory(row.sourceId);
    if (!source || !isMemoryValidAt(source, asOf)) continue;
    if (!map.has(row.targetId)) map.set(row.targetId, row.sourceId);
  }
  return map;
}

function promoteSupersedingMemories(
  candidates: Map<string, AgentContextItem>,
  superseders: Map<string, string>,
  accessibleSpaces?: Set<string>,
  temporal?: { asOf: string; includeExpired: boolean },
  scope?: { path: string; includeDescendants: boolean },
): void {
  for (const item of Array.from(candidates.values())) {
    const sourceId = superseders.get(item.id);
    if (!sourceId || candidates.has(sourceId)) continue;
    const source = getMemory(sourceId);
    // KM-102：替代版本以乘性加分进入，保持“新版本排旧版本之前”的原意。
    if (source?.status === 'active') addCandidate(candidates, source, item.score * 1.15, accessibleSpaces, temporal, scope);
  }
}

function expandRelatedMemories(
  candidates: Map<string, AgentContextItem>,
  accessibleSpaces?: Set<string>,
  temporal?: { asOf: string; includeExpired: boolean },
): Set<string> {
  // 关系扩展刻意不套项目范围过滤：显式建立的 relates_to/derived_from 等关系
  // 是用户/Agent 确认过的跨项目线索，应随种子记忆进入上下文包；
  // agent 空间隔离仍然生效，不会跨私有空间泄露。
  const expansionIds = new Set<string>();
  const seeds = Array.from(candidates.values());
  for (const item of seeds) {
    if (expansionIds.has(item.id)) continue; // 扩展项不再作为种子，防止多级噪声放大
    const related = findRelatedMemories(item.id)
      // KM-208/D4：共现噪声边不得直接进入上下文——只扩展 strength ≥ 0.5 的边。
      .filter(rel => ['relates_to', 'derived_from', 'references', 'part_of'].includes(rel.relationType))
      .filter(rel => rel.strength >= MEMORY_POLICY.coHitRelations.expandMinStrength)
      .slice(0, 4);
    for (const rel of related) {
      if (candidates.has(rel.memoryId)) continue;
      const memory = getMemory(rel.memoryId);
      if (memory?.status !== 'active') continue;
      // KM-102：扩展项分数 = 种子分 × (1 + 0.5×strength)，永远低于种子且受关系强度调制。
      addCandidate(candidates, memory, item.score * (1 + 0.5 * Math.min(1, rel.strength)), accessibleSpaces, temporal, undefined, expansionIds);
    }
  }
  return expansionIds;
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
  const validity = item.validTo ? `, valid=${item.validFrom}..${item.validTo}` : '';
  const shortId = item.id.slice(0, 8);
  return `- [${item.layer}, ${shortId}${source}${validity}] ${item.title}: ${item.content}${relationLine(item)}`;
}

function formatMarkdown(pack: Omit<AgentContextPack, 'markdown'>, mailThread?: MailThreadContext, historicalReferences?: HistoricalReference[]): string {
  const lines = ['# KeyMemory Context'];
  if (pack.project) lines.push(`Project: ${pack.project}`);
  if (pack.query) lines.push(`Query: ${pack.query}`);
  lines.push(`As of: ${pack.asOf}${pack.includeExpired ? ' (including expired facts)' : ''}`);
  lines.push(`Generated: ${pack.generatedAt}`);
  lines.push('');

  if (mailThread) {
    lines.push('## Shared mailbox handoff');
    lines.push('Read this project thread first. It is the shared account of the work seen by both the user and Agents.');
    lines.push('');
    lines.push(mailThread.markdown);
    lines.push('');
  }

  // KM-301：易变区只含非稳定类条目；稳定类（偏好/约束/流程）由 stableMarkdown 承载。
  const volatileSections = pack.sections.filter(section => !STABLE_KINDS.has(section.kind));
  if (volatileSections.length === 0) {
    lines.push('No relevant memories found.');
  } else {
    for (const section of volatileSections) {
      lines.push(`## ${section.title}`);
      for (const item of section.items) lines.push(formatItem(item));
      lines.push('');
    }
  }

  // 注入历史相关记忆：帮助 Agent 获取与当前线程相关的历史经验
  if (historicalReferences && historicalReferences.length > 0) {
    lines.push('## Historical References');
    lines.push('The following historical memories are relevant to the current thread, provided for reference:');
    for (const ref of historicalReferences) {
      const shortId = ref.id.slice(0, 8);
      lines.push(`- [${ref.layer}, ${shortId}] ${ref.title}: ${ref.content}`);
    }
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

// KM-301/D6：稳定区内容——天级变更的长期知识，放在系统提示末尾让前缀稳定命中 KV cache。
// 不包含 query/asOf/generatedAt 等每轮变化的字段，保证跨轮字节一致。
const STABLE_KINDS = new Set<string>(['preference', 'constraint', 'procedure']);

function formatStableMarkdown(sections: AgentContextPack['sections'], stableAppend?: string): string {
  const stableSections = sections.filter(section => STABLE_KINDS.has(section.kind));
  if (stableSections.length === 0 && !stableAppend) return '';
  const lines = ['# KeyMemory Stable Context'];
  for (const section of stableSections) {
    lines.push(`## ${section.title}`);
    for (const item of section.items) lines.push(formatItem(item));
    lines.push('');
  }
  // KM-305：Loop 任务地图等稳定追加段（内容不变则稳定区字节不变）。
  if (stableAppend) {
    lines.push(stableAppend.trimEnd());
    lines.push('');
  }
  lines.push(MAILBOX_OPERATING_GUIDE);
  return lines.join('\n').trimEnd();
}

/**
 * 基于当前邮件线程主题搜索 top-5 相关历史记忆，注入 Context Pack 帮助 Agent 获取历史经验。
 * 非阻塞：任何异常只记录日志，不向上抛出，确保不影响主流程。
 */
async function injectHistoricalContext(
  threadSubject: string,
  existingMemoryIds: Set<string>,
  accessibleSpaces: Set<string> | undefined,
  temporal: { asOf: string; includeExpired: boolean },
): Promise<HistoricalReference[] | undefined> {
  if (!threadSubject || threadSubject.trim().length < 5) return undefined;

  try {
    const results = await searchHybrid(threadSubject, {
      projectId: undefined,
      includeDescendants: false,
      asOf: temporal.asOf,
      includeExpired: temporal.includeExpired,
      limit: 12, // 多取一些，过滤掉已关联的之后仍够 5 条
      agentSpaces: accessibleSpaces ? Array.from(accessibleSpaces) : undefined,
    });

    const filtered = results.filter(r => !existingMemoryIds.has(r.memory.id));
    const top5 = filtered.slice(0, 5);

    if (top5.length === 0) return undefined;

    return top5.map(r => ({
      id: r.memory.id,
      title: r.memory.title,
      content: truncate(r.memory.content, 300),
      relevanceScore: Number(r.score.toFixed(4)),
      layer: r.memory.layer,
    }));
  } catch (err) {
    console.error('[ContextPack] Historical context injection failed:', (err as Error).message);
    return undefined;
  }
}

export async function buildAgentContextPack(input: AgentContextPackRequest = {}): Promise<AgentContextPack> {
  const maxItems = Math.max(1, Math.min(input.maxItems ?? 12, 40));
  // KM-303/D5：预算单位以 token 为准（确定性估算），消除中英文 3–4 倍的字符预算差异；
  // 旧 maxChars 仅在未提供 maxTokens 时作为兼容路径生效。
  const tokenBudget = Math.max(400, Math.min(input.maxTokens ?? MEMORY_POLICY.contextBudget.maxTokens, MEMORY_POLICY.contextBudget.hardMaxTokens));
  const maxChars = input.maxChars !== undefined && input.maxTokens === undefined
    ? Math.max(800, Math.min(input.maxChars, 30000))
    : Math.max(800, Math.min(tokensToCharsBudget(tokenBudget), 30000));
  const project = input.projectId ? getProject(input.projectId) : input.project ? findProjectRef(input.project) : null;
  const projectKnownBySource = !project && input.project ? Boolean(getDatabase().prepare(`
    SELECT 1 FROM memories
    WHERE status = 'active' AND (
      json_extract(metadata, '$.sourceProjectPath') = @path
      OR json_extract(metadata, '$.sourceProjectPath') LIKE @prefix
      OR json_extract(metadata, '$.legacyProject.path') = @path
      OR json_extract(metadata, '$.legacyProject.path') LIKE @prefix
    )
    LIMIT 1
  `).get({ path: input.project, prefix: `${input.project}/%` })) : false;
  const projectMissing = Boolean((input.projectId || input.project) && !project && !projectKnownBySource);
  const projectId = input.projectId ?? project?.id;
  const projectName = project?.path ?? input.project;
  const asOf = resolveAsOf(input.asOf);
  const temporal = { asOf, includeExpired: input.includeExpired === true };
  const allowedKinds = input.memoryKinds && input.memoryKinds.length > 0 ? new Set(input.memoryKinds) : null;
  // 隔离过滤：若调用方传入 agentSpaces，则 search/list/扩展路径都只接受这些空间的记忆。
  // accessibleSpaces 是 Set 形式供 addCandidate O(1) 判断；agentSpaces 原数组透传给 SQL 层。
  const accessibleSpaces = input.agentSpaces && input.agentSpaces.length > 0 ? new Set(input.agentSpaces) : undefined;
  // 项目范围：项目目录行存在时用其路径，否则用调用方传入的路径（邮箱化后项目只存在于来源线索）。
  // includeDescendants 默认 true，与 CLI 的 "descendants included by default" 语义一致。
  const includeDescendants = input.includeDescendants !== false;
  const projectScope = !projectMissing && (project?.path || input.project)
    ? { path: project?.path ?? input.project!, includeDescendants }
    : undefined;

  const candidates = new Map<string, AgentContextItem>();
  const superseders = input.includeSuperseded === true ? new Map<string, string>() : activeSuperseders(asOf);

  if (input.query?.trim() && !projectMissing) {
    // 搜索分支与 list 分支统一走项目路径路由：邮箱化后原子记忆不再绑定项目目录行，
    // projectPath 仅留在 metadata.sourceProjectPath。严格 projectId 过滤会把这类记忆
    // 全部排除导致搜索 0 命中；projectPath 路由同时覆盖 sourceProjectPath、
    // legacyProject.path 与显式 project_id 绑定三种来源，是正确的超集。
    const results = await searchHybrid(input.query, {
      projectPath: project?.path ?? input.project,
      includeDescendants,
      includeSuperseded: input.includeSuperseded,
      asOf,
      includeExpired: temporal.includeExpired,
      limit: maxItems * 3,
      agentSpaces: input.agentSpaces,
    });
    for (const result of results) addCandidate(candidates, result.memory, result.score, accessibleSpaces, temporal, projectScope);
  }

  if (!projectMissing) {
    const scoped = listMemories({
      projectId: undefined,
      includeDescendants: false,
      status: 'active',
      asOf,
      includeExpired: temporal.includeExpired,
      limit: maxItems * 5,
      agentSpaces: input.agentSpaces,
    });
    for (const memory of scoped) addCandidate(candidates, memory, 0, accessibleSpaces, temporal, projectScope);
  }

  promoteSupersedingMemories(candidates, superseders, accessibleSpaces, temporal, projectScope);
  const expansionIds = expandRelatedMemories(candidates, accessibleSpaces, temporal);

  // KM-208：关系扩展项在候选池占比不得超过 30%，先在候选阶段裁减（保证主检索项的入选名额），
  // 从低分端裁减扩展项。
  if (expansionIds.size > 0 && candidates.size > 0) {
    const maxExpansion = Math.max(1, Math.floor(candidates.size * 0.3));
    let expansionCount = Array.from(candidates.values()).filter(item => expansionIds.has(item.id)).length;
    if (expansionCount > maxExpansion) {
      const expansionItems = Array.from(candidates.values())
        .filter(item => expansionIds.has(item.id))
        .sort((a, b) => a.score - b.score);
      for (const item of expansionItems) {
        if (expansionCount <= maxExpansion) break;
        candidates.delete(item.id);
        expansionIds.delete(item.id);
        expansionCount -= 1;
      }
    }
  }

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

  // 读取上下文包不应改变记忆的证据校准置信度：之前的 +0.01 提升会污染
  // 用户显式写入的 confidence，读操作也不应静默改写用户可见数据。
  // 命中热度仍由查询路径的 hit_count 记录。

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
    asOf,
    includeExpired: temporal.includeExpired,
    generatedAt: new Date().toISOString(),
    totalItems: selected.length,
    usedChars,
    sections,
  };

  // 邮箱优先：具体项目、任务或事件先恢复共享邮件线程，再补充原子记忆。
  // 旧 Agent 继续调用 context_pack 也能自动获得新规则，无需依赖宿主先升级提示词。
  let mailThread: MailThreadContext | undefined;
  try {
    let threadId: string | undefined;
    if (projectId) {
      const row = getDatabase().prepare(`
        SELECT id FROM mail_threads
        WHERE project_scope_id = ? OR legacy_project_id = ?
        ORDER BY COALESCE(last_message_at, updated_at) DESC LIMIT 1
      `).get(projectId, projectId) as { id: string } | undefined;
      threadId = row?.id;
    }
    if (!threadId) {
      const needle = (input.project || input.query || '').trim();
      if (needle.length >= 5) {
        threadId = listMailThreads({ folder: 'all', query: needle, agentSpaces: input.agentSpaces, limit: 2 })[0]?.id;
      }
    }
    if (threadId) {
      const recipientId = input.agentSpaces?.find(space => space.startsWith('agent:')) ?? 'agent:context-pack';
      mailThread = getMailThreadContext(threadId, recipientId, input.agentSpaces) ?? undefined;
    }
  } catch (err) {
    console.error('[context-pack] Mailbox handoff failed (non-fatal):', (err as Error).message);
  }

  // 历史记忆注入：基于当前邮件线程主题搜索 top-5 相关历史记忆作为参考上下文。
  // 非阻塞：搜索失败不影响主流程返回。
  let historicalReferences: HistoricalReference[] | undefined;
  if (mailThread) {
    historicalReferences = await injectHistoricalContext(
      mailThread.thread.subject,
      new Set(mailThread.linkedMemories.map(m => m.id)),
      accessibleSpaces,
      temporal,
    );
  }

  const result = {
    ...packBase,
    mailThread,
    historicalReferences,
    // KM-301：双区输出。volatile 每轮变化（放用户消息前）；stable 天级稳定（放系统提示末尾），
    // 让稳定前缀命中 KV cache。markdown 保留为两者拼接，向后兼容旧调用方。
    volatileMarkdown: formatMarkdown({ ...packBase, mailThread, historicalReferences }, mailThread, historicalReferences),
    stableMarkdown: formatStableMarkdown(packBase.sections, input.stableAppend),
    markdown: '',
  };
  result.markdown = result.stableMarkdown
    ? `${result.volatileMarkdown}\n\n${result.stableMarkdown}`
    : `${result.volatileMarkdown}\n\n${MAILBOX_OPERATING_GUIDE}`;

  // 记录 agent 活动到 loop_runs 表，让使用动态页能看到智能体何时访问了记忆库。
  if (input.recordActivity !== false) recordAgentActivity(input, result);

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

    // Activity telemetry shares loop_runs for UI visibility, but it must never
    // mutate durable loop-harness rows. Only coalesce rows created by this
    // telemetry path.
    const recent = db.prepare(`
      SELECT id FROM loop_runs
      WHERE agent_id = ?
        AND lease_owner = 'keymemory-auto'
        AND idempotency_key LIKE 'auto:%'
        AND updated_at > ?
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
