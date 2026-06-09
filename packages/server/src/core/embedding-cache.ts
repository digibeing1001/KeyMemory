/**
 * 嵌入向量内存缓存
 *
 * 避免每次语义搜索都从磁盘读取所有向量做余弦计算。
 * LRU 策略，Map 保持插入顺序，淘汰最久未访问的条目。
 *
 * 设计决策：
 * - 缓存 Float32Array 向量，key 为 memory_id
 * - 分块向量 key 为 chunk:{id}
 * - 最大条目数 10000，覆盖绝大多数个人使用场景
 * - 内存占用估算：10000 × 512 × 4B ≈ 20MB（bge-small-zh）
 * - 惰性加载：搜索时填充，不预加载
 * - 写入时失效：记忆更新/删除时清除对应缓存
 */

import { bufferToEmbedding } from '../embed/onnx.js';
import { getDatabase } from '../db/sqlite.js';

interface CacheEntry {
  vector: Float32Array;
  lastAccess: number;
}

const MAX_ENTRIES = 10000;

const cache = new Map<string, CacheEntry>();

function evictIfNeeded(): void {
  while (cache.size >= MAX_ENTRIES) {
    // LRU: 删除最久未访问的条目
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, entry] of cache) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
}

/**
 * 获取记忆的嵌入向量（优先缓存）
 */
export function getCachedEmbedding(memoryId: string): Float32Array | null {
  const entry = cache.get(memoryId);
  if (entry) {
    entry.lastAccess = Date.now();
    return entry.vector;
  }

  // 从磁盘加载
  const db = getDatabase();
  const row = db.prepare('SELECT embedding FROM embeddings WHERE memory_id = ?').get(memoryId) as { embedding: Buffer } | undefined;
  if (!row?.embedding) return null;

  const vector = bufferToEmbedding(row.embedding);
  evictIfNeeded();
  cache.set(memoryId, { vector, lastAccess: Date.now() });
  return vector;
}

/**
 * 获取分块的嵌入向量（优先缓存）
 */
export function getCachedChunkEmbedding(chunkId: string): Float32Array | null {
  const cacheKey = `chunk:${chunkId}`;
  const entry = cache.get(cacheKey);
  if (entry) {
    entry.lastAccess = Date.now();
    return entry.vector;
  }

  const db = getDatabase();
  const row = db.prepare('SELECT embedding FROM memory_chunks WHERE id = ?').get(chunkId) as { embedding: Buffer } | undefined;
  if (!row?.embedding) return null;

  const vector = bufferToEmbedding(row.embedding);
  evictIfNeeded();
  cache.set(cacheKey, { vector, lastAccess: Date.now() });
  return vector;
}

/**
 * 批量加载所有活跃记忆的嵌入向量到缓存
 * 在首次语义搜索时调用，后续搜索直接走缓存
 */
export function warmupEmbeddingCache(): void {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT e.memory_id, e.embedding
    FROM embeddings e
    JOIN memories m ON m.id = e.memory_id
    WHERE m.status = 'active'
  `).all() as { memory_id: string; embedding: Buffer }[];

  for (const row of rows) {
    if (cache.has(row.memory_id)) continue; // 已缓存
    const vector = bufferToEmbedding(row.embedding);
    evictIfNeeded();
    cache.set(row.memory_id, { vector, lastAccess: Date.now() });
  }
}

/**
 * 批量加载所有分块的嵌入向量到缓存
 */
export function warmupChunkEmbeddingCache(): void {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT mc.id, mc.embedding
    FROM memory_chunks mc
    JOIN memories m ON m.id = mc.memory_id
    WHERE m.status = 'active' AND mc.embedding IS NOT NULL
  `).all() as { id: string; embedding: Buffer }[];

  for (const row of rows) {
    const cacheKey = `chunk:${row.id}`;
    if (cache.has(cacheKey)) continue;
    const vector = bufferToEmbedding(row.embedding);
    evictIfNeeded();
    cache.set(cacheKey, { vector, lastAccess: Date.now() });
  }
}

/**
 * 使指定记忆的缓存失效
 * 在记忆更新/删除/重新嵌入时调用
 */
export function invalidateEmbeddingCache(memoryId: string): void {
  cache.delete(memoryId);
  // 同时删除该记忆所有分块的缓存
  const db = getDatabase();
  const chunks = db.prepare('SELECT id FROM memory_chunks WHERE memory_id = ?').all(memoryId) as { id: string }[];
  for (const chunk of chunks) {
    cache.delete(`chunk:${chunk.id}`);
  }
}

/**
 * 清空全部缓存
 */
export function clearEmbeddingCache(): void {
  cache.clear();
}

/**
 * 获取缓存统计信息
 */
export function getEmbeddingCacheStats(): { size: number; maxEntries: number; memoryEstimateMB: number } {
  let totalFloats = 0;
  for (const entry of cache.values()) {
    totalFloats += entry.vector.length;
  }
  return {
    size: cache.size,
    maxEntries: MAX_ENTRIES,
    memoryEstimateMB: Math.round((totalFloats * 4) / (1024 * 1024) * 100) / 100,
  };
}
