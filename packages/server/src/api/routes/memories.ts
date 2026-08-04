/**
 * KM-410：记忆资源路由（CRUD/搜索/版本/关系/回收站，从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import type { CreateMemoryInput, UpdateMemoryInput, Layer, MemoryStatus, SearchQuery, ForgetMethod, IsolationMode } from '@keymemory/shared';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory, recordHit, batchCreateMemories, batchUpdateMemories, batchDeleteMemories } from '../../core/atom.js';
import { moveLayer, getLayerStats } from '../../core/layer.js';
import { searchHybrid } from '../../core/query.js';
import { forgetMemory, restoreMemory, getDecayingMemories, applyDecay as runDecay } from '../../core/forgetting.js';
import { extractTags } from '../../core/auto.js';
import { ContentQualityError } from '../../core/content-quality.js';
import { getDatabase } from '../../db/sqlite.js';
import { rowToMemory } from '../../db/mapper.js';
import { routeMemory, createAgentContext, visibleSpacesFor } from '../../adapters/base.js';
import { syncToClaudeMd, syncFromClaudeMd } from '../../adapters/claude-code.js';
import { buildAgentContextPack } from '../../core/context-pack.js';
import { injectContext as injectContextRoute } from '../../core/health.js';
import type { AgentContextPackRequest } from '@keymemory/shared';
import { filterMemoriesByOwner, filterRawRowsByOwner, getCaller, requireAdmin } from './shared.js';

export function registerMemoryRoutes(app: FastifyInstance): void {
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
    // 透传 caller userId 到 createMemory,使记忆写入 owner_user_id
    const caller = getCaller(request);
    // REST 手动创建是显式人工写入，跳过价值门禁（bypassQualityGate），
    // 防止用户主动记录的内容被误拒；Agent 路径（MCP/CLI/autoRemember）仍受门禁保护。
    try {
      const mem = createMemory({ ...input, bypassQualityGate: true, ...(caller?.userId ? { ownerUserId: caller.userId } : {}) } as CreateMemoryInput & { ownerUserId?: string; bypassQualityGate?: boolean });
      // 后处理（实体链接 + embedding + autoAssociate）已内聚到 createMemory 内部
      reply.code(201);
      return mem;
    } catch (err) {
      if (err instanceof ContentQualityError) {
        reply.code(422);
        return { error: err.message, code: err.code, reasons: err.reasons };
      }
      throw err;
    }
  });

  app.get('/api/memories/search', async (request) => {
    const query = request.query as Record<string, string>;
    const q = query.q;
    if (!q) return [];
    return searchHybrid(q, {
      layer: query.layer as Layer | undefined,
      projectId: query.projectId,
      projectPath: query.projectPath,
      includeDescendants: query.includeDescendants !== 'false',
      includeSuperseded: query.includeSuperseded === 'true',
      asOf: query.asOf,
      includeExpired: query.includeExpired === 'true',
      explain: query.explain === 'true',
      memoryKind: query.memoryKind as SearchQuery['memoryKind'],
      status: query.status as MemoryStatus | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    });
  });

  app.get('/api/memories/decaying', async () => {
    return getDecayingMemories();
  });

  app.get('/api/memories', async (request) => {
    const query = request.query as Record<string, string>;
    const caller = getCaller(request);
    const memories = listMemories({
      layer: query.layer as Layer | undefined,
      projectId: query.projectId,
      includeDescendants: query.includeDescendants === 'true',
      status: query.status as MemoryStatus | undefined,
      asOf: query.asOf,
      includeExpired: query.includeExpired === undefined ? undefined : query.includeExpired === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return filterMemoriesByOwner(memories, caller);
  });

  // 近期命中：按 last_hit_at 倒序返回近期被命中的记忆，让 UI 能直接展示系统的实际使用情况
  app.get('/api/memories/recent-hits', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const caller = getCaller(request);
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE status = 'active' AND last_hit_at IS NOT NULL
      ORDER BY last_hit_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return filterRawRowsByOwner(rows, caller).map(rowToMemory);
  });

  // 近期创建工作集：按 created_at 倒序返回最近写入的记忆，让用户能看到"系统在产出"
  app.get('/api/memories/recent-created', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const caller = getCaller(request);
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return filterRawRowsByOwner(rows, caller).map(rowToMemory);
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
    // 后处理（嵌入刷新 + 实体链接 + 关联重建）已内聚到 updateMemory 内部
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

  app.get('/api/layers/stats', async () => {
    return getLayerStats();
  });

  app.post('/api/layers/decay', async () => {
    return runDecay();
  });

  app.post('/api/context/inject', async (request) => {
    const { project, query, limit, includeSuperseded } = request.body as {
      project?: string;
      query?: string;
      limit?: number;
      includeSuperseded?: boolean;
    };
    return injectContextRoute({ project, query, limit, includeSuperseded: includeSuperseded === true });
  });

  app.post('/api/context/pack', async (request) => {
    const body = request.body as AgentContextPackRequest;
    // REST 端点也做 agent_space 隔离：从 header 推导可见空间。
    // 若 body 显式传了 agentSpaces 则优先 body（允许调用方覆盖），否则用 header 推导的默认值。
    if (!body.agentSpaces) {
      const agentId = (request.headers['x-agent-id'] as string) || 'hermes';
      const isolationMode = (request.headers['x-isolation-mode'] as IsolationMode) || 'hybrid';
      const caller = getCaller(request);
      body.agentSpaces = visibleSpacesFor(agentId, isolationMode, caller?.userId);
    }
    return buildAgentContextPack(body);
  });

  app.post('/api/agent/route', async (request) => {
    const { content, layer, agentId, isolationMode, customRules } = request.body as {
      content: string;
      layer: Layer;
      agentId: string;
      isolationMode?: IsolationMode;
      customRules?: { pattern: string; targetSpace: string; priority: number }[];
    };
    const caller = getCaller(request);
    const ctx = createAgentContext(agentId, isolationMode, caller?.userId);
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
}
