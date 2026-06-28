/**
 * 记忆整理动作检测器（共享模块）
 *
 * 抽取自 consolidation.ts 和 dreaming.ts 的重复逻辑。
 * 两处曾各自维护一份近似实现，导致：
 *  - detectStaleActions 的 last_hit_at IS NULL bug 在 dreaming 修了，consolidation 没修
 *  - detectDuplicateActions 的双重验证只在 dreaming 有，consolidation 用纯 cosine 易误合并
 *
 * 合并后采用 dreaming 的更严谨版本作为单一真相源：
 *  - detectStaleActions：OR last_hit_at IS NULL（从未被命中的记忆也识别为 stale）
 *  - detectDuplicateActions：cosine + 文本相似度双重验证
 *
 * 调用方：
 *  - consolidation.ts planConsolidation：scanLimit=200（快速检测）
 *  - dreaming.ts detectCleanupActions：scanLimit=DREAM_CONFIG.fullScanLimit（深度扫描）
 */

import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { ConsolidationAction } from '@keymemory/shared';
import { CONSOLIDATION_CONFIG } from '@keymemory/shared';
import { cosineSimilarity, bufferToEmbedding } from '../embed/onnx.js';

type Db = Database.Database;

/**
 * 构建 "AND id NOT IN (...)" 排除子句。
 * 避免同一条记忆被多个检测器重复识别。
 */
export function buildExcludeClause(ids: Set<string>): { clause: string; params: string[] } {
  if (ids.size === 0) return { clause: '', params: [] };
  const params = Array.from(ids);
  const clause = `AND id NOT IN (${params.map(() => '?').join(',')})`;
  return { clause, params };
}

/**
 * 检测重复记忆：cosine 语义相似度 + 文本相似度双重验证。
 *
 * 双重验证原因：纯 cosine 可能把"讨论 React 性能"和"讨论 Vue 性能"判为高相似（都是前端性能话题），
 * 但它们是不同记忆不应合并。加上 textSim/titleSim 验证，要求内容或标题也有显著词重叠。
 *
 * 优先级排序：flash > short > long > entity，然后按 created_at DESC。
 * 这样最需紧急清理的 flash 层记忆优先进入扫描窗口。
 *
 * @param scanLimit 候选记忆上限。consolidation 传 200（快速），dreaming 传 fullScanLimit（深度）
 * @param layerFilter 可选层过滤。['flash','short'] 时仅扫描这两层（快速梦境模式）。
 */
export function detectDuplicateActions(
  db: Db,
  affectedIds: Set<string>,
  scanLimit: number = 200,
  layerFilter?: string[],
): ConsolidationAction[] {
  const threshold = CONSOLIDATION_CONFIG.duplicateSimilarity;
  const actions: ConsolidationAction[] = [];

  // 优先级排序：flash(1) > short(2) > long(3) > entity(4)，然后 created_at DESC
  // 让最需紧急清理的 flash 层优先进入有限扫描窗口
  const layerOrder = `CASE m.layer
    WHEN 'flash' THEN 1
    WHEN 'short' THEN 2
    WHEN 'long' THEN 3
    WHEN 'entity' THEN 4
    ELSE 5
  END`;

  const params: unknown[] = [scanLimit];
  let whereClause = `WHERE m.status = 'active'`;
  if (layerFilter && layerFilter.length > 0) {
    const placeholders = layerFilter.map(() => '?').join(',');
    whereClause += ` AND m.layer IN (${placeholders})`;
    params.unshift(...layerFilter);
  }

  let memories: { id: string; title: string; content: string; embedding: Buffer }[];
  try {
    memories = db.prepare(`
      SELECT m.id, m.title, m.content, e.embedding
      FROM memories m
      JOIN embeddings e ON e.memory_id = m.id
      ${whereClause}
      ORDER BY ${layerOrder}, m.created_at DESC
      LIMIT ?
    `).all(...params) as { id: string; title: string; content: string; embedding: Buffer }[];
  } catch {
    return actions;
  }

  if (memories.length < 2) return actions;

  const mergedSet = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    if (mergedSet.has(memories[i].id)) continue;
    for (let j = i + 1; j < memories.length; j++) {
      if (mergedSet.has(memories[j].id)) continue;

      const vecA = bufferToEmbedding(memories[i].embedding);
      const vecB = bufferToEmbedding(memories[j].embedding);
      const sim = cosineSimilarity(vecA, vecB);

      const textSim = computeTextSimilarity(memories[i].content, memories[j].content);
      const titleSim = computeTextSimilarity(memories[i].title, memories[j].title);

      // 语义+文本双重验证，避免误合并
      if (sim > threshold && (textSim > 0.5 || titleSim > 0.7)) {
        const keeper = memories[i].id;
        const removed = memories[j].id;

        if (!affectedIds.has(keeper) && !affectedIds.has(removed)) {
          actions.push({
            id: uuid(),
            type: 'deduplicate',
            sourceIds: [keeper, removed],
            targetId: keeper,
            description: `「${memories[i].title}」与「${memories[j].title}」语义相似度${sim.toFixed(2)}，保留前者`,
            status: 'pending',
          });
          affectedIds.add(removed);
          mergedSet.add(removed);
        }
      }
    }
  }

  return actions;
}

/**
 * 检测 stale 记忆：decay_factor < 0.3 且长期未访问。
 *
 * 关键修复（原 consolidation.ts bug）：
 * 原要求 last_hit_at IS NOT NULL，导致从未被命中的孤儿记忆（last_hit_at IS NULL）
 * 永远绕过 stale 检测。改为 OR last_hit_at IS NULL，让从未被命中的内容也能被归档。
 *
 * 语义：从未被命中的记忆比"被命中过但很久没命中"的更 stale，理应优先归档。
 */
export function detectStaleActions(db: Db, affectedIds: Set<string>, layerFilter?: string[]): ConsolidationAction[] {
  const staleDays = CONSOLIDATION_CONFIG.staleDays;
  const actions: ConsolidationAction[] = [];
  const exclude = buildExcludeClause(affectedIds);

  // 默认检测 short+long 层的 stale 记忆；quickMode 下 layerFilter=['short'] 跳过 long 层
  const layerClause = layerFilter && layerFilter.length > 0
    ? `AND layer IN (${layerFilter.map(() => '?').join(',')})`
    : "AND layer IN ('short', 'long')";
  const layerParams = layerFilter && layerFilter.length > 0 ? layerFilter : [];

  const stale = db.prepare(`
    SELECT id, title, layer FROM memories
    WHERE status = 'active'
      ${layerClause}
      AND decay_factor < 0.3
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', ? || ' days'))
      ${exclude.clause}
  `).all(...layerParams, `-${staleDays}`, ...exclude.params) as { id: string; title: string; layer: string }[];

  for (const m of stale) {
    if (!affectedIds.has(m.id)) {
      actions.push({
        id: uuid(),
        type: 'archive_stale',
        sourceIds: [m.id],
        description: `「${m.title}」(${m.layer}层)已${staleDays}天未访问且衰变因子<0.3，归档`,
        status: 'pending',
      });
      affectedIds.add(m.id);
    }
  }

  return actions;
}

/**
 * 检测过期闪念：flash 层创建超过 flashMaxDays 的记忆。
 */
export function detectOldFlashActions(db: Db, affectedIds: Set<string>): ConsolidationAction[] {
  const maxDays = CONSOLIDATION_CONFIG.flashMaxDays;
  const actions: ConsolidationAction[] = [];
  const exclude = buildExcludeClause(affectedIds);

  const oldFlash = db.prepare(`
    SELECT id, title FROM memories
    WHERE status = 'active'
      AND layer = 'flash'
      AND created_at <= datetime('now', ? || ' days')
      ${exclude.clause}
  `).all(`-${maxDays}`, ...exclude.params) as { id: string; title: string }[];

  for (const m of oldFlash) {
    if (!affectedIds.has(m.id)) {
      actions.push({
        id: uuid(),
        type: 'archive_flash',
        sourceIds: [m.id],
        description: `闪念「${m.title}」已超过${maxDays}天，归档`,
        status: 'pending',
      });
      affectedIds.add(m.id);
    }
  }

  return actions;
}

/**
 * 检测可固化记忆：short 层命中次数达 solidifyMinHits，建议升级到 long 层。
 *
 * 仅 consolidation 调用；dreaming 不调用（dreaming 侧重清理而非固化）。
 * 放在共享模块是为了未来 dreaming 也可能需要，且保持检测器集中维护。
 */
export function detectSolidifyActions(db: Db, affectedIds: Set<string>): ConsolidationAction[] {
  const minHits = CONSOLIDATION_CONFIG.solidifyMinHits;
  const actions: ConsolidationAction[] = [];
  const exclude = buildExcludeClause(affectedIds);

  const candidates = db.prepare(`
    SELECT id, title, hit_count FROM memories
    WHERE status = 'active'
      AND layer = 'short'
      AND hit_count >= ?
      ${exclude.clause}
  `).all(minHits, ...exclude.params) as { id: string; title: string; hit_count: number }[];

  for (const m of candidates) {
    if (!affectedIds.has(m.id)) {
      actions.push({
        id: uuid(),
        type: 'solidify',
        sourceIds: [m.id],
        targetId: m.id,
        description: `短期记忆「${m.title}」已被命中${m.hit_count}次，建议固化为长期记忆`,
        status: 'pending',
      });
      affectedIds.add(m.id);
    }
  }

  return actions;
}

/**
 * 计算两段文本的 Jaccard 相似度（token 交集 / 并集）。
 *
 * 用于 detectDuplicateActions 的双重验证，也在 dreaming 的语义合并阶段使用。
 * 支持 CJK + 英文混合文本：
 *  - CJK 占比 > 30%：按字符分词 + 保留长度≥2的英文/数字词
 *  - 否则：按空白分词
 */
export function computeTextSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 1.0;
  return intersection.size / union.size;
}

/**
 * 文本分词（中英文混合）。
 *
 * CJK 文本按字符切分（中文没有空格），同时保留连续的英文/数字词（长度≥2）。
 * 英文文本按空白切分。
 *
 * 设计决策：
 * - CJK 按字符：避免依赖分词库，对短文本（标题）效果尚可
 * - 英文词长度≥2：过滤 "a"/"I" 等无意义单字符
 * - 阈值 30%：文本中 30% 以上是 CJK 就走 CJK 模式
 */
function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return new Set();

  // 检测是否以中文字符为主
  const cjkCount = (normalized.match(/[一-鿿]/g) || []).length;
  const totalCount = normalized.length;

  if (cjkCount / totalCount > 0.3) {
    // 中文/CJK 文本：按字符分词，同时保留长度>=2的连续英文/数字词
    const tokens = new Set<string>();
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      if (/[一-鿿]/.test(ch)) {
        tokens.add(ch);
      }
    }
    const words = normalized.match(/[a-z0-9]{2,}/g);
    if (words) {
      for (const w of words) tokens.add(w);
    }
    return tokens;
  }

  // 英文/西文文本：按空白分词
  return new Set(normalized.split(/\s+/).filter(Boolean));
}
