/**
 * LLM 关联推理器（Relation Reasoner）
 *
 * 设计原则：
 * - 在自动整理时进行关联推理，识别记忆间的补强、延伸、反转、桥接关系
 * - 被整理过的记忆相互之间要有双向关联来标注它们的关系
 * - 批量大小按未扫描存量处理，通过新记忆查找老记忆时不过分控制 token 成本
 * - 关联推理要有确认性，尽可能少自主发挥，但可以从中发现新的洞见
 *
 * 四问范式：
 * - extends 延伸：A 是 B 的自然下一步/具体化
 * - reverses 反转：A 推翻/否定 B
 * - reinforces 补强：A 强化/佐证 B
 * - bridges 桥接：A 连接了两个本不相关的旧记忆
 *
 * 流程：
 * 1. 找出所有"未扫描存量"（llm_reasoning_log 表无记录的活跃记忆）
 * 2. 对每条锚记忆：
 *    a. ONNX 语义相似度 top-K 预筛候选（K=25，不过分控制 token）
 *    b. 调 LLM 做四问判定，强制 JSON 输出
 *    c. 对判定为 extends/reverses/reinforces/bridges 的，建立双向关系
 *    d. 记录到 llm_reasoning_log（无论是否建立关系，都标记已扫描）
 */

import { v4 as uuid } from 'uuid';
import Database from 'better-sqlite3';
import { RELATION_REASONER_CONFIG } from '@keymemory/shared';
import type { LLMRelationJudgment, LLMRelationReasoningResult, LLMChatResponse } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity } from '../embed/onnx.js';
import { getCachedEmbedding } from './embedding-cache.js';
import { isEmbeddingAvailable } from '../embed/onnx.js';
import { createMemoryRelation } from '../graph/entity.js';
import { isLLMAvailable, chatWithLLM } from './llm-provider.js';

/** 扫描结果汇总 */
export interface RelationReasonerReport {
  /** 本次扫描的锚记忆数 */
  scanned: number;
  /** 实际建立的演化关系数（反向索引不重复计数） */
  relationsCreated: number;
  /** 每条锚记忆的扫描明细 */
  details: { memoryId: string; title: string; relationsCreated: number; latencyMs: number }[];
  /** 跳过原因（LLM 未配置 / 无候选 / 调用失败） */
  skipped: string[];
  /** 总耗时 ms */
  durationMs: number;
}

/**
 * 初始化 llm_reasoning_log 表（幂等）。
 *
 * 字段：
 * - memory_id: 被扫描的锚记忆 ID
 * - scan_type: 'relation_reasoning'（预留扩展）
 * - relations_created: 本次扫描建立的关系数
 * - llm_model: 使用的 LLM 模型
 * - latency_ms: 单条扫描耗时
 * - created_at: 扫描时间
 *
 * 唯一约束：(memory_id, scan_type) → 同一条记忆只扫描一次（除非显式重置）
 */
export function initRelationReasoningLog(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_reasoning_log (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      scan_type TEXT NOT NULL DEFAULT 'relation_reasoning',
      relations_created INTEGER NOT NULL DEFAULT 0,
      llm_model TEXT,
      latency_ms INTEGER,
      created_at TEXT NOT NULL,
      UNIQUE(memory_id, scan_type)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_llm_reasoning_log_memory ON llm_reasoning_log(memory_id)`);
}

/**
 * 找出所有未做过 LLM 关联推理的活跃记忆。
 *
 * "存量"语义：memories.status='active' 且不在 llm_reasoning_log 中。
 * 按 last_hit_at DESC 优先扫描近期命中的（更可能与新记忆产生关系）。
 *
 * @param limit 最多返回多少条（RELATION_REASONER_CONFIG.batchSize）
 */
export function findUnscannedMemories(limit: number = RELATION_REASONER_CONFIG.batchSize): { id: string; title: string; content: string; projectId: string; createdAt: string }[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT m.id, m.title, m.content, m.project_id, m.created_at
    FROM memories m
    LEFT JOIN llm_reasoning_log l
      ON l.memory_id = m.id AND l.scan_type = 'relation_reasoning'
    WHERE m.status = 'active'
      AND l.id IS NULL
    ORDER BY m.last_hit_at DESC NULLS LAST, m.created_at DESC
    LIMIT ?
  `).all(limit) as { id: string; title: string; content: string; projectId: string; createdAt: string }[];
}

/**
 * ONNX 语义相似度 top-K 预筛候选。
 *
 * 对锚记忆做 cosine 相似度排序，取 top-K（默认 25）。
 * 阈值 0.55（比 autoAssociate 的 0.75 低，保证召回，让 LLM 做精细判定）。
 *
 * @returns 候选记忆列表（含 ID/title/content/similarity）
 */
type RelationCandidate = { id: string; title: string; content: string; similarity: number };
type RelationAnchor = { id: string; title: string; content: string; status: string; agentSpace: string; createdAt: string };

function candidateRows(anchor: RelationAnchor): Array<{ id: string; title: string; content: string }> {
  const db = getDatabase();
  return db.prepare(`
    SELECT m.id, m.title, m.content
    FROM memories m
    WHERE m.status = 'active' AND m.id != ?
      AND m.agent_space = ?
      AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < (SELECT rowid FROM memories WHERE id = ?)))
    ORDER BY m.last_hit_at DESC NULLS LAST, m.updated_at DESC
    LIMIT 500
  `).all(anchor.id, anchor.agentSpace, anchor.createdAt, anchor.createdAt, anchor.id) as Array<{ id: string; title: string; content: string }>;
}

function findTopKCandidates(anchor: RelationAnchor, anchorVec: Float32Array): RelationCandidate[] {
  const candidates = candidateRows(anchor);

  const scored: { id: string; title: string; content: string; similarity: number }[] = [];
  for (const cand of candidates) {
    const vec = getCachedEmbedding(cand.id);
    if (!vec) continue;
    const sim = cosineSimilarity(anchorVec, vec);
    if (sim >= RELATION_REASONER_CONFIG.prefilterThreshold) {
      scored.push({ ...cand, similarity: sim });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, RELATION_REASONER_CONFIG.topK);
}

const LEXICAL_STOPWORDS = new Set(['记忆', '内容', '系统', '功能', '这个', '一个', '已经', '需要', '进行', '相关', '可以', '目前', '工作', '项目', '任务', '今天', 'the', 'and', 'for', 'with', 'this', 'that']);

function lexicalTokens(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase();
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z][a-z0-9._-]{2,}|\d{3,}/g) ?? []) {
    if (!LEXICAL_STOPWORDS.has(word)) tokens.add(word);
  }
  for (const chunk of normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    if (!LEXICAL_STOPWORDS.has(chunk) && chunk.length <= 8) tokens.add(chunk);
    for (let index = 0; index < chunk.length - 1; index++) {
      const pair = chunk.slice(index, index + 2);
      if (!LEXICAL_STOPWORDS.has(pair)) tokens.add(pair);
    }
  }
  return tokens;
}

function overlapScore(anchor: RelationAnchor, candidate: { title: string; content: string }): number {
  const anchorTitle = lexicalTokens(anchor.title);
  const candidateTitle = lexicalTokens(candidate.title);
  const anchorAll = lexicalTokens(`${anchor.title} ${anchor.content}`);
  const candidateAll = lexicalTokens(`${candidate.title} ${candidate.content}`);
  const intersect = (left: Set<string>, right: Set<string>) => [...left].filter(item => right.has(item)).length;
  const titleMatches = intersect(anchorTitle, candidateTitle);
  const allMatches = intersect(anchorAll, candidateAll);
  if (allMatches < 2 && titleMatches === 0) return 0;
  return Math.min(0.99, (titleMatches * 3 + allMatches) / Math.max(8, Math.min(anchorAll.size, candidateAll.size)));
}

/** Embedding 不可用时的保守候选回退；LLM 仍负责最终确认。 */
function findLexicalCandidates(anchor: RelationAnchor): RelationCandidate[] {
  return candidateRows(anchor)
    .map(candidate => ({ ...candidate, similarity: overlapScore(anchor, candidate) }))
    .filter(candidate => candidate.similarity >= 0.18)
    .sort((left, right) => right.similarity - left.similarity)
    .slice(0, Math.min(RELATION_REASONER_CONFIG.topK, 12));
}

/**
 * 构造四问深度扫描的 LLM 提示词。
 *
 * 设计原则：
 * - "有确认性" → 必须基于原文证据
 * - "尽可能少自主发挥" → relation 必须是 5 枚举值之一，evidence_quote 必须摘自原文
 * - "可以从中发现新的洞见" → reason 字段允许 LLM 解释推理逻辑（洞见）
 *
 * @param anchor 锚记忆
 * @param candidates 候选旧记忆列表
 * @returns 系统提示词 + 用户消息
 */
function buildReasoningPrompt(
  anchor: { id: string; title: string; content: string },
  candidates: { id: string; title: string; content: string; similarity: number }[]
): { systemPrompt: string; userMessage: string } {
  const systemPrompt = `你是一个记忆关联推理专家。你的任务是**确认**一条新记忆与若干条旧记忆之间是否存在演化关系，而不是**创造**关系。如果没有充分证据，必须选 none。

## 核心原则：确认性优先

- 你的角色是基于原文证据**确认**关系，不是**推测**或**创造**关系
- 宁可漏掉弱关系选 none，也不要强行关联
- 所有判断必须有原文证据支撑，不得引入外部知识或常识

## 四种演化关系（来自 starcluster-indexer 范式）

1. **extends 延伸**：新记忆是旧记忆的自然下一步、具体化或后续进展。
   - 旧："打算用 React 做前端" → 新："React 前端已完成，用了 TypeScript"
   - 判定要点：旧是计划/意图/早期状态，新是执行/结果/后续状态

2. **reverses 反转**：新记忆推翻、否定或逆转了旧记忆。
   - 旧："决定用方案 A" → 新："方案 A 失败，改用方案 B"
   - 判定要点：旧与新在结论/方向上冲突，新明确否定旧

3. **reinforces 补强**：新记忆强化、佐证或补充了旧记忆的证据。
   - 旧："发现用户喜欢圆角设计" → 新："A/B 测试圆角点击率 +15%"
   - 判定要点：旧是假设/观察，新提供佐证/数据/案例支持

4. **bridges 桥接**：新记忆连接了两个本不相关的旧记忆，揭示隐藏关联。
   - 旧 A 谈技术选型，旧 B 谈用户调研 → 新："用户调研显示的需求恰好验证了技术选型"
   - 判定要点：新使两个看似无关的旧记忆产生联系

5. **none 无关系**：以上四种都不成立。

## 硬约束（必须遵守）

1. relation 必须从 [extends, reverses, reinforces, bridges, none] 中选择，不得自创
2. evidence_quote 必须是从旧记忆原文摘录的连续片段，**不得改写、不得编造、不得拼接**
3. 没有关系就选 none，**不得强行关联**
4. strength 低于 0.5 的关系，请选 none
5. 只能基于输入的记忆内容判断，**不得引入外部知识或常识推测**
6. reason 字段允许你解释推理逻辑，可以包含洞见，但必须基于 evidence_quote

## 输出格式（严格 JSON）

\`\`\`json
{
  "judgments": [
    {
      "target_id": "候选记忆ID",
      "relation": "extends|reverses|reinforces|bridges|none",
      "strength": 0.0,
      "reason": "一句话说明为什么是这个关系（允许洞见）",
      "evidence_quote": "从旧记忆原文摘的片段"
    }
  ]
}
\`\`\`

只输出 JSON，不要输出任何其他内容。`;

  const candidatesText = candidates.map((c, i) => {
    // 用户明确要求"不需要过分控制 token 的成本"，放宽到 800 字符保留完整上下文
    const truncatedContent = c.content.length > 800 ? c.content.slice(0, 800) + '...' : c.content;
    return `### 候选 ${i + 1}
- ID: ${c.id}
- 标题: ${c.title}
- 候选相关度: ${c.similarity.toFixed(2)}
- 内容: ${truncatedContent}`;
  }).join('\n\n');

  const anchorContent = anchor.content.length > 1500 ? anchor.content.slice(0, 1500) + '...' : anchor.content;

  const userMessage = `## 新记忆（锚）

- ID: ${anchor.id}
- 标题: ${anchor.title}
- 内容: ${anchorContent}

## 候选旧记忆

${candidatesText}

## 任务

对每条候选旧记忆，判断它与新记忆（锚）的演化关系。输出严格 JSON。`;

  return { systemPrompt, userMessage };
}

/**
 * 解析 LLM 输出的 JSON（容错处理）。
 *
 * LLM 可能输出带 ```json 包裹或多余文本，需要提取纯 JSON。
 */
function parseJudgments(rawContent: string): LLMRelationJudgment[] {
  // 尝试直接 parse
  let text = rawContent.trim();

  // 去除 ```json ... ``` 包裹
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // 提取第一个 { 到最后一个 } 之间的内容
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  try {
    const parsed = JSON.parse(text) as { judgments?: unknown };
    if (!Array.isArray(parsed.judgments)) return [];

    return parsed.judgments.filter((j): j is LLMRelationJudgment => {
      if (!j || typeof j !== 'object') return false;
      const obj = j as Record<string, unknown>;
      return typeof obj.target_id === 'string'
        && typeof obj.relation === 'string'
        && ['extends', 'reverses', 'reinforces', 'bridges', 'none'].includes(obj.relation as string)
        && typeof obj.strength === 'number'
        && typeof obj.reason === 'string'
        && typeof obj.evidence_quote === 'string';
    });
  } catch {
    return [];
  }
}

/**
 * 对单条锚记忆执行四问深度扫描。
 *
 * @param anchorId 锚记忆 ID
 * @returns 推理结果（含判定和耗时）；null 表示无法处理（无 embedding / 无候选 / LLM 失败）
 */
export async function reasonRelationsForMemory(anchorId: string): Promise<LLMRelationReasoningResult | null> {
  initRelationReasoningLog();
  const db = getDatabase();

  // 1. 读取锚记忆
  const anchor = db.prepare(`SELECT id, title, content, status, agent_space as agentSpace, created_at as createdAt FROM memories WHERE id = ?`).get(anchorId) as RelationAnchor | undefined;
  if (!anchor || anchor.status !== 'active') return null;

  // 2. 检查 LLM 是否可用
  if (!isLLMAvailable()) return null;

  // 3. 优先使用本地语义向量；模型未安装或向量尚未生成时，回退到保守文本重合候选。
  const anchorVec = isEmbeddingAvailable() ? getCachedEmbedding(anchorId) : null;
  const candidates = anchorVec ? findTopKCandidates(anchor, anchorVec) : findLexicalCandidates(anchor);
  if (candidates.length === 0) {
    // 无候选也标记为已扫描（避免重复扫描）
    recordScanResult(anchorId, 0, null, 0);
    return { anchorId, judgments: [], relationsCreated: 0, latencyMs: 0 };
  }

  // 5. 构造提示词并调用 LLM
  const { systemPrompt, userMessage } = buildReasoningPrompt(anchor, candidates);
  const start = Date.now();

  let llmResp: LLMChatResponse;
  try {
    llmResp = await chatWithLLM({
      systemPrompt,
      userMessage,
      temperature: RELATION_REASONER_CONFIG.temperature,
      maxTokens: RELATION_REASONER_CONFIG.maxTokens,
    });
  } catch (err) {
    console.error(`[RelationReasoner] LLM 调用失败 for ${anchorId}:`, (err as Error).message);
    // LLM 失败不标记为已扫描，下次 Dream 会重试
    return null;
  }

  const latencyMs = Date.now() - start;

  // 6. 解析判定结果
  const judgments = parseJudgments(llmResp.content);

  // 7. 对判定为演化关系的，建立双向关联（事务保护：单条锚记忆的所有关系原子性）
  // 之前无事务，中途失败会导致部分关系建立、部分丢失，造成记忆图不一致
  const candidatesById = new Map(candidates.map(candidate => [candidate.id, candidate]));
  let validJudgments = judgments.filter(j => {
    const candidate = candidatesById.get(j.target_id);
    return Boolean(candidate)
      && j.relation !== 'none'
      && Number.isFinite(j.strength)
      && j.strength >= RELATION_REASONER_CONFIG.minRelationStrength
      && j.strength <= 1
      && j.evidence_quote.trim().length >= 2
      && candidate!.content.includes(j.evidence_quote.trim());
  });
  // 桥接的含义是同时连接至少两个旧上下文；单条 bridges 判定没有可验证的桥。
  if (validJudgments.filter(j => j.relation === 'bridges').length < 2) {
    validJudgments = validJudgments.filter(j => j.relation !== 'bridges');
  }

  let relationsCreated = 0;
  if (validJudgments.length > 0) {
    try {
      relationsCreated = db.transaction(() => {
        let created = 0;
        for (const j of validJudgments) {
          // 锚 → 候选：正向关系
          // createMemoryRelation 内部会自动建立反向回填
          createMemoryRelation(
            anchorId,         // source = 新记忆
            j.target_id,      // target = 旧记忆
            j.relation,       // extends / reverses / reinforces / bridges
            j.strength,
            `${j.reason} | 证据: "${j.evidence_quote}"`
          );
          created++;
        }
        return created;
      })();
    } catch (err) {
      console.error(`[RelationReasoner] 事务建立关系失败 ${anchorId}（${validJudgments.length} 条关系全部回滚）:`, (err as Error).message);
      // 事务失败时关系未建立，但仍标记已扫描避免下次重试（LLM 判定结果已固化）
      // 若需要重试，可手动清除 llm_reasoning_log 记录
    }
  }

  // 8. 记录扫描结果（无论是否建立关系，都标记已扫描）
  recordScanResult(anchorId, relationsCreated, llmResp.model, latencyMs);

  return {
    anchorId,
    judgments,
    relationsCreated,
    latencyMs,
    usage: llmResp.usage,
  };
}

/**
 * 记录单条扫描结果到 llm_reasoning_log。
 */
function recordScanResult(memoryId: string, relationsCreated: number, llmModel: string | null, latencyMs: number): void {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO llm_reasoning_log (id, memory_id, scan_type, relations_created, llm_model, latency_ms, created_at)
    VALUES (@id, @memoryId, 'relation_reasoning', @relationsCreated, @llmModel, @latencyMs, @now)
    ON CONFLICT(memory_id, scan_type) DO UPDATE SET
      relations_created = excluded.relations_created,
      llm_model = excluded.llm_model,
      latency_ms = excluded.latency_ms,
      created_at = excluded.created_at
  `).run({
    id,
    memoryId,
    relationsCreated,
    llmModel,
    latencyMs,
    now,
  });
}

/**
 * 批量执行关联推理。
 *
 * @returns 扫描汇总报告
 */
export async function runRelationReasonerBatch(): Promise<RelationReasonerReport> {
  initRelationReasoningLog();

  const start = Date.now();
  const skipped: string[] = [];

  // 1. 检查 LLM 是否可用
  if (!isLLMAvailable()) {
    skipped.push('LLM 未配置或未启用，关联推理跳过');
    return { scanned: 0, relationsCreated: 0, details: [], skipped, durationMs: Date.now() - start };
  }

  // 2. 找出未扫描存量。Embedding 不可用时会自动使用文本候选，不再整批停摆。
  const unscanned = findUnscannedMemories(RELATION_REASONER_CONFIG.batchSize);
  if (unscanned.length === 0) {
    return { scanned: 0, relationsCreated: 0, details: [], skipped, durationMs: Date.now() - start };
  }

  // 4. 有界并发扫描。单个供应商请求可能需要几十秒；完全串行会让“立即扫描”
  // 看起来像没有反应，而无限并发又容易触发限流。固定最多 3 个 worker。
  const details: { memoryId: string; title: string; relationsCreated: number; latencyMs: number }[] = [];
  let totalRelations = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < unscanned.length) {
      const mem = unscanned[cursor++];
      try {
        const result = await reasonRelationsForMemory(mem.id);
        if (result) {
          const created = result.relationsCreated;
          totalRelations += created;
          details.push({ memoryId: mem.id, title: mem.title, relationsCreated: created, latencyMs: result.latencyMs });
        } else {
          skipped.push(`${mem.title} (${mem.id}): 没有可核实的候选，或 LLM 调用失败`);
        }
      } catch (err) {
        skipped.push(`${mem.title} (${mem.id}): ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, unscanned.length) }, () => worker()));

  return {
    scanned: details.length,
    relationsCreated: totalRelations,
    details,
    skipped,
    durationMs: Date.now() - start,
  };
}

/**
 * 重置某条记忆的扫描状态（下次 Dream 会重新扫描）。
 */
export function resetScanStatus(memoryId: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM llm_reasoning_log WHERE memory_id = ? AND scan_type = ?').run(memoryId, 'relation_reasoning');
  return result.changes > 0;
}

/**
 * 重置所有记忆的扫描状态（用户在 UI 上手动触发全量重扫）。
 */
export function resetAllScanStatus(): number {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM llm_reasoning_log WHERE scan_type = ?').run('relation_reasoning');
  return result.changes;
}

/**
 * 衰减所有记忆关系的 strength。
 *
 * 设计用途：在 Full Dream 周期的最后阶段调用，模拟关系随时间自然弱化。
 * 衰减公式：newStrength = strength * 0.98（每次 Dream 衰减 2%）
 * 低于 MIN_STRENGTH (0.1) 的关系自动删除，避免残留无意义的极弱关联。
 *
 * @param db 数据库实例（由 dreaming.ts 传入，复用 Dream 周期已有的连接）
 * @returns 衰减和删除的关系数量
 */
export function decayRelationStrengths(db: Database.Database): { decayed: number; removed: number } {
  const DECAY_RATE = 0.98;
  const MIN_STRENGTH = 0.1;

  try {
    // 衰减所有 strength 仍在阈值之上的关系
    const decayResult = db.prepare(`
      UPDATE memory_relations
      SET strength = strength * ?
      WHERE strength > ?
    `).run(DECAY_RATE, MIN_STRENGTH);

    // 删除衰减后低于阈值的关系
    const removeResult = db.prepare(`
      DELETE FROM memory_relations
      WHERE strength < ?
    `).run(MIN_STRENGTH);

    return {
      decayed: decayResult.changes,
      removed: removeResult.changes,
    };
  } catch (err) {
    console.error('[RelationReasoner] decayRelationStrengths failed (non-fatal):', (err as Error).message);
    return { decayed: 0, removed: 0 };
  }
}

/**
 * 获取扫描统计（供 UI 展示）。
 */
export function getScanStats(): { totalScanned: number; totalRelations: number; lastScanAt?: string } {
  initRelationReasoningLog();
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) as total, SUM(relations_created) as relations, MAX(created_at) as last
    FROM llm_reasoning_log WHERE scan_type = 'relation_reasoning'
  `).get() as { total: number; relations: number | null; last: string | null };

  return {
    totalScanned: row.total ?? 0,
    totalRelations: row.relations ?? 0,
    lastScanAt: row.last ?? undefined,
  };
}
