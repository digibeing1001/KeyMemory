import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory } from '../core/atom.js';
import { getLayerStats } from '../core/layer.js';
import { searchHybrid } from '../core/query.js';
import { autoRemember } from '../core/auto.js';
import { discoverMigrationSources, migrateMemoriesFromPath } from '../core/migration.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile } from '../core/backup.js';
import { buildAgentContextPack } from '../core/context-pack.js';
import { acceptProjectSuggestion, listProjectSuggestions, rejectProjectSuggestion } from '../core/project.js';
import { createMemoryRelation, findRelatedMemories, MEMORY_RELATION_TYPES } from '../graph/entity.js';
import { createHermesAdapter } from '../adapters/hermes.js';
import { openClawAdapter } from '../adapters/openclaw.js';
import { MCP_TOOLS, MCP_RESOURCES, MCP_PROMPTS } from '../adapters/openclaw.js';
import type { CreateMemoryInput, Layer, IsolationMode, MemoryKind } from '@keymemory/shared';
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

const MIGRATION_TOOLS: MCPTool[] = [
  {
    name: 'memory_migration_discover',
    description: 'Discover local memory sources for one-click migration across Windows, Linux, macOS, and WSL.',
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
    description: 'Import one memory file or directory and normalize it into KeyMemory projects, kinds, tags, evidence, and optional dream consolidation.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path to import' },
        source: { type: 'string', description: 'Source identifier, e.g. codex, claude-code, cursor, mem0' },
        format: { type: 'string', enum: ['auto', 'json', 'jsonl', 'markdown', 'text'], description: 'Input format. Default auto.' },
        defaultLayer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'], description: 'Fallback layer. Default long.' },
        defaultProjectPath: { type: 'string', description: 'Fallback project path if source has none.' },
        recursive: { type: 'boolean', description: 'Import directories recursively. Default true.' },
        maxFiles: { type: 'number', description: 'Directory file cap. Default 200.' },
        runDream: { type: 'boolean', description: 'Run dream consolidation after import. Default false.' },
        dryRun: { type: 'boolean', description: 'Preview counts without writing memories or running dream. Default false.' },
      },
      required: ['path'],
    },
  },
];

const MEMORY_RELATION_TOOLS: MCPTool[] = [
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
];

const BACKUP_TOOLS: MCPTool[] = [
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
];

const PROJECT_SUGGESTION_TOOLS: MCPTool[] = [
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
];

const TOOLS: MCPTool[] = [
  ...MCP_TOOLS,
  {
    name: 'memory_context_pack',
    description: 'Build an agent-ready context pack grouped by preferences, constraints, decisions, tasks, procedures, and project facts.',
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
  AUTO_REMEMBER_TOOL,
  ...MEMORY_RELATION_TOOLS,
  ...MIGRATION_TOOLS,
  ...BACKUP_TOOLS,
  ...PROJECT_SUGGESTION_TOOLS,
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
        projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
        includeDescendants: args.includeDescendants !== false,
        includeSuperseded: Boolean(args.includeSuperseded),
        memoryKind: typeof args.memoryKind === 'string' ? args.memoryKind as MemoryKind : undefined,
      });
    }
    case 'memory_read':
      return adapter.read(args.id as string);
    case 'memory_delete':
      return adapter.delete(args.id as string);
    case 'memory_context_pack':
      return buildAgentContextPack({
        query: typeof args.query === 'string' ? args.query : undefined,
        project: typeof args.project === 'string' ? args.project : undefined,
        projectId: typeof args.projectId === 'string' ? args.projectId : undefined,
        includeDescendants: args.includeDescendants !== false,
        memoryKinds: Array.isArray(args.memoryKinds) ? args.memoryKinds as import('@keymemory/shared').MemoryKind[] : undefined,
        maxItems: typeof args.maxItems === 'number' ? args.maxItems : undefined,
        maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
      });
    case 'memory_auto_remember':
      return autoRemember({
        content: args.content as string,
        source: args.source as string | undefined,
        agentId: args.agentId as string | undefined,
        isolationMode: args.isolationMode as IsolationMode | undefined,
        currentProjectId: args.currentProject as string | undefined,
        conversationRound: args.conversationRound as number | undefined,
      });
    case 'memory_relate':
      if (!args.sourceId || !args.targetId || !args.relationType) {
        return { error: 'sourceId, targetId, and relationType are required' };
      }
      if (!getMemory(String(args.sourceId))) {
        return { error: `Memory not found: ${args.sourceId}` };
      }
      if (!getMemory(String(args.targetId))) {
        return { error: `Memory not found: ${args.targetId}` };
      }
      try {
        return createMemoryRelation(
          String(args.sourceId),
          String(args.targetId),
          String(args.relationType),
          typeof args.strength === 'number' ? args.strength : 1.0,
          typeof args.reason === 'string' ? args.reason : undefined,
        );
      } catch (err) {
        return { error: (err as Error).message };
      }
    case 'memory_related':
      if (!args.id) return { error: 'id is required' };
      if (!getMemory(String(args.id))) {
        return { error: `Memory not found: ${args.id}` };
      }
      try {
        return findRelatedMemories(
          String(args.id),
          typeof args.relationType === 'string' ? args.relationType : undefined,
        );
      } catch (err) {
        return { error: (err as Error).message };
      }
    case 'memory_migration_discover': {
      const roots = typeof args.root === 'string'
        ? args.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
        : undefined;
      return discoverMigrationSources({
        roots,
        includeHome: args.includeHome !== false,
        includeMissing: Boolean(args.includeMissing),
      });
    }
    case 'memory_migration_import':
      if (!args.path) return { error: 'path is required' };
      return migrateMemoriesFromPath(String(args.path), {
        source: typeof args.source === 'string' ? args.source : undefined,
        format: typeof args.format === 'string' ? args.format as 'auto' | 'json' | 'jsonl' | 'markdown' | 'text' : undefined,
        defaultLayer: typeof args.defaultLayer === 'string' ? args.defaultLayer as Layer : undefined,
        defaultProjectPath: typeof args.defaultProjectPath === 'string' ? args.defaultProjectPath : undefined,
        recursive: args.recursive !== false,
        maxFiles: typeof args.maxFiles === 'number' ? args.maxFiles : undefined,
        runDream: Boolean(args.runDream),
        dryRun: Boolean(args.dryRun),
      });
    case 'memory_backup_create':
      return createBackupFile(
        typeof args.filePath === 'string' ? args.filePath : undefined,
        {
          includeEmbeddings: Boolean(args.includeEmbeddings),
          includeOperationalLogs: Boolean(args.includeOperationalLogs),
        },
      );
    case 'memory_backup_inspect':
      if (!args.filePath) return { error: 'filePath is required' };
      return inspectBackupFile(String(args.filePath));
    case 'memory_backup_restore_dry_run':
      if (!args.filePath) return { error: 'filePath is required' };
      return restoreBackupFile(String(args.filePath), { dryRun: true });
    case 'memory_project_suggestions': {
      const status = typeof args.status === 'string' ? args.status : undefined;
      if (status && !['pending', 'accepted', 'rejected'].includes(status)) {
        return { error: 'status must be pending, accepted, or rejected' };
      }
      return listProjectSuggestions(status as 'pending' | 'accepted' | 'rejected' | undefined);
    }
    case 'memory_project_suggestion_accept':
      if (!args.id) return { error: 'id is required' };
      return acceptProjectSuggestion(
        String(args.id),
        typeof args.customName === 'string' ? args.customName : undefined,
      );
    case 'memory_project_suggestion_reject':
      if (!args.id) return { error: 'id is required' };
      return { success: rejectProjectSuggestion(String(args.id)), id: String(args.id) };
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
