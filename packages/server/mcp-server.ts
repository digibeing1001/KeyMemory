#!/usr/bin/env node
import { stdin, stdout } from 'process';
import { createMemory, getMemory, listMemories, deleteMemory } from './src/core/atom.js';
import { searchHybrid } from './src/core/query.js';
import { initDatabase } from './src/db/sqlite.js';

initDatabase();

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
                text: `✅ 记忆已保存！\n\nID: ${mem.id}\n标题: ${mem.title}\n层级: ${mem.layer}`,
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
                text: `🔍 找到 ${results.length} 条相关记忆：\n\n` +
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
              content: [{ type: 'text', text: `❌ 未找到记忆: ${args.id}` }],
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
              content: [{ type: 'text', text: '📭 还没有记忆，使用 memory_create 创建第一条吧！' }],
            };
          }
          return {
            content: [
              {
                type: 'text',
                text: `📋 ${mems.length} 条记忆：\n\n` +
                  mems.map((m, i) => `${i + 1}. [${m.layer}] ${m.title}`).join('\n'),
              },
            ],
          };
        }

        case 'memory_delete': {
          const ok = deleteMemory(args.id);
          return {
            content: [{ type: 'text', text: ok ? '✅ 记忆已删除' : '❌ 未找到该记忆' }],
          };
        }

        default:
          return {
            content: [{ type: 'text', text: `❌ 未知工具: ${toolName}` }],
            isError: true,
          };
      }
    }

    case 'resources/list':
      return { resources: [] };

    case 'prompts/list':
      return { prompts: [] };

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
