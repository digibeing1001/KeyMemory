import type { SearchResult, Layer, MemoryStatus } from '@keymemory/shared';
import { SEARCH_WEIGHTS, SEARCH_CONFIG } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { embed, embeddingToBuffer, bufferToEmbedding, cosineSimilarity, EMBEDDING_DIM, initEmbedding, isEmbeddingAvailable } from '../embed/onnx.js';
import { recordHit } from './atom.js';
import { rowToMemory } from '../db/mapper.js';

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
  db.prepare(`
    INSERT INTO embeddings (memory_id, embedding, model, created_at)
    VALUES (?, ?, 'all-MiniLM-L6-v2', ?)
  `).run(memoryId, embeddingToBuffer(vector), now);
}

export async function searchFulltext(query: string, options?: { layer?: Layer; status?: MemoryStatus; agentSpaces?: string[]; limit?: number }): Promise<SearchResult[]> {
  const db = getDatabase();
  const conditions = ["m.status = 'active'"];
  const params: Record<string, unknown> = { limit: options?.limit ?? 20 };

  if (options?.layer) {
    conditions.push('m.layer = @layer');
    params.layer = options.layer;
  }

  if (options?.agentSpaces && options.agentSpaces.length > 0) {
    conditions.push(`m.agent_space IN (${options.agentSpaces.map((_, i) => `@agentSpace${i}`).join(', ')})`);
    options.agentSpaces.forEach((space, i) => {
      params[`agentSpace${i}`] = space;
    });
  }

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

    return rows.map(r => ({
      memory: rowToMemory(r),
      score: -r.score,
      matchType: 'fulltext' as const,
    }));
  } catch {
    return [];
  }
}

export async function searchSemantic(query: string, options?: { layer?: Layer; status?: MemoryStatus; agentSpaces?: string[]; limit?: number }): Promise<SearchResult[]> {
  if (!isEmbeddingAvailable()) {
    return [];
  }

  const queryVec = await embed(query);
  if (!queryVec) {
    return [];
  }

  const db = getDatabase();
  const conditions = ["status = 'active'"];
  const params: Record<string, unknown> = {};
  if (options?.layer) {
    conditions.push('layer = @layer');
    params.layer = options.layer;
  }

  if (options?.agentSpaces && options.agentSpaces.length > 0) {
    conditions.push(`agent_space IN (${options.agentSpaces.map((_, i) => `@agentSpace${i}`).join(', ')})`);
    options.agentSpaces.forEach((space, i) => {
      params[`agentSpace${i}`] = space;
    });
  }

  const rows = db.prepare(`
    SELECT m.*, e.embedding
    FROM memories m
    LEFT JOIN embeddings e ON e.memory_id = m.id
    WHERE ${conditions.join(' AND ')}
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

  for (const r of scored.slice(0, options?.limit ?? 20)) {
    recordHit(r.memory.id);
  }

  return scored.slice(0, options?.limit ?? 20);
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
    }
  }

  duplicates.sort((a, b) => b.similarity - a.similarity);

  return duplicates.slice(0, limit);
}

export async function searchHybrid(query: string, options?: { layer?: Layer; status?: MemoryStatus; agentSpaces?: string[]; limit?: number }): Promise<SearchResult[]> {
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
    return {
      memory: data.memory,
      score,
      matchType: 'hybrid' as const,
    };
  });

  fused.sort((a, b) => b.score - a.score);

  for (const r of fused.slice(0, limit)) {
    recordHit(r.memory.id);
  }

  return fused.slice(0, limit);
}
