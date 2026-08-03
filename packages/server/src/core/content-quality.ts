/**
 * content-quality.ts — 记忆写入质量守门（纯确定性启发式，零 LLM 依赖）
 *
 * 两个维度的写入链路质量保障：
 *
 * 1. 内容完整性（针对残缺记忆）
 *    - assessCompleteness(): 识别半句、悬挂连接词、中途截断、指代不明
 *    - tryCompleteFromContext(): 严格证据式补全——只有当残缺片段能在给定
 *      上下文（前后对话、来源消息/邮件正文、关联记忆）中作为某句的
 *      前缀/后缀被完整匹配到时，才从上下文恢复完整句子，并记录补全依据。
 *      上下文不足以可靠补全时返回 null，由调用方保留原文并标记
 *      metadata.completeness = { status: 'incomplete' }。绝不猜测、绝不幻觉。
 *
 * 2. 内容价值（针对套话/寒暄/模板记忆）
 *    - assessValue(): 纯寒暄应答精确匹配拒绝；短模板表述且无任何信息信号
 *      （数字/路径/URL/代码标识符/项目标签/决策词）时拒绝。
 *
 * 生效环节：
 *    - 准入评估: autoRemember()（低价值直接拒绝；残缺先尝试证据补全）
 *    - 写入前处理: createMemory()（未 bypass 时低价值拒绝；残缺仅标记不阻断）
 *    - 整理周期: runDreamCycle() 调用 auditStoredMemories + markQualityFindings
 *      对已入库记忆做检测与标记（补救路径）
 *
 * 隔离保障：本模块只读取 memories 表的 title/content/metadata 并更新
 * metadata 中的质量标记字段，不涉及 agent_space 过滤逻辑，也不改动 source/
 * sourceId 等来源记录。
 */
import { getDatabase } from '../db/sqlite.js';
import { removeFromFts } from './fts-helpers.js';

// ---------------------------------------------------------------------------
// 错误类型：低价值内容被准入过滤拒绝时抛出，调用方可结构化处理
// ---------------------------------------------------------------------------
export class ContentQualityError extends Error {
  code = 'low-value-content' as const;
  reasons: string[];
  constructor(message: string, reasons: string[]) {
    super(message);
    this.name = 'ContentQualityError';
    this.reasons = reasons;
  }
}

// ---------------------------------------------------------------------------
// 1. 完整性检测
// ---------------------------------------------------------------------------
export type CompletenessIssueType = 'dangling-connector' | 'mid-sentence-cut' | 'unresolved-reference';

export interface CompletenessIssue {
  type: CompletenessIssueType;
  reason: string;
}

export interface CompletenessAssessment {
  complete: boolean;
  issues: CompletenessIssue[];
}

/** 中文悬挂词：以这些词结尾的句子一定还有后文（缺宾语/缺分句） */
const CN_DANGLING_WORDS = [
  '以及', '但是', '因为', '所以', '如果', '虽然', '然后', '接着', '还有', '另外',
  '比如', '例如', '包括', '关于', '对于', '至于', '除了',
  '的', '地', '得', '和', '与', '或', '及', '并', '但', '而',
  '把', '被', '将', '让', '使', '向', '往', '从', '对', '给', '等',
];

/** 英文悬挂词（句子最后一个词是这些时视为未写完） */
const EN_DANGLING_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'to', 'of', 'in', 'on', 'at',
  'for', 'with', 'by', 'from', 'via', 'is', 'are', 'was', 'were', 'be',
  'that', 'which', 'as', 'vs',
]);

/** 指代不明的开头词：短句以这些词开头且没有显式对象（[[]] 或 @mention）时标记 */
const PRONOUN_HEAD = /^(他|她|它|对方|这个人|那个人|这个|那个|该|此事|此方案)/;

/**
 * 检测内容是否残缺。只做确定性判断，宁缺毋滥：
 * 只在有强信号（悬挂连接词/连接标点结尾、未闭合代码块、指代不明）时报告。
 */
export function assessCompleteness(content: string): CompletenessAssessment {
  const issues: CompletenessIssue[] = [];
  const text = content.trim();

  if (text.length === 0) {
    return { complete: false, issues: [{ type: 'mid-sentence-cut', reason: '内容为空' }] };
  }

  const lastChar = text[text.length - 1];

  // 以连接标点结尾 = 句子没写完
  if ('，、,：:'.includes(lastChar)) {
    issues.push({ type: 'dangling-connector', reason: `以连接标点「${lastChar}」结尾，句子未写完` });
  }

  // 中文悬挂词结尾（长词优先匹配）
  let danglingMatched = false;
  for (const w of CN_DANGLING_WORDS) {
    // 避免把英文单词内部的 "and" 等误判：中文词直接 endsWith；单字连接词要求前面不是字母
    if (text.endsWith(w)) {
      const before = text.slice(0, text.length - w.length);
      if (w.length === 1 && /[A-Za-z]$/.test(before)) continue;
      issues.push({ type: 'dangling-connector', reason: `以悬挂连接词「${w}」结尾，缺少后续成分` });
      danglingMatched = true;
      break;
    }
  }

  // 英文悬挂词结尾
  if (!danglingMatched) {
    const m = text.match(/([A-Za-z]+)$/);
    if (m && EN_DANGLING_WORDS.has(m[1].toLowerCase())) {
      issues.push({ type: 'dangling-connector', reason: `以悬挂连接词「${m[1]}」结尾，缺少后续成分` });
    }
  }

  // 未闭合代码块 / 未闭合引号对（中途截断的强信号）
  const fenceCount = (text.match(/```/g) || []).length;
  if (fenceCount % 2 === 1) {
    issues.push({ type: 'mid-sentence-cut', reason: '代码块未闭合（``` 数量为奇数），内容疑似中途截断' });
  }

  // 指代不明：短句以代词/指示词开头且没有显式对象锚点
  if (PRONOUN_HEAD.test(text) && text.length <= 60 && !/\[\[[^\]]+\]\]/.test(text) && !/@[\p{L}\p{N}_\-]/u.test(text)) {
    issues.push({ type: 'unresolved-reference', reason: '以代词/指示词开头且缺少显式对象，指代不明' });
  }

  return { complete: issues.length === 0, issues };
}

// ---------------------------------------------------------------------------
// 2. 证据式上下文补全（严禁猜测：只做上下文的严格子串匹配）
// ---------------------------------------------------------------------------
export interface ContextSegment {
  label: string;
  text: string;
}

export interface CompletionBasis {
  strategy: 'extend-tail' | 'restore-head';
  segmentLabel: string;
  excerpt: string;
}

export interface CompletionResult {
  completed: string;
  basis: CompletionBasis;
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n|[。！？!?]/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * 尝试从真实上下文中恢复残缺片段的完整句子。
 *
 * 仅接受两种可审计的证据形态：
 *  - extend-tail:  上下文某句包含 fragment，且其后还有正文（尾部被截断场景），
 *                  补全结果 = 从 fragment 在句中的位置到句末（逐字来自上下文）；
 *  - restore-head: 上下文某句以 fragment 结尾（头部被截断场景），
 *                  补全结果 = 整个上下文句子（把缺失的前部恢复）。
 *
 * 匹配是严格子串匹配，补全结果逐字来自上下文，不存在模型生成内容。
 * 找不到证据时返回 null——调用方必须保留原文并标记“信息不完整”。
 */
export function tryCompleteFromContext(
  fragment: string,
  segments: ContextSegment[]
): CompletionResult | null {
  const frag = fragment.trim();
  if (frag.length < 6 || segments.length === 0) return null;
  // 去掉残缺片段尾部的悬挂标点/空白再匹配
  const fragCore = frag.replace(/[，、,。.!！?？:：;；\s]+$/, '');
  if (fragCore.length < 6) return null;

  for (const seg of segments) {
    if (!seg.text) continue;
    for (const sentence of splitSentences(seg.text)) {
      if (sentence.length <= fragCore.length + 2) continue;
      const idx = sentence.indexOf(fragCore);
      if (idx === -1) continue;
      const tail = sentence.slice(idx + fragCore.length).trim();
      if (tail.length >= 2) {
        return {
          completed: sentence.slice(idx),
          basis: { strategy: 'extend-tail', segmentLabel: seg.label, excerpt: sentence },
        };
      }
    }
  }

  for (const seg of segments) {
    if (!seg.text) continue;
    for (const sentence of splitSentences(seg.text)) {
      if (sentence.length <= fragCore.length + 2) continue;
      if (sentence.endsWith(fragCore)) {
        return {
          completed: sentence,
          basis: { strategy: 'restore-head', segmentLabel: seg.label, excerpt: sentence },
        };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 3. 价值评估（套话/寒暄/模板内容准入过滤）
// ---------------------------------------------------------------------------
export interface ValueAssessment {
  verdict: 'accept' | 'reject';
  reasons: string[];
  score: number;
}

/** 纯应答/寒暄：整条内容归一化后命中即拒绝 */
const GREETING_EXACT = new Set([
  '好的', '好', '行', '可以', '嗯', '嗯嗯', '收到', '明白', '明白了', '了解',
  '没问题', '辛苦了', '不客气', '谢谢', '感谢', '好的好的', '收到收到',
  '好的，谢谢', '收到，谢谢', '好的谢谢', '收到谢谢', '明白，谢谢',
  '好的，收到，谢谢', '好的好的，收到，谢谢', '收到收到，谢谢，辛苦了',
  '收到，辛苦了', '好的，辛苦', '感谢感谢',
  'ok', 'okay', 'k', 'thx', 'thanks', 'thank you', 'got it', 'noted',
  'ok, thanks', 'ok thanks', 'sounds good', '没问题，谢谢',
]);

/** 模板化套话模式：短内容命中且无信息信号时拒绝 */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /如有疑问.{0,12}(联系|沟通|找我)/,
  /希望对您?有帮助/,
  /祝(工作|生活|一切).{0,6}(顺利|愉快|安好)/,
  /期待您的?回复/,
  /我会继续跟进/,
  /(有|有任何).{0,6}(进展|问题).{0,8}(同步|告知|联系)/,
  /感谢(您|你)的?(支持|配合|理解|信任)/,
  /后续.{0,6}(保持|随时).{0,6}(沟通|联系|交流)/,
  /let me know if/i,
  /feel free to/i,
  /best regards/i,
  /此致/,
  /顺祝/,
];

/** 信息信号：出现任一即说明内容有可复用事实 */
const INFORMATION_SIGNALS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\d{2,}/, label: '数字/日期/版本' },
  { pattern: /https?:\/\/\S+/, label: 'URL' },
  { pattern: /[\p{L}\p{N}_\-]+[\/\\][\p{L}\p{N}_\-.]+/u, label: '路径' },
  { pattern: /[a-z]+[A-Z][\p{L}\p{N}]*/u, label: '代码标识符' },
  { pattern: /\[\[[^\]]+\]\]/, label: '项目引用' },
  { pattern: /#[\p{L}\p{N}_\-]+/u, label: '标签' },
  {
    pattern: /(决定|选择|改为|采用|放弃|拒绝|修复|解决|失败|成功|原因是|结论|结论是|目标|进度|截止|验收|交付|偏好|喜欢|不喜欢|不想要|习惯|踩坑|教训|经验|因为|所以)/,
    label: '决策/事实关键词',
  },
];

/**
 * 评估内容是否值得入库。
 * verdict='reject' 的情形（保守策略，避免误伤）：
 *  1. 归一化后完全等于寒暄/应答短语；
 *  2. 短内容（≤80 字符）命中套话模板且不含任何信息信号。
 */
export function assessValue(text: string): ValueAssessment {
  const reasons: string[] = [];
  const trimmed = text.trim();
  const normalized = trimmed
    .replace(/[\s。！!？?~～.…]+$/g, '')
    .replace(/^[\s。！!？?~～.…]+/g, '')
    .toLowerCase();

  if (normalized.length === 0) {
    return { verdict: 'reject', reasons: ['内容为空'], score: 0 };
  }

  if (GREETING_EXACT.has(normalized)) {
    return { verdict: 'reject', reasons: ['纯寒暄/应答内容，无实际信息量'], score: 0 };
  }

  const signals = INFORMATION_SIGNALS.filter(s => s.pattern.test(trimmed));

  if (trimmed.length <= 80) {
    const matched = BOILERPLATE_PATTERNS.filter(p => p.test(trimmed));
    if (matched.length > 0 && signals.length === 0) {
      return {
        verdict: 'reject',
        reasons: [`模板化套话（命中 ${matched[0].source.slice(0, 24)}…）且无任何信息信号`],
        score: 0,
      };
    }
  }

  // 0~1 的信息密度分，供审计与置信度校准参考
  const score = Math.min(1, 0.3 + signals.length * 0.2);
  return { verdict: 'accept', reasons, score };
}

// ---------------------------------------------------------------------------
// 4. 已入库记忆的质量审计（补救路径：dream 周期 / REST / CLI 共用）
// ---------------------------------------------------------------------------
export interface QualityFinding {
  memoryId: string;
  title: string;
  kind: 'incomplete' | 'low-value';
  reasons: string[];
}

/**
 * 扫描已入库的 active 记忆，返回质量问题清单（只读，不修改数据）。
 * 已被上下文补全过的记忆（metadata.completeness.status === 'completed'）
 * 不再重复标记为残缺。
 */
export function auditStoredMemories(options?: { limit?: number }): QualityFinding[] {
  const db = getDatabase();
  const limit = Math.max(1, Math.min(options?.limit ?? 500, 5000));
  const rows = db.prepare(`
    SELECT id, title, content, metadata
    FROM memories
    WHERE status = 'active'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string; title: string; content: string; metadata: string | null }>;

  const findings: QualityFinding[] = [];
  for (const row of rows) {
    let meta: Record<string, unknown> = {};
    try {
      meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }

    const value = assessValue(`${row.title}\n${row.content}`);
    if (value.verdict === 'reject') {
      findings.push({ memoryId: row.id, title: row.title, kind: 'low-value', reasons: value.reasons });
      continue;
    }

    const completenessStatus = (meta.completeness as { status?: string } | undefined)?.status;
    if (completenessStatus === 'completed') continue;
    const completeness = assessCompleteness(row.content);
    if (!completeness.complete) {
      findings.push({
        memoryId: row.id,
        title: row.title,
        kind: 'incomplete',
        reasons: completeness.issues.map(i => i.reason),
      });
    }
  }
  return findings;
}

/**
 * 把审计结论写入对应记忆的 metadata（qualityFlags / completeness），
 * 只增不删：不改动内容、agent_space、source 等字段。返回标记条数。
 */
export function markQualityFindings(findings: QualityFinding[]): number {
  if (findings.length === 0) return 0;
  const db = getDatabase();
  const now = new Date().toISOString();
  let marked = 0;
  const select = db.prepare(`SELECT metadata FROM memories WHERE id = ? AND status = 'active'`);
  const update = db.prepare(`UPDATE memories SET metadata = ?, updated_at = ? WHERE id = ? AND status = 'active'`);

  for (const finding of findings) {
    const row = select.get(finding.memoryId) as { metadata: string | null } | undefined;
    if (!row) continue;
    let meta: Record<string, unknown> = {};
    try {
      meta = row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : {};
    } catch {
      meta = {};
    }

    const flags = new Set<string>(Array.isArray(meta.qualityFlags) ? (meta.qualityFlags as string[]) : []);
    flags.add(finding.kind);
    meta.qualityFlags = [...flags];
    meta.qualityAuditedAt = now;
    if (finding.kind === 'incomplete') {
      const existing = meta.completeness as { status?: string } | undefined;
      if (!existing || existing.status !== 'completed') {
        meta.completeness = {
          status: 'incomplete',
          reasons: finding.reasons,
          markedAt: now,
        };
      }
    }

    update.run(JSON.stringify(meta), now, finding.memoryId);
    marked++;
  }
  return marked;
}

/**
 * 清理（软删除）指定的低价值记忆。与 adapter.delete 语义一致：
 * status='deleted' + 移出全文索引，可通过版本历史追溯。
 */
export function cleanupLowValueMemories(memoryIds: string[]): { cleaned: number; notFound: number } {
  const db = getDatabase();
  const now = new Date().toISOString();
  let cleaned = 0;
  let notFound = 0;
  const select = db.prepare(`SELECT id FROM memories WHERE id = ? AND status = 'active'`);
  const softDelete = db.prepare(`UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ?`);

  for (const id of memoryIds) {
    const row = select.get(id);
    if (!row) {
      notFound++;
      continue;
    }
    softDelete.run(now, id);
    removeFromFts(db, id);
    cleaned++;
  }
  return { cleaned, notFound };
}
