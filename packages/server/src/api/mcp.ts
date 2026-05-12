import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory } from '../core/atom.js';
import { getLayerStats } from '../core/layer.js';
import { searchHybrid } from '../core/query.js';
import { autoRemember } from '../core/auto.js';
import { createHermesAdapter } from '../adapters/hermes.js';
import { openClawAdapter } from '../adapters/openclaw.js';
import { MCP_TOOLS, MCP_RESOURCES, MCP_PROMPTS } from '../adapters/openclaw.js';
import type { CreateMemoryInput, Layer, IsolationMode } from '@keymemory/shared';
import type { MemoryAdapter } from '../adapters/base.js';

interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const AUTO_REMEMBER_TOOL: MCPTool = {
  name: 'memory_auto_remember',
  description: '自动评估并记录记忆（通过 SelfCheck 评估是否值得记录）',
  inputSchema: {
    type: 'object',
    properties: {
      content: { type: 'string', description: '要评估和记录的内容' },
      source: { type: 'string', description: '内容来源' },
      agentId: { type: 'string', description: 'Agent ID' },
      isolationMode: { type: 'string', enum: ['isolated', 'shared', 'hybrid', 'project'], description: '隔离模式' },
      currentProject: { type: 'string', description: '当前项目' },
      conversationRound: { type: 'number', description: '对话轮次' },
    },
    required: ['content'],
  },
};

const TOOLS: MCPTool[] = [
  ...MCP_TOOLS,
  AUTO_REMEMBER_TOOL,
];

function getAdapter(request: FastifyRequest): MemoryAdapter {
  const agentType = request.headers['x-agent-type'] as string | undefined;
  if (agentType === 'openclaw') return openClawAdapter;
  const agentId = (request.headers['x-agent-id'] as string) || 'hermes';
  const isolationMode = (request.headers['x-isolation-mode'] as IsolationMode) || 'hybrid';
  return createHermesAdapter({ agentId, isolationMode });
}

async function handleToolCall(name: string, args: Record<string, unknown>, adapter: MemoryAdapter): Promise<unknown> {
  switch (name) {
    case 'memory_create':
      return adapter.write(args as unknown as CreateMemoryInput);
    case 'memory_search': {
      const query = args.query as string;
      if (!query) return [];
      return adapter.search(query, {
        layer: args.layer as Layer | undefined,
        limit: (args.limit as number) ?? 20,
      });
    }
    case 'memory_read':
      return adapter.read(args.id as string);
    case 'memory_delete':
      return adapter.delete(args.id as string);
    case 'memory_auto_remember':
      return autoRemember({
        content: args.content as string,
        source: args.source as string | undefined,
        agentId: args.agentId as string | undefined,
        isolationMode: args.isolationMode as IsolationMode | undefined,
        currentProject: args.currentProject as string | undefined,
        conversationRound: args.conversationRound as number | undefined,
      });
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

export function registerMCPRoutes(app: FastifyInstance): void {
  app.post('/mcp', async (request, reply) => {
    const mcpRequest = request.body as MCPRequest;

    if (mcpRequest.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'keymemory', version: '0.1.0' },
        },
      };
    }

    if (mcpRequest.method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result: { tools: TOOLS },
      };
    }

    if (mcpRequest.method === 'tools/call') {
      const params = mcpRequest.params ?? {};
      const toolName = params.name as string;
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const adapter = getAdapter(request);
      const result = await handleToolCall(toolName, toolArgs, adapter);

      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        },
      };
    }

    if (mcpRequest.method === 'resources/list') {
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result: { resources: MCP_RESOURCES },
      };
    }

    if (mcpRequest.method === 'resources/read') {
      const params = mcpRequest.params ?? {};
      const uri = params.uri as string;

      if (uri === 'keymemory://stats') {
        return {
          jsonrpc: '2.0',
          id: mcpRequest.id,
          result: {
            contents: [{
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(getLayerStats()),
            }],
          },
        };
      }

      reply.code(400);
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        error: { code: -32602, message: `Unknown resource: ${uri}` },
      };
    }

    if (mcpRequest.method === 'prompts/list') {
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result: { prompts: MCP_PROMPTS },
      };
    }

    if (mcpRequest.method === 'prompts/get') {
      const params = mcpRequest.params ?? {};
      const promptName = params.name as string;

      if (promptName === 'memory_context') {
        const args = (params.arguments ?? {}) as Record<string, string>;
        const project = args.project;
        const query = args.query;

        let contextText = '';
        if (query) {
          const results = await searchHybrid(query, { limit: 5 });
          contextText = results.map(r => `- [${r.memory.layer}] ${r.memory.title}: ${r.memory.content.slice(0, 200)}`).join('\n');
        } else if (project) {
          const mems = listMemories({ project, status: 'active', limit: 5 });
          contextText = mems.map(m => `- [${m.layer}] ${m.title}: ${m.content.slice(0, 200)}`).join('\n');
        }

        return {
          jsonrpc: '2.0',
          id: mcpRequest.id,
          result: {
            description: 'Inject relevant memories into the conversation context',
            messages: contextText
              ? [{ role: 'user' as const, content: { type: 'text' as const, text: `## KeyMemory Context\n\n${contextText}` } }]
              : [],
          },
        };
      }

      reply.code(400);
      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        error: { code: -32602, message: `Unknown prompt: ${promptName}` },
      };
    }

    reply.code(400);
    return {
      jsonrpc: '2.0',
      id: mcpRequest.id,
      error: { code: -32601, message: `Method not found: ${mcpRequest.method}` },
    };
  });
}
