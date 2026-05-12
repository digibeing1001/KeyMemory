#!/usr/bin/env node
import { stdin, stdout } from 'process';
import { createMemory, getMemory, listMemories, deleteMemory } from './src/core/atom.js';
import { searchHybrid } from './src/core/query.js';
import { initDatabase } from './src/db/sqlite.js';
import { initEmbedding } from './src/embed/onnx.js';
import { autoRemember } from './src/core/auto.js';
import { getLayerStats } from './src/core/layer.js';
import { runDailyInspection } from './src/core/evolution.js';
import { applyDecay } from './src/core/forgetting.js';

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
    const { registerRoutes } = await import('./src/api/rest.js');
    const { registerMCPRoutes } = await import('./src/api/mcp.js');
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
            description: '创建一条新记忆。用于记住用户的重要信息、偏好、技术细节等。',
            inputSchema: {
              type: 'object',
              properties: {
                title: { type: 'string', description: '简洁明了的标题' },
                content: { type: 'string', description: '完整的记忆内容' },
                layer: { type: 'string', enum: ['flash', 'short', 'long', 'project', 'entity'], description: '记忆层级：flash(临时), short(几天), long(长期), project(项目), entity(实体)' },
                project: { type: 'string', description: '关联的项目名称（可选）' },
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
        ],
      };

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};

      switch (toolName) {
        case 'memory_create': {
          const mem = createMemory({
            title: args.title,
            content: args.content,
            layer: args.layer,
            project: args.project,
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
                    .map(
                      (r, i) =>
                        `${i + 1}. [${r.memory.layer}] ${r.memory.title}\n   ${r.memory.content.slice(0, 200)}...`,
                    )
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
                text: `# ${mem.title}\n\n层级: ${mem.layer}\n状态: ${mem.status}\n创建时间: ${mem.createdAt}\n\n---\n\n${mem.content}`,
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
