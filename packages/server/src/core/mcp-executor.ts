import type { CreateMemoryInput, EntityType, IsolationMode, Layer, LoopCheckpointRequest, LoopContextRequest, LoopFinishRequest, LoopRunStartRequest, MemoryKind, MemoryStatus, UpdateMemoryInput } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { getMemory, listMemories, updateMemory } from './atom.js';
import { autoRemember, extractTags } from './auto.js';
import { discoverMigrationSources, migrateMemoriesFromPath } from './migration.js';
import { buildAgentContextPack } from './context-pack.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile } from './backup.js';
import { acceptProjectSuggestion, listProjectSuggestions, rejectProjectSuggestion } from './project.js';
import { createMemoryRelation, findRelatedMemories, MEMORY_RELATION_TYPES, addEntityAlias, removeEntityAlias, listEntityAliases, mergeEntities, findDuplicateEntities } from '../graph/entity.js';
import { deleteToolSecret, getToolSecret, listToolSecrets, setToolSecret } from './secrets.js';
import { createRule, deleteRule, listAllRules, updateRule } from './isolation-rules.js';
import type { IsolationRuleType } from './isolation-rules.js';
import { canonicalToolName, ENTITY_TYPES } from './mcp-tools.js';
import { checkpointLoopRun, finishLoopRun, getLoopContext, loopErrorObservation, LoopProtocolError, startLoopRun } from './loop-harness.js';
import type { MemoryAdapter } from '../adapters/base.js';
import { supersedeMemory } from './supersession.js';

export interface McpToolExecutionResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpToolExecutionOptions {
  responseStyle?: 'json' | 'agentText';
}

class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

const VALID_LAYERS = new Set<Layer>(LAYERS);
const VALID_MEMORY_STATUSES = new Set<MemoryStatus>(['active', 'archived', 'decayed', 'deleted']);

function ok(value: unknown): McpToolExecutionResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: isRecord(value) ? value : { result: value },
  };
}

function fail(message: string): McpToolExecutionResult {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { error: { message } },
    isError: true,
  };
}

function memorySavedText(memory: Awaited<ReturnType<MemoryAdapter['write']>>): string {
  return `记忆已保存\n\nID: ${memory.id}\n标题: ${memory.title}\n层级: ${memory.layer}`;
}

function searchResultsText(query: string, results: Awaited<ReturnType<MemoryAdapter['search']>>): string {
  if (results.length === 0) return `没有找到关于"${query}"的记忆`;
  return `找到 ${results.length} 条相关记忆：\n\n` +
    results
      .map((result, index) => {
        const memory = result.memory;
        let line = `${index + 1}. [${memory.layer}] ${memory.title}`;
        if (memory.tags && memory.tags.length > 0) line += ` | 标签: ${memory.tags.join(', ')}`;
        if (memory.source) line += ` | 来源: ${memory.source}`;
        if (memory.validTo) line += ` | 有效期: ${memory.validFrom}..${memory.validTo}`;
        if (result.scoreBreakdown) {
          const fulltext = result.scoreBreakdown.fulltextRank ? `全文#${result.scoreBreakdown.fulltextRank}` : '全文未命中';
          const semantic = result.scoreBreakdown.semanticRank ? `语义#${result.scoreBreakdown.semanticRank}` : '语义未命中';
          line += ` | 排名: ${fulltext}, ${semantic}, score=${result.scoreBreakdown.finalScore}`;
        }
        if (memory.metadata) {
          const meta = memory.metadata as Record<string, unknown>;
          const parts: string[] = [];
          if (meta.timeline) parts.push(`时间: ${meta.timeline}`);
          if (meta.entities) parts.push(`实体: ${Array.isArray(meta.entities) ? meta.entities.join(', ') : meta.entities}`);
          if (meta.context) parts.push(`场景: ${meta.context}`);
          if (meta.category) parts.push(`分类: ${meta.category}`);
          if (meta.importance) parts.push(`重要度: ${meta.importance}`);
          if (parts.length > 0) line += ` | ${parts.join(', ')}`;
        }
        line += `\n   ${memory.content.slice(0, 300)}`;
        if (memory.content.length > 300) line += '...';
        return line;
      })
      .join('\n\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new ToolInputError(`${key} must be a string`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (!value) throw new ToolInputError(`${key} is required`);
  return value;
}

function optionalNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(`${key} must be a finite number`);
  }
  return value;
}

function optionalConfidence(args: Record<string, unknown>, key = 'confidence'): number | undefined {
  const value = optionalNumber(args, key);
  if (value !== undefined && (value < 0 || value > 1)) {
    throw new ToolInputError(`${key} must be between 0 and 1`);
  }
  return value;
}

function requiredNumber(args: Record<string, unknown>, key: string): number {
  const value = optionalNumber(args, key);
  if (value === undefined) throw new ToolInputError(`${key} is required`);
  return value;
}

function optionalStringArray(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
    throw new ToolInputError(`${key} must be an array of strings`);
  }
  return value.map(item => item.trim()).filter(Boolean);
}

function optionalRecord(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = args[key];
  if (value == null) return undefined;
  if (!isRecord(value)) throw new ToolInputError(`${key} must be an object`);
  return value;
}

function optionalLayer(args: Record<string, unknown>, key = 'layer'): Layer | undefined {
  const value = optionalString(args, key);
  if (value == null) return undefined;
  if (!VALID_LAYERS.has(value as Layer)) {
    throw new ToolInputError(`${key} must be one of: ${LAYERS.join(', ')}`);
  }
  return value as Layer;
}

function requiredLayer(args: Record<string, unknown>, key = 'layer'): Layer {
  const layer = optionalLayer(args, key);
  if (!layer) throw new ToolInputError(`${key} is required`);
  return layer;
}

function optionalEntityType(args: Record<string, unknown>, key = 'entityType'): EntityType | undefined {
  const value = optionalString(args, key);
  if (value == null) return undefined;
  if (!ENTITY_TYPES.includes(value)) {
    throw new ToolInputError(`${key} must be one of: ${ENTITY_TYPES.join(', ')}`);
  }
  return value as EntityType;
}

function optionalTagsMatch(args: Record<string, unknown>, key = 'tagsMatch'): 'any' | 'all' | undefined {
  const value = optionalString(args, key);
  if (value == null) return undefined;
  if (value !== 'any' && value !== 'all') {
    throw new ToolInputError(`${key} must be 'any' or 'all'`);
  }
  return value;
}

function optionalLimit(args: Record<string, unknown>, fallback: number, max = 100): number {
  const raw = optionalNumber(args, 'limit');
  const limit = Math.trunc(raw ?? fallback);
  if (limit < 1) throw new ToolInputError('limit must be at least 1');
  return Math.min(limit, max);
}

function buildCreateInput(args: Record<string, unknown>): CreateMemoryInput {
  const title = requiredString(args, 'title');
  const content = requiredString(args, 'content');
  // layer 可选：未指定时由 normalizeMemoryInput 推断，避免上游一律传 long
  const layer = optionalLayer(args);
  const tags = optionalStringArray(args, 'tags') ?? extractTags(content);

  return {
    title,
    content,
    layer,
    projectId: optionalString(args, 'projectId'),
    projectPath: optionalString(args, 'projectPath'),
    confidence: optionalConfidence(args),
    validFrom: optionalString(args, 'validFrom'),
    validTo: optionalString(args, 'validTo'),
    tags,
    metadata: optionalRecord(args, 'metadata'),
    source: optionalString(args, 'source'),
    sourceId: optionalString(args, 'sourceId'),
  };
}

function buildUpdateInput(args: Record<string, unknown>): UpdateMemoryInput {
  const input: UpdateMemoryInput = {};
  const title = optionalString(args, 'title');
  const content = optionalString(args, 'content');
  const layer = optionalLayer(args);
  const projectId = optionalString(args, 'projectId');
  const projectPath = optionalString(args, 'projectPath');
  const tags = optionalStringArray(args, 'tags');
  const metadata = optionalRecord(args, 'metadata');
  const source = optionalString(args, 'source');
  const confidence = optionalConfidence(args);
  const validFrom = optionalString(args, 'validFrom');
  const validToValue = args.validTo;
  const validTo = validToValue === null ? null : optionalString(args, 'validTo');

  if (title !== undefined) input.title = title;
  if (content !== undefined) input.content = content;
  if (layer !== undefined) input.layer = layer;
  if (projectId !== undefined) input.projectId = projectId;
  if (projectPath !== undefined) input.projectPath = projectPath;
  if (tags !== undefined) input.tags = tags;
  if (metadata !== undefined) input.metadata = metadata;
  if (source !== undefined) input.source = source;
  if (confidence !== undefined) input.confidence = confidence;
  if (validFrom !== undefined) input.validFrom = validFrom;
  if (validTo !== undefined) input.validTo = validTo;

  if (Object.keys(input).length === 0) throw new ToolInputError('at least one update field is required');
  return input;
}

function inferImportLayer(title: string, content: string, metadata?: Record<string, unknown>): Layer {
  const text = `${title} ${content}`.toLowerCase();
  const importance = metadata?.importance;
  if (importance === 'high') return 'long';
  if (importance === 'low') return 'short';
  if (metadata?.category === 'preference' || metadata?.category === 'decision') return 'long';
  if (metadata?.category === 'person' || metadata?.category === 'entity') return 'entity';
  if (metadata?.category === 'task' || metadata?.category === 'todo') return 'short';
  if (/person|entity|人物|人员|同事|客户|团队|负责人|工具|产品/.test(text)) return 'entity';
  if (/preference|rule|principle|decision|project|architecture|repo|framework|偏好|习惯|风格|原则|规则|决定|结论|取舍|架构|方法论|框架|理论|约束|边界|必须|禁止/.test(text)) return 'long';
  if (/todo|today|tomorrow|temporary|pending|待办|任务|计划|截止|临时|本周|今天|明天|近期/.test(text)) return 'short';
  // 不再以长度>200 作为 long 兜底——长内容默认进 short，由 dream 升格
  return 'short';
}

function stripCommonPrefix(value: unknown, enabled: boolean): string {
  const text = typeof value === 'string' ? value : '';
  if (!enabled) return text;
  return text
    .replace(/^\[[\w\u4e00-\u9fff]+\]\s*/, '')
    .replace(/^[\w\u4e00-\u9fff]+[:：-]\s*/, match => (/^(http|https|ftp|www)/i.test(match) ? match : ''))
    .replace(/^migration[:：\s]*\S*\s*/i, '')
    .trimStart();
}

async function writeMemory(adapter: MemoryAdapter, input: CreateMemoryInput) {
  const memory = await adapter.write(input);
  // 后处理（embedding + autoAssociate）已内聚到 createMemory 内部
  return memory;
}

export async function executeMcpTool(
  name: unknown,
  argsInput: unknown,
  adapter: MemoryAdapter,
  options: McpToolExecutionOptions = {},
): Promise<McpToolExecutionResult> {
  const args = isRecord(argsInput) ? argsInput : {};
  const toolName = canonicalToolName(name);
  const agentText = options.responseStyle === 'agentText';

  try {
    switch (toolName) {
      case 'memory_connection_status': {
        const receipt = {
          status: 'connected',
          service: 'KeyMemory',
          transport: 'mcp',
          checkedAt: new Date().toISOString(),
          agentSpaces: adapter.getAgentSpaces?.() ?? [],
          capabilities: {
            read: true,
            write: true,
            context: true,
            supersession: true,
            secrets: true,
          },
        };
        return agentText
          ? { content: [{ type: 'text', text: JSON.stringify(receipt, null, 2) }], structuredContent: { receipt } }
          : ok(receipt);
      }

      case 'memory_create': {
        const memory = await writeMemory(adapter, buildCreateInput(args));
        return agentText
          ? { content: [{ type: 'text', text: memorySavedText(memory) }], structuredContent: { memory } }
          : ok(memory);
      }

      case 'memory_search': {
        const query = requiredString(args, 'query');
        const results = await adapter.search(query, {
          layer: optionalLayer(args),
          limit: optionalLimit(args, 10),
          projectId: optionalString(args, 'projectId'),
          includeDescendants: args.includeDescendants !== false,
          includeSuperseded: Boolean(args.includeSuperseded),
          asOf: optionalString(args, 'asOf'),
          includeExpired: Boolean(args.includeExpired),
          explain: Boolean(args.explain),
          memoryKind: optionalString(args, 'memoryKind') as MemoryKind | undefined,
          tags: optionalStringArray(args, 'tags'),
          tagsMatch: optionalTagsMatch(args),
          entityId: optionalString(args, 'entityId'),
          entityName: optionalString(args, 'entityName'),
          entityType: optionalEntityType(args),
          source: optionalString(args, 'source'),
          minConfidence: optionalNumber(args, 'minConfidence'),
          createdAfter: optionalString(args, 'createdAfter'),
          createdBefore: optionalString(args, 'createdBefore'),
          updatedAfter: optionalString(args, 'updatedAfter'),
          updatedBefore: optionalString(args, 'updatedBefore'),
          lastHitAfter: optionalString(args, 'lastHitAfter'),
          lastHitBefore: optionalString(args, 'lastHitBefore'),
        });
        return agentText
          ? { content: [{ type: 'text', text: searchResultsText(query, results) }], structuredContent: { results } }
          : ok(results);
      }

      case 'memory_context_pack': {
        const pack = await buildAgentContextPack({
          query: optionalString(args, 'query'),
          project: optionalString(args, 'project'),
          projectId: optionalString(args, 'projectId'),
          includeDescendants: args.includeDescendants !== false,
          includeSuperseded: Boolean(args.includeSuperseded),
          asOf: optionalString(args, 'asOf'),
          includeExpired: Boolean(args.includeExpired),
          memoryKinds: optionalStringArray(args, 'memoryKinds') as MemoryKind[] | undefined,
          maxItems: optionalNumber(args, 'maxItems'),
          maxChars: optionalNumber(args, 'maxChars'),
          // 从 adapter 提取当前 agent 可见空间，确保 context pack 不会跨 agent 私有空间泄露
          agentSpaces: adapter.getAgentSpaces?.(),
        });
        return { content: [{ type: 'text', text: pack.markdown }], structuredContent: { contextPack: pack } };
      }

      case 'memory_loop_start':
        return ok(await startLoopRun({
          objective: requiredString(args, 'objective'),
          project: optionalString(args, 'project'),
          projectId: optionalString(args, 'projectId'),
          agentId: requiredString(args, 'agentId'),
          idempotencyKey: requiredString(args, 'idempotencyKey'),
          leaseOwner: requiredString(args, 'leaseOwner'),
          leaseTtlSeconds: optionalNumber(args, 'leaseTtlSeconds'),
          query: optionalString(args, 'query'),
          maxItems: optionalNumber(args, 'maxItems'),
          maxChars: optionalNumber(args, 'maxChars'),
          metadata: optionalRecord(args, 'metadata'),
          tokenBudget: optionalNumber(args, 'tokenBudget'),
          costUsdBudget: optionalNumber(args, 'costUsdBudget'),
        } satisfies LoopRunStartRequest));

      case 'memory_loop_context':
        return ok(await getLoopContext({
          runId: requiredString(args, 'runId'),
          leaseOwner: requiredString(args, 'leaseOwner'),
          renewLeaseSeconds: optionalNumber(args, 'renewLeaseSeconds'),
          query: optionalString(args, 'query'),
          afterSequence: optionalNumber(args, 'afterSequence'),
          maxEvents: optionalNumber(args, 'maxEvents'),
          maxItems: optionalNumber(args, 'maxItems'),
          maxChars: optionalNumber(args, 'maxChars'),
        } satisfies LoopContextRequest));

      case 'memory_loop_checkpoint':
        return ok(await checkpointLoopRun({
          runId: requiredString(args, 'runId'),
          expectedVersion: requiredNumber(args, 'expectedVersion'),
          idempotencyKey: requiredString(args, 'idempotencyKey'),
          leaseOwner: requiredString(args, 'leaseOwner'),
          leaseTtlSeconds: optionalNumber(args, 'leaseTtlSeconds'),
          phase: requiredString(args, 'phase'),
          summary: requiredString(args, 'summary'),
          state: optionalRecord(args, 'state'),
          nextActions: optionalStringArray(args, 'nextActions'),
          artifacts: optionalStringArray(args, 'artifacts'),
          memoryRefs: optionalStringArray(args, 'memoryRefs'),
          status: optionalString(args, 'status') as LoopCheckpointRequest['status'],
          eventName: optionalString(args, 'eventName'),
          severity: optionalString(args, 'severity') as LoopCheckpointRequest['severity'],
          spanId: optionalString(args, 'spanId'),
          tokenUsage: optionalNumber(args, 'tokenUsage'),
          attemptOutcome: optionalString(args, 'attemptOutcome') as LoopCheckpointRequest['attemptOutcome'],
          error: optionalString(args, 'error'),
        } satisfies LoopCheckpointRequest));

      case 'memory_loop_finish':
        return ok(await finishLoopRun({
          runId: requiredString(args, 'runId'),
          expectedVersion: requiredNumber(args, 'expectedVersion'),
          idempotencyKey: requiredString(args, 'idempotencyKey'),
          leaseOwner: requiredString(args, 'leaseOwner'),
          status: requiredString(args, 'status') as LoopFinishRequest['status'],
          summary: requiredString(args, 'summary'),
          state: optionalRecord(args, 'state'),
          artifacts: optionalStringArray(args, 'artifacts'),
          memoryRefs: optionalStringArray(args, 'memoryRefs'),
          spanId: optionalString(args, 'spanId'),
          tokenUsage: optionalNumber(args, 'tokenUsage'),
          attemptOutcome: optionalString(args, 'attemptOutcome') as LoopFinishRequest['attemptOutcome'],
          error: optionalString(args, 'error'),
        } satisfies LoopFinishRequest));

      case 'memory_read': {
        const id = requiredString(args, 'id');
        const memory = await adapter.read(id);
        return memory ? ok(memory) : fail(`Memory not found or not accessible: ${id}`);
      }

      case 'memory_list': {
        const status = optionalString(args, 'status');
        if (status && !VALID_MEMORY_STATUSES.has(status as MemoryStatus)) {
          throw new ToolInputError('status must be active, archived, decayed, or deleted');
        }
        return ok(listMemories({
          layer: optionalLayer(args),
          projectId: optionalString(args, 'projectId'),
          status: (status as MemoryStatus | undefined) ?? 'active',
          limit: optionalLimit(args, 20),
          // 隔离过滤：memory_list 也必须遵守 agent_space 可见性，防止跨 agent 看到私有记忆
          agentSpaces: adapter.getAgentSpaces?.(),
          tags: optionalStringArray(args, 'tags'),
          tagsMatch: optionalTagsMatch(args),
          entityId: optionalString(args, 'entityId'),
          entityName: optionalString(args, 'entityName'),
          entityType: optionalEntityType(args),
          source: optionalString(args, 'source'),
          minConfidence: optionalNumber(args, 'minConfidence'),
          createdAfter: optionalString(args, 'createdAfter'),
          createdBefore: optionalString(args, 'createdBefore'),
          updatedAfter: optionalString(args, 'updatedAfter'),
          updatedBefore: optionalString(args, 'updatedBefore'),
          lastHitAfter: optionalString(args, 'lastHitAfter'),
          lastHitBefore: optionalString(args, 'lastHitBefore'),
          asOf: optionalString(args, 'asOf'),
          includeExpired: Boolean(args.includeExpired),
        }));
      }

      case 'memory_update': {
        const id = requiredString(args, 'id');
        const visible = await adapter.read(id);
        if (!visible) return fail(`Memory not found or not accessible: ${id}`);
        const input = buildUpdateInput(args);
        const memory = updateMemory(id, input, optionalString(args, 'change_reason'));
        if (!memory) return fail(`Memory not found: ${id}`);
        // 后处理（嵌入刷新 + 实体链接 + 关联重建）已内聚到 updateMemory 内部
        return ok(memory);
      }

      case 'memory_delete': {
        const id = requiredString(args, 'id');
        const success = await adapter.delete(id);
        return success ? ok(agentText ? { success, id } : success) : fail(`Memory not found or not deletable: ${id}`);
      }

      case 'memory_auto_remember':
      case 'keymemory_auto_remember': {
        const result = await autoRemember({
          content: requiredString(args, 'content'),
          source: optionalString(args, 'source'),
          agentId: optionalString(args, 'agentId'),
          isolationMode: optionalString(args, 'isolationMode') as IsolationMode | undefined,
          currentProjectId: optionalString(args, 'currentProject'),
          conversationRound: optionalNumber(args, 'conversationRound'),
        });
        return ok(result);
      }

      case 'memory_relate': {
        const sourceId = requiredString(args, 'sourceId');
        const targetId = requiredString(args, 'targetId');
        const relationType = requiredString(args, 'relationType');
        if (!MEMORY_RELATION_TYPES.includes(relationType as typeof MEMORY_RELATION_TYPES[number])) {
          throw new ToolInputError(`relationType must be one of: ${MEMORY_RELATION_TYPES.join(', ')}`);
        }
        // 隔离校验：只能对当前 agent 可见的记忆创建关系，防止跨 agent 越权关联私有记忆
        const sourceVisible = await adapter.read(sourceId);
        if (!sourceVisible) return fail(`Memory not found or not accessible: ${sourceId}`);
        const targetVisible = await adapter.read(targetId);
        if (!targetVisible) return fail(`Memory not found or not accessible: ${targetId}`);
        return ok(createMemoryRelation(
          sourceId,
          targetId,
          relationType,
          optionalNumber(args, 'strength') ?? 1.0,
          optionalString(args, 'reason'),
        ));
      }

      case 'memory_supersede': {
        const sourceId = requiredString(args, 'sourceId');
        const targetId = requiredString(args, 'targetId');
        const sourceVisible = await adapter.read(sourceId);
        if (!sourceVisible) return fail(`Memory not found or not accessible: ${sourceId}`);
        const targetVisible = await adapter.read(targetId);
        if (!targetVisible) return fail(`Memory not found or not accessible: ${targetId}`);
        return ok(supersedeMemory(sourceId, targetId, {
          effectiveAt: optionalString(args, 'effectiveAt'),
          reason: requiredString(args, 'reason'),
        }));
      }

      case 'memory_related': {
        const id = requiredString(args, 'id');
        const visible = await adapter.read(id);
        if (!visible) return fail(`Memory not found or not accessible: ${id}`);
        const related = findRelatedMemories(id, optionalString(args, 'relationType'));
        const accessibleSpaces = adapter.getAgentSpaces?.();
        if (!accessibleSpaces) return ok(related);
        // 过滤掉不可见空间的关联记忆，防止通过关系图泄露其他 agent 的私有记忆 title/content
        const accessibleSet = new Set(accessibleSpaces);
        return ok(related.filter(rel => {
          const mem = getMemory(rel.memoryId);
          return mem && accessibleSet.has(mem.agentSpace);
        }));
      }

      case 'memory_import': {
        const memories = args.memories;
        if (!Array.isArray(memories)) throw new ToolInputError('memories must be an array');
        const autoLayer = args.autoLayer !== false;
        const stripPrefixes = args.stripPrefixes !== false;
        let imported = 0;
        const skipped: string[] = [];

        for (const rawInput of memories) {
          const raw = isRecord(rawInput) ? rawInput : {};
          const title = stripCommonPrefix(raw.title, stripPrefixes).trim();
          const content = stripCommonPrefix(raw.content, stripPrefixes).trim();
          if (!title || !content) {
            skipped.push(title || '(empty)');
            continue;
          }
          const metadata = isRecord(raw.metadata) ? raw.metadata : undefined;
          const rawLayer = typeof raw.layer === 'string' && VALID_LAYERS.has(raw.layer as Layer)
            ? raw.layer as Layer
            : undefined;
          const layer = rawLayer ?? (autoLayer ? inferImportLayer(title, content, metadata) : 'short');
          await writeMemory(adapter, {
            title,
            content,
            layer,
            projectId: typeof raw.projectId === 'string' ? raw.projectId : undefined,
            projectPath: typeof raw.projectPath === 'string' ? raw.projectPath : undefined,
            confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
            validFrom: typeof raw.validFrom === 'string' ? raw.validFrom : undefined,
            validTo: typeof raw.validTo === 'string' ? raw.validTo : undefined,
            tags: Array.isArray(raw.tags) && raw.tags.every(item => typeof item === 'string') ? raw.tags : extractTags(content),
            metadata,
            source: typeof raw.source === 'string' ? raw.source : undefined,
            sourceId: typeof raw.sourceId === 'string' ? raw.sourceId : undefined,
          });
          imported++;
        }

        return ok({ imported, skipped });
      }

      case 'memory_migration_discover': {
        const root = optionalString(args, 'root');
        const roots = root ? root.split(/[;,]/g).map(item => item.trim()).filter(Boolean) : undefined;
        return ok(discoverMigrationSources({
          roots,
          includeHome: args.includeHome !== false,
          includeMissing: Boolean(args.includeMissing),
        }));
      }

      case 'memory_migration_import':
        return ok(await migrateMemoriesFromPath(requiredString(args, 'path'), {
          source: optionalString(args, 'source'),
          format: optionalString(args, 'format') as 'auto' | 'json' | 'jsonl' | 'markdown' | 'text' | undefined,
          defaultLayer: optionalLayer(args, 'defaultLayer'),
          defaultProjectPath: optionalString(args, 'defaultProjectPath'),
          recursive: args.recursive !== false,
          maxFiles: optionalNumber(args, 'maxFiles'),
          runDream: Boolean(args.runDream),
          dryRun: Boolean(args.dryRun),
        }));

      case 'memory_backup_create':
        return ok(createBackupFile(optionalString(args, 'filePath'), {
          includeEmbeddings: Boolean(args.includeEmbeddings),
          includeOperationalLogs: Boolean(args.includeOperationalLogs),
        }));

      case 'memory_backup_inspect':
        return ok(inspectBackupFile(requiredString(args, 'filePath')));

      case 'memory_backup_restore_dry_run':
        return ok(restoreBackupFile(requiredString(args, 'filePath'), { dryRun: true }));

      case 'memory_project_suggestions': {
        const status = optionalString(args, 'status');
        if (status && !['pending', 'accepted', 'rejected'].includes(status)) {
          throw new ToolInputError('status must be pending, accepted, or rejected');
        }
        return ok(listProjectSuggestions(status as 'pending' | 'accepted' | 'rejected' | undefined));
      }

      case 'memory_project_suggestion_accept':
        return ok(acceptProjectSuggestion(requiredString(args, 'id'), optionalString(args, 'customName')));

      case 'memory_project_suggestion_reject': {
        const id = requiredString(args, 'id');
        return ok({ success: rejectProjectSuggestion(id), id });
      }

      case 'memory_secret_set':
        return ok(setToolSecret({
          tool: requiredString(args, 'tool'),
          name: optionalString(args, 'name'),
          value: requiredString(args, 'value'),
          metadata: optionalRecord(args, 'metadata'),
        }));

      case 'memory_secret_get': {
        const secret = getToolSecret(requiredString(args, 'tool'), optionalString(args, 'name'));
        return secret ? ok(secret) : fail('secret not found');
      }

      case 'memory_secret_list':
        return ok(listToolSecrets(optionalString(args, 'tool')));

      case 'memory_secret_delete':
        return ok({
          success: deleteToolSecret(requiredString(args, 'tool'), optionalString(args, 'name')),
          tool: requiredString(args, 'tool'),
          name: optionalString(args, 'name') ?? 'api_key',
        });

      case 'memory_isolation_rule_create': {
        const ruleType = optionalString(args, 'ruleType');
        if (ruleType !== 'regex' && ruleType !== 'keyword') {
          throw new ToolInputError('ruleType must be "regex" or "keyword"');
        }
        const pattern = requiredString(args, 'pattern');
        const targetSpace = requiredString(args, 'targetSpace');
        const rule = createRule({
          agentId: optionalString(args, 'agentId'),
          ruleType: ruleType as IsolationRuleType,
          pattern,
          targetSpace,
          priority: optionalNumber(args, 'priority'),
          enabled: args.enabled === undefined ? undefined : Boolean(args.enabled),
        });
        return ok(rule);
      }

      case 'memory_isolation_rule_list':
        return ok(listAllRules(optionalString(args, 'agentId')));

      case 'memory_isolation_rule_update': {
        const id = requiredString(args, 'id');
        const ruleType = optionalString(args, 'ruleType');
        if (ruleType !== undefined && ruleType !== 'regex' && ruleType !== 'keyword') {
          throw new ToolInputError('ruleType must be "regex" or "keyword"');
        }
        const updated = updateRule(id, {
          ruleType: ruleType as IsolationRuleType | undefined,
          pattern: optionalString(args, 'pattern'),
          targetSpace: optionalString(args, 'targetSpace'),
          priority: optionalNumber(args, 'priority'),
          enabled: args.enabled === undefined ? undefined : Boolean(args.enabled),
        });
        if (!updated) return fail(`Rule not found: ${id}`);
        return ok(updated);
      }

      case 'memory_isolation_rule_delete': {
        const id = requiredString(args, 'id');
        const success = deleteRule(id);
        return ok({ success, id });
      }

      case 'memory_entity_alias_add': {
        const entityId = requiredString(args, 'entityId');
        const alias = requiredString(args, 'alias');
        try {
          return ok(addEntityAlias(entityId, alias));
        } catch (err) {
          return fail((err as Error).message);
        }
      }

      case 'memory_entity_alias_remove': {
        const entityId = requiredString(args, 'entityId');
        const alias = requiredString(args, 'alias');
        return ok({ success: removeEntityAlias(entityId, alias), entityId, alias });
      }

      case 'memory_entity_alias_list':
        return ok(listEntityAliases(requiredString(args, 'entityId')));

      case 'memory_entity_merge': {
        const sourceId = requiredString(args, 'sourceId');
        const targetId = requiredString(args, 'targetId');
        try {
          return ok(mergeEntities(sourceId, targetId));
        } catch (err) {
          return fail((err as Error).message);
        }
      }

      case 'memory_entity_duplicates':
        return ok(findDuplicateEntities());

      default:
        return fail(`Unknown tool: ${String(name)}`);
    }
  } catch (err) {
    if (err instanceof LoopProtocolError) {
      const observation = loopErrorObservation(err);
      return {
        content: [{ type: 'text', text: JSON.stringify(observation, null, 2) }],
        structuredContent: { observation },
        isError: true,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return fail(message);
  }
}
