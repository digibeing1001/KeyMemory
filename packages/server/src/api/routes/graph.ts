/**
 * KM-410：图谱（graph）路由——记忆连接图/标签云/实体/重建（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../../db/sqlite.js';
import { ensureEmbedding } from '../../core/query.js';
import { listEntities, getEntityGraph, extractEntities, ensureEntity, linkMemoryEntity } from '../../graph/entity.js';
import { cleanTag, isMeaningfulTag } from '../../core/memory-schema.js';
import { callerIsAdminOrAnonymous, getCaller, isPlaceholderProjectName, requireAdmin, safeParseTags } from './shared.js';

export function registerGraphRoutes(app: FastifyInstance): void {
  /**
   * KM-407：弱边剪枝——批量删除 strength 低于阈值的关系边（默认仅 relates_to，
   * 即共现/弱关联；supersedes 等强语义边不受影响）。限 admin。
   */
  app.post('/api/graph/prune-weak-edges', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = (request.body ?? {}) as { minStrength?: number; relationType?: string };
    const minStrength = typeof body.minStrength === 'number' ? Math.max(0, Math.min(1, body.minStrength)) : 0.2;
    const relationType = body.relationType ?? 'relates_to';
    const db = getDatabase();
    const result = db.prepare('DELETE FROM memory_relations WHERE relation_type = ? AND strength < ?').run(relationType, minStrength);
    return { pruned: result.changes, relationType, minStrength };
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

  app.get('/api/graph/memory-connections', async (request) => {
    const db = getDatabase();
    const caller = getCaller(request);
    // member/exec/pm 只看自己的记忆 + owner_user_id 为 NULL 的旧数据;
    // boss/admin/匿名 看全部(不加 owner 条件)
    const ownerCondition = callerIsAdminOrAnonymous(caller)
      ? ''
      : 'AND (m.owner_user_id = @ownerUserId OR m.owner_user_id IS NULL)';
    const params: Record<string, unknown> = {};
    if (!callerIsAdminOrAnonymous(caller) && caller) {
      params.ownerUserId = caller.userId;
    }

    const rows = db.prepare(`
      SELECT m.id, m.title, m.content, m.layer, m.tags, m.updated_at, p.name as project_name,
        (SELECT mt.id
         FROM mail_thread_memories mtm
         JOIN mail_threads mt ON mt.id = mtm.thread_id
         WHERE mtm.memory_id = m.id
         ORDER BY mt.updated_at DESC LIMIT 1) as mail_thread_id,
        (SELECT mt.subject
         FROM mail_thread_memories mtm
         JOIN mail_threads mt ON mt.id = mtm.thread_id
         WHERE mtm.memory_id = m.id
         ORDER BY mt.updated_at DESC LIMIT 1) as mail_subject
      FROM memories m
      LEFT JOIN projects p ON m.project_id = p.id
      WHERE m.status = 'active' ${ownerCondition}
    `).all(params) as { id: string; title: string; content: string; layer: string; tags: string | null; updated_at: string; project_name: string | null; mail_thread_id: string | null; mail_subject: string | null }[];

    const entityRows = db.prepare(`
      SELECT me.memory_id, me.entity_id, e.name as entity_name
      FROM memory_entities me
      JOIN entities e ON e.id = me.entity_id
      JOIN memories m ON m.id = me.memory_id
      WHERE m.status = 'active' ${ownerCondition}
    `).all(params) as { memory_id: string; entity_id: string; entity_name: string }[];
    void entityRows;

    // 显式记忆关系：两端记忆都需存活且对当前调用方可见（owner 过滤对两端同时生效）
    const relationOwnerCondition = callerIsAdminOrAnonymous(caller)
      ? ''
      : ' AND (s.owner_user_id = @ownerUserId OR s.owner_user_id IS NULL) AND (t.owner_user_id = @ownerUserId OR t.owner_user_id IS NULL)';
    const explicitRows = db.prepare(`
      SELECT mr.source_memory_id, mr.target_memory_id, mr.relation_type, mr.strength, mr.reason
      FROM memory_relations mr
      JOIN memories s ON s.id = mr.source_memory_id AND s.status = 'active'
      JOIN memories t ON t.id = mr.target_memory_id AND t.status = 'active'
      WHERE 1 = 1${relationOwnerCondition}
    `).all(params) as { source_memory_id: string; target_memory_id: string; relation_type: string; strength: number; reason: string | null }[];

    // 构建关系映射：每个记忆的直属关联记忆 ID 列表
    const relationsMap = new Map<string, string[]>();
    for (const rel of explicitRows) {
      if (!relationsMap.has(rel.source_memory_id)) relationsMap.set(rel.source_memory_id, []);
      if (!relationsMap.has(rel.target_memory_id)) relationsMap.set(rel.target_memory_id, []);
      relationsMap.get(rel.source_memory_id)!.push(rel.target_memory_id);
      relationsMap.get(rel.target_memory_id)!.push(rel.source_memory_id);
    }

    const usableTags = (raw: string | null) => safeParseTags(raw)
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => cleanTag(tag.normalize('NFKC')))
      .filter(tag => isMeaningfulTag(tag) && !/^sensitivity:/i.test(tag));

    const nodes = rows.map(r => {
      const tags = usableTags(r.tags);
      const project = r.project_name?.trim() || undefined;
      return {
        id: r.id,
        title: r.title,
        summary: r.content.slice(0, 180),
        layer: r.layer,
        tags,
        project,
        updatedAt: r.updated_at,
        mailThreadId: r.mail_thread_id ?? undefined,
        relations: [...new Set(relationsMap.get(r.id) ?? [])],
      };
    });

    // 按节点对分组边，合并同一对节点间的多条关系
    const edgeMap = new Map<string, {
      source: string;
      target: string;
      relations: Array<{ type: string; strength: number; reason: string | null; direction: 'outgoing' | 'incoming' }>;
    }>();

    for (const rel of explicitRows) {
      const source = rel.source_memory_id;
      const target = rel.target_memory_id;
      // 用字典序键去重，确保同一对节点合并为一条边
      const [a, b] = source < target ? [source, target] : [target, source];
      const key = `${a}::${b}`;
      // direction: source_memory_id 是发起方 = outgoing
      const direction: 'outgoing' | 'incoming' = source === a ? 'outgoing' : 'incoming';
      const existing = edgeMap.get(key);
      if (existing) {
        existing.relations.push({ type: rel.relation_type, strength: rel.strength, reason: rel.reason, direction });
      } else {
        edgeMap.set(key, {
          source: a,
          target: b,
          relations: [{ type: rel.relation_type, strength: rel.strength, reason: rel.reason, direction }],
        });
      }
    }

    // 计算每条边的聚合字段
    const edges = Array.from(edgeMap.values()).map(e => {
      const typeCounts = new Map<string, number>();
      let totalStrength = 0;
      for (const r of e.relations) {
        typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
        totalStrength += r.strength;
      }
      let mostCommonType = e.relations[0].type;
      let maxCount = 0;
      for (const [type, count] of typeCounts) {
        if (count > maxCount) { mostCommonType = type; maxCount = count; }
      }
      return {
        source: e.source,
        target: e.target,
        type: mostCommonType,
        weight: e.relations.length,
        label: mostCommonType,
        strength: totalStrength / e.relations.length,
        direction: e.relations[0].direction,
        relations: e.relations,
      };
    });

    return { nodes, edges, nodesCount: nodes.length };
  });

  app.get('/api/graph/tag-cloud', async (request) => {
    const db = getDatabase();
    const caller = getCaller(request);
    const ownerCondition = callerIsAdminOrAnonymous(caller)
      ? ''
      : 'AND (m.owner_user_id = @ownerUserId OR m.owner_user_id IS NULL)';
    const params: Record<string, unknown> = {};
    if (!callerIsAdminOrAnonymous(caller) && caller) {
      params.ownerUserId = caller.userId;
    }

    const rows = db.prepare(`
      SELECT m.tags, m.layer, m.updated_at, p.name as project_name
      FROM memories m
      LEFT JOIN projects p ON m.project_id = p.id
      WHERE m.status = 'active' ${ownerCondition}
    `).all(params) as { tags: string | null; layer: string; updated_at: string; project_name: string | null }[];

    const totalMemories = rows.length;

    const tagData = new Map<string, { name: string; count: number; layers: Record<string, number>; lastUsedAt: string; aliases: Set<string> }>();
    const suspectData = new Map<string, { name: string; count: number; reason: string }>();
    for (const r of rows) {
      const tags: string[] = safeParseTags(r.tags);
      for (const rawTag of tags) {
        if (typeof rawTag !== 'string') continue;
        const tag = cleanTag(rawTag.normalize('NFKC')).replace(/\s+/g, ' ');
        const looksCorrupted = /[ï¿½]|锟斤拷|ï¿½|Ã.|Â./i.test(tag);
        const isSystemTag = /^sensitivity:/i.test(tag);
        if (!tag || looksCorrupted || isSystemTag || !isMeaningfulTag(tag)) {
          const reason = looksCorrupted
            ? '疑似乱码'
            : isSystemTag
              ? '系统内部标签'
              : '不符合标签规则';
          const key = tag.toLocaleLowerCase() || rawTag;
          const suspect = suspectData.get(key);
          if (suspect) suspect.count += 1;
          else suspectData.set(key, { name: tag || rawTag, count: 1, reason });
          continue;
        }

        const key = tag.toLocaleLowerCase();
        const existing = tagData.get(key);
        if (existing) {
          existing.count += 1;
          existing.layers[r.layer] = (existing.layers[r.layer] || 0) + 1;
          existing.aliases.add(tag);
        } else {
          tagData.set(key, { name: tag, count: 1, layers: { [r.layer]: 1 }, lastUsedAt: r.updated_at, aliases: new Set([tag]) });
        }
      }
    }

    const tags = Array.from(tagData.values())
      .map(data => ({ name: data.name, count: data.count, layers: data.layers, lastUsedAt: data.lastUsedAt, aliases: [...data.aliases] }))
      .sort((a, b) => b.count - a.count);

    const suspectTags = Array.from(suspectData.values()).sort((a, b) => b.count - a.count);

    const projectData = new Map<string, number>();
    for (const r of rows) {
      if (r.project_name && !isPlaceholderProjectName(r.project_name)) {
        projectData.set(r.project_name, (projectData.get(r.project_name) || 0) + 1);
      }
    }

    const projects = Array.from(projectData.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return { tags, suspectTags, projects, totalMemories };
  });
}
