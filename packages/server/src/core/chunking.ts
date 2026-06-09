/**
 * 长记忆分块模块
 *
 * 将超长记忆内容按段落切分为多个 chunk，每个 chunk 独立生成嵌入向量。
 * 搜索时命中 chunk 可精确定位到原记忆的具体段落。
 *
 * 设计决策：
 * - 分块阈值 500 字符（中文约 250 字），低于此不分块
 * - 优先按段落（双换行）切分，保持语义完整性
 * - 短段落合并到目标大小，长段落按句子切分
 * - 每个chunk保留上下文重叠（overlap），避免跨块语义断裂
 */

import { v4 as uuid } from 'uuid';
import { getDatabase } from '../db/sqlite.js';
import { embed, embeddingToBuffer, getCurrentModelInfo, isEmbeddingAvailable } from '../embed/onnx.js';
import { invalidateEmbeddingCache } from './embedding-cache.js';

/** 分块配置 */
const CHUNK_CONFIG = {
  /** 内容超过此长度才分块 */
  minContentLength: 500,
  /** 目标块大小（字符数） */
  targetChunkSize: 400,
  /** 块间重叠字符数，避免语义断裂 */
  overlapChars: 60,
  /** 单个记忆最多分多少块，防止异常膨胀 */
  maxChunksPerMemory: 20,
} as const;

/**
 * 异步触发分块嵌入
 * 不阻塞同步的 createMemory/updateMemory 主流程
 * 使用 setImmediate 在下一个事件循环中执行
 */
export function scheduleChunkAndEmbed(memoryId: string, title: string, content: string): void {
  setImmediate(() => {
    chunkAndEmbed(memoryId, title, content).catch(err => {
      console.error(`[Chunking] Failed for memory ${memoryId}:`, (err as Error).message);
    });
  });
}

/**
 * 将内容切分为块
 * 策略：按段落切 → 合并短段 → 切分长段 → 添加重叠
 */
export function splitContent(content: string): string[] {
  if (content.length < CHUNK_CONFIG.minContentLength) {
    return []; // 不需要分块
  }

  // 1. 按段落切分
  const paragraphs = content
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // 只有一个段落且不太长，不分块
  if (paragraphs.length <= 1 && content.length < CHUNK_CONFIG.minContentLength * 1.5) {
    return [];
  }

  // 2. 合并短段落到目标大小
  const merged: string[] = [];
  let buffer = '';

  for (const para of paragraphs) {
    if (buffer.length + para.length + 2 > CHUNK_CONFIG.targetChunkSize && buffer.length > 0) {
      merged.push(buffer.trim());
      buffer = para;
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para;
    }
  }
  if (buffer.trim()) {
    merged.push(buffer.trim());
  }

  // 3. 切分超长段落（按句子边界）
  const chunks: string[] = [];
  for (const block of merged) {
    if (block.length <= CHUNK_CONFIG.targetChunkSize * 1.5) {
      chunks.push(block);
      continue;
    }

    // 按句子切分（中英文句号、问号、感叹号、换行）
    const sentences = block.split(/(?<=[。！？.!?\n])/g).filter(s => s.trim().length > 0);
    let subBuffer = '';

    for (const sentence of sentences) {
      if (subBuffer.length + sentence.length > CHUNK_CONFIG.targetChunkSize && subBuffer.length > 0) {
        chunks.push(subBuffer.trim());
        subBuffer = sentence;
      } else {
        subBuffer += sentence;
      }
    }
    if (subBuffer.trim()) {
      chunks.push(subBuffer.trim());
    }
  }

  // 4. 添加重叠：每个块前面加上前一块的尾部
  const overlapped: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];
    if (i > 0 && CHUNK_CONFIG.overlapChars > 0) {
      const prevTail = chunks[i - 1].slice(-CHUNK_CONFIG.overlapChars);
      // 找到最近的句子边界开始
      const boundary = prevTail.search(/[。！？.!?\n]/);
      const overlap = boundary >= 0 ? prevTail.slice(boundary + 1).trim() : prevTail;
      if (overlap.length > 10) {
        chunk = `...${overlap}\n${chunk}`;
      }
    }
    overlapped.push(chunk);
  }

  // 5. 限制最大块数
  return overlapped.slice(0, CHUNK_CONFIG.maxChunksPerMemory);
}

/**
 * 为记忆创建分块并生成嵌入
 * 在记忆创建/更新后调用
 */
export async function chunkAndEmbed(memoryId: string, title: string, content: string): Promise<void> {
  const chunks = splitContent(content);
  if (chunks.length === 0) return; // 内容不够长，不需要分块

  if (!isEmbeddingAvailable()) return;

  const db = getDatabase();
  const now = new Date().toISOString();
  const modelInfo = getCurrentModelInfo();
  const model = modelInfo.id ?? 'unknown';

  // 删除旧分块
  db.prepare('DELETE FROM memory_chunks WHERE memory_id = ?').run(memoryId);

  const insertStmt = db.prepare(`
    INSERT INTO memory_chunks (id, memory_id, chunk_index, content, embedding, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const chunkId = uuid();

    // 生成嵌入：标题 + 块内容，让搜索更精准
    const embedText = `${title} ${chunkContent}`;
    let embeddingBuf: Buffer | null = null;

    try {
      const vector = await embed(embedText);
      if (vector) {
        embeddingBuf = embeddingToBuffer(vector);
      }
    } catch (err) {
      console.error(`[Chunking] Embedding failed for chunk ${i} of memory ${memoryId}:`, (err as Error).message);
    }

    insertStmt.run(chunkId, memoryId, i, chunkContent, embeddingBuf, model, now, now);
  }

  // 使缓存失效
  invalidateEmbeddingCache(memoryId);
}

/**
 * 删除记忆的所有分块
 * 在记忆删除时调用
 */
export function deleteChunks(memoryId: string): void {
  const db = getDatabase();
  db.prepare('DELETE FROM memory_chunks WHERE memory_id = ?').run(memoryId);
  invalidateEmbeddingCache(memoryId);
}

/**
 * 获取记忆的所有分块
 */
export function getChunks(memoryId: string): { id: string; chunkIndex: number; content: string; embedding: Buffer | null }[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT id, chunk_index as chunkIndex, content, embedding
    FROM memory_chunks
    WHERE memory_id = ?
    ORDER BY chunk_index
  `).all(memoryId) as { id: string; chunkIndex: number; content: string; embedding: Buffer | null }[];
}
