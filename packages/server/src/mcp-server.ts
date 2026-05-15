#!/usr/bin/env node
import { stdin, stdout, stderr } from 'process';
import { createMemory, getMemory, listMemories, deleteMemory } from './core/atom.js';
import { searchHybrid, ensureEmbedding } from './core/query.js';
import { initDatabase } from './db/sqlite.js';
import { initEmbedding } from './embed/onnx.js';
import { autoRemember, extractTags } from './core/auto.js';
import { getLayerStats } from './core/layer.js';
import type { Layer } from '@keymemory/shared';
import { runDailyInspection } from './core/evolution.js';
import { applyDecay } from './core/forgetting.js';

initDatabase();

initEmbedding().catch(() => {});

setInterval(async () => {
  try { await runDailyInspection(); applyDecay(); } catch {}
}, 86400000);

startRestServerInBackground();

async function startRestServerInBackground() {
  try {
    const Fastify = (await import('fastify')).default;
    const cors = (await import('@fastify/cors')).default;
    const { registerRoutes } = await import('./api/rest.js');
    const { registerMCPRoutes } = await import('./api/mcp.js');
    const { DEFAULT_PORT, DEFAULT_HOST } = await import('@keymemory/shared');

    const app = Fastify({ logger: false });
    await app.register(cors, { origin: true });
    registerRoutes(app);
    registerMCPRoutes(app);
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
                layer: { type: 'string', enum: ['flash', 'short', 'long', 'project', 'entity'], description: '记忆层级：flash(临时), short(几天), long(长期), project(项目), entity(实体)' },
                project: { type: 'string', description: '关联的项目名称（可选）' },
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
                limit: { type: 'number', description: '返回结果数量（默认10）' },
              },
              required: ['query'],
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
                layer: { type: 'string', enum: ['flash', 'short', 'long', 'project', 'entity'], description: '按层级筛选' },
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
                      layer: { type: 'string', enum: ['flash', 'short', 'long', 'project', 'entity'], description: '记忆层级。不指定时自动推断' },
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
        ],
      };

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      switch (toolName) {
        case 'memory_create': {
          const tags = args.tags ?? extractTags(args.content);
          const mem = createMemory({
            title: args.title,
            content: args.content,
            layer: args.layer,
            project: args.project,
            tags,
            metadata: args.metadata,
            source: args.source,
          });
          ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined).catch(() => {});
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
                  mems.map((m, i) => `${i + 1}. [${m.layer}] ${m.title}`).join('\n'),
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

        case 'memory_auto_remember': {
          const result = await autoRemember({
            content: args.content,
            agentId: args.agentId,
            currentProject: args.currentProject,
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
          const items = args.memories as Array<{ title: string; content: string; layer?: string; project?: string; tags?: string[]; metadata?: Record<string, unknown>; source?: string; sourceId?: string }>;
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
            const validLayers: Layer[] = ['flash', 'short', 'long', 'project', 'entity'];
            const safeLayer = validLayers.includes(layer as Layer) ? (layer as Layer) : 'short';
            layerCounts[layer] = (layerCounts[layer] || 0) + 1;

            const mem = createMemory({
              title: title.trim(),
              content: content.trim(),
              layer: safeLayer,
              project: item.project,
              tags: item.tags,
              metadata: item.metadata,
              source: item.source,
              sourceId: item.sourceId,
            });
            ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined).catch(() => {});
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
        let contextText = '';
        if (query) {
          const results = await searchHybrid(query, { limit: 5 });
          contextText = results.map(r => `- [${r.memory.layer}] ${r.memory.title}: ${r.memory.content.slice(0, 200)}`).join('\n');
        } else {
          const mems = listMemories({ project, limit: 5 });
          contextText = mems.map(m => `- [${m.layer}] ${m.title}: ${m.content.slice(0, 200)}`).join('\n');
        }
        return {
          description: '注入相关记忆到对话上下文',
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: contextText ? `## KeyMemory Context\n\n${contextText}` : 'No relevant memories found.' },
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
