/**
 * KM-410：记忆运维路由（版本/批量/导入导出/关系/回收站/标签命名空间，从 memories.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import type { Layer, MemoryStatus } from '@keymemory/shared';
import { listVersions, getVersion, revertToVersion, exportMemoriesAsJson, importMemories, listRecycleBin, restoreFromRecycleBin, permanentlyDeleteMemory } from '../../core/atom.js';
import { findDuplicateMemories } from '../../core/query.js';
import { getVersions, diffVersions, rollbackToVersion } from '../../core/provenance.js';
import { getDatabase } from '../../db/sqlite.js';
import { findRelatedMemories, createMemoryRelation, MEMORY_RELATION_TYPES } from '../../graph/entity.js';
import { supersedeMemory } from '../../core/supersession.js';
import { getCaller, getVisibleMemoryForRequest, requireAdmin, safeParseTags } from './shared.js';

export function registerMemoryOpsRoutes(app: FastifyInstance): void {
  app.get('/api/memories/export', async (request, reply) => {
    // 导出全库属于敏感操作,限 admin。非 admin 调用直接 403。
    if (!requireAdmin(reply, getCaller(request))) return;
    const query = request.query as Record<string, string>;
    const layer = query.layer as Layer | undefined;
    const status = query.status as MemoryStatus | undefined;
    return exportMemoriesAsJson({ layer, status });
  });

  app.post('/api/memories/import', async (request, reply) => {
    // 导入属于敏感操作,限 admin
    if (!requireAdmin(reply, getCaller(request))) return;
    const { data } = request.body as { data: string };
    return importMemories(data);
  });

  app.get('/api/memories/duplicates', async (request) => {
    const query = request.query as Record<string, string>;
    const threshold = parseFloat(query.threshold) || 0.9;
    const limit = parseInt(query.limit) || 20;
    return findDuplicateMemories(threshold, limit);
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
      if (!getVisibleMemoryForRequest(request, id)) {
        reply.code(404);
        return { error: `Memory not found or not accessible: ${id}` };
      }
      if (!getVisibleMemoryForRequest(request, targetId)) {
        reply.code(404);
        return { error: `Memory not found or not accessible: ${targetId}` };
      }
      const relation = createMemoryRelation(id, targetId, relationType, strength ?? 1.0, reason);
      return relation;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/memories/:id/related', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    if (!getVisibleMemoryForRequest(request, id)) {
      reply.code(404);
      return { error: `Memory not found or not accessible: ${id}` };
    }
    return findRelatedMemories(id, query.type)
      .filter(related => Boolean(getVisibleMemoryForRequest(request, related.memoryId)));
  });

  app.post('/api/memories/:id/supersede', async (request, reply) => {
    const { id: targetId } = request.params as { id: string };
    const { sourceId, effectiveAt, reason } = request.body as { sourceId?: string; effectiveAt?: string; reason?: string };
    if (!sourceId || !reason?.trim()) {
      reply.code(400);
      return { error: 'sourceId and reason are required' };
    }
    if (!getVisibleMemoryForRequest(request, sourceId) || !getVisibleMemoryForRequest(request, targetId)) {
      reply.code(404);
      return { error: 'Memory not found or not accessible' };
    }
    try {
      return supersedeMemory(sourceId, targetId, { effectiveAt, reason });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
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
}
