import { v4 as uuid } from 'uuid';
import type { SearchResult, Layer, MemoryStatus } from '@keymemory/shared';
import { SEARCH_WEIGHTS, SEARCH_CONFIG } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { embed, embeddingToBuffer, bufferToEmbedding, cosineSimilarity, getEmbeddingDim, getCurrentModelInfo, isEmbeddingAvailable } from '../embed/onnx.js';
import { recordHit } from './atom.js';
import { rowToMemory } from '../db/mapper.js';

type SearchOptions = {
  layer?: Layer;
  status?: MemoryStatus;
  agentSpaces?: string[];
  projectId?: string;
  includeDescendants?: boolean;
  includeSuperseded?: boolean;
  memoryKind?: string;
  limit?: number;
};

function logQuery(query: string, memoryId: string, matchType: string): void {
  try {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO query_logs (id, query, memory_id, match_type, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(uuid(), query.trim().slice(0, 200), memoryId, matchType, now);
  } catch {
    // 查询日志失败不应影响搜索功能
  }
}

function addSearchFilters(conditions: string[], params: Record<string, unknown>, options?: SearchOptions): void {
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

  if (options?.memoryKind) {
    conditions.push("(m.tags LIKE @memoryKindTag OR m.metadata LIKE @memoryKindMeta)");
    params.memoryKindTag = `%kind:${options.memoryKind}%`;
    params.memoryKindMeta = `%"memoryKind":"${options.memoryKind}"%`;
  }

  const activeSearch = (options?.status ?? 'active') === 'active';
  if (activeSearch && options?.includeSuperseded !== true) {
    conditions.push(`NOT EXISTS (
      SELECT 1
      FROM memory_relations r
      JOIN memories source ON source.id = r.source_memory_id
      WHERE r.target_memory_id = m.id
        AND r.relation_type = 'supersedes'
        AND source.status = 'active'
    )`);
  }

  if (options?.agentSpaces && options.agentSpaces.length > 0) {
    conditions.push(`m.agent_space IN (${options.agentSpaces.map((_, i) => `@agentSpace${i}`).join(', ')})`);
    options.agentSpaces.forEach((space, i) => {
      params[`agentSpace${i}`] = space;
    });
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
}

export async function searchFulltext(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const db = getDatabase();
  const conditions = [options?.status ? 'm.status = @status' : "m.status = 'active'"];
  const params: Record<string, unknown> = { limit: options?.limit ?? 20 };
  if (options?.status) params.status = options.status;

  addSearchFilters(conditions, params, options);

  let matchQuery = query;
  const hasWildcard = query.includes('*') || query.includes('?');
  
  if (hasWildcard) {
    matchQuery = query
      .replace(/([^\\])\*/g, '$1*')
      .replace(/([^\\])\?/g, '$1?')
      .replace(/\\\*/g, '*')
      .replace(/\\\?/g, '?');
  } else {
    matchQuery = `"${query}" OR ${query}*`;
  }
  
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
    return searchLikeFallback(query, conditions, params);
  } catch {
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

  const db = getDatabase();
  const conditions = [options?.status ? 'm.status = @status' : "m.status = 'active'"];
  const params: Record<string, unknown> = {};
  if (options?.status) params.status = options.status;
  addSearchFilters(conditions, params, options);

  const rows = db.prepare(`
    SELECT m.*, e.embedding
    FROM memories m
    LEFT JOIN embeddings e ON e.memory_id = m.id
    WHERE ${conditions.join(' AND ')}
    LIMIT 500
  `).all(params) as (Record<string, unknown> & { embedding: Buffer | undefined })[];

  const scored = rows.map(r => {
    if (!r.embedding) {
      return {
        memory: rowToMemory(r),
        score: 0,
        matchType: 'semantic' as const,
      };
    }
    const memVec = bufferToEmbedding(r.embedding);
    const sim = cosineSimilarity(queryVec, memVec);
    return {
      memory: rowToMemory(r),
      score: sim,
      matchType: 'semantic' as const,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const limited = scored.slice(0, options?.limit ?? 20);
  // Do not recordHit here; searchHybrid handles it once for fused results.

  return limited;
}

export async function findDuplicateMemories(threshold: number = 0.9, limit: number = 20): Promise<{ memoryId1: string; memoryId2: string; similarity: number }[]> {
  if (!isEmbeddingAvailable()) {
    return [];
  }

  const db = getDatabase();
  const rows = db.prepare(`
    SELECT e1.memory_id as id1, e2.memory_id as id2, e1.embedding as emb1, e2.embedding as emb2
    FROM embeddings e1
    JOIN embeddings e2 ON e1.memory_id < e2.memory_id
    WHERE e1.memory_id != e2.memory_id
    LIMIT 5000
  `).all() as { id1: string; id2: string; emb1: Buffer; emb2: Buffer }[];

  const duplicates: { memoryId1: string; memoryId2: string; similarity: number }[] = [];

  for (const row of rows) {
    const vec1 = bufferToEmbedding(row.emb1);
    const vec2 = bufferToEmbedding(row.emb2);
    const sim = cosineSimilarity(vec1, vec2);

    if (sim >= threshold) {
      duplicates.push({
        memoryId1: row.id1,
        memoryId2: row.id2,
        similarity: sim,
      });
      if (duplicates.length >= limit) break;
    }
  }

  duplicates.sort((a, b) => b.similarity - a.similarity);

  return duplicates;
}

function productionRankBoost(memory: SearchResult['memory']): number {
  const hitBoost = Math.min(0.006, Math.log1p(memory.hitCount) * 0.0015);
  const confidenceBoost = Math.max(0, Math.min(memory.confidence, 1)) * 0.003;
  const longBoost = memory.layer === 'long' || memory.layer === 'entity' ? 0.002 : 0;
  return hitBoost + confidenceBoost + longBoost;
}

export async function searchHybrid(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  const limit = options?.limit ?? 20;

  const [fulltextResults, semanticResults] = await Promise.all([
    searchFulltext(query, { ...options, limit: limit * 2 }),
    searchSemantic(query, { ...options, limit: limit * 2 }),
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
    let score = 0;
    if (data.fulltextRank) score += SEARCH_WEIGHTS.fulltext / (k + data.fulltextRank);
    if (data.semanticRank) score += SEARCH_WEIGHTS.semantic / (k + data.semanticRank);
    score += productionRankBoost(data.memory);
    return {
      memory: data.memory,
      score,
      matchType: 'hybrid' as const,
    };
  });

  fused.sort((a, b) => b.score - a.score);

  const limited = fused.slice(0, limit);
  for (const r of limited) {
    recordHit(r.memory.id);
    logQuery(query, r.memory.id, 'hybrid');
  }

  return limited;
}
