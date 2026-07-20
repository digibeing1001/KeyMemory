import { v4 as uuid } from 'uuid';
import type { SearchResult, Layer, MemoryStatus, EntityType } from '@keymemory/shared';
import { SEARCH_WEIGHTS, SEARCH_CONFIG } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { embed, embeddingToBuffer, cosineSimilarity, getEmbeddingDim, getCurrentModelInfo, isEmbeddingAvailable } from '../embed/onnx.js';
import { recordHit } from './atom.js';
import { rowToMemory } from '../db/mapper.js';
import { getCachedEmbedding, getCachedChunkEmbedding, warmupEmbeddingCache, warmupChunkEmbeddingCache, invalidateEmbeddingCache } from './embedding-cache.js';
import { scheduleChunkAndEmbed } from './chunking.js';
import { redactSensitiveText } from './privacy.js';
import { resolveAsOf } from './temporal.js';

/**
 * 增强共同命中的记忆之间的关系。
 *
 * 当两条记忆同时出现在搜索结果 top-N 中时，它们之间的现有关系 strength +0.01。
 * 这模拟了“同时被检索的记忆间存在更强语义关联”的信号。
 *
 * 失败不影响主流程（非阻塞、不抛错）。
 */
function reinforceCoHitRelations(db: ReturnType<typeof getDatabase>, hitMemoryIds: string[]): void {
  if (hitMemoryIds.length < 2) return;

  const REINFORCE_AMOUNT = 0.01;
  const MAX_STRENGTH = 1.0;

  try {
    for (let i = 0; i < hitMemoryIds.length; i++) {
      for (let j = i + 1; j < hitMemoryIds.length; j++) {
        db.prepare(`
          UPDATE memory_relations
          SET strength = MIN(?, strength + ?)
          WHERE (source_memory_id = ? AND target_memory_id = ?)
             OR (source_memory_id = ? AND target_memory_id = ?)
        `).run(
          MAX_STRENGTH, REINFORCE_AMOUNT,
          hitMemoryIds[i], hitMemoryIds[j],
          hitMemoryIds[j], hitMemoryIds[i],
        );
      }
    }
  } catch (err) {
    console.error('[Query] Relation reinforcement failed (non-fatal):', (err as Error).message);
  }
}

type SearchOptions = {
  layer?: Layer;
  status?: MemoryStatus;
  agentSpaces?: string[];
  projectId?: string;
  /** Mailbox-era source scope retained for legacy project-path retrieval. */
  projectPath?: string;
  includeDescendants?: boolean;
  includeSuperseded?: boolean;
  asOf?: string;
  includeExpired?: boolean;
  explain?: boolean;
  memoryKind?: string;
  limit?: number;
  tags?: string[];
  tagsMatch?: 'any' | 'all';
  entityId?: string;
  entityName?: string;
  entityType?: EntityType;
  source?: string;
  minConfidence?: number;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  lastHitAfter?: string;
  lastHitBefore?: string;
};

function logQuery(query: string, memoryId: string, matchType: string): void {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    const safeQuery = redactSensitiveText(query.trim()).text.slice(0, 200);
    db.prepare(`
      INSERT INTO query_logs (id, query, memory_id, match_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuid(), safeQuery, memoryId, matchType, now);
  } catch {
    // 查询日志失败不应影响搜索功能
  }
}

function addSearchFilters(conditions: string[], params: Record<string, unknown>, options?: SearchOptions): void {
  const asOf = resolveAsOf(options?.asOf);
  if (options?.layer) {
    conditions.push('m.layer = @layer');
    params.layer = options.layer;
  }

  if (options?.projectId) {
    params.projectId = options.projectId;
    if (options.includeDescendants === false) {
      conditions.push('m.project_id = @projectId');
    } else {
      conditions.push(`m.project_id IN (
        SELECT child.id
        FROM projects child
        JOIN projects root ON root.id = @projectId
        WHERE child.id = root.id OR child.path LIKE root.path || '/%'
      )`);
    }
  }

  if (options?.projectPath) {
    params.projectPath = options.projectPath;
    params.projectPathPrefix = `${options.projectPath}/%`;
    const sourcePath = `CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata)
      THEN json_extract(m.metadata, '$.sourceProjectPath') END`;
    const legacyPath = `CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata)
      THEN json_extract(m.metadata, '$.legacyProject.path') END`;
    const sourceMatch = options.includeDescendants === false
      ? `(${sourcePath} = @projectPath
          OR ${legacyPath} = @projectPath
          OR m.project_id IN (SELECT id FROM projects WHERE path = @projectPath))`
      : `(${sourcePath} = @projectPath
          OR ${sourcePath} LIKE @projectPathPrefix
          OR ${legacyPath} = @projectPath
          OR ${legacyPath} LIKE @projectPathPrefix
          OR m.project_id IN (SELECT id FROM projects WHERE path = @projectPath OR path LIKE @projectPathPrefix))`;
    conditions.push(sourceMatch);
  }

  if (options?.memoryKind) {
    conditions.push("(m.tags LIKE @memoryKindTag OR m.metadata LIKE @memoryKindMeta)");
    params.memoryKindTag = `%kind:${options.memoryKind}%`;
    params.memoryKindMeta = `%"memoryKind":"${options.memoryKind}"%`;
  }

  const activeSearch = (options?.status ?? 'active') === 'active';
  if (options?.includeExpired !== true) {
    params.asOf = asOf;
    const validFrom = "COALESCE(CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata) THEN json_extract(m.metadata, '$.validFrom') END, m.created_at)";
    const validTo = "CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata) THEN json_extract(m.metadata, '$.validTo') END";
    conditions.push(`${validFrom} <= @asOf AND (${validTo} IS NULL OR ${validTo} > @asOf)`);
  }
  if (activeSearch && options?.includeSuperseded !== true) {
    params.asOf = asOf;
    conditions.push(`NOT EXISTS (
      SELECT 1
      FROM memory_relations r
      JOIN memories source ON source.id = r.source_memory_id
      WHERE r.target_memory_id = m.id
        AND r.relation_type = 'supersedes'
        AND source.status = 'active'
        AND COALESCE(
          CASE WHEN source.metadata IS NOT NULL AND json_valid(source.metadata)
            THEN json_extract(source.metadata, '$.validFrom') END,
          source.created_at
        ) <= @asOf
        AND (
          CASE WHEN source.metadata IS NOT NULL AND json_valid(source.metadata)
            THEN json_extract(source.metadata, '$.validTo') END IS NULL
          OR CASE WHEN source.metadata IS NOT NULL AND json_valid(source.metadata)
            THEN json_extract(source.metadata, '$.validTo') END > @asOf
        )
    )`);
  }

  if (options?.agentSpaces && options.agentSpaces.length > 0) {
    conditions.push(`m.agent_space IN (${options.agentSpaces.map((_, i) => `@agentSpace${i}`).join(', ')})`);
    options.agentSpaces.forEach((space, i) => {
      params[`agentSpace${i}`] = space;
    });
  }

  // 标签过滤：tags 列以 JSON 数组存储，用 json_each 精确匹配避免 LIKE 误命中（如 "tag1" 匹配 "tag10"）。
  // json_valid 保护：旧数据若非 JSON 不会报错，只是不入选。
  if (options?.tags && options.tags.length > 0) {
    const matchMode = options.tagsMatch ?? 'any';
    const tagClauses = options.tags.map((tag, i) => {
      const paramName = `tag${i}`;
      params[paramName] = tag;
      return `EXISTS (SELECT 1 FROM json_each(m.tags) WHERE json_each.value = @${paramName})`;
    });
    const connector = matchMode === 'all' ? ' AND ' : ' OR ';
    conditions.push(`(m.tags IS NOT NULL AND json_valid(m.tags) AND (${tagClauses.join(connector)}))`);
  }

  // 实体过滤：通过 memory_entities 关联表 JOIN entities。
  // entityId 优先；否则用 entityName/entityType 组合（AND 语义）。
  // entityName 同时匹配 entity.name 和 entity_aliases.alias，确保别名实体也能被检索到。
  if (options?.entityId) {
    params.entityId = options.entityId;
    conditions.push(`EXISTS (
      SELECT 1 FROM memory_entities me
      WHERE me.memory_id = m.id AND me.entity_id = @entityId
    )`);
  } else if (options?.entityName || options?.entityType) {
    const entityConds: string[] = [];
    if (options.entityName) {
      params.entityName = options.entityName;
      // 同时匹配 name 和 alias，让通过别名检索也能命中
      entityConds.push('(e.name = @entityName OR EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.entity_id = e.id AND ea.alias = @entityName))');
    }
    if (options.entityType) {
      params.entityType = options.entityType;
      entityConds.push('e.type = @entityType');
    }
    conditions.push(`EXISTS (
      SELECT 1 FROM memory_entities me
      JOIN entities e ON e.id = me.entity_id
      WHERE me.memory_id = m.id AND ${entityConds.join(' AND ')}
    )`);
  }

  if (options?.source) {
    conditions.push('m.source = @source');
    params.source = options.source;
  }

  if (typeof options?.minConfidence === 'number') {
    conditions.push('m.confidence >= @minConfidence');
    params.minConfidence = options.minConfidence;
  }

  // 时间范围过滤：ISO 8601 字符串的文本比较天然按时间序。
  // last_hit_at 可能为 NULL（从未被命中的记忆），对 lastHit* 过滤需显式 IS NOT NULL。
  if (options?.createdAfter) {
    conditions.push('m.created_at >= @createdAfter');
    params.createdAfter = options.createdAfter;
  }
  if (options?.createdBefore) {
    conditions.push('m.created_at <= @createdBefore');
    params.createdBefore = options.createdBefore;
  }
  if (options?.updatedAfter) {
    conditions.push('m.updated_at >= @updatedAfter');
    params.updatedAfter = options.updatedAfter;
  }
  if (options?.updatedBefore) {
    conditions.push('m.updated_at <= @updatedBefore');
    params.updatedBefore = options.updatedBefore;
  }
  if (options?.lastHitAfter) {
    conditions.push('m.last_hit_at IS NOT NULL AND m.last_hit_at >= @lastHitAfter');
    params.lastHitAfter = options.lastHitAfter;
  }
  if (options?.lastHitBefore) {
    conditions.push('m.last_hit_at IS NOT NULL AND m.last_hit_at <= @lastHitBefore');
    params.lastHitBefore = options.lastHitBefore;
  }
}

export async function ensureEmbedding(memoryId: string, title: string, content: string, tags?: string[], metadata?: Record<string, unknown>, force?: boolean): Promise<void> {
  const db = getDatabase();
  const existing = db.prepare(`SELECT memory_id FROM embeddings WHERE memory_id = ?`).get(memoryId);
  if (existing && !force) return;
  if (existing && force) {
    db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(memoryId);
  }

  let embedText = `${title} ${content}`;
  if (tags && tags.length > 0) embedText += ` ${tags.join(' ')}`;
  if (metadata) {
    const metaValues = Object.values(metadata).filter(v => typeof v === 'string' || Array.isArray(v));
    if (metaValues.length > 0) embedText += ` ${metaValues.flat().join(' ')}`;
  }

  const vector = await embed(embedText);
  if (!vector) {
    return;
  }
  const now = new Date().toISOString();
  const modelInfo = getCurrentModelInfo();
  db.prepare(`
    INSERT INTO embeddings (memory_id, embedding, model, created_at)
    VALUES (?, ?, ?, ?)
  `).run(memoryId, embeddingToBuffer(vector), modelInfo.id ?? 'unknown', now);

  // 使缓存失效，下次搜索会重新加载
  invalidateEmbeddingCache(memoryId);

  // 触发分块嵌入（传入 tags/metadata 作为全局前缀，与 memory 级嵌入保持上下文一致）
  scheduleChunkAndEmbed(memoryId, title, content, tags, metadata);
}

function quoteFtsPhrase(value: string): string {
  const phrase = value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/"/g, '""');
  return `"${phrase}"`;
}

function buildSimpleWildcardQuery(query: string): string | undefined {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (terms.length === 0) return undefined;

  const safeTerms: string[] = [];
  for (const term of terms.slice(0, 12)) {
    const match = term.match(/^([\p{L}\p{N}_-]+)(\*)?$/u);
    if (!match) return undefined;
    safeTerms.push(match[2] ? `${match[1]}*` : quoteFtsPhrase(match[1]));
  }
  return safeTerms.join(' OR ');
}

function buildSafeFtsQuery(query: string): string {
  const normalized = query.replace(/\s+/g, ' ').trim();
  if (!normalized) return '""';

  if (normalized.includes('*')) {
    const wildcard = buildSimpleWildcardQuery(normalized);
    if (wildcard) return wildcard;
  }

  const terms = normalized.match(/[\p{L}\p{N}_-]{2,}/gu)?.slice(0, 12) ?? [];
  const clauses = [quoteFtsPhrase(normalized), ...terms.map(quoteFtsPhrase)];
  return Array.from(new Set(clauses)).join(' OR ');
}

export async function searchFulltext(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const db = getDatabase();
  const conditions = [options?.status ? 'm.status = @status' : "m.status = 'active'"];
  const params: Record<string, unknown> = { limit: options?.limit ?? 20 };
  if (options?.status) params.status = options.status;

  addSearchFilters(conditions, params, options);

  const matchQuery = buildSafeFtsQuery(query);
  
  params.q = matchQuery;

  try {
    const rows = db.prepare(`
      SELECT m.*, bm25(memories_fts) as score
      FROM memories_fts f
      JOIN memories m ON m.rowid = f.rowid
      WHERE memories_fts MATCH @q
        AND ${conditions.join(' AND ')}
      ORDER BY score
      LIMIT @limit
    `).all(params) as (Record<string, unknown> & { score: number })[];

    const results = rows.map(r => ({
      memory: rowToMemory(r),
      score: -r.score,
      matchType: 'fulltext' as const,
    }));

    for (const r of results) {
      logQuery(query, r.memory.id, 'fulltext');
    }

    if (results.length > 0) return results;
    // FTS 命中 0 条 → 仍回退到 LIKE，但记录原因便于排查
    console.warn(`[Query] FTS 命中 0 条，回退 LIKE。query=${query.slice(0, 80)}, matchQuery=${matchQuery.slice(0, 80)}`);
    return searchLikeFallback(query, conditions, params);
  } catch (err) {
    // FTS 查询失败（如特殊字符触发语法错误）→ 记录日志后回退 LIKE，避免阻断搜索
    // 之前静默吞错，难以排查 FTS 索引损坏或查询语法问题
    console.error(`[Query] FTS 查询失败，回退 LIKE。query=${query.slice(0, 80)}, error=${(err as Error).message}`);
    return searchLikeFallback(query, conditions, params);
  }
}

function searchLikeFallback(query: string, conditions: string[], params: Record<string, unknown>): SearchResult[] {
  const db = getDatabase();
  const terms = query
    .split(/[\s,，。；;]+/)
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (terms.length === 0) return [];

  const likeConditions = terms.map((_, i) => `(
    m.title LIKE @like${i}
    OR m.content LIKE @like${i}
    OR m.tags LIKE @like${i}
    OR m.metadata LIKE @like${i}
    OR p.name LIKE @like${i}
    OR p.path LIKE @like${i}
  )`);
  const likeParams = { ...params };
  terms.forEach((term, i) => {
    likeParams[`like${i}`] = `%${term}%`;
  });

  const rows = db.prepare(`
    SELECT m.*
    FROM memories m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE ${conditions.join(' AND ')}
      AND (${likeConditions.join(' OR ')})
    ORDER BY m.updated_at DESC
    LIMIT @limit
  `).all(likeParams) as Record<string, unknown>[];

  const results = rows.map(r => ({
    memory: rowToMemory(r),
    score: 0.01,
    matchType: 'fulltext' as const,
  }));
  for (const r of results) {
    logQuery(query, r.memory.id, 'like');
  }
  return results;
}

export async function searchSemantic(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  if (!isEmbeddingAvailable()) {
    return [];
  }

  const queryVec = await embed(query);
  if (!queryVec) {
    return [];
  }

  // 首次搜索时预热缓存
  warmupEmbeddingCache();
  warmupChunkEmbeddingCache();

  const db = getDatabase();
  const conditions = [options?.status ? 'm.status = @status' : "m.status = 'active'"];
  const params: Record<string, unknown> = {};
  if (options?.status) params.status = options.status;
  addSearchFilters(conditions, params, options);

  // 1. 只取有 embedding 的记忆（INNER JOIN embeddings），避免对无向量记忆做无效 cosine 计算。
  //    按 hit_count / last_hit_at / updated_at 排序，让高频/近期命中的重要记忆优先进入 500 限额，
  //    防止"随机 500 条"漏掉最相关的记忆。
  const rows = db.prepare(`
    SELECT m.*
    FROM memories m
    INNER JOIN embeddings e ON e.memory_id = m.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.hit_count DESC, m.last_hit_at DESC, m.updated_at DESC
    LIMIT 500
  `).all(params) as Record<string, unknown>[];

  // 2. 批量获取所有相关记忆的分块 ID（一次查询代替 N 次）
  const memoryIds = rows.map(r => (r as { id: string }).id);
  const chunkMap = new Map<string, string[]>(); // memoryId → chunkIds
  if (memoryIds.length > 0) {
    const placeholders = memoryIds.map(() => '?').join(',');
    const chunkRows = db.prepare(`
      SELECT memory_id, id FROM memory_chunks
      WHERE memory_id IN (${placeholders}) AND embedding IS NOT NULL
    `).all(...memoryIds) as { memory_id: string; id: string }[];

    for (const cr of chunkRows) {
      const list = chunkMap.get(cr.memory_id) || [];
      list.push(cr.id);
      chunkMap.set(cr.memory_id, list);
    }
  }

  // 3. 计算相似度
  const scored: SearchResult[] = [];

  for (const r of rows) {
    const mem = rowToMemory(r);
    const memVec = getCachedEmbedding(mem.id);
    const memSim = memVec ? cosineSimilarity(queryVec, memVec) : 0;

    // 检查分块，取最高分
    let bestChunkSim = 0;
    const chunkIds = chunkMap.get(mem.id) || [];
    for (const chunkId of chunkIds) {
      const chunkVec = getCachedChunkEmbedding(chunkId);
      if (chunkVec) {
        const chunkSim = cosineSimilarity(queryVec, chunkVec);
        if (chunkSim > bestChunkSim) bestChunkSim = chunkSim;
      }
    }

    // 取记忆级和分块级的最高分
    const finalScore = Math.max(memSim, bestChunkSim);

    scored.push({
      memory: mem,
      score: finalScore,
      matchType: 'semantic' as const,
    });
  }

  scored.sort((a, b) => b.score - a.score);

  const limited = scored.slice(0, options?.limit ?? 20);
  // Do not recordHit here; searchHybrid handles it once for fused results.

  return limited;
}

export async function findDuplicateMemories(threshold: number = 0.9, limit: number = 20): Promise<{ memoryId1: string; memoryId2: string; similarity: number }[]> {
  if (!isEmbeddingAvailable()) {
    return [];
  }

  // 使用缓存，避免大量磁盘 IO
  warmupEmbeddingCache();

  const db = getDatabase();
  const rows = db.prepare(`
    SELECT e.memory_id as id
    FROM embeddings e
    JOIN memories m ON m.id = e.memory_id
    WHERE m.status = 'active'
    LIMIT 5000
  `).all() as { id: string }[];

  // 从缓存获取向量
  const vectors: { id: string; vec: Float32Array }[] = [];
  for (const row of rows) {
    const vec = getCachedEmbedding(row.id);
    if (vec) vectors.push({ id: row.id, vec });
  }

  const duplicates: { memoryId1: string; memoryId2: string; similarity: number }[] = [];

  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const sim = cosineSimilarity(vectors[i].vec, vectors[j].vec);
      if (sim >= threshold) {
        duplicates.push({
          memoryId1: vectors[i].id,
          memoryId2: vectors[j].id,
          similarity: sim,
        });
        if (duplicates.length >= limit) break;
      }
    }
    if (duplicates.length >= limit) break;
  }

  duplicates.sort((a, b) => b.similarity - a.similarity);

  return duplicates;
}

function productionRankBoost(memory: SearchResult['memory']): {
  hitBoost: number;
  confidenceBoost: number;
  durableLayerBoost: number;
  decayBoost: number;
  total: number;
} {
  const hitBoost = Math.min(0.006, Math.log1p(memory.hitCount) * 0.0015);
  const confidenceBoost = Math.max(0, Math.min(memory.confidence, 1)) * 0.003;
  const durableLayerBoost = memory.layer === 'long' || memory.layer === 'entity' ? 0.002 : 0;
  const decayBoost = (memory.decayFactor ?? 1) * 0.002;
  return {
    hitBoost,
    confidenceBoost,
    durableLayerBoost,
    decayBoost,
    total: hitBoost + confidenceBoost + durableLayerBoost + decayBoost,
  };
}

export async function searchHybrid(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const limit = options?.limit ?? 20;
  // Full-text and semantic branches must evaluate the same instant. Resolving
  // "now" once avoids millisecond boundary disagreements around validFrom/To.
  const effectiveOptions = { ...options, asOf: resolveAsOf(options?.asOf) };

  const [fulltextResults, semanticResults] = await Promise.all([
    searchFulltext(query, { ...effectiveOptions, limit: limit * 2 }),
    searchSemantic(query, { ...effectiveOptions, limit: limit * 2 }),
  ]);

  const rrfMap = new Map<string, { memory: SearchResult['memory']; fulltextRank?: number; semanticRank?: number }>();

  fulltextResults.forEach((r, idx) => {
    rrfMap.set(r.memory.id, { memory: r.memory, fulltextRank: idx + 1 });
  });

  semanticResults.forEach((r, idx) => {
    const existing = rrfMap.get(r.memory.id);
    if (existing) {
      existing.semanticRank = idx + 1;
    } else {
      rrfMap.set(r.memory.id, { memory: r.memory, semanticRank: idx + 1 });
    }
  });

  const k = SEARCH_CONFIG.rrfK;
  const fused = Array.from(rrfMap.entries()).map(([id, data]) => {
    const fulltextContribution = data.fulltextRank ? SEARCH_WEIGHTS.fulltext / (k + data.fulltextRank) : 0;
    const semanticContribution = data.semanticRank ? SEARCH_WEIGHTS.semantic / (k + data.semanticRank) : 0;
    const boosts = productionRankBoost(data.memory);
    const score = fulltextContribution + semanticContribution + boosts.total;
    return {
      memory: data.memory,
      score,
      matchType: 'hybrid' as const,
      ...(options?.explain ? {
        scoreBreakdown: {
          fulltextRank: data.fulltextRank,
          semanticRank: data.semanticRank,
          fulltextContribution: Number(fulltextContribution.toFixed(8)),
          semanticContribution: Number(semanticContribution.toFixed(8)),
          hitBoost: Number(boosts.hitBoost.toFixed(8)),
          confidenceBoost: Number(boosts.confidenceBoost.toFixed(8)),
          durableLayerBoost: Number(boosts.durableLayerBoost.toFixed(8)),
          decayBoost: Number(boosts.decayBoost.toFixed(8)),
          finalScore: Number(score.toFixed(8)),
        },
      } : {}),
    };
  });

  fused.sort((a, b) => b.score - a.score);

  const limited = fused.slice(0, limit);
  const hitIds: string[] = [];
  for (const r of limited) {
    recordHit(r.memory.id);
    logQuery(query, r.memory.id, 'hybrid');
    hitIds.push(r.memory.id);
  }

  // 异步增强共同命中的记忆间关系（不阻塞返回）
  setImmediate(() => {
    try {
      reinforceCoHitRelations(getDatabase(), hitIds);
    } catch {
      // 已内部捕获，此处额外保护
    }
  });

  return limited;
}
