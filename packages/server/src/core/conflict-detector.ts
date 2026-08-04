import { CONFLICT_PATTERNS } from '@keymemory/shared';
import { isLLMAvailable, chatWithLLM } from './llm-provider.js';

export type ConflictMemory = { id: string; title: string; content: string };
export type ConflictMatch = {
  positive: ConflictMemory;
  negative: ConflictMemory;
  positiveWord: string;
  negativeWord: string;
};

const NOISY_ENTITY = /^(?:今天|昨天|明天|现在|目前|系统|项目|任务|工作|用户|时间|Windows|Git|API|\d{4}(?:[-年]\d{1,2})?.*)$/iu;
const TOPIC_STOP = new Set(['今天', '现在', '目前', '已经', '需要', '一个', '这个', '系统', '项目', '任务', '工作', '用户', '内容', '记忆']);

function topicTokens(value: string, entityName: string): Set<string> {
  const text = value.toLocaleLowerCase().replaceAll(entityName.toLocaleLowerCase(), ' ');
  const result = new Set<string>();
  for (const word of text.match(/[a-z][a-z0-9._-]{2,}/g) ?? []) if (!TOPIC_STOP.has(word)) result.add(word);
  for (const chunk of text.match(/[\u4e00-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index < chunk.length - 1; index++) {
      const pair = chunk.slice(index, index + 2);
      if (!TOPIC_STOP.has(pair)) result.add(pair);
    }
  }
  return result;
}

function sharesTopic(left: ConflictMemory, right: ConflictMemory, entityName: string): boolean {
  const leftTokens = topicTokens(`${left.title} ${left.content}`, entityName);
  const rightTokens = topicTokens(`${right.title} ${right.content}`, entityName);
  return [...leftTokens].filter(token => rightTokens.has(token)).length >= 2;
}

/** 高精度的规则候选；最终仍作为“待确认”，不会自动改写原记忆。 */
export function findConflictMatch(entityName: string, memories: ConflictMemory[]): ConflictMatch | null {
  if (entityName.trim().length < 2 || NOISY_ENTITY.test(entityName.trim())) return null;
  for (const [positiveSet, negativeSet] of CONFLICT_PATTERNS) {
    for (const positive of memories) {
      if (negativeSet.some(word => positive.content.includes(word))) continue;
      const positiveWord = positiveSet.find(word => positive.content.includes(word));
      if (!positiveWord) continue;
      for (const negative of memories) {
        if (negative.id === positive.id || !sharesTopic(positive, negative, entityName)) continue;
        const negativeWord = negativeSet.find(word => negative.content.includes(word));
        if (negativeWord) return { positive, negative, positiveWord, negativeWord };
      }
    }
  }
  return null;
}

/* ================= KM-209/D11：语义冲突判定 =================
 * 词表只能抓字面对立（喜欢/讨厌），抓不到“用 PostgreSQL” vs “迁移到 MySQL”
 * 这类真实冲突。方案：词表作为快速预筛；另用“同主题 + 变更标记”生成语义候选，
 * 交给 LLM 做最终判定（复用 relation-reasoner 的强制 JSON + evidence_quote 防幻觉模式）；
 * LLM 不可用时维持词表结果并标记 degraded，绝不静默。 */

const DIVERGENCE_MARKERS = ['迁移到', '改用', '换成', '替换为', '切换到', '变更为', '不再使用', '放弃', '仍在使用', '仍用', '继续使用', '保持使用'];

export interface ConflictJudgment {
  conflict: boolean;
  reason: string;
  evidenceQuoteA?: string;
  evidenceQuoteB?: string;
}

export interface SemanticConflictCandidate {
  a: ConflictMemory;
  b: ConflictMemory;
  markersA: string[];
  markersB: string[];
  judgment?: ConflictJudgment;
}

export interface ConflictAssessment {
  /** 词表路径命中（高精度） */
  match: ConflictMatch | null;
  /** 语义候选及 LLM 判定结果 */
  semantic: SemanticConflictCandidate[];
  /** LLM 不可用 → 语义判定关闭，仅词表结果可信 */
  degraded: boolean;
  source: 'lexicon' | 'llm' | 'none';
}

/** 语义候选生成：同主题且双方都带变更/维持标记的记忆对。 */
export function findSemanticConflictCandidates(entityName: string, memories: ConflictMemory[]): SemanticConflictCandidate[] {
  if (entityName.trim().length < 2 || NOISY_ENTITY.test(entityName.trim())) return [];
  const candidates: SemanticConflictCandidate[] = [];
  for (let i = 0; i < memories.length; i++) {
    const markersA = DIVERGENCE_MARKERS.filter(w => memories[i].content.includes(w));
    if (markersA.length === 0) continue;
    for (let j = i + 1; j < memories.length; j++) {
      const markersB = DIVERGENCE_MARKERS.filter(w => memories[j].content.includes(w));
      if (markersB.length === 0) continue;
      if (!sharesTopic(memories[i], memories[j], entityName)) continue;
      candidates.push({ a: memories[i], b: memories[j], markersA, markersB });
      if (candidates.length >= 3) return candidates;
    }
  }
  return candidates;
}

function extractJson(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** LLM 判定单对候选：强制 JSON + evidence_quote 摘自原文（防幻觉）。 */
export async function confirmConflictWithLLM(candidate: SemanticConflictCandidate): Promise<ConflictJudgment> {
  const systemPrompt = `你是记忆冲突裁决专家。判断同一主题下的两条记忆是否在事实上互相矛盾。
输出严格 JSON，不要输出其他内容：
{
  "conflict": true 或 false,
  "reason": "一句话说明判断依据",
  "evidence_quote_a": "从记忆 A 原文摘录的片段（不得改写）",
  "evidence_quote_b": "从记忆 B 原文摘录的片段（不得改写）"
}
规则：
1. 只有两条记忆对同一事实给出不相容结论时 conflict=true；时间先后的更新、补充、不同方面不算冲突。
2. evidence_quote 必须是原文逐字片段，用于人工核验，禁止编造。
3. 证据不足或含糊时 conflict=false。`;
  const userMessage = `主题实体：${'' /* 保留可读性 */}候选冲突对

记忆 A：${candidate.a.title}
${candidate.a.content}

记忆 B：${candidate.b.title}
${candidate.b.content}`;
  const response = await chatWithLLM({ systemPrompt, userMessage, maxTokens: 300 });
  const parsed = extractJson(response.content);
  if (!parsed || typeof parsed.conflict !== 'boolean') {
    return { conflict: false, reason: 'LLM 输出不可解析，保守判定为非冲突' };
  }
  return {
    conflict: parsed.conflict,
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    evidenceQuoteA: typeof parsed.evidence_quote_a === 'string' ? parsed.evidence_quote_a : undefined,
    evidenceQuoteB: typeof parsed.evidence_quote_b === 'string' ? parsed.evidence_quote_b : undefined,
  };
}

/**
 * 综合评估某实体下的冲突：词表预筛 + 语义候选 + LLM 判定。
 * LLM 不可用时 degraded=true，仅词表结果可信（降级可见，绝不静默）。
 */
export async function assessEntityConflicts(entityName: string, memories: ConflictMemory[]): Promise<ConflictAssessment> {
  const match = findConflictMatch(entityName, memories);
  const candidates = findSemanticConflictCandidates(entityName, memories);
  const degraded = !isLLMAvailable();

  if (!degraded) {
    for (const candidate of candidates) {
      try {
        candidate.judgment = await confirmConflictWithLLM(candidate);
      } catch (err) {
        candidate.judgment = { conflict: false, reason: `LLM 判定失败：${(err as Error).message}` };
      }
    }
  }

  const confirmed = candidates.filter(c => c.judgment?.conflict);
  const source = match ? 'lexicon' : confirmed.length > 0 ? 'llm' : 'none';
  return { match, semantic: candidates, degraded, source };
}
