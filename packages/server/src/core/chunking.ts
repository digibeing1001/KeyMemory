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
import { getDatabase, isDatabaseInitialized } from '../db/sqlite.js';
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

function isClosedDatabaseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Database not initialized') || message.includes('database is not open');
}

/**
 * 异步触发分块嵌入
 * 不阻塞同步的 createMemory/updateMemory 主流程
 * 使用 setImmediate 在下一个事件循环中执行
 *
 * @param tags 记忆标签，作为全局前缀注入每个 chunk 的嵌入文本
 * @param metadata 记忆元数据，其字符串/数组值作为全局前缀
 */
export function scheduleChunkAndEmbed(
  memoryId: string,
  title: string,
  content: string,
  tags?: string[],
  metadata?: Record<string, unknown>,
): void {
  setImmediate(() => {
    if (!isDatabaseInitialized()) return;
    chunkAndEmbed(memoryId, title, content, tags, metadata).catch(err => {
      if (isClosedDatabaseError(err)) return;
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
 *
 * 全局前缀设计：
 * chunk 嵌入文本 = [全局前缀] + title + chunkContent
 * 全局前缀 = tags + metadata 字符串值，与 ensureEmbedding 保持一致。
 *
 * 原问题：chunk 嵌入只用 `title + chunkContent`，缺少 tags/metadata 上下文。
 * 而 memory 级嵌入（ensureEmbedding）包含 tags + metadata。
 * 这导致 chunk 和 memory 嵌入不对称——chunk 检索时丢失分类上下文。
 * 例如：记忆标签 `kind:preference` 的 chunk 搜索 "用户偏好" 时本应高分，
 * 但因 chunk 嵌入无 tag 信号而漏命中。
 *
 * 修复后每个 chunk 都继承记忆的全局分类上下文，检索一致性提升。
 */
export async function chunkAndEmbed(
  memoryId: string,
  title: string,
  content: string,
  tags?: string[],
  metadata?: Record<string, unknown>,
): Promise<void> {
  const chunks = splitContent(content);
  if (chunks.length === 0) return; // 内容不够长，不需要分块

  if (!isEmbeddingAvailable()) return;

  const db = getDatabase();
  const now = new Date().toISOString();
  const modelInfo = getCurrentModelInfo();
  const model = modelInfo.id ?? 'unknown';

  // 构建全局前缀（与 ensureEmbedding 的嵌入文本构造逻辑保持一致）
  let globalPrefix = '';
  if (tags && tags.length > 0) globalPrefix += ` ${tags.join(' ')}`;
  if (metadata) {
    const metaValues = Object.values(metadata).filter(v => typeof v === 'string' || Array.isArray(v));
    if (metaValues.length > 0) globalPrefix += ` ${metaValues.flat().join(' ')}`;
  }
  globalPrefix = globalPrefix.trim();

  // 删除旧分块
  db.prepare('DELETE FROM memory_chunks WHERE memory_id = ?').run(memoryId);

  const insertStmt = db.prepare(`
    INSERT INTO memory_chunks (id, memory_id, chunk_index, content, embedding, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (let i = 0; i < chunks.length; i++) {
    const chunkContent = chunks[i];
    const chunkId = uuid();

    // 生成嵌入：全局前缀 + 标题 + 块内容
    const embedText = globalPrefix ? `${globalPrefix} ${title} ${chunkContent}` : `${title} ${chunkContent}`;
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
