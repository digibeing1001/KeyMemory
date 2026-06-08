import type { CreateMemoryInput, IsolationMode, Layer, MemoryKind, MemoryStatus, UpdateMemoryInput } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { getMemory, listMemories, updateMemory } from './atom.js';
import { searchHybrid, ensureEmbedding } from './query.js';
import { autoRemember, extractTags } from './auto.js';
import { discoverMigrationSources, migrateMemoriesFromPath } from './migration.js';
import { buildAgentContextPack } from './context-pack.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile } from './backup.js';
import { acceptProjectSuggestion, listProjectSuggestions, rejectProjectSuggestion } from './project.js';
import { createMemoryRelation, findRelatedMemories, MEMORY_RELATION_TYPES } from '../graph/entity.js';
import { deleteToolSecret, getToolSecret, listToolSecrets, setToolSecret } from './secrets.js';
import { canonicalToolName } from './mcp-tools.js';
import type { MemoryAdapter } from '../adapters/base.js';

export interface McpToolExecutionResult {
  content: Array<{ type: 'text'; text: string }>;
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
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function fail(message: string): McpToolExecutionResult {
  return { content: [{ type: 'text', text: message }], isError: true };
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

function optionalLimit(args: Record<string, unknown>, fallback: number, max = 100): number {
  const raw = optionalNumber(args, 'limit');
  const limit = Math.trunc(raw ?? fallback);
  if (limit < 1) throw new ToolInputError('limit must be at least 1');
  return Math.min(limit, max);
}

function buildCreateInput(args: Record<string, unknown>): CreateMemoryInput {
  const title = requiredString(args, 'title');
  const content = requiredString(args, 'content');
  const layer = requiredLayer(args);
  const tags = optionalStringArray(args, 'tags') ?? extractTags(content);

  return {
    title,
    content,
    layer,
    projectId: optionalString(args, 'projectId'),
    projectPath: optionalString(args, 'projectPath'),
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
  const confidence = optionalNumber(args, 'confidence');

  if (title !== undefined) input.title = title;
  if (content !== undefined) input.content = content;
  if (layer !== undefined) input.layer = layer;
  if (projectId !== undefined) input.projectId = projectId;
  if (projectPath !== undefined) input.projectPath = projectPath;
  if (tags !== undefined) input.tags = tags;
  if (metadata !== undefined) input.metadata = metadata;
  if (source !== undefined) input.source = source;
  if (confidence !== undefined) input.confidence = Math.max(0, Math.min(1, confidence));

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
  if (/preference|rule|principle|decision|project|architecture|repo|framework/.test(text)) return 'long';
  if (/todo|today|tomorrow|temporary|pending/.test(text)) return 'short';
  return content.length > 200 ? 'long' : 'short';
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
  ensureEmbedding(memory.id, memory.title, memory.content, memory.tags, memory.metadata as Record<string, unknown> | undefined)
    .catch(() => {});
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
      case 'memory_create': {
        const memory = await writeMemory(adapter, buildCreateInput(args));
        return agentText ? { content: [{ type: 'text', text: memorySavedText(memory) }] } : ok(memory);
      }

      case 'memory_search': {
        const query = requiredString(args, 'query');
        const results = await adapter.search(query, {
          layer: optionalLayer(args),
          limit: optionalLimit(args, 10),
          projectId: optionalString(args, 'projectId'),
          includeDescendants: args.includeDescendants !== false,
          includeSuperseded: Boolean(args.includeSuperseded),
          memoryKind: optionalString(args, 'memoryKind') as MemoryKind | undefined,
        });
        return agentText ? { content: [{ type: 'text', text: searchResultsText(query, results) }] } : ok(results);
      }

      case 'memory_context_pack': {
        const pack = await buildAgentContextPack({
          query: optionalString(args, 'query'),
          project: optionalString(args, 'project'),
          projectId: optionalString(args, 'projectId'),
          includeDescendants: args.includeDescendants !== false,
          memoryKinds: optionalStringArray(args, 'memoryKinds') as MemoryKind[] | undefined,
          maxItems: optionalNumber(args, 'maxItems'),
          maxChars: optionalNumber(args, 'maxChars'),
        });
        return { content: [{ type: 'text', text: pack.markdown }] };
      }

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
          status: status as MemoryStatus | undefined,
          limit: optionalLimit(args, 20),
        }));
      }

      case 'memory_update': {
        const id = requiredString(args, 'id');
        const visible = await adapter.read(id);
        if (!visible) return fail(`Memory not found or not accessible: ${id}`);
        const input = buildUpdateInput(args);
        const memory = updateMemory(id, input, optionalString(args, 'change_reason'));
        if (!memory) return fail(`Memory not found: ${id}`);
        if (input.title !== undefined || input.content !== undefined || input.tags !== undefined) {
          ensureEmbedding(memory.id, memory.title, memory.content, memory.tags, memory.metadata as Record<string, unknown> | undefined, true)
            .catch(() => {});
        }
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
        if (!getMemory(sourceId)) return fail(`Memory not found: ${sourceId}`);
        if (!getMemory(targetId)) return fail(`Memory not found: ${targetId}`);
        return ok(createMemoryRelation(
          sourceId,
          targetId,
          relationType,
          optionalNumber(args, 'strength') ?? 1.0,
          optionalString(args, 'reason'),
        ));
      }

      case 'memory_related': {
        const id = requiredString(args, 'id');
        if (!getMemory(id)) return fail(`Memory not found: ${id}`);
        return ok(findRelatedMemories(id, optionalString(args, 'relationType')));
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

      default:
        return fail(`Unknown tool: ${String(name)}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(message);
  }
}
