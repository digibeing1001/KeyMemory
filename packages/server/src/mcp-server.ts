#!/usr/bin/env node
import { stdin, stdout, stderr } from 'process';
import { inspect } from 'util';
import { initDatabase } from './db/sqlite.js';
import { initEmbedding } from './embed/onnx.js';
import { getLayerStats } from './core/layer.js';
import { runDailyInspection } from './core/evolution.js';
import { applyDecay } from './core/forgetting.js';
import { startScheduler, stopScheduler } from './core/scheduler.js';
import { buildAgentContextPack } from './core/context-pack.js';
import { canonicalToolName, MCP_TOOLS } from './core/mcp-tools.js';
import { executeMcpTool } from './core/mcp-executor.js';
import { createHermesAdapter } from './adapters/hermes.js';
import { openClawAdapter } from './adapters/openclaw.js';
import type { IsolationMode } from '@keymemory/shared';

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
const stdioAdapter = process.env.KEYMEMORY_AGENT_ID
  ? createHermesAdapter({
    agentId: process.env.KEYMEMORY_AGENT_ID,
    isolationMode: (process.env.KEYMEMORY_ISOLATION_MODE as IsolationMode | undefined) ?? 'hybrid',
  })
  : openClawAdapter;

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
    try { await runDailyInspection(); applyDecay(); } catch (err) { console.error('[MCP] Daily inspection failed:', (err as Error).message); }
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

    case 'tools/call': {
      const toolName = canonicalToolName(params?.name);
      const args = params?.arguments || {};
      return executeMcpTool(toolName, args, stdioAdapter, { responseStyle: 'agentText' });
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
      const requestId = request?.id ?? null;
      if (!request || typeof request !== 'object' || !request.method) {
        sendJsonRpc(requestId, undefined, { code: -32600, message: 'Invalid Request' });
        continue;
      }
      handleRequest(request)
        .then((result) => sendJsonRpc(request.id ?? null, result))
        .catch((error) => {
          const errObj = error instanceof Error
            ? { code: -32603, message: error.message }
            : (error && typeof error === 'object' && 'code' in error ? error : { code: -32603, message: String(error) });
          sendJsonRpc(request.id ?? null, undefined, errObj);
        });
    } catch {
      sendJsonRpc(null, undefined, { code: -32700, message: 'Parse error' });
    }
  }
});

stdin.on('end', () => shutdown(0));
