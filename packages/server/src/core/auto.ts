import type { Memory, Layer, SelfCheckResult } from '@keymemory/shared';
import { createMemory, getMemory } from './atom.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { processContent, extractEntities, extractProjects } from '../graph/entity.js';
import { searchHybrid } from './query.js';
import { getDatabase } from '../db/sqlite.js';
import { ensureProjectPath, resolveProjectRef } from './project.js';
import { extractProjectPathFromContent } from './memory-schema.js';

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

// 语义信号检测：识别内容类型特征
function detectContentType(content: string): { isProject: boolean; isEntity: boolean; isKnowledge: boolean; isTask: boolean; isIdea: boolean } {
  const text = content.toLowerCase();

  // 项目特征：会议、决策、里程碑、roadmap、版本发布、项目周会
  const projectSignals = /(?:项目|周会|会议纪要|决策记录|里程碑|roadmap|版本发布|上线|评审|复盘|冲刺|迭代|sprint|milestone|release|launch)/i;
  // 实体特征：职位、联系方式、偏好、档案、人物介绍
  const entitySignals = /(?:职位|联系方式|电话|邮箱|偏好|风格|档案|基本信息|技术特长|工作风格|沟通建议|协作)/i;
  // 知识特征：框架、原理、概念、学习、总结、方法论、最佳实践、教程
  const knowledgeSignals = /(?:框架|原理|概念|学习|总结|方法论|最佳实践|教程|指南|模式|模型|体系|理论|分析|综述)/i;
  // 任务特征：待办、本周、今天、明天、截止日期、安排、计划、task、todo
  const taskSignals = /(?:待办|本周|今天|明天|后天|截止日期|截止|安排|计划|task|todo|完成|推进|跟进|落实|执行)/i;
  // 灵感特征：灵感、想法、想到、如果、试试、也许、假设
  const ideaSignals = /(?:灵感|想法|想到|如果|试试|也许|假设|猜想|突发奇想|灵光一闪)/i;

  return {
    isProject: projectSignals.test(text),
    isEntity: entitySignals.test(text),
    isKnowledge: knowledgeSignals.test(text),
    isTask: taskSignals.test(text),
    isIdea: ideaSignals.test(text),
  };
}

function suggestLayer(content: string, evaluation: SelfCheckResult): Layer {
  const signals = detectContentType(content);

  // 优先级 1：长期记忆 - 含项目产出特征且提及项目名称
  if (signals.isProject && extractProjects(content).length > 0) {
    return 'long';
  }

  // 优先级 2：实体层 - 含人物/组织档案特征
  if (signals.isEntity) {
    return 'entity';
  }

  // 优先级 3：长期知识 - 知识特征明显
  if (signals.isKnowledge && evaluation.total >= 0.6) {
    return 'long';
  }

  // 优先级 4：短期任务 - 任务特征
  if (signals.isTask && evaluation.total >= 0.5) {
    return 'short';
  }

  // 优先级 5：闪念 - 灵感特征
  if (signals.isIdea || evaluation.total < 0.5) {
    return 'flash';
  }

  // _fallback：按评分
  if (evaluation.total > 0.75) return 'long';
  if (evaluation.total > 0.55) return 'short';
  return 'flash';
}

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

  // 尝试提取实体、项目名称或关键短语
  const projectMatch = content.match(/\[\[([^\]]+)\]\]/);
  if (projectMatch) {
    return `项目笔记: ${projectMatch[1]}`;
  }

  const personMatch = content.match(/@([\p{L}\p{N}_]+)/u);
  if (personMatch) {
    return `关于 @${personMatch[1]} 的笔记`;
  }

  const conceptMatch = content.match(/#([\p{L}\p{N}_]+)/u);
  if (conceptMatch) {
    return `#${conceptMatch[1]} 相关笔记`;
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

const TYPE_TAGS: Record<string, string[]> = {
  knowledge: ['知识', '方法论', '框架', '模型', '原理', '总结', '指南', '教程'],
  decision: ['决策', '决定', '选择', '方案'],
  meeting: ['会议', '周会', '纪要', '讨论'],
  idea: ['灵感', '想法', '创意'],
  task: ['任务', '待办', '计划'],
  reference: ['备忘', '参考', '配置'],
};

const SOURCE_TAGS: Record<string, string[]> = {
  conversation: ['对话', '讨论', '交流'],
  reading: ['阅读', '看书', '文章'],
  meeting: ['会议', '周会'],
  experience: ['实践', '经验', '踩坑'],
};

function inferTypeTag(content: string): string | null {
  const text = content.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_TAGS)) {
    if (keywords.some(k => text.includes(k))) {
      return `type:${type}`;
    }
  }
  return null;
}

function inferSourceTag(content: string): string | null {
  const text = content.toLowerCase();
  for (const [source, keywords] of Object.entries(SOURCE_TAGS)) {
    if (keywords.some(k => text.includes(k))) {
      return `source:${source}`;
    }
  }
  return null;
}

export function extractTags(content: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  function addTag(tag: string) {
    const normalized = tag.toLowerCase();
    if (!seen.has(normalized) && tag.length >= 2) {
      seen.add(normalized);
      tags.push(tag);
    }
  }

  // 提取 #hashtag 形式的标签（支持命名空间如 #type:知识）
  const hashtagPattern = /#([\p{L}\p{N}_\-一-鿿:/]+)/gu;
  let match;
  while ((match = hashtagPattern.exec(content)) !== null) {
    addTag(match[1]);
  }

  // 提取 @mention 作为标签
  const mentionPattern = /@([\p{L}\p{N}_\-一-鿿]+)/gu;
  while ((match = mentionPattern.exec(content)) !== null) {
    addTag(match[1]);
  }

  // 提取 [[项目]] 作为标签，同时生成 project: 命名空间标签
  const projectPattern = /\[\[([^\]]+)\]\]/g;
  while ((match = projectPattern.exec(content)) !== null) {
    const projectName = match[1].trim();
    addTag(projectName);
    addTag(`project:${projectName}`);
  }

  // 提取常见中文关键词并添加命名空间
  const keywordPatterns = [
    { pattern: /(?:问题|bug|fix|修复|解决)[\s:：]*/gi, tag: '问题修复' },
    { pattern: /(?:待办|todo|任务|task)[\s:：]*/gi, tag: '待办', nsTag: 'type:task' },
    { pattern: /(?:想法|idea|灵感|思考)[\s:：]*/gi, tag: '想法', nsTag: 'type:idea' },
    { pattern: /(?:笔记|note|记录)[\s:：]*/gi, tag: '笔记', nsTag: 'type:note' },
    { pattern: /(?:会议|meeting|讨论|talk)[\s:：]*/gi, tag: '会议', nsTag: 'source:meeting' },
    { pattern: /(?:代码|code|编程|开发)[\s:：]*/gi, tag: '代码' },
    { pattern: /(?:设计|design|ui|ux)[\s:：]*/gi, tag: '设计' },
    { pattern: /(?:学习|study|阅读|book)[\s:：]*/gi, tag: '学习', nsTag: 'source:reading' },
  ];

  for (const kp of keywordPatterns) {
    if (kp.pattern.test(content)) {
      addTag(kp.tag);
      if (kp.nsTag) addTag(kp.nsTag);
    }
  }

  // 自动推断 type: 和 source: 命名空间标签
  const typeTag = inferTypeTag(content);
  if (typeTag) addTag(typeTag);
  const sourceTag = inferSourceTag(content);
  if (sourceTag) addTag(sourceTag);

  // 如果内容涉及技术栈，添加 domain:技术
  const techSignals = /(?:react|vue|angular|typescript|javascript|python|docker|kubernetes|database|api|frontend|backend|devops)/i;
  if (techSignals.test(content)) {
    addTag('domain:技术');
  }

  return tags.slice(0, 12); // 最多 12 个标签（含命名空间）
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

  const layer = suggestLayer(content, evaluation);
  const title = extractTitle(content);
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

  const entities = extractEntities(content);
  const metadata: Record<string, unknown> = {
    context: `auto-remember via ${agentId || 'unknown'}`,
    importance: layer === 'long' ? 'high' : layer === 'short' ? 'medium' : 'low',
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
    tags,
    metadata,
    source: source || 'auto-remember',
  });

  const entityResult = processContent(mem.id, content);

  try {
    const { ensureEmbedding } = await import('./query.js');
    await ensureEmbedding(mem.id, title, content.trim(), mem.tags, mem.metadata as Record<string, unknown> | undefined);
  } catch {}

  return {
    recorded: true,
    reason: `SelfCheck 评分 ${evaluation.total.toFixed(2)}，自动记录到${layer}层`,
    memory: mem,
    evaluation,
    entities: entityResult.entities,
  };
}
