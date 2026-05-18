import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory, recordHit, listVersions, getVersion, revertToVersion, batchCreateMemories, batchUpdateMemories, batchDeleteMemories, exportMemoriesAsJson, importMemories } from '../core/atom.js';
import { moveLayer, getLayerStats } from '../core/layer.js';
import { searchHybrid, ensureEmbedding, findDuplicateMemories } from '../core/query.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { runDailyInspection, getPendingTasks, resolveTask } from '../core/evolution.js';
import { processContent, listEntities, getEntityGraph, extractEntities, ensureEntity, linkMemoryEntity } from '../graph/entity.js';
import { getVersions, diffVersions, rollbackToVersion } from '../core/provenance.js';
import { forgetMemory, restoreMemory, getDecayingMemories, applyDecay as runDecay } from '../core/forgetting.js';
import { compressProjectMemories, compressEntityMemories, listCompressibleProjects } from '../core/compression.js';
import { getHealthReport, injectContext } from '../core/health.js';
import { planConsolidation, executeConsolidation, rollbackConsolidation, getConsolidationPlan, listConsolidationPlans, getConsolidationSnapshots, runAutoConsolidation } from '../core/consolidation.js';
import { runDreamCycle, getDreamReport, listDreamReports, getDreamSignalsForReport } from '../core/dreaming.js';
import { getSchedulerConfig, updateSchedulerConfig, restartScheduler } from '../core/scheduler.js';
import { routeMemory, createAgentContext } from '../adapters/base.js';
import { syncToClaudeMd, syncFromClaudeMd } from '../adapters/claude-code.js';
import { getDatabase } from '../db/sqlite.js';
import { autoRemember } from '../core/auto.js';
import { extractTags } from '../core/auto.js';
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
    // 如果未提供标签，自动生成
    if (!input.tags || input.tags.length === 0) {
      input.tags = extractTags(input.content);
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
    // 如果内容更新且未提供标签，重新生成
    if (input.content !== undefined && (!input.tags || input.tags.length === 0)) {
      input.tags = extractTags(input.content);
    }
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

  app.post('/api/embeddings/rebuild-all', async () => {
    const db = getDatabase();
    const memories = db.prepare(`
      SELECT id, title, content, tags, metadata FROM memories WHERE status = 'active'
    `).all() as { id: string; title: string; content: string; tags: string | null; metadata: string | null }[];

    let success = 0;
    let failed = 0;

    for (const mem of memories) {
      try {
        const tags = mem.tags ? JSON.parse(mem.tags) : undefined;
        const metadata = mem.metadata ? JSON.parse(mem.metadata) : undefined;
        await ensureEmbedding(mem.id, mem.title, mem.content, tags, metadata, true);
        success++;
      } catch {
        failed++;
      }
    }

    return { total: memories.length, success, failed };
  });

  app.post('/api/entities/rebuild-all', async () => {
    const db = getDatabase();
    const memories = db.prepare(`
      SELECT id, content FROM memories WHERE status = 'active'
    `).all() as { id: string; content: string }[];

    let processed = 0;

    for (const mem of memories) {
      const entities = extractEntities(mem.content);
      for (const ext of entities) {
        const entity = ensureEntity(ext.name, ext.type);
        linkMemoryEntity(mem.id, entity.id);
      }
      processed++;
    }

    return { total: memories.length, processed };
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

  app.get('/api/graph/memory-connections', async () => {
    const db = getDatabase();

    const rows = db.prepare(`
      SELECT id, title, layer, tags, project FROM memories WHERE status = 'active'
    `).all() as { id: string; title: string; layer: string; tags: string | null; project: string | null }[];

    const entityRows = db.prepare(`
      SELECT me.memory_id, me.entity_id, e.name as entity_name
      FROM memory_entities me
      JOIN entities e ON e.id = me.entity_id
      JOIN memories m ON m.id = me.memory_id AND m.status = 'active'
    `).all() as { memory_id: string; entity_id: string; entity_name: string }[];

    const nodes = rows.map(r => ({
      id: r.id,
      title: r.title,
      layer: r.layer,
      tags: r.tags ? JSON.parse(r.tags) : [],
      project: r.project,
    }));

    const memoryMap = new Map<string, typeof nodes[0]>();
    for (const n of nodes) {
      memoryMap.set(n.id, n);
    }

    const tagToMemories = new Map<string, string[]>();
    for (const r of rows) {
      const tags: string[] = r.tags ? JSON.parse(r.tags) : [];
      for (const tag of tags) {
        if (!tagToMemories.has(tag)) tagToMemories.set(tag, []);
        tagToMemories.get(tag)!.push(r.id);
      }
    }

    const projectToMemories = new Map<string, string[]>();
    for (const r of rows) {
      if (r.project) {
        if (!projectToMemories.has(r.project)) projectToMemories.set(r.project, []);
        projectToMemories.get(r.project)!.push(r.id);
      }
    }

    const entityToMemories = new Map<string, { name: string; memoryIds: string[] }>();
    for (const er of entityRows) {
      if (!entityToMemories.has(er.entity_id)) {
        entityToMemories.set(er.entity_id, { name: er.entity_name, memoryIds: [] });
      }
      entityToMemories.get(er.entity_id)!.memoryIds.push(er.memory_id);
    }

    type EdgeKey = string;
    const edgeMap = new Map<EdgeKey, { source: string; target: string; type: string; weight: number; labels: string[] }>();

    const addEdge = (source: string, target: string, type: string, label: string) => {
      const [a, b] = source < target ? [source, target] : [target, source];
      const key = `${a}::${b}::${type}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.weight += 1;
        existing.labels.push(label);
      } else {
        edgeMap.set(key, { source: a, target: b, type, weight: 1, labels: [label] });
      }
    };

    for (const [tag, memIds] of tagToMemories) {
      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          addEdge(memIds[i], memIds[j], 'shared_tag', tag);
        }
      }
    }

    for (const [project, memIds] of projectToMemories) {
      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          addEdge(memIds[i], memIds[j], 'shared_project', project);
        }
      }
    }

    for (const [, info] of entityToMemories) {
      const memIds = info.memoryIds;
      for (let i = 0; i < memIds.length; i++) {
        for (let j = i + 1; j < memIds.length; j++) {
          addEdge(memIds[i], memIds[j], 'shared_entity', info.name);
        }
      }
    }

    const edges = Array.from(edgeMap.values()).map(e => ({
      source: e.source,
      target: e.target,
      type: e.type,
      weight: e.weight,
      label: e.labels.join(', '),
    }));

    return { nodes, edges };
  });

  app.get('/api/graph/tag-cloud', async () => {
    const db = getDatabase();

    const rows = db.prepare(`
      SELECT tags, layer, project FROM memories WHERE status = 'active'
    `).all() as { tags: string | null; layer: string; project: string | null }[];

    const totalMemories = rows.length;

    const tagData = new Map<string, { count: number; layers: Record<string, number> }>();
    for (const r of rows) {
      const tags: string[] = r.tags ? JSON.parse(r.tags) : [];
      for (const tag of tags) {
        const existing = tagData.get(tag);
        if (existing) {
          existing.count += 1;
          existing.layers[r.layer] = (existing.layers[r.layer] || 0) + 1;
        } else {
          tagData.set(tag, { count: 1, layers: { [r.layer]: 1 } });
        }
      }
    }

    const tags = Array.from(tagData.entries())
      .map(([name, data]) => ({ name, count: data.count, layers: data.layers }))
      .sort((a, b) => b.count - a.count);

    const projectData = new Map<string, number>();
    for (const r of rows) {
      if (r.project) {
        projectData.set(r.project, (projectData.get(r.project) || 0) + 1);
      }
    }

    const projects = Array.from(projectData.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return { tags, projects, totalMemories };
  });

  app.get('/api/memories/:id/versions', async (request) => {
    const { id } = request.params as { id: string };
    return listVersions(id);
  });

  app.get('/api/memories/:id/versions/:version', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const result = getVersion(id, parseInt(version));
    if (!result) {
      return { error: 'Version not found' };
    }
    return result;
  });

  app.post('/api/memories/:id/versions/:version/revert', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const { reason } = request.body as { reason?: string };
    const result = revertToVersion(id, parseInt(version), reason);
    if (!result) {
      return { error: 'Failed to revert' };
    }
    return result;
  });

  app.post('/api/memories/batch/create', async (request) => {
    const inputs = request.body as CreateMemoryInput[];
    return batchCreateMemories(inputs);
  });

  app.post('/api/memories/batch/update', async (request) => {
    const updates = request.body as { id: string; input: UpdateMemoryInput }[];
    return batchUpdateMemories(updates);
  });

  app.post('/api/memories/batch/delete', async (request) => {
    const { ids, permanent } = request.body as { ids: string[]; permanent?: boolean };
    return batchDeleteMemories(ids, permanent);
  });

  app.get('/api/memories/export', async (request) => {
    const query = request.query as Record<string, string>;
    const layer = query.layer as Layer | undefined;
    const status = query.status as MemoryStatus | undefined;
    return exportMemoriesAsJson({ layer, status });
  });

  app.post('/api/memories/import', async (request) => {
    const { data } = request.body as { data: string };
    return importMemories(data);
  });

  app.get('/api/memories/duplicates', async (request) => {
    const query = request.query as Record<string, string>;
    const threshold = parseFloat(query.threshold) || 0.9;
    const limit = parseInt(query.limit) || 20;
    return findDuplicateMemories(threshold, limit);
  });

  app.get('/api/memories/:id/entities', async (request) => {
    const { id } = request.params as { id: string };
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT e.* FROM entities e
      JOIN memory_entities me ON e.id = me.entity_id
      WHERE me.memory_id = ?
      ORDER BY e.name
    `).all(id) as Record<string, unknown>[];
    
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      type: r.type as string,
      properties: r.properties ? JSON.parse(r.properties as string) : undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  });

  app.post('/api/consolidation/plan', async () => {
    return planConsolidation();
  });

  app.post('/api/consolidation/execute', async (request) => {
    const { planId } = request.body as { planId: string };
    if (!planId) return { error: 'planId is required' };
    try {
      return executeConsolidation(planId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.post('/api/consolidation/auto', async () => {
    return runAutoConsolidation();
  });

  app.post('/api/consolidation/rollback', async (request) => {
    const { planId, actionIds } = request.body as { planId: string; actionIds?: string[] };
    if (!planId) return { error: 'planId is required' };
    try {
      return rollbackConsolidation(planId, actionIds);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.get('/api/consolidation/plans', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    return listConsolidationPlans(limit);
  });

  app.get('/api/consolidation/plans/:planId', async (request) => {
    const { planId } = request.params as { planId: string };
    const plan = getConsolidationPlan(planId);
    if (!plan) return { error: 'Plan not found' };
    return plan;
  });

  app.get('/api/consolidation/plans/:planId/snapshots', async (request) => {
    const { planId } = request.params as { planId: string };
    return getConsolidationSnapshots(planId);
  });

  app.post('/api/dream/run', async () => {
    return runDreamCycle();
  });

  app.get('/api/dream/reports', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    return listDreamReports(limit);
  });

  app.get('/api/dream/reports/:reportId', async (request) => {
    const { reportId } = request.params as { reportId: string };
    const report = getDreamReport(reportId);
    if (!report) return { error: 'Report not found' };
    return report;
  });

  app.get('/api/dream/reports/:reportId/signals', async (request) => {
    const { reportId } = request.params as { reportId: string };
    return getDreamSignalsForReport(reportId);
  });

  app.get('/api/scheduler/config', async () => {
    return getSchedulerConfig();
  });

  app.post('/api/scheduler/config', async (request) => {
    const updates = request.body as Record<string, unknown>;
    const result = updateSchedulerConfig(updates);
    restartScheduler();
    return result;
  });
}
