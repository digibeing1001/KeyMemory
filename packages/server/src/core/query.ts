import { v4 as uuid } from 'uuid';
import type { SearchResult, Layer, MemoryStatus, EntityType } from '@keymemory/shared';
import { SEARCH_WEIGHTS, SEARCH_CONFIG, MEMORY_POLICY } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { embed, embeddingToBuffer, cosineSimilarity, getEmbeddingDim, getCurrentModelInfo, isEmbeddingAvailable } from '../embed/onnx.js';
import { recordHit } from './atom.js';
import { rowToMemory } from '../db/mapper.js';
import { getCachedEmbedding, getCachedChunkEmbedding, warmupEmbeddingCache, warmupChunkEmbeddingCache, invalidateEmbeddingCache } from './embedding-cache.js';
import { scheduleChunkAndEmbed } from './chunking.js';
import { redactSensitiveText } from './privacy.js';
import { resolveAsOf } from './temporal.js';
import { cjkTrigrams, containsCjk } from './cjk.js';
import { extractEntities } from '../graph/entity.js';

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
  /** KM-001：searchHybrid 统一记录含完整指标的日志时，抑制单路内部的重复记录。 */
  suppressQueryLog?: boolean;
};

type QueryLogMetrics = {
  queryId?: string;
  rank?: number;
  score?: number;
  latencyMs?: number;
  candidateCount?: number;
  degradedReason?: string;
};

function logQuery(query: string, memoryId: string, matchType: string, metrics: QueryLogMetrics = {}): void {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    const safeQuery = redactSensitiveText(query.trim()).text.slice(0, 200);
    db.prepare(`
      INSERT INTO query_logs (id, query, memory_id, match_type, created_at, query_id, rank, score, latency_ms, candidate_count, degraded_reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuid(), safeQuery, memoryId, matchType, now,
      metrics.queryId ?? null,
      metrics.rank ?? null,
      metrics.score ?? null,
      metrics.latencyMs ?? null,
      metrics.candidateCount ?? null,
      metrics.degradedReason ?? null,
    );
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

  // KM-103/D3：memories_fts 用 trigram 分词器（substring 匹配，最小 3 字符）。
  // 中文 query 拆为 trigram 词元做 OR 匹配；双字词无法命中 trigram 索引，
  // 从 FTS 词元中剔除（交给 LIKE 降级路），避免整串 0 命中。
  if (containsCjk(normalized)) {
    const rawTerms = normalized.split(/\s+/).filter(Boolean);
    const terms = new Set<string>();
    for (const term of rawTerms) {
      if (!containsCjk(term)) {
        if (/^[\p{L}\p{N}_-]{2,}$/u.test(term)) terms.add(term);
        continue;
      }
      if (term.length >= 3) {
        for (const gram of cjkTrigrams(term)) terms.add(gram);
      }
      // <3 字的中文词：trigram 不可索引，不进 FTS 词元
    }
    if (terms.size === 0) return '""';
    return Array.from(terms).slice(0, 24).map(quoteFtsPhrase).join(' OR ');
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

    if (!options?.suppressQueryLog) {
      for (const r of results) {
        logQuery(query, r.memory.id, 'fulltext');
      }
    }

    if (results.length > 0) return results;
    // FTS 命中 0 条 → 仍回退到 LIKE，但记录原因便于排查
    console.warn(`[Query] FTS 命中 0 条，回退 LIKE。query=${query.slice(0, 80)}, matchQuery=${matchQuery.slice(0, 80)}`);
    return searchLikeFallback(query, conditions, params, options);
  } catch (err) {
    // FTS 查询失败（如特殊字符触发语法错误）→ 记录日志后回退 LIKE，避免阻断搜索
    // 之前静默吞错，难以排查 FTS 索引损坏或查询语法问题
    console.error(`[Query] FTS 查询失败，回退 LIKE。query=${query.slice(0, 80)}, error=${(err as Error).message}`);
    return searchLikeFallback(query, conditions, params, options);
  }
}

function searchLikeFallback(query: string, conditions: string[], params: Record<string, unknown>, options?: SearchOptions): SearchResult[] {
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

  // KM-106/D14：LIKE 降级必须可见——结果打 degraded 标记，日志写 degraded_reason，
  // 前端可据此渲染“中文检索已降级为模糊匹配，排序不准确”提示。
  const results = rows.map(r => ({
    memory: rowToMemory(r),
    score: 0.01,
    matchType: 'fulltext' as const,
    degraded: 'fts_unavailable' as const,
  }));
  if (!options?.suppressQueryLog) {
    for (const r of results) {
      logQuery(query, r.memory.id, 'like', { degradedReason: 'fts_unavailable' });
    }
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

  // KM-104/D2：候选窗口改分层抽样，消除“按热度截断导致新记忆永远进不了候选”的系统性偏差：
  //   热度 Top300 ∪ 最近写入 Top200 ∪ 当前过滤范围内全量（上限 1000）。
  // 旧方案按 hit_count 排序截断 500，hit_count=0 的新记忆在库超过 500 条后永远召不回。
  const candidateSelectBase = `
    FROM memories m
    INNER JOIN embeddings e ON e.memory_id = m.id
    WHERE ${conditions.join(' AND ')}
  `;
  const hotIds = (db.prepare(`SELECT m.id ${candidateSelectBase} ORDER BY m.hit_count DESC, m.last_hit_at DESC LIMIT 300`).all(params) as { id: string }[]).map(r => r.id);
  const recentIds = (db.prepare(`SELECT m.id ${candidateSelectBase} ORDER BY m.created_at DESC LIMIT 200`).all(params) as { id: string }[]).map(r => r.id);
  const scopedIds = (db.prepare(`SELECT m.id ${candidateSelectBase} ORDER BY m.updated_at DESC LIMIT 1000`).all(params) as { id: string }[]).map(r => r.id);
  const candidateIds = Array.from(new Set([...hotIds, ...recentIds, ...scopedIds]));
  if (candidateIds.length === 0) return [];

  const rows = (db.prepare(`
    SELECT m.*
    FROM memories m
    WHERE m.id IN (${candidateIds.map(() => '?').join(',')})
  `).all(...candidateIds) as Record<string, unknown>[]);

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
  total: number;
} {
  const hitBoost = Math.min(0.006, Math.log1p(memory.hitCount) * 0.0015);
  const confidenceBoost = Math.max(0, Math.min(memory.confidence, 1)) * 0.003;
  const durableLayerBoost = memory.layer === 'long' || memory.layer === 'entity' ? 0.002 : 0;
  return {
    hitBoost,
    confidenceBoost,
    durableLayerBoost,
    total: hitBoost + confidenceBoost + durableLayerBoost,
  };
}

// KM-101/D1：旧实现把 boost（上限 0.011）直接加到 RRF 主分（典型 0.004–0.012）上，
// 加成上限 ≥ 主分满值，高 hit_count 的老记忆可直接压过精准命中。
// 现改为乘性微调：score × (1 + rankBoostFactor × normalizedBoost)，影响被限制在 ±15% 内。
const RANK_BOOST_MAX = 0.006 + 0.003 + 0.002;

function qualityMultiplier(memory: SearchResult['memory']): { multiplier: number; boost: ReturnType<typeof productionRankBoost> } {
  const boost = productionRankBoost(memory);
  const normalizedBoost = Math.max(0, Math.min(1, boost.total / RANK_BOOST_MAX));
  return { multiplier: 1 + MEMORY_POLICY.rankBoostFactor * normalizedBoost, boost };
}

/**
 * KM-107/D1·M3-Agent：实体路由检索（RRF 第三路）。
 * 实体不应只是标注结果，而应是一等检索入口：从 query 抽实体 →
 * 按名称/别名反查 entity → 经 memory_entities 取关联记忆。
 * 实体型 query（含人名/工具名/项目名）在此路直接命中，不受热度与分词影响。
 */
function searchEntityRouted(query: string, options?: SearchOptions, limit = 30): SearchResult[] {
  try {
    const extracted = extractEntities(query);
    if (extracted.length === 0) return [];
    const db = getDatabase();
    const conditions = [options?.status ? 'm.status = @status' : "m.status = 'active'"];
    const params: Record<string, unknown> = {};
    if (options?.status) params.status = options.status;
    addSearchFilters(conditions, params, options);
    const names = Array.from(new Set(extracted.map(e => e.name))).slice(0, 6);
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    for (const name of names) {
      const rows = db.prepare(`
        SELECT DISTINCT m.*
        FROM memory_entities me
        JOIN entities e ON e.id = me.entity_id
        LEFT JOIN entity_aliases ea ON ea.entity_id = e.id
        JOIN memories m ON m.id = me.memory_id
        WHERE (e.name = @name OR ea.alias = @name) AND ${conditions.join(' AND ')}
        ORDER BY m.updated_at DESC
        LIMIT @limit
      `).all({ ...params, name, limit }) as Record<string, unknown>[];
      for (const r of rows) {
        const mem = rowToMemory(r);
        if (seen.has(mem.id)) continue;
        seen.add(mem.id);
        results.push({ memory: mem, score: 1, matchType: 'semantic' as const });
      }
    }
    if (!options?.suppressQueryLog) {
      for (const r of results) {
        logQuery(query, r.memory.id, 'entity');
      }
    }
    return results;
  } catch {
    // 实体路由失败不阻断主检索（降级原则：失败静默回退，但整体降级在 health 可见）
    return [];
  }
}

// KM-108 多跳候选准入：与主检索同标准的时态与裁决过滤（被替代/未生效/过期的记忆不得经多跳绕过过滤进入结果）。
function multiHopAllowed(db: ReturnType<typeof getDatabase>, memoryId: string, asOf: string, includeExpired: boolean, includeSuperseded: boolean): boolean {
  try {
    const row = db.prepare(`
      SELECT
        COALESCE(CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata) THEN json_extract(m.metadata, '$.validFrom') END, m.created_at) AS valid_from,
        CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata) THEN json_extract(m.metadata, '$.validTo') END AS valid_to,
        EXISTS (
          SELECT 1 FROM memory_relations r
          JOIN memories source ON source.id = r.source_memory_id
          WHERE r.target_memory_id = m.id AND r.relation_type = 'supersedes' AND source.status = 'active'
        ) AS has_superseder
      FROM memories m WHERE m.id = ?
    `).get(memoryId) as { valid_from: string; valid_to: string | null; has_superseder: number } | undefined;
    if (!row) return false;
    if (!includeExpired) {
      if (row.valid_from > asOf) return false;
      if (row.valid_to !== null && row.valid_to <= asOf) return false;
    }
    if (!includeSuperseded && row.has_superseder) return false;
    return true;
  } catch {
    return false;
  }
}

export async function searchHybrid(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const limit = options?.limit ?? 20;
  // Full-text and semantic branches must evaluate the same instant. Resolving
  // "now" once avoids millisecond boundary disagreements around validFrom/To.
  // KM-001：统一记录完整排序过程（query_id 串联同一次检索的多条命中）。
  const effectiveOptions = { ...options, asOf: resolveAsOf(options?.asOf), suppressQueryLog: true };
  const startedAt = Date.now();
  const queryId = uuid();

  const [fulltextResults, semanticResults] = await Promise.all([
    searchFulltext(query, { ...effectiveOptions, limit: limit * 2 }),
    searchSemantic(query, { ...effectiveOptions, limit: limit * 2 }),
  ]);
  // KM-107：实体路由作为第三路参与 RRF 融合（同步执行，SQL 反查开销极低）。
  const entityResults = searchEntityRouted(query, effectiveOptions, limit * 2);

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

  entityResults.forEach((r, idx) => {
    const existing = rrfMap.get(r.memory.id);
    if (!existing) {
      // 复用 semanticRank 槽位参与融合（权重相同），避免新增类型破坏 breakdown 结构。
      rrfMap.set(r.memory.id, { memory: r.memory, semanticRank: idx + 1 });
    }
  });

  // KM-108/D2·M3-Agent：多跳召回——仅当首跳候选稀疏（< minResults）时触发，
  // 用首跳记忆的实体经 relations 表扩展一跳关联实体再反查记忆，最多 3 跳。
  const MIN_RESULTS = 3;
  if (rrfMap.size < MIN_RESULTS) {
    const db = getDatabase();
    for (let hop = 0; hop < 3 && rrfMap.size < MIN_RESULTS; hop++) {
      const seedIds = Array.from(rrfMap.keys());
      if (seedIds.length === 0) break;
      let expandedIds: string[] = [];
      try {
        const placeholders = seedIds.map(() => '?').join(',');
        // 首跳实体的集合：种子记忆的实体 ∪ 经 relations 表一跳可达的关联实体
        const seedEntityRows = db.prepare(`SELECT DISTINCT entity_id as eid FROM memory_entities WHERE memory_id IN (${placeholders})`).all(...seedIds) as { eid: string }[];
        if (seedEntityRows.length === 0) break;
        const relatedEntityIds = new Set(seedEntityRows.map(r => r.eid));
        const eph = Array.from(relatedEntityIds).map(() => '?').join(',');
        const relRows = db.prepare(`SELECT source_id, target_id FROM relations WHERE source_id IN (${eph}) OR target_id IN (${eph})`)
          .all(...relatedEntityIds, ...relatedEntityIds) as { source_id: string; target_id: string }[];
        for (const r of relRows) {
          relatedEntityIds.add(r.source_id);
          relatedEntityIds.add(r.target_id);
        }
        const allEntityIds = Array.from(relatedEntityIds);
        const aph = allEntityIds.map(() => '?').join(',');
        expandedIds = (db.prepare(`
          SELECT DISTINCT m.id
          FROM memory_entities me
          JOIN memories m ON m.id = me.memory_id
          WHERE me.entity_id IN (${aph}) AND m.status = 'active' AND m.id NOT IN (${placeholders})
          ORDER BY m.updated_at DESC
          LIMIT 20
        `).all(...allEntityIds, ...seedIds) as { id: string }[]).map(r => r.id);
      } catch {
        break; // 表结构异常时不阻断主检索
      }
      if (expandedIds.length === 0) break;
      const iph = expandedIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT * FROM memories WHERE id IN (${iph})`).all(...expandedIds) as Record<string, unknown>[];
      const before = rrfMap.size;
      rows.forEach((r, i) => {
        const mem = rowToMemory(r);
        if (rrfMap.has(mem.id)) return;
        // 多跳不得绕过主检索的时态/裁决过滤（否则被 supersede 的旧记忆会从旁路回流）。
        if (!multiHopAllowed(db, mem.id, effectiveOptions.asOf as string, effectiveOptions.includeExpired === true, effectiveOptions.includeSuperseded === true)) return;
        rrfMap.set(mem.id, { memory: mem, semanticRank: 100 + i });
      });
      if (rrfMap.size === before) break; // 本跳无新增，提前终止避免无效循环
    }
  }

  const k = SEARCH_CONFIG.rrfK;
  // KM-106：全文路是否降级为 LIKE 必须在结果与日志中可见。
  const ftsDegraded = fulltextResults.some(r => r.degraded === 'fts_unavailable');
  const degradedReason = ftsDegraded ? 'fts_unavailable' : undefined;

  const fused = Array.from(rrfMap.entries()).map(([id, data]) => {
    const fulltextContribution = data.fulltextRank ? SEARCH_WEIGHTS.fulltext / (k + data.fulltextRank) : 0;
    const semanticContribution = data.semanticRank ? SEARCH_WEIGHTS.semantic / (k + data.semanticRank) : 0;
    // KM-101：乘性质量微调，不再加性叠加。
    const { multiplier, boost } = qualityMultiplier(data.memory);
    const score = (fulltextContribution + semanticContribution) * multiplier;
    return {
      memory: data.memory,
      score,
      matchType: 'hybrid' as const,
      ...(degradedReason ? { degraded: degradedReason } : {}),
      // KM-002：breakdown 无条件产出（写入 query_logs 与 API 返回都依赖它），
      // explain 仅控制是否在响应中展示。等式：finalScore = (ft+sem) × qualityMultiplier。
      scoreBreakdown: {
        fulltextRank: data.fulltextRank,
        semanticRank: data.semanticRank,
        fulltextContribution: Number(fulltextContribution.toFixed(8)),
        semanticContribution: Number(semanticContribution.toFixed(8)),
        hitBoost: Number(boost.hitBoost.toFixed(8)),
        confidenceBoost: Number(boost.confidenceBoost.toFixed(8)),
        durableLayerBoost: Number(boost.durableLayerBoost.toFixed(8)),
        qualityMultiplier: Number(multiplier.toFixed(6)),
        finalScore: Number(score.toFixed(8)),
      },
    };
  });

  fused.sort((a, b) => b.score - a.score);

  const limited = fused.slice(0, limit);
  const latencyMs = Date.now() - startedAt;
  const candidateCount = rrfMap.size;
  const hitIds: string[] = [];
  limited.forEach((r, idx) => {
    recordHit(r.memory.id);
    logQuery(query, r.memory.id, 'hybrid', {
      queryId,
      rank: idx + 1,
      score: r.score,
      latencyMs,
      candidateCount,
      degradedReason,
    });
    hitIds.push(r.memory.id);
  });

  // 异步增强共同命中的记忆间关系（不阻塞返回）
  setImmediate(() => {
    try {
      reinforceCoHitRelations(getDatabase(), hitIds);
    } catch {
      // 已内部捕获，此处额外保护
    }
  });

  // 非 explain 调用不对外暴露 breakdown，但日志中已完整留存。
  if (!options?.explain) {
    return limited.map(({ scoreBreakdown: _omit, ...rest }) => rest as SearchResult);
  }
  return limited;
}

/**
 * 对同一次检索共同命中的记忆对，创建或渐进增强 relates_to 关系。
 * - 已存在的关系：strength 每次 +0.05，上限 1.0（避免无限增长）
 * - 不存在的关系：以较低初始强度 0.2 创建，reason 标注来源
 * - 仅处理前 5 条命中（最多 10 对），避免大结果集产生 O(n²) 写入
 * 任何异常在调用方已捕获，此处保持纯同步、无副作用外抛。
 */
// KM-206/D4：共现计数门槛——同一对记忆共现 ≥ minCoOccurrences(3) 次才落库建边，
// 避免单次搜索噪声直接污染关系图（旧实现 1 次即建边，数月后图谱退化为共现噪声网）。
const CO_HIT_COUNTERS = new Map<string, number>();
const CO_HIT_COUNTER_MAX = 5000;

function reinforceCoHitRelations(db: ReturnType<typeof getDatabase>, hitIds: string[]): void {
  if (hitIds.length < 2) return;
  const ids = hitIds.slice(0, 5);
  const now = new Date().toISOString();
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const pairKey = `${ids[i]}|${ids[j]}`;
      const existing = db.prepare(
        "SELECT id FROM memory_relations WHERE source_memory_id = ? AND target_memory_id = ? AND relation_type = 'relates_to'",
      ).get(ids[i], ids[j]) as { id: string } | undefined;
      if (existing) {
        CO_HIT_COUNTERS.delete(pairKey);
        db.prepare('UPDATE memory_relations SET strength = MIN(1.0, strength + 0.05) WHERE id = ?').run(existing.id);
        continue;
      }
      const count = (CO_HIT_COUNTERS.get(pairKey) ?? 0) + 1;
      if (count < MEMORY_POLICY.coHitRelations.minCoOccurrences) {
        if (CO_HIT_COUNTERS.size >= CO_HIT_COUNTER_MAX) CO_HIT_COUNTERS.clear();
        CO_HIT_COUNTERS.set(pairKey, count);
        continue;
      }
      CO_HIT_COUNTERS.delete(pairKey);
      db.prepare(
        'INSERT INTO memory_relations (id, source_memory_id, target_memory_id, relation_type, strength, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(uuid(), ids[i], ids[j], 'relates_to', 0.2, 'co-hit in search results', now);
    }
  }
}
