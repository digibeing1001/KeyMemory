import type { Memory, Layer, SelfCheckResult, CreateMemoryInput } from '@keymemory/shared';
import { createMemory } from './atom.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { processContent, extractEntities, extractProjects } from '../graph/entity.js';
import { extractProjectPathFromContent, inferMemoryLayer, isMeaningfulTag, cleanTag } from './memory-schema.js';
import { reasonRelationsForMemory } from './relation-reasoner.js';
import { isLLMAvailable } from './llm-provider.js';
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

  // 链路环节 1：准入评估——价值过滤。套话/寒暄/无信息量模板直接拒绝，
  // 不进入后续评分与写入，避免污染记忆库。
  const value = assessValue(content);
  if (value.verdict === 'reject') {
    return {
      recorded: false,
      reason: `低价值内容被准入过滤拒绝：${value.reasons.join('；')}`,
      quality: { value },
    };
  }

  // 链路环节 2：写入前处理——完整性检测 + 证据式补全。
  // 补全只做上下文的严格子串匹配（逐字来自上下文），严禁猜测/幻觉；
  // 上下文不足以可靠补全时保留原文并标记“信息不完整”。
  let finalContent = content.trim();
  const quality: AutoRememberQuality = { value };
  const completeness = assessCompleteness(finalContent);
  if (!completeness.complete) {
    const segments: ContextSegment[] = (sourceContext ?? [])
      .filter(t => typeof t === 'string' && t.trim().length > 0)
      .map((text, i) => ({ label: `context-${i + 1}`, text }));
    const completion = segments.length > 0 ? tryCompleteFromContext(finalContent, segments) : null;
    if (completion) {
      finalContent = completion.completed;
      quality.completeness = { status: 'completed', issues: completeness.issues, basis: completion.basis };
    } else {
      quality.completeness = { status: 'incomplete', issues: completeness.issues };
    }
  }

  const evaluation = await evaluate(finalContent, { currentProject: currentProjectId, conversationRound });

  if (evaluation.action === 'ignore') {
    return { recorded: false, reason: 'SelfCheck 评估为忽略', evaluation, quality };
  }

  if (evaluation.action === 'suggest') {
    return { recorded: false, reason: 'SelfCheck 建议记录，但需要确认', evaluation, quality };
  }

  const title = extractTitle(finalContent);
  const layer = inferMemoryLayer(title, finalContent, undefined, evaluation);
  const projects = extractProjects(finalContent);
  const inferredProjectPath = extractProjectPathFromContent(finalContent);
  // 项目路径只作为来源线索保留，不再创建或扩展用户项目文件夹。
  // 具体工作的连续上下文由邮件主题承担；原子记忆统一进入公共记忆池，
  // 之后可以被多个邮件线程引用。
  const projectPath: string | undefined = projects[0] || inferredProjectPath;

  const tags = extractTags(finalContent);
  // Agent-derived memories should not be indistinguishable from explicit user
  // assertions. Calibrate confidence from the admission score and cap it below
  // 1.0 so a later user correction can deterministically outrank it.
  const confidence = confidenceFromSelfCheck(evaluation.total);

  const entities = extractEntities(finalContent);
  const metadata: Record<string, unknown> = {
    context: `auto-remember via ${agentId || 'unknown'}`,
    importance: layer === 'long' ? 'high' : layer === 'short' ? 'medium' : 'low',
    admission: {
      method: 'selfcheck',
      score: evaluation.total,
      action: evaluation.action,
    },
    qualityValue: { score: value.score },
  };
  if (quality.completeness) {
    // 补全可审计：status=completed 时 basis 记录依据来源（哪段上下文、哪句）；
    // 无法可靠补全时标记 incomplete，供 dream 周期与质量审计识别。
    metadata.completeness = {
      ...quality.completeness,
      at: new Date().toISOString(),
    };
  }
  if (entities.length > 0) metadata.entities = entities;
  if (currentProjectId) metadata.projectId = currentProjectId;
  if (projectPath) metadata.projectPath = projectPath;

  const mem = createMemory({
    title,
    content: finalContent,
    layer,
    projectPath,
    agentSpace: isolationMode === 'isolated' && agentId ? `agent:${agentId}` : 'global',
    ownerAgentId: agentId,
    confidence,
    tags,
    metadata,
    source: source || 'auto-remember',
    // 透传 ownerUserId 到 createMemory(扩展字段,shared 类型不感知)
    ...(userId ? { ownerUserId: userId } : {}),
  } as CreateMemoryInput & { ownerUserId?: string });

  // processContent 由 createMemory 内部自动调用，此处重复调用仅为获取 entities 返回值（幂等）
  const entityResult = processContent(mem.id, finalContent);

  // ensureEmbedding + autoAssociate 已内聚到 createMemory 内部，此处无需重复调用

  // 异步触发增量关联推理（不阻塞主流程）
  if (mem && isLLMAvailable()) {
    reasonRelationsForMemory(mem.id).catch(err => {
      console.error(`[Auto] Incremental relation reasoning failed for ${mem.id}:`, err);
    });
  }

  return {
    recorded: true,
    reason: `SelfCheck 评分 ${evaluation.total.toFixed(2)}，自动记录到${layer}层`,
    memory: mem,
    evaluation,
    entities: entityResult.entities,
    quality,
  };
}
