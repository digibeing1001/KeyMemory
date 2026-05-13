import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory, recordHit } from '../core/atom.js';
import { moveLayer, getLayerStats } from '../core/layer.js';
import { searchHybrid, ensureEmbedding } from '../core/query.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { runDailyInspection, getPendingTasks, resolveTask } from '../core/evolution.js';
import { processContent, listEntities, getEntityGraph } from '../graph/entity.js';
import { getVersions, diffVersions, rollbackToVersion } from '../core/provenance.js';
import { forgetMemory, restoreMemory, getDecayingMemories, applyDecay as runDecay } from '../core/forgetting.js';
import { compressProjectMemories, compressEntityMemories, listCompressibleProjects } from '../core/compression.js';
import { getHealthReport, injectContext } from '../core/health.js';
import { routeMemory, createAgentContext } from '../adapters/base.js';
import { syncToClaudeMd, syncFromClaudeMd } from '../adapters/claude-code.js';
import { getDatabase } from '../db/sqlite.js';
import { autoRemember } from '../core/auto.js';
import type { CreateMemoryInput, UpdateMemoryInput, Layer, MemoryStatus, SearchQuery, ForgetMethod, IsolationMode } from '@keymemory/shared';

export function registerRoutes(app: FastifyInstance): void {
  const apiKey = process.env.KEYMEMORY_API_KEY;

  // 简单的 API Key 认证（仅在 API Key 存在时启用）
  if (apiKey) {
    app.addHook('preHandler', async (request: FastifyRequest) => {
      // 健康检查端点不需要认证
      if (request.url === '/api/health') return;

      const authHeader = request.headers['authorization'];
      const requestApiKey = authHeader?.replace('Bearer ', '');

      if (!requestApiKey || requestApiKey !== apiKey) {
        throw { code: 401, message: 'Unauthorized: Invalid API Key' };
      }
    });
  }

  app.get('/api/health', async () => {
    const stats = getLayerStats();
    return { status: 'ok', timestamp: new Date().toISOString(), stats };
  });

  app.post('/api/memories', async (request, reply) => {
    const input = request.body as CreateMemoryInput;
    if (!input.title || !input.content || !input.layer) {
      reply.code(400);
      return { error: 'title, content, and layer are required' };
    }
    const mem = createMemory(input);
    ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined).catch(() => {});
    reply.code(201);
    return mem;
  });

  app.get('/api/memories', async (request) => {
    const query = request.query as Record<string, string>;
    return listMemories({
      layer: query.layer as Layer | undefined,
      project: query.project,
      status: query.status as MemoryStatus | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  });

  app.get('/api/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const mem = getMemory(id);
    if (!mem) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    return mem;
  });

  app.put('/api/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = request.body as UpdateMemoryInput;
    const mem = updateMemory(id, input);
    if (!mem) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    if (input.title !== undefined || input.content !== undefined) {
      ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined, true).catch(() => {});
    }
    return mem;
  });

  app.delete('/api/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const permanent = query.permanent === 'true';
    const ok = deleteMemory(id, permanent);
    if (!ok) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    return { success: true };
  });

  app.patch('/api/memories/:id/layer', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { layer, reason } = request.body as { layer: Layer; reason?: string };
    if (!layer) {
      reply.code(400);
      return { error: 'layer is required' };
    }
    const ok = moveLayer(id, layer, reason);
    if (!ok) {
      reply.code(400);
      return { error: 'Invalid layer move' };
    }
    return getMemory(id);
  });

  app.post('/api/memories/:id/hit', async (request) => {
    const { id } = request.params as { id: string };
    recordHit(id);
    return { success: true };
  });

  app.get('/api/memories/search', async (request) => {
    const query = request.query as SearchQuery;
    const q = query.q;
    if (!q) return [];
    return searchHybrid(q, {
      layer: query.layer,
      status: query.status,
      limit: query.limit ?? 20,
    });
  });

  app.get('/api/layers/stats', async () => {
    return getLayerStats();
  });

  app.post('/api/layers/decay', async () => {
    return runDecay();
  });

  app.get('/api/versions/:memoryId', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    return getVersions(memoryId);
  });

  app.get('/api/versions/:memoryId/diff', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    const query = request.query as { from: string; to: string };
    return diffVersions(memoryId, parseInt(query.from), parseInt(query.to));
  });

  app.post('/api/versions/:memoryId/rollback', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    const { targetVersion, reason } = request.body as { targetVersion: number; reason?: string };
    const ok = rollbackToVersion(memoryId, targetVersion, reason);
    return { success: ok };
  });

  app.post('/api/memories/:id/forget', async (request) => {
    const { id } = request.params as { id: string };
    const { method } = request.body as { method: ForgetMethod };
    if (!method) return { error: 'method is required (archive|decay|delete)' };
    return { success: forgetMemory(id, method) };
  });

  app.post('/api/memories/:id/restore', async (request) => {
    const { id } = request.params as { id: string };
    return { success: restoreMemory(id) };
  });

  app.get('/api/memories/decaying', async () => {
    return getDecayingMemories();
  });

  app.post('/api/compress/project', async (request) => {
    const { project } = request.body as { project: string };
    return compressProjectMemories(project);
  });

  app.post('/api/compress/entity', async (request) => {
    const { entityId } = request.body as { entityId: string };
    return compressEntityMemories(entityId);
  });

  app.get('/api/compress/candidates', async () => {
    return listCompressibleProjects();
  });

  app.get('/api/health/report', async () => {
    return getHealthReport();
  });

  app.post('/api/context/inject', async (request) => {
    const { project, query, limit } = request.body as { project?: string; query?: string; limit?: number };
    return injectContext({ project, query, limit });
  });

  app.post('/api/agent/route', async (request) => {
    const { content, layer, agentId, isolationMode, customRules } = request.body as {
      content: string;
      layer: Layer;
      agentId: string;
      isolationMode?: IsolationMode;
      customRules?: { pattern: string; targetSpace: string; priority: number }[];
    };
    const ctx = createAgentContext(agentId, isolationMode);
    return routeMemory(content, layer, ctx, customRules);
  });

  app.post('/api/sync/claude-md', async () => {
    await syncToClaudeMd();
    return { success: true };
  });

  app.get('/api/sync/claude-md', async () => {
    const content = await syncFromClaudeMd();
    return { content };
  });

  app.post('/api/selfcheck', async (request) => {
    const { content, currentProject, conversationRound, userEmphasis } = request.body as {
      content: string;
      currentProject?: string;
      conversationRound?: number;
      userEmphasis?: number;
    };
    if (!content) {
      return { error: 'content is required' };
    }
    return evaluate(content, { currentProject, conversationRound, userEmphasis });
  });

  app.post('/api/evolution/inspect', async () => {
    return runDailyInspection();
  });

  app.get('/api/evolution/tasks', async () => {
    return getPendingTasks();
  });

  app.post('/api/evolution/tasks/:id/resolve', async (request) => {
    const { id } = request.params as { id: string };
    const { action } = request.body as { action: 'accepted' | 'rejected' };
    if (!action || !['accepted', 'rejected'].includes(action)) {
      return { error: 'action must be accepted or rejected' };
    }
    return resolveTask(id, action);
  });

  app.get('/api/entities', async (request) => {
    const query = request.query as Record<string, string>;
    return listEntities(query.type as import('@keymemory/shared').EntityType | undefined);
  });

  app.get('/api/entities/:id/graph', async (request) => {
    const { id } = request.params as { id: string };
    try {
      return getEntityGraph(id);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.post('/api/auto-remember', async (request) => {
    const { content, source, agentId, isolationMode, currentProject, conversationRound } = request.body as {
      content: string;
      source?: string;
      agentId?: string;
      isolationMode?: IsolationMode;
      currentProject?: string;
      conversationRound?: number;
    };
    if (!content) return { error: 'content is required' };
    return autoRemember({ content, source, agentId, isolationMode, currentProject, conversationRound });
  });

  app.get('/api/agents', async () => {
    const db = getDatabase();
    const agents = db.prepare(`
      SELECT DISTINCT owner_agent_id as agentId, agent_space as agentSpace, COUNT(*) as memoryCount
      FROM memories
      WHERE owner_agent_id IS NOT NULL
      GROUP BY owner_agent_id, agent_space
    `).all();
    return agents;
  });

  app.post('/api/backup', async (request, reply) => {
    const db = getDatabase();
    const data = db.prepare(`SELECT * FROM memories`).all();
    const fts = db.prepare(`SELECT * FROM memories_fts`).all();
    const entities = db.prepare(`SELECT * FROM entities`).all();
    const versions = db.prepare(`SELECT * FROM versions`).all();
    return {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      memories: data,
      fts,
      entities,
      versions,
    };
  });
}
