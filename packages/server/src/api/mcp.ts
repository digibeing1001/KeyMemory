import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getLayerStats } from '../core/layer.js';
import { buildAgentContextPack } from '../core/context-pack.js';
import { createHermesAdapter } from '../adapters/hermes.js';
import { createOpenClawAdapter } from '../adapters/openclaw.js';
import { canonicalToolName, MCP_TOOLS, MCP_RESOURCES, MCP_PROMPTS } from '../core/mcp-tools.js';
import { executeMcpTool } from '../core/mcp-executor.js';
import type { IsolationMode } from '@keymemory/shared';
import type { MemoryAdapter } from '../adapters/base.js';

interface MCPRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

function getAdapter(request: FastifyRequest): MemoryAdapter {
  const agentType = request.headers['x-agent-type'] as string | undefined;
  const agentId = (request.headers['x-agent-id'] as string) || (agentType === 'openclaw' ? 'openclaw' : 'hermes');
  const isolationMode = (request.headers['x-isolation-mode'] as IsolationMode) || 'hybrid';
  // openclaw 与 hermes 都从 header 创建带隔离的 adapter，确保每个请求用对应 agent 的可见空间
  if (agentType === 'openclaw') return createOpenClawAdapter({ agentId, isolationMode });
  return createHermesAdapter({ agentId, isolationMode });
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
        result: { tools: MCP_TOOLS },
      };
    }

    if (mcpRequest.method === 'tools/call') {
      const params = mcpRequest.params ?? {};
      const toolName = canonicalToolName(params.name);
      const toolArgs = (params.arguments ?? {}) as Record<string, unknown>;
      const adapter = getAdapter(request);
      const result = await executeMcpTool(toolName, toolArgs, adapter, { responseStyle: 'json' });

      return {
        jsonrpc: '2.0',
        id: mcpRequest.id,
        result,
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
        const projectId = args.projectId;
        const project = args.project;
        const query = args.query;
        const pack = await buildAgentContextPack({ query, project, projectId, maxItems: 8, maxChars: 4000 });

        return {
          jsonrpc: '2.0',
          id: mcpRequest.id,
          result: {
            description: 'Inject relevant memories into the conversation context',
            messages: [{ role: 'user' as const, content: { type: 'text' as const, text: pack.markdown } }],
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
