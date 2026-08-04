import type { Memory, Layer, SelfCheckResult, CreateMemoryInput } from '@keymemory/shared';
import { createMemory, getMemory } from './atom.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { processContent, extractEntities, extractProjects } from '../graph/entity.js';
import { extractProjectPathFromContent, inferMemoryLayer, isMeaningfulTag, cleanTag } from './memory-schema.js';
import { reasonRelationsForMemory } from './relation-reasoner.js';
import { isLLMAvailable } from './llm-provider.js';
import { enqueueRefine, flushRefineQueue } from './refine-queue.js';
import {
  assessCompleteness,
  assessValue,
  tryCompleteFromContext,
  type ContextSegment,
  type CompletionBasis,
  type CompletenessIssue,
} from './content-quality.js';

interface AutoRememberInput {
  content: string;
  source?: string;
  agentId?: string;
  isolationMode?: import('@keymemory/shared').IsolationMode;
  currentProjectId?: string;
  conversationRound?: number;
  /** 当前调用用户 id。提供时记忆写入 owner_user_id,实现 user-scoped 隔离 */
  userId?: string;
  /**
   * 残缺内容的补全依据来源（当轮及前后的对话文本、来源消息/邮件正文、
   * 关联的已有记忆等）。只做严格子串匹配的证据式补全，不参与任何生成。
   */
  sourceContext?: string[];
  /**
   * KM-201：默认异步提炼——同步段只做价值过滤+落盘即返回（目标 ≤50ms），
   * 完整性/补全/SelfCheck 定层在后台队列完成。awaitRefine=true 时同步等待
   * 提炼完成并返回完整结果（测试与需要即时反馈的调用方使用）。
   */
  awaitRefine?: boolean;
}

interface AutoRememberQuality {
  value: { verdict: 'accept' | 'reject'; reasons: string[]; score: number };
  completeness?: {
    status: 'completed' | 'incomplete';
    issues: CompletenessIssue[];
    basis?: CompletionBasis;
  };
}

interface AutoRememberResult {
  recorded: boolean;
  reason: string;
  memory?: Memory;
  evaluation?: SelfCheckResult;
  entities?: import('@keymemory/shared').Entity[];
  quality?: AutoRememberQuality;
  /** KM-201：异步模式下为 true，表示完整性/定层等提炼仍在后台进行。 */
  refinePending?: boolean;
}

export function confidenceFromSelfCheck(total: number): number {
  if (!Number.isFinite(total)) return 0.55;
  return Number(Math.max(0.55, Math.min(0.95, 0.55 + total * 0.4)).toFixed(3));
}

// detectContentType / suggestLayer 已合并到 memory-schema.ts 的 inferMemoryLayer
// 历史问题：两条路径规则不一致——REST 路径只用关键词，autoRemember 路径只用评分，
// 导致相同内容因入口不同被分到不同层。现统一为单一函数，evaluation 可选。

function extractTitle(content: string): string {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return 'Untitled';

  // 尝试从内容中提取关键信息生成标题
  const firstLine = lines[0];

  // 如果第一行是一个有效的标题（不是代码、不是纯符号），使用它
  const looksLikeTitle = /^[\p{L}\p{N}\s\-_，。？！、：""''（）《》【】]+$/u.test(firstLine) && firstLine.length <= 80;
  if (looksLikeTitle && firstLine.length >= 5) {
    return firstLine.length > 50 ? firstLine.slice(0, 50) + '...' : firstLine;
  }

  // 提取项目名 [[xxx]] 作为标题（用户偏好：标题直接写内容，不加"项目笔记:"等前缀）
  const projectMatch = content.match(/\[\[([^\]]+)\]\]/);
  if (projectMatch) {
    const name = projectMatch[1];
    return name.length > 50 ? name.slice(0, 50) + '...' : name;
  }

  // 提取前几个有意义的词
  const meaningfulWords = firstLine
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^[\d\W]+$/.test(w))
    .slice(0, 6)
    .join(' ');

  if (meaningfulWords.length >= 5) {
    return meaningfulWords.length > 50 ? meaningfulWords.slice(0, 50) + '...' : meaningfulWords;
  }

  return firstLine.length > 50 ? firstLine.slice(0, 50) + '...' : firstLine;
}

/**
 * extractTags: 从内容中提取有意义的标签。
 *
 * 标签清洗规则（isMeaningfulTag/cleanTag）在 memory-schema.ts 中定义，
 * 被 normalizeMemoryInput/Update 复用，确保所有写入路径标签一致清洗。
 */
export function extractTags(content: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  function addTag(tag: string) {
    const cleaned = cleanTag(tag);
    const key = cleaned.toLowerCase();
    if (!seen.has(key) && isMeaningfulTag(cleaned)) {
      seen.add(key);
      tags.push(cleaned);
    }
  }

  // 提取 #hashtag 形式的标签
  const hashtagPattern = /#([\p{L}\p{N}_\-一-鿿]+)/gu;
  let match;
  while ((match = hashtagPattern.exec(content)) !== null) {
    addTag(match[1]);
  }

  // 提取 @mention 作为标签
  const mentionPattern = /@([\p{L}\p{N}_\-一-鿿]+)/gu;
  while ((match = mentionPattern.exec(content)) !== null) {
    addTag(match[1]);
  }

  // 提取 [[项目]] 作为标签（只生成项目名，不再生成 project:xxx 命名空间）
  const projectPattern = /\[\[([^\]]+)\]\]/g;
  while ((match = projectPattern.exec(content)) !== null) {
    addTag(match[1].trim());
  }

  // 提取常见中文关键词作为自然标签（不再生成 type:/source: 命名空间标签）
  const keywordPatterns: RegExp[] = [
    /(?:问题|bug|fix|修复|解决)/gi,
    /(?:待办|todo|任务|task)/gi,
    /(?:想法|idea|灵感|思考)/gi,
    /(?:笔记|note|记录)/gi,
    /(?:会议|meeting|讨论|talk)/gi,
    /(?:代码|code|编程|开发)/gi,
    /(?:设计|design|ui|ux)/gi,
    /(?:学习|study|阅读|book)/gi,
  ];
  const keywordTags = ['问题修复', '待办', '想法', '笔记', '会议', '代码', '设计', '学习'];
  keywordPatterns.forEach((pattern, i) => {
    if (pattern.test(content)) addTag(keywordTags[i]);
  });

  return tags.slice(0, 8); // 最多 8 个标签（精简，避免标签碎片化）
}

export async function autoRemember(input: AutoRememberInput): Promise<AutoRememberResult> {
  const { content, source, agentId, isolationMode, currentProjectId, conversationRound, userId, sourceContext } = input;

  if (!content || content.trim().length < 10) {
    return { recorded: false, reason: '内容过短，不值得记录' };
  }

  // 同步段第 1 步：准入价值过滤（纯规则，微秒级）。套话/寒暄/无信息量模板直接拒绝。
  const value = assessValue(content);
  if (value.verdict === 'reject') {
    return {
      recorded: false,
      reason: `低价值内容被准入过滤拒绝：${value.reasons.join('；')}`,
      quality: { value },
    };
  }

  // KM-201 同步段第 2 步：毫秒落盘。先以保守初值写入（flash 层/默认置信度），
  // metadata.refinePending 标记待提炼；随后立即返回，Agent 交互不被嵌入/评分阻塞。
  const trimmed = content.trim();
  const title = extractTitle(trimmed);
  const projects = extractProjects(trimmed);
  const inferredProjectPath = extractProjectPathFromContent(trimmed);
  const projectPath: string | undefined = projects[0] || inferredProjectPath;
  const syncMetadata: Record<string, unknown> = {
    context: `auto-remember via ${agentId || 'unknown'}`,
    qualityValue: { score: value.score },
    refinePending: true,
  };
  if (currentProjectId) syncMetadata.projectId = currentProjectId;
  if (projectPath) syncMetadata.projectPath = projectPath;

  const mem = createMemory({
    title,
    content: trimmed,
    layer: 'flash',
    projectPath,
    agentSpace: isolationMode === 'isolated' && agentId ? `agent:${agentId}` : 'global',
    ownerAgentId: agentId,
    confidence: 0.7,
    tags: extractTags(trimmed),
    metadata: syncMetadata,
    source: source || 'auto-remember',
    ...(userId ? { ownerUserId: userId } : {}),
  } as CreateMemoryInput & { ownerUserId?: string });

  enqueueRefine({ memoryId: mem.id, agentId, currentProjectId, conversationRound, sourceContext });

  if (input.awaitRefine !== true) {
    return {
      recorded: true,
      reason: '已写入，完整性检测与定层在后台提炼（每 5 轮 / 10 分钟空闲 / 手动触发）',
      memory: mem,
      quality: { value },
      refinePending: true,
    };
  }

  // 同步等待模式：先提炼，再基于落盘结果重建完整返回值（测试/即时反馈路径）。
  await flushRefineQueue();
  const after = getMemory(mem.id);
  if (!after || after.status === 'deleted') {
    return {
      recorded: false,
      reason: '记忆不存在或已被删除',
      quality: { value },
    };
  }

  const meta = (after.metadata ?? {}) as Record<string, unknown>;
  const admission = meta.admission as { score?: number; action?: string } | undefined;
  const completenessMeta = meta.completeness as AutoRememberQuality['completeness'] | undefined;
  if (admission?.action === 'ignore') {
    // KM-203：保留已写入内容，仅按旧契约返回“未自动记录”结论（完整性结论仍一并返回），
    // 可经质量审计处置。
    const qualityOnIgnore: AutoRememberQuality = { value };
    if (completenessMeta) qualityOnIgnore.completeness = completenessMeta;
    return {
      recorded: false,
      reason: 'SelfCheck 评估为忽略（内容已保留，可经质量审计处置）',
      memory: after,
      quality: qualityOnIgnore,
    };
  }
  const quality: AutoRememberQuality = { value };
  if (completenessMeta) quality.completeness = completenessMeta;

  // processContent 幂等（createMemory 已调用过），此处仅为取 Entity[] 类型的返回值。
  const entities = processContent(after.id, after.content).entities;

  return {
    recorded: true,
    reason: `SelfCheck 评分 ${admission?.score?.toFixed(2) ?? '-'}，自动记录到${after.layer}层`,
    memory: after,
    evaluation: admission?.score !== undefined ? ({ total: admission.score, action: admission.action } as unknown as SelfCheckResult) : undefined,
    entities,
    quality,
  };
}
