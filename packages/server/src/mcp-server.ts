#!/usr/bin/env node
import { stdin, stdout, stderr } from 'process';
import { inspect } from 'util';
import { createMemory, getMemory, listMemories, deleteMemory, updateMemory } from './core/atom.js';
import { searchHybrid, ensureEmbedding } from './core/query.js';
import { initDatabase } from './db/sqlite.js';
import { initEmbedding } from './embed/onnx.js';
import { autoRemember, extractTags } from './core/auto.js';
import { getLayerStats } from './core/layer.js';
import type { Layer } from '@keymemory/shared';
import { runDailyInspection } from './core/evolution.js';
import { applyDecay } from './core/forgetting.js';
import { startScheduler, stopScheduler } from './core/scheduler.js';
import { discoverMigrationSources, migrateMemoriesFromPath } from './core/migration.js';
import { buildAgentContextPack } from './core/context-pack.js';
import { createMemoryRelation, findRelatedMemories, MEMORY_RELATION_TYPES } from './graph/entity.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile } from './core/backup.js';
import { acceptProjectSuggestion, listProjectSuggestions, rejectProjectSuggestion } from './core/project.js';
import { canonicalToolName, MCP_TOOLS } from './core/mcp-tools.js';

function formatLogArg(arg: unknown): string {
  if (arg instanceof Error) return arg.stack || arg.message;
  if (typeof arg === 'string') return arg;
  return inspect(arg, { depth: 4, colors: false, breakLength: Infinity });
}

function writeLog(level: string, args: unknown[]): void {
  stderr.write(`[KeyMemory ${level}] ${args.map(formatLogArg).join(' ')}\n`);
}

console.log = (...args: unknown[]) => writeLog('info', args);
console.warn = (...args: unknown[]) => writeLog('warn', args);
console.error = (...args: unknown[]) => writeLog('error', args);

const launchedByKeyMemoryLauncher = process.env.KEYMEMORY_STDIO === '1';

function shutdown(exitCode = 0): void {
  try {
    if (!launchedByKeyMemoryLauncher) stopScheduler();
  } finally {
    process.exit(exitCode);
  }
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
process.once('uncaughtException', (err) => {
  writeLog('fatal', ['Uncaught exception:', err]);
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  writeLog('error', ['Unhandled rejection:', reason]);
});

initDatabase();

initEmbedding().catch(() => {});

if (launchedByKeyMemoryLauncher) {
  console.log('stdio MCP mode: background REST server and scheduler disabled');
} else {
  setInterval(async () => {
    try { await runDailyInspection(); applyDecay(); } catch {}
  }, 86400000);

  startScheduler();

  startRestServerInBackground();
}

async function startRestServerInBackground() {
  try {
    const Fastify = (await import('fastify')).default;
    const cors = (await import('@fastify/cors')).default;
    const { registerRoutes } = await import('./api/rest.js');
    const { registerMCPRoutes } = await import('./api/mcp.js');
    const { registerWebUI } = await import('./web-ui.js');
    const { DEFAULT_PORT, DEFAULT_HOST } = await import('@keymemory/shared');
    const { assertSafeServerBinding, createCorsOriginPolicy } = await import('./core/security.js');

    assertSafeServerBinding(DEFAULT_HOST);
    const app = Fastify({ logger: false });
    await app.register(cors, { origin: createCorsOriginPolicy() });
    registerRoutes(app);
    registerMCPRoutes(app);
    registerWebUI(app);
    await app.listen({ port: DEFAULT_PORT, host: DEFAULT_HOST });

    stderr.write(`[KeyMemory] REST API + Web UI available at http://${DEFAULT_HOST}:${DEFAULT_PORT}\n`);
  } catch (err) {
    stderr.write(`[KeyMemory] REST API startup skipped: ${(err as Error).message}\n`);
  }
}

function sendJson(data: unknown) {
  stdout.write(JSON.stringify(data) + '\n');
}

function sendJsonRpc(id: string | number | null, result?: unknown, error?: unknown) {
  const response: any = { jsonrpc: '2.0', id };
  if (error) {
    response.error = error;
  } else {
    response.result = result;
  }
  sendJson(response);
}

async function handleRequest(request: any) {
  const { method, params, id } = request;

  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
        serverInfo: {
          name: 'keymemory',
          version: '0.1.0',
        },
      };

    case 'tools/list':
      return { tools: MCP_TOOLS };

      return {
        tools: [
          {
            name: 'memory_create',
            description: '创建一条新记忆。用于记住用户的重要信息、偏好、技术细节等。\n\n重要：写入记忆时必须补充结构化信息，以便后续搜索能精准命中：\n- tags：添加关键词标签，帮助分类和检索\n- metadata：补充上下文元数据，推荐字段：\n  - timeline: 时间信息（如 "2024-03 至今"）\n  - entities: 涉及的人/组织/项目\n  - context: 记忆产生的场景或原因\n  - category: 内容分类（偏好/技术/项目/人际/决策）\n  - importance: 重要程度（high/medium/low）\n- source：标记记忆来源（如 "conversation", "notionclaw", "hindsight"）\n\n这些结构化字段会参与搜索排序，信息越完整，搜索越精准。',
            inputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '简洁明了的标题' },
                content: { type: 'string', description: '完整的记忆内容，支持 Markdown 格式' },
                layer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'], description: '记忆层级：flash(临时), short(几天), long(长期), project(项目), entity(实体)' },
                projectId: { type: 'string', description: '关联的项目ID（可选）' },
                projectPath: { type: 'string', description: 'Project path such as Product/Backend/Memory. Missing folders are created automatically.' },
                tags: { type: 'array', items: { type: 'string' }, description: '标签列表，帮助分类和检索（必填推荐）' },
                metadata: { type: 'object', description: '结构化元数据。推荐字段：timeline(时间线), entities(涉及实体), context(场景), category(分类), importance(重要程度)' },
                source: { type: 'string', description: '记忆来源标识（如 conversation, notionclaw, hindsight）' },
              },
              required: ['title', 'content', 'layer'],
            },
          },
          {
            name: 'memory_search',
            description: '搜索相关记忆。使用关键词混合搜索（全文+语义）来找到用户之前提到的信息。',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '搜索关键词' },
                projectId: { type: 'string', description: 'Limit to a project. Descendants are included by default.' },
                includeDescendants: { type: 'boolean', description: 'Whether project search includes child projects. Default true.' },
                includeSuperseded: { type: 'boolean', description: 'Include memories superseded by active newer memories. Default false.' },
                memoryKind: { type: 'string', enum: ['preference', 'project_fact', 'decision', 'task', 'procedure', 'concept', 'relationship', 'event', 'constraint', 'raw_note'], description: 'Filter by normalized memory kind.' },
                limit: { type: 'number', description: '返回结果数量（默认10）' },
              },
              required: ['query'],
            },
          },
          {
            name: 'memory_context_pack',
            description: 'Build an agent-ready context pack grouped by preferences, constraints, decisions, tasks, procedures, and project facts. Use before long-running work.',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string', description: 'Current task or question.' },
                project: { type: 'string', description: 'Project path/name/id. Descendants are included by default.' },
                projectId: { type: 'string', description: 'Project ID.' },
                includeDescendants: { type: 'boolean', description: 'Whether to include child projects. Default true.' },
                memoryKinds: { type: 'array', items: { type: 'string' }, description: 'Optional memory kinds to include.' },
                maxItems: { type: 'number', description: 'Max memories. Default 12.' },
                maxChars: { type: 'number', description: 'Approximate character budget. Default 6000.' },
              },
            },
          },
          {
            name: 'memory_relate',
            description: 'Create or update a memory-to-memory relation, e.g. supersedes when newer guidance replaces old guidance.',
            inputSchema: {
              type: 'object',
              properties: {
                sourceId: { type: 'string', description: 'Source memory ID.' },
                targetId: { type: 'string', description: 'Target memory ID.' },
                relationType: { type: 'string', enum: [...MEMORY_RELATION_TYPES], description: 'Relation type.' },
                strength: { type: 'number', description: 'Relation strength from 0 to 1. Default 1.' },
                reason: { type: 'string', description: 'Provenance or reason for this relation.' },
              },
              required: ['sourceId', 'targetId', 'relationType'],
            },
          },
          {
            name: 'memory_related',
            description: 'List memories related to one memory, including dream-created supersedes relations.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Memory ID.' },
                relationType: { type: 'string', enum: [...MEMORY_RELATION_TYPES], description: 'Optional relation type filter.' },
              },
              required: ['id'],
            },
          },
          {
            name: 'memory_read',
            description: '读取一条记忆的完整内容。通过 ID 获取详细信息。',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string', description: '记忆的唯一标识符' } },
              required: ['id'],
            },
          },
          {
            name: 'memory_list',
            description: '列出最近的记忆。可以按层级筛选。',
            inputSchema: {
              type: 'object',
              properties: {
                layer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'], description: '按层级筛选' },
                limit: { type: 'number', description: '返回数量（默认20）' },
              },
            },
          },
          {
            name: 'memory_delete',
            description: '删除一条不再需要的记忆。',
            inputSchema: {
              type: 'object',
              properties: { id: { type: 'string', description: '要删除的记忆 ID' } },
              required: ['id'],
            },
          },
          {
            name: 'memory_update',
            description: '更新一条已有的记忆。可修改标题、内容、层级、项目、标签、元数据等。',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '要更新的记忆 ID' },
                title: { type: 'string', description: '新的标题（可选）' },
                content: { type: 'string', description: '新的内容（可选）' },
                layer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'], description: '新的层级（可选）' },
                project: { type: 'string', description: '新的关联项目（可选）' },
                tags: { type: 'array', items: { type: 'string' }, description: '新的标签列表（可选）' },
                metadata: { type: 'object', description: '新的元数据（可选）' },
                change_reason: { type: 'string', description: '变更原因（可选，建议层级移动时填写）' },
              },
              required: ['id'],
            },
          },
          {
            name: 'memory_auto_remember',
            description: '自动记忆：传入对话内容，系统自动评估是否值得记录，自动选择层级并保存。推荐优先使用此工具。',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string', description: '要记忆的对话内容' },
                agentId: { type: 'string', description: 'Agent 标识（如 hermes）' },
                currentProject: { type: 'string', description: '当前项目名称（可选）' },
              },
              required: ['content'],
            },
          },
          {
            name: 'memory_import',
            description: '批量导入记忆，通用迁移工具。支持从任何来源（笔记、文档、对话记录、其他记忆系统等）批量导入。\n\n特性：\n- 自动清理标题/内容中的来源前缀（如 [NC]、H:、迁移：等任何 [xxx]、xxx: 格式）\n- autoLayer 模式：不指定 layer 时自动根据内容推断层级\n- 自动提取 tags：从内容中识别关键实体作为标签\n- 支持任意 metadata 结构，保留原始系统的丰富信息',
            inputSchema: {
              type: 'object',
              properties: {
                memories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string', description: '记忆标题' },
                      content: { type: 'string', description: '记忆完整内容' },
                      layer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'], description: '记忆层级。不指定时自动推断' },
                      project: { type: 'string', description: '关联项目名' },
                      tags: { type: 'array', items: { type: 'string' }, description: '标签列表' },
                      metadata: { type: 'object', description: '任意结构化元数据（时间线、实体、上下文、原始字段等）' },
                      source: { type: 'string', description: '来源标识（如 notionclaw、hindsight、obsidian、chatgpt、manual）' },
                      sourceId: { type: 'string', description: '原始系统中的 ID' },
                    },
                    required: ['title', 'content'],
                  },
                  description: '要导入的记忆列表。layer 为可选，不指定时自动推断',
                },
                autoLayer: { type: 'boolean', description: '是否自动推断层级（默认 true）。未指定 layer 的记忆会根据内容自动分配' },
                stripPrefixes: { type: 'boolean', description: '是否自动清理来源前缀（默认 true）' },
              },
              required: ['memories'],
            },
          },
          {
            name: 'memory_migration_discover',
            description: 'Discover local memory sources for one-click migration. Works across Windows, Linux, macOS, and WSL using home/workspace paths.',
            inputSchema: {
              type: 'object',
              properties: {
                root: { type: 'string', description: 'Optional workspace root path. Multiple paths may be separated by ; or ,' },
                includeHome: { type: 'boolean', description: 'Include home-directory memory sources. Default true.' },
                includeMissing: { type: 'boolean', description: 'Include expected source paths even when missing. Default false.' },
              },
            },
          },
          {
            name: 'memory_migration_import',
            description: 'Import one discovered memory source, file, or directory, then normalize project tree, memory kind, tags, and optional dream consolidation.',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File or directory path to import' },
                source: { type: 'string', description: 'Source identifier, e.g. codex, claude-code, cursor, mem0' },
                format: { type: 'string', enum: ['auto', 'json', 'jsonl', 'markdown', 'text'], description: 'Input format. Default auto.' },
                defaultLayer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'], description: 'Fallback memory layer. Default long.' },
                defaultProjectPath: { type: 'string', description: 'Fallback project path if none is found in source content.' },
                recursive: { type: 'boolean', description: 'Import supported files recursively when path is a directory. Default true.' },
                maxFiles: { type: 'number', description: 'Directory file cap. Default 200.' },
                runDream: { type: 'boolean', description: 'Run a dream cycle after import. Default false.' },
                dryRun: { type: 'boolean', description: 'Preview counts without writing memories or running dream. Default false.' },
              },
              required: ['path'],
            },
          },
          {
            name: 'memory_backup_create',
            description: 'Create a portable KeyMemory JSON backup before migration, dream consolidation, or risky maintenance.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'Optional backup file path. Defaults to KeyMemory data-dir backups folder.' },
                includeEmbeddings: { type: 'boolean', description: 'Include embedding blobs. Larger file. Default false.' },
                includeOperationalLogs: { type: 'boolean', description: 'Include query logs that may contain user text. Default false.' },
              },
            },
          },
          {
            name: 'memory_backup_inspect',
            description: 'Inspect and checksum-verify a KeyMemory backup file without changing current data.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'Backup file path to inspect.' },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'memory_backup_restore_dry_run',
            description: 'Validate whether a KeyMemory backup could be restored. This is dry-run only and never writes data.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: { type: 'string', description: 'Backup file path to validate.' },
              },
              required: ['filePath'],
            },
          },
          {
            name: 'memory_project_suggestions',
            description: 'List dream-created project organization suggestions so agents can review proposed project-tree changes.',
            inputSchema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['pending', 'accepted', 'rejected'], description: 'Optional suggestion status. Default all.' },
              },
            },
          },
          {
            name: 'memory_project_suggestion_accept',
            description: 'Accept a project organization suggestion and move the suggested projects under a new parent project.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Suggestion ID.' },
                customName: { type: 'string', description: 'Optional custom parent project name.' },
              },
              required: ['id'],
            },
          },
          {
            name: 'memory_project_suggestion_reject',
            description: 'Reject a project organization suggestion.',
            inputSchema: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Suggestion ID.' },
              },
              required: ['id'],
            },
          },
        ],
      };

    case 'tools/call': {
      const toolName = canonicalToolName(params?.name);
      const args = params?.arguments || {};

      switch (toolName) {
        case 'memory_create': {
          const tags = args.tags ?? extractTags(args.content);
          const mem = createMemory({
            title: args.title,
            content: args.content,
            layer: args.layer,
            projectId: args.projectId,
            projectPath: args.projectPath,
            tags,
            metadata: args.metadata,
            source: args.source,
          });
          ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined).catch((err) => {
            stderr.write(`[KeyMemory] Warning: Failed to create embedding for memory ${mem.id}: ${(err as Error).message}\n`);
          });
          return {
            content: [
              {
                type: 'text',
                text: `记忆已保存\n\nID: ${mem.id}\n标题: ${mem.title}\n层级: ${mem.layer}`,
              },
            ],
          };
        }

        case 'memory_search': {
          const results = await searchHybrid(args.query, {
            limit: args.limit || 10,
            projectId: args.projectId,
            includeDescendants: args.includeDescendants !== false,
            includeSuperseded: Boolean(args.includeSuperseded),
            memoryKind: args.memoryKind,
          });
          if (results.length === 0) {
            return {
              content: [
                { type: 'text', text: `没有找到关于"${args.query}"的记忆` }
              ],
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: `找到 ${results.length} 条相关记忆：\n\n` +
                  results
                    .map((r, i) => {
                      const m = r.memory;
                      let line = `${i + 1}. [${m.layer}] ${m.title}`;
                      if (m.tags && m.tags.length > 0) line += ` | 标签: ${m.tags.join(', ')}`;
                      if (m.source) line += ` | 来源: ${m.source}`;
                      if (m.metadata) {
                        const meta = m.metadata as Record<string, unknown>;
                        const parts: string[] = [];
                        if (meta.timeline) parts.push(`时间: ${meta.timeline}`);
                        if (meta.entities) parts.push(`实体: ${Array.isArray(meta.entities) ? meta.entities.join(', ') : meta.entities}`);
                        if (meta.context) parts.push(`场景: ${meta.context}`);
                        if (meta.category) parts.push(`分类: ${meta.category}`);
                        if (meta.importance) parts.push(`重要度: ${meta.importance}`);
                        if (parts.length > 0) line += ` | ${parts.join(', ')}`;
                      }
                      line += `\n   ${m.content.slice(0, 300)}`;
                      if (m.content.length > 300) line += '...';
                      return line;
                    })
                    .join('\n\n'),
              },
            ],
          };
        }

        case 'memory_context_pack': {
          const pack = await buildAgentContextPack({
            query: typeof args.query === 'string' ? args.query : undefined,
            project: typeof args.project === 'string' ? args.project : undefined,
            projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
            includeDescendants: args.includeDescendants !== false,
            memoryKinds: Array.isArray(args.memoryKinds) ? args.memoryKinds : undefined,
            maxItems: typeof args.maxItems === 'number' ? args.maxItems : undefined,
            maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
          });
          return {
            content: [{ type: 'text', text: pack.markdown }],
          };
        }

        case 'memory_relate': {
          if (!getMemory(args.sourceId)) {
            return { content: [{ type: 'text', text: `Memory not found: ${args.sourceId}` }], isError: true };
          }
          if (!getMemory(args.targetId)) {
            return { content: [{ type: 'text', text: `Memory not found: ${args.targetId}` }], isError: true };
          }
          try {
            const relation = createMemoryRelation(
              String(args.sourceId),
              String(args.targetId),
              String(args.relationType),
              typeof args.strength === 'number' ? args.strength : 1.0,
              typeof args.reason === 'string' ? args.reason : undefined,
            );
            return { content: [{ type: 'text', text: JSON.stringify(relation, null, 2) }] };
          } catch (err) {
            return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
          }
        }

        case 'memory_related': {
          if (!getMemory(args.id)) {
            return { content: [{ type: 'text', text: `Memory not found: ${args.id}` }], isError: true };
          }
          try {
            const related = findRelatedMemories(
              String(args.id),
              typeof args.relationType === 'string' ? args.relationType : undefined,
            );
            return { content: [{ type: 'text', text: JSON.stringify(related, null, 2) }] };
          } catch (err) {
            return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
          }
        }

        case 'memory_read': {
          const mem = getMemory(args.id);
          if (!mem) {
            return {
              content: [{ type: 'text', text: `未找到记忆: ${args.id}` }],
              isError: true,
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: `# ${mem.title}\n\n层级: ${mem.layer}\n状态: ${mem.status}\n创建时间: ${mem.createdAt}${mem.tags && mem.tags.length > 0 ? `\n标签: ${mem.tags.join(', ')}` : ''}${mem.source ? `\n来源: ${mem.source}` : ''}${mem.metadata ? `\n元数据: ${JSON.stringify(mem.metadata, null, 2)}` : ''}\n\n---\n\n${mem.content}`,
              },
            ],
          };
        }

        case 'memory_list': {
          const mems = listMemories({
            layer: args.layer,
            limit: args.limit || 20,
          });
          if (mems.length === 0) {
            return {
              content: [{ type: 'text', text: '还没有记忆，使用 memory_create 创建第一条吧' }],
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: `${mems.length} 条记忆：\n\n` +
                  mems.map((m, i) => {
                    const preview = m.content.slice(0, 100);
                    const suffix = m.content.length > 100 ? '...' : '';
                    return `${i + 1}. [${m.layer}] ${m.title}\n   ID: ${m.id}\n   ${preview}${suffix}`;
                  }).join('\n\n'),
              },
            ],
          };
        }

        case 'memory_delete': {
          const ok = deleteMemory(args.id);
          return {
            content: [{ type: 'text', text: ok ? '记忆已删除' : '未找到该记忆' }],
          };
        }

        case 'memory_update': {
          const { id, change_reason, ...updateData } = args;
          const mem = updateMemory(id, updateData, change_reason);
          if (!mem) {
            return {
              content: [{ type: 'text', text: `未找到记忆: ${id}` }],
              isError: true,
            };
          }
          
          if (updateData.title !== undefined || updateData.content !== undefined) {
            ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata).catch((err) => {
              stderr.write(`[KeyMemory] Warning: Failed to create embedding for memory ${mem.id}: ${(err as Error).message}\n`);
            });
          }
          
          return {
            content: [
              {
                type: 'text',
                text: `记忆已更新\n\nID: ${mem.id}\n标题: ${mem.title}\n层级: ${mem.layer}`,
              },
            ],
          };
        }

        case 'memory_auto_remember': {
          const result = await autoRemember({
            content: args.content,
            agentId: args.agentId,
            currentProjectId: args.currentProject,
          });
          if (result.recorded) {
            return {
              content: [{ type: 'text', text: `已自动记录: ${result.reason}\n层级: ${result.memory?.layer}` }],
            };
          }
          return {
            content: [{ type: 'text', text: `未记录: ${result.reason}` }],
          };
        }

        case 'memory_import': {
          const items = args.memories as Array<{ title: string; content: string; layer?: string; projectId?: string; tags?: string[]; metadata?: Record<string, unknown>; source?: string; sourceId?: string }>;
          const autoLayer = args.autoLayer !== false;
          const stripPrefixes = args.stripPrefixes !== false;

          const stripPrefix = (s: string): string => {
            if (!stripPrefixes) return s;
            return s
              .replace(/^\[[\w\u4e00-\u9fff]+\]\s*/, '')
              .replace(/^[\w\u4e00-\u9fff]+[：:\-]\s*/, (match) => {
                if (/^(http|https|ftp|www)/i.test(match)) return match;
                return '';
              })
              .replace(/^迁移[：:\s]*\S*\s*/, '')
              .trimStart();
          };

          const inferLayer = (title: string, content: string, metadata?: Record<string, unknown>): string => {
            const text = `${title} ${content}`.toLowerCase();
            const importance = metadata?.importance as string | undefined;
            if (importance === 'high') return 'long';
            if (importance === 'low') return 'short';

            if (metadata?.category === 'preference' || metadata?.category === 'decision') return 'long';
            if (metadata?.category === 'person' || metadata?.category === 'entity') return 'entity';

            const entitySignals = /偏好|习惯|喜欢|讨厌|总是|从不|坚持|原则|价值观|性格|名字叫|电话|邮箱|地址|生日/;
            const projectSignals = /项目|工程|仓库|代码库|repo|project|仓库|架构|技术栈|框架/;
            const shortSignals = /今天|暂时|临时|待办|todo|稍后|待确认|待讨论/;

            if (entitySignals.test(text)) return 'entity';
            if (projectSignals.test(text)) return 'project';
            if (shortSignals.test(text)) return 'short';
            if (content.length > 200) return 'long';
            return 'short';
          };

          let count = 0;
          const layerCounts: Record<string, number> = {};
          const skipped: string[] = [];

          for (const item of items) {
            const title = stripPrefix(item.title);
            const content = stripPrefix(item.content);

            if (!title.trim() || !content.trim()) {
              skipped.push(item.title || '(empty)');
              continue;
            }

            const layer = item.layer || (autoLayer ? inferLayer(title, content, item.metadata) : 'short');
            const validLayers: Layer[] = ['flash', 'short', 'long', 'entity'];
            const safeLayer = validLayers.includes(layer as Layer) ? (layer as Layer) : 'short';
            layerCounts[layer] = (layerCounts[layer] || 0) + 1;

            const mem = createMemory({
              title: title.trim(),
              content: content.trim(),
              layer: safeLayer,
              projectId: item.projectId,
              tags: item.tags,
              metadata: item.metadata,
              source: item.source,
              sourceId: item.sourceId,
            });
            ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined).catch((err) => {
            stderr.write(`[KeyMemory] Warning: Failed to create embedding for memory ${mem.id}: ${(err as Error).message}\n`);
          });
            count++;
          }

          const summary = [
            `已导入 ${count} 条记忆`,
            Object.entries(layerCounts).map(([l, c]) => `${l}: ${c}条`).join(', '),
            skipped.length > 0 ? `跳过 ${skipped.length} 条空内容` : '',
          ].filter(Boolean).join('\n');

          return {
            content: [{ type: 'text', text: summary }],
          };
        }

        case 'memory_migration_discover': {
          const roots = typeof args.root === 'string'
            ? args.root.split(/[;,]/g).map((root: string) => root.trim()).filter(Boolean)
            : undefined;
          const sources = discoverMigrationSources({
            roots,
            includeHome: args.includeHome !== false,
            includeMissing: Boolean(args.includeMissing),
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(sources, null, 2) }],
          };
        }

        case 'memory_migration_import': {
          if (!args.path) {
            return { content: [{ type: 'text', text: 'path is required' }], isError: true };
          }
          const result = await migrateMemoriesFromPath(String(args.path), {
            source: typeof args.source === 'string' ? args.source : undefined,
            format: typeof args.format === 'string' ? args.format as 'auto' | 'json' | 'jsonl' | 'markdown' | 'text' : undefined,
            defaultLayer: typeof args.defaultLayer === 'string' ? args.defaultLayer as Layer : undefined,
            defaultProjectPath: typeof args.defaultProjectPath === 'string' ? args.defaultProjectPath : undefined,
            recursive: args.recursive !== false,
            maxFiles: typeof args.maxFiles === 'number' ? args.maxFiles : undefined,
            runDream: Boolean(args.runDream),
            dryRun: Boolean(args.dryRun),
          });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        }

        case 'memory_backup_create': {
          const summary = createBackupFile(
            typeof args.filePath === 'string' ? args.filePath : undefined,
            {
              includeEmbeddings: Boolean(args.includeEmbeddings),
              includeOperationalLogs: Boolean(args.includeOperationalLogs),
            },
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          };
        }

        case 'memory_backup_inspect': {
          if (!args.filePath) {
            return { content: [{ type: 'text', text: 'filePath is required' }], isError: true };
          }
          const summary = inspectBackupFile(String(args.filePath));
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          };
        }

        case 'memory_backup_restore_dry_run': {
          if (!args.filePath) {
            return { content: [{ type: 'text', text: 'filePath is required' }], isError: true };
          }
          const summary = restoreBackupFile(String(args.filePath), { dryRun: true });
          return {
            content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
          };
        }

        case 'memory_project_suggestions': {
          const status = typeof args.status === 'string' ? args.status : undefined;
          if (status && !['pending', 'accepted', 'rejected'].includes(status)) {
            return { content: [{ type: 'text', text: 'status must be pending, accepted, or rejected' }], isError: true };
          }
          const suggestions = listProjectSuggestions(status as 'pending' | 'accepted' | 'rejected' | undefined);
          return {
            content: [{ type: 'text', text: JSON.stringify(suggestions, null, 2) }],
          };
        }

        case 'memory_project_suggestion_accept': {
          if (!args.id) {
            return { content: [{ type: 'text', text: 'id is required' }], isError: true };
          }
          const result = acceptProjectSuggestion(
            String(args.id),
            typeof args.customName === 'string' ? args.customName : undefined,
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            isError: !result.success,
          };
        }

        case 'memory_project_suggestion_reject': {
          if (!args.id) {
            return { content: [{ type: 'text', text: 'id is required' }], isError: true };
          }
          const ok = rejectProjectSuggestion(String(args.id));
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: ok, id: String(args.id) }, null, 2) }],
            isError: !ok,
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `未知工具: ${toolName}` }],
            isError: true,
          };
      }
    }

    case 'resources/list':
      return {
        resources: [
          {
            uri: 'keymemory://stats',
            name: 'KeyMemory Statistics',
            description: 'Current memory statistics by layer',
          },
        ],
      };

    case 'resources/read': {
      const uri = params?.uri;
      if (uri === 'keymemory://stats') {
        const stats = getLayerStats();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }
      return { contents: [] };
    }

    case 'prompts/list':
      return {
        prompts: [
          {
            name: 'memory_context',
            description: '注入相关记忆到对话上下文',
            arguments: [
              { name: 'project', description: '当前项目名称', required: false },
              { name: 'query', description: '上下文查询', required: false },
            ],
          },
        ],
      };

    case 'prompts/get': {
      const promptName = params?.name;
      if (promptName === 'memory_context') {
        const query = params?.arguments?.query;
        const project = params?.arguments?.project;
        const projectId = params?.arguments?.projectId;
        const pack = await buildAgentContextPack({ query, project, projectId, maxItems: 8, maxChars: 4000 });
        return {
          description: '注入相关记忆到对话上下文',
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: pack.markdown },
            },
          ],
        };
      }
      throw { code: -32601, message: `Unknown prompt: ${promptName}` };
    }

    case 'ping':
      return {};

    default:
      throw { code: -32601, message: `Unknown method: ${method}` };
  }
}

let buffer = '';
stdin.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() || '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const request = JSON.parse(line);
      handleRequest(request)
        .then((result) => sendJsonRpc(request.id, result))
        .catch((error) => sendJsonRpc(request.id, undefined, error));
    } catch (err) {
      sendJsonRpc(null, undefined, { code: -32700, message: 'Parse error' });
    }
  }
});

stdin.on('end', () => shutdown(0));
