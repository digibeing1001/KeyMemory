import type { Memory, Layer, SelfCheckResult } from '@keymemory/shared';
import { createMemory } from './atom.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { processContent, extractEntities, extractProjects } from '../graph/entity.js';
import { getDatabase } from '../db/sqlite.js';
import { ensureProjectPath, resolveProjectRef } from './project.js';
import { extractProjectPathFromContent, inferMemoryLayer, isMeaningfulTag, cleanTag } from './memory-schema.js';

interface AutoRememberInput {
  content: string;
  source?: string;
  agentId?: string;
  isolationMode?: import('@keymemory/shared').IsolationMode;
  currentProjectId?: string;
  conversationRound?: number;
}

interface AutoRememberResult {
  recorded: boolean;
  reason: string;
  memory?: Memory;
  evaluation?: SelfCheckResult;
  entities?: import('@keymemory/shared').Entity[];
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
  const { content, source, agentId, isolationMode, currentProjectId, conversationRound } = input;

  if (!content || content.trim().length < 10) {
    return { recorded: false, reason: '内容过短，不值得记录' };
  }

  const evaluation = await evaluate(content, { currentProject: currentProjectId, conversationRound });

  if (evaluation.action === 'ignore') {
    return { recorded: false, reason: 'SelfCheck 评估为忽略', evaluation };
  }

  if (evaluation.action === 'suggest') {
    return { recorded: false, reason: 'SelfCheck 建议记录，但需要确认', evaluation };
  }

  const title = extractTitle(content);
  const layer = inferMemoryLayer(title, content, undefined, evaluation);
  const projects = extractProjects(content);
  const inferredProjectPath = extractProjectPathFromContent(content);
  const projectName = projects[0] || currentProjectId;

  // Look up project ID from name, fallback to uncategorized root
  const db = getDatabase();
  let projectId: string | undefined;
  let projectPath: string | undefined = projects[0] || inferredProjectPath;
  if (projectName) {
    const project = projects[0] ? ensureProjectPath(projects[0]) : resolveProjectRef(projectName);
    projectId = project?.id;
    projectPath = project?.path ?? projectPath;
  } else if (inferredProjectPath) {
    const project = ensureProjectPath(inferredProjectPath);
    projectId = project?.id;
    projectPath = project?.path ?? inferredProjectPath;
  }
  if (!projectId && !projectPath) {
    const rootProject = db.prepare("SELECT id FROM projects WHERE parent_id IS NULL LIMIT 1").get() as { id: string } | undefined;
    projectId = rootProject?.id;
  }

  const tags = extractTags(content);
  // Agent-derived memories should not be indistinguishable from explicit user
  // assertions. Calibrate confidence from the admission score and cap it below
  // 1.0 so a later user correction can deterministically outrank it.
  const confidence = confidenceFromSelfCheck(evaluation.total);

  const entities = extractEntities(content);
  const metadata: Record<string, unknown> = {
    context: `auto-remember via ${agentId || 'unknown'}`,
    importance: layer === 'long' ? 'high' : layer === 'short' ? 'medium' : 'low',
    admission: {
      method: 'selfcheck',
      score: evaluation.total,
      action: evaluation.action,
    },
  };
  if (entities.length > 0) metadata.entities = entities;
  if (currentProjectId) metadata.projectId = currentProjectId;
  if (projectPath) metadata.projectPath = projectPath;

  const mem = createMemory({
    title,
    content: content.trim(),
    layer,
    projectId,
    projectPath,
    agentSpace: isolationMode === 'isolated' && agentId ? `agent:${agentId}` : 'global',
    ownerAgentId: agentId,
    confidence,
    tags,
    metadata,
    source: source || 'auto-remember',
  });

  // processContent 由 createMemory 内部自动调用，此处重复调用仅为获取 entities 返回值（幂等）
  const entityResult = processContent(mem.id, content);

  // ensureEmbedding + autoAssociate 已内聚到 createMemory 内部，此处无需重复调用

  return {
    recorded: true,
    reason: `SelfCheck 评分 ${evaluation.total.toFixed(2)}，自动记录到${layer}层`,
    memory: mem,
    evaluation,
    entities: entityResult.entities,
  };
}
