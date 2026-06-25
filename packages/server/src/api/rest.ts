import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory, recordHit, listVersions, getVersion, revertToVersion, batchCreateMemories, batchUpdateMemories, batchDeleteMemories, exportMemoriesAsJson, importMemories, listRecycleBin, restoreFromRecycleBin, permanentlyDeleteMemory } from '../core/atom.js';
import { moveLayer, getLayerStats } from '../core/layer.js';
import { createProject, getProject, listProjects, updateProject, deleteProject, moveProject, getProjectPath, getProjectDescendants, getProjectMemories, listProjectSuggestions, acceptProjectSuggestion, rejectProjectSuggestion } from '../core/project.js';
import { searchHybrid, ensureEmbedding, findDuplicateMemories } from '../core/query.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { runDailyInspection, getPendingTasks, resolveTask } from '../core/evolution.js';
import { processContent, listEntities, getEntityGraph, extractEntities, ensureEntity, linkMemoryEntity, findRelatedMemories, autoAssociate, createMemoryRelation, MEMORY_RELATION_TYPES } from '../graph/entity.js';
import { getVersions, diffVersions, rollbackToVersion } from '../core/provenance.js';
import { forgetMemory, restoreMemory, getDecayingMemories, applyDecay as runDecay } from '../core/forgetting.js';
import { compressProjectMemories, compressEntityMemories, listCompressibleProjects } from '../core/compression.js';
import { getHealthReport, injectContext } from '../core/health.js';
import { buildAgentContextPack } from '../core/context-pack.js';
import { planConsolidation, executeConsolidation, rollbackConsolidation, getConsolidationPlan, listConsolidationPlans, getConsolidationSnapshots, runAutoConsolidation } from '../core/consolidation.js';
import { runDreamCycle, getDreamReport, listDreamReports, getDreamSignalsForReport, rollbackDream, deleteDreamReport, getPendingTodosForContext, resolveConflict } from '../core/dreaming.js';
import { getSchedulerConfig, updateSchedulerConfig, restartScheduler } from '../core/scheduler.js';
import { discoverMigrationSources, migrateMemoriesFromPath, migrateMigrationSources } from '../core/migration.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile } from '../core/backup.js';
import type { BackupSummary } from '../core/backup.js';
import { routeMemory, createAgentContext } from '../adapters/base.js';
import { syncToClaudeMd, syncFromClaudeMd } from '../adapters/claude-code.js';
import { getDatabase } from '../db/sqlite.js';
import { rowToMemory, rowToLoopRunSummary } from '../db/mapper.js';
import { autoRemember } from '../core/auto.js';
import { extractTags } from '../core/auto.js';
import { isApiRequestAuthorized, shouldAuthenticateHttpPath } from '../core/security.js';
import { checkpointLoopRun, finishLoopRun, getLoopContext, loopErrorObservation, startLoopRun } from '../core/loop-harness.js';
import type { AgentContextPackRequest, CreateMemoryInput, UpdateMemoryInput, Layer, LoopCheckpointRequest, LoopContextRequest, LoopFinishRequest, LoopRunStartRequest, MemoryStatus, SearchQuery, ForgetMethod, IsolationMode } from '@keymemory/shared';

function safeParseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function createMigrationBackup(shouldCreate: boolean | undefined, dryRun: boolean | undefined): BackupSummary | undefined {
  if (!shouldCreate || dryRun) return undefined;
  return createBackupFile();
}

function loopHttpStatus(code: string | undefined): number {
  if (code === 'RUN_NOT_FOUND' || code === 'CHECKPOINT_NOT_FOUND' || code === 'PROJECT_NOT_FOUND' || code === 'MEMORY_NOT_FOUND') return 404;
  if (code === 'INVALID_INPUT') return 400;
  if (code === 'LIMIT_EXCEEDED') return 413;
  if (code === 'INTERNAL_ERROR') return 500;
  return 409;
}

export function registerRoutes(app: FastifyInstance): void {
  const apiKey = process.env.KEYMEMORY_API_KEY;

  // 简单的 API Key 认证（仅在 API Key 存在时启用）
  if (apiKey) {
    app.addHook('preHandler', async (request: FastifyRequest, reply) => {
      // 健康检查端点不需要认证
      if (request.url === '/api/health') return;

      const path = request.url.split('?')[0];
      if (!shouldAuthenticateHttpPath(path) || path === '/api/health') return;

      if (!isApiRequestAuthorized(request.headers as Record<string, string | string[] | undefined>)) {
        return reply.code(401).send({ error: 'Unauthorized: invalid API key' });
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
    // 自动建立语义关联
    autoAssociate(mem.id, mem.content, mem.title);
    reply.code(201);
    return mem;
  });

  app.get('/api/memories/search', async (request) => {
    const query = request.query as Record<string, string>;
    const q = query.q;
    if (!q) return [];
    return searchHybrid(q, {
      layer: query.layer as Layer | undefined,
      projectId: query.projectId,
      includeDescendants: query.includeDescendants !== 'false',
      includeSuperseded: query.includeSuperseded === 'true',
      memoryKind: query.memoryKind as SearchQuery['memoryKind'],
      status: query.status as MemoryStatus | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    });
  });

  app.get('/api/memories', async (request) => {
    const query = request.query as Record<string, string>;
    return listMemories({
      layer: query.layer as Layer | undefined,
      projectId: query.projectId,
      includeDescendants: query.includeDescendants === 'true',
      status: query.status as MemoryStatus | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  });

  // 近期工作集：按 last_hit_at 倒序返回近期被命中的记忆，让 UI 能直接展示"系统在流动"
  // 真实数据中 long 层有 26 条零命中、整体 short active=0——这个端点让用户在 UI 上能直接看到
  // 哪些记忆被实际用到了、哪些从未被命中，作为 loop 上下文记忆库的核心入口视图
  app.get('/api/memories/recent-hits', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE status = 'active' AND last_hit_at IS NOT NULL
      ORDER BY last_hit_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map(rowToMemory);
  });

  // 近期创建工作集：按 created_at 倒序返回最近写入的记忆，让用户能看到"系统在产出"
  app.get('/api/memories/recent-created', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map(rowToMemory);
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

  app.post('/api/memories/:id/forget', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { method } = request.body as { method: ForgetMethod };
    const validMethods: ForgetMethod[] = ['archive', 'decay', 'delete'];
    if (!method || !validMethods.includes(method)) {
      reply.code(400);
      return { error: `method is required and must be one of: ${validMethods.join('|')}` };
    }
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
    const { project, query, limit, includeSuperseded } = request.body as {
      project?: string;
      query?: string;
      limit?: number;
      includeSuperseded?: boolean;
    };
    return injectContext({ project, query, limit, includeSuperseded: includeSuperseded === true });
  });

  app.post('/api/context/pack', async (request) => {
    return buildAgentContextPack(request.body as AgentContextPackRequest);
  });

  // 列表端点：让 UI 能直接看到"系统作为 loop 上下文记忆库被使用"的实际情况。
  // 没有这个端点时，healthReport.loopRuns 只是一个数字，用户看不到具体跑了什么。
  // 这是把 KeyMemory 真正作为 loop 工程上下文集库的核心视图入口。
  app.get('/api/loop/runs', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, objective, project_id, project_path, agent_id, status,
             checkpoint_version, last_event_sequence, trace_id,
             lease_owner, lease_expires_at, metadata,
             created_at, updated_at, completed_at
      FROM loop_runs
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return rows.map(rowToLoopRunSummary);
  });

  app.post('/api/loop/runs', async (request, reply) => {
    try {
      const observation = await startLoopRun(request.body as LoopRunStartRequest);
      reply.code(observation.status === 'warning' ? 200 : 201);
      return observation;
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/context', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await getLoopContext({ ...(request.body as Omit<LoopContextRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/checkpoints', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await checkpointLoopRun({ ...(request.body as Omit<LoopCheckpointRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/finish', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await finishLoopRun({ ...(request.body as Omit<LoopFinishRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
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
    return autoRemember({ content, source, agentId, isolationMode, currentProjectId: currentProject, conversationRound });
  });

  app.post('/api/migration/import-file', async (request, reply) => {
    const body = request.body as {
      filePath?: string;
      format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
      source?: string;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMemoriesFromPath(body.filePath, {
        format: body.format,
        source: body.source,
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/migration/sources', async (request) => {
    const query = request.query as Record<string, string>;
    const roots = query.root
      ? query.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
      : undefined;
    return discoverMigrationSources({
      roots,
      includeHome: query.includeHome !== 'false',
      includeMissing: query.includeMissing === 'true',
      maxFilesPerDirectory: query.maxFiles ? parseInt(query.maxFiles, 10) : undefined,
    });
  });

  app.post('/api/migration/import-path', async (request, reply) => {
    const body = request.body as {
      path?: string;
      format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
      source?: string;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      recursive?: boolean;
      maxFiles?: number;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    if (!body.path) {
      reply.code(400);
      return { error: 'path is required' };
    }
    try {
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMemoriesFromPath(body.path, {
        format: body.format,
        source: body.source,
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        recursive: body.recursive,
        maxFiles: body.maxFiles,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/migration/import-discovered', async (request, reply) => {
    const body = request.body as {
      root?: string;
      includeHome?: boolean;
      minConfidence?: number;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      maxFiles?: number;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    try {
      const roots = body.root
        ? body.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
        : undefined;
      const minConfidence = body.minConfidence ?? 0.7;
      const sources = discoverMigrationSources({ roots, includeHome: body.includeHome !== false })
        .filter(source => source.confidence >= minConfidence);
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMigrationSources(sources, {
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        maxFiles: body.maxFiles,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup, sources };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
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

  app.post('/api/backup/create-file', async (request, reply) => {
    const body = request.body as {
      filePath?: string;
      includeEmbeddings?: boolean;
      includeOperationalLogs?: boolean;
    };
    try {
      return createBackupFile(body.filePath, {
        includeEmbeddings: body.includeEmbeddings,
        includeOperationalLogs: body.includeOperationalLogs,
      });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/backup/inspect-file', async (request, reply) => {
    const body = request.body as { filePath?: string };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      return inspectBackupFile(body.filePath);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/backup/restore', async (request, reply) => {
    const body = request.body as { filePath?: string; dryRun?: boolean; replace?: boolean; preRestoreBackupPath?: string };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      return restoreBackupFile(body.filePath, {
        dryRun: body.dryRun === true,
        replace: body.replace === true,
        preRestoreBackupPath: body.preRestoreBackupPath,
      });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/graph/memory-connections', async () => {
    const db = getDatabase();

    const rows = db.prepare(`
      SELECT m.id, m.title, m.layer, m.tags, p.name as project_name
      FROM memories m
      LEFT JOIN projects p ON m.project_id = p.id
      WHERE m.status = 'active'
    `).all() as { id: string; title: string; layer: string; tags: string | null; project_name: string | null }[];

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
      tags: safeParseTags(r.tags),
      project: r.project_name,
    }));

    const memoryMap = new Map<string, typeof nodes[0]>();
    for (const n of nodes) {
      memoryMap.set(n.id, n);
    }

    const tagToMemories = new Map<string, string[]>();
    for (const r of rows) {
      const tags: string[] = safeParseTags(r.tags);
      for (const tag of tags) {
        if (!tagToMemories.has(tag)) tagToMemories.set(tag, []);
        tagToMemories.get(tag)!.push(r.id);
      }
    }

    const projectToMemories = new Map<string, string[]>();
    for (const r of rows) {
      if (r.project_name) {
        if (!projectToMemories.has(r.project_name)) projectToMemories.set(r.project_name, []);
        projectToMemories.get(r.project_name)!.push(r.id);
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
      SELECT m.tags, m.layer, p.name as project_name
      FROM memories m
      LEFT JOIN projects p ON m.project_id = p.id
      WHERE m.status = 'active'
    `).all() as { tags: string | null; layer: string; project_name: string | null }[];

    const totalMemories = rows.length;

    const tagData = new Map<string, { count: number; layers: Record<string, number> }>();
    for (const r of rows) {
      const tags: string[] = safeParseTags(r.tags);
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
      if (r.project_name) {
        projectData.set(r.project_name, (projectData.get(r.project_name) || 0) + 1);
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

  app.post('/api/dream/run', async (request, reply) => {
    try {
      const report = runDreamCycle();
      if (report.status === 'failed') {
        reply.code(500);
      } else {
        updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
      }
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
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

  app.post('/api/dream/rollback/:reportId', async (request) => {
    const { reportId } = request.params as { reportId: string };
    try {
      return rollbackDream(reportId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.delete('/api/dream/reports/:reportId', async (request, reply) => {
    const { reportId } = request.params as { reportId: string };
    const result = deleteDreamReport(reportId);
    if (!result.success) {
      reply.code(404);
      return { error: 'Report not found' };
    }
    return { success: true };
  });

  app.get('/api/dream/todos', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return { todos: getPendingTodosForContext(limit) };
  });

  // 解决冲突 todo 项
  app.post('/api/dream/conflicts/resolve', async (request, reply) => {
    const body = request.body as {
      memoryId: string;
      targetId: string;
      action: 'keep_memory' | 'keep_target' | 'merge_into_memory' | 'merge_into_target' | 'delete_memory' | 'delete_target';
      title?: string;
      content?: string;
      tags?: string[];
    };
    if (!body.memoryId || !body.targetId || !body.action) {
      reply.code(400);
      return { success: false, message: '缺少 memoryId / targetId / action' };
    }
    const result = resolveConflict(body.memoryId, body.targetId, body.action, {
      title: body.title,
      content: body.content,
      tags: body.tags,
    });
    if (!result.success) reply.code(400);
    return result;
  });

  // Project Suggestion routes
  app.get('/api/project-suggestions', async (request) => {
    const query = request.query as Record<string, string>;
    return listProjectSuggestions(query.status as 'pending' | 'accepted' | 'rejected' | undefined);
  });

  app.post('/api/project-suggestions/:id/accept', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { customName?: string };
    const result = acceptProjectSuggestion(id, body?.customName);
    if (!result.success) {
      reply.code(400);
      return { error: result.error };
    }
    return result;
  });

  app.post('/api/project-suggestions/:id/reject', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = rejectProjectSuggestion(id);
    if (!ok) {
      reply.code(400);
      return { error: 'Suggestion not found or already processed' };
    }
    return { success: true };
  });

  app.get('/api/recycle-bin', async (request) => {
    const query = request.query as Record<string, string>;
    return listRecycleBin({
      layer: query.layer as Layer | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  });

  app.post('/api/recycle-bin/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const mem = restoreFromRecycleBin(id);
    if (!mem) {
      reply.code(404);
      return { error: 'Memory not found or already active' };
    }
    return mem;
  });

  app.delete('/api/recycle-bin/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = permanentlyDeleteMemory(id);
    if (!ok) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    return { success: true };
  });

  app.post('/api/memories/:id/relate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { targetId, relationType, strength, reason } = request.body as { targetId: string; relationType: string; strength?: number; reason?: string };
    if (!targetId || !relationType) {
      reply.code(400);
      return { error: 'targetId and relationType are required' };
    }
    if (!MEMORY_RELATION_TYPES.includes(relationType as typeof MEMORY_RELATION_TYPES[number])) {
      reply.code(400);
      return { error: `relationType must be one of: ${MEMORY_RELATION_TYPES.join(', ')}` };
    }
    try {
      if (!getMemory(id)) {
        reply.code(404);
        return { error: `Memory not found: ${id}` };
      }
      if (!getMemory(targetId)) {
        reply.code(404);
        return { error: `Memory not found: ${targetId}` };
      }
      const relation = createMemoryRelation(id, targetId, relationType, strength ?? 1.0, reason);
      return relation;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/memories/:id/related', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    return findRelatedMemories(id, query.type);
  });

  app.get('/api/tags/namespaces', async () => {
    const db = getDatabase();
    const rows = db.prepare(`SELECT tags FROM memories WHERE status = 'active' AND tags IS NOT NULL`).all() as { tags: string }[];
    const namespaces = new Map<string, Set<string>>();
    for (const row of rows) {
      const tags: string[] = safeParseTags(row.tags);
      for (const tag of tags) {
        if (tag.includes(':')) {
          const [ns, value] = tag.split(':', 2);
          if (!namespaces.has(ns)) namespaces.set(ns, new Set());
          namespaces.get(ns)!.add(value);
        }
      }
    }
    return Object.fromEntries(
      Array.from(namespaces.entries()).map(([k, v]) => [k, Array.from(v).sort()])
    );
  });

  // Project routes
  app.get('/api/projects', async () => {
    return listProjects();
  });

  app.post('/api/projects', async (request, reply) => {
    const input = request.body as { name: string; parentId?: string | null; description?: string };
    if (!input.name) {
      reply.code(400);
      return { error: 'Project name is required' };
    }
    const project = createProject(input);
    reply.code(201);
    return project;
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = getProject(id);
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return project;
  });

  app.put('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = request.body as { name?: string; description?: string };
    const project = updateProject(id, input);
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return project;
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const strategy = query.strategy === 'promote' ? 'promote' : 'cascade';
    const ok = deleteProject(id, strategy);
    if (!ok) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return { success: true };
  });

  app.post('/api/projects/:id/move', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { parentId } = request.body as { parentId?: string | null };
    const project = moveProject(id, parentId ?? null);
    if (!project) {
      reply.code(400);
      return { error: 'Invalid move' };
    }
    return project;
  });

  app.get('/api/projects/:id/children', async (request, reply) => {
    const { id } = request.params as { id: string };
    return listProjects(id);
  });

  app.get('/api/projects/:id/descendants', async (request, reply) => {
    const { id } = request.params as { id: string };
    return getProjectDescendants(id);
  });

  app.get('/api/projects/:id/path', async (request, reply) => {
    const { id } = request.params as { id: string };
    return getProjectPath(id);
  });

  app.get('/api/projects/:id/memories', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    return getProjectMemories(id, {
      layer: query.layer,
      includeDescendants: query.includeDescendants === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  });

  app.get('/api/scheduler/config', async () => {
    return getSchedulerConfig();
  });

  app.post('/api/scheduler/config', async (request, reply) => {
    const updates = request.body as Record<string, unknown>;
    try {
      const result = updateSchedulerConfig(updates);
      restartScheduler();
      return result;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}
