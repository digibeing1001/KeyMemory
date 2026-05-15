import type { Memory, Layer, SelfCheckResult } from '@keymemory/shared';
import { createMemory, getMemory } from './atom.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { processContent, extractEntities, extractProjects } from '../graph/entity.js';
import { searchHybrid } from './query.js';

interface AutoRememberInput {
  content: string;
  source?: string;
  agentId?: string;
  isolationMode?: import('@keymemory/shared').IsolationMode;
  currentProject?: string;
  conversationRound?: number;
}

interface AutoRememberResult {
  recorded: boolean;
  reason: string;
  memory?: Memory;
  evaluation?: SelfCheckResult;
  entities?: import('@keymemory/shared').Entity[];
}

function suggestLayer(content: string, evaluation: SelfCheckResult): Layer {
  if (evaluation.total > 0.8) return 'long';
  if (evaluation.total > 0.6) return 'short';
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

export function extractTags(content: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();

  // 提取 #hashtag 形式的标签
  const hashtagPattern = /#([\p{L}\p{N}_\-一-鿿]+)/gu;
  let match;
  while ((match = hashtagPattern.exec(content)) !== null) {
    const tag = match[1].toLowerCase();
    if (!seen.has(tag) && tag.length >= 2) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  // 提取 @mention 作为标签
  const mentionPattern = /@([\p{L}\p{N}_\-一-鿿]+)/gu;
  while ((match = mentionPattern.exec(content)) !== null) {
    const tag = match[1].toLowerCase();
    if (!seen.has(tag) && tag.length >= 2) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  // 提取 [[项目]] 作为标签
  const projectPattern = /\[\[([^\]]+)\]\]/g;
  while ((match = projectPattern.exec(content)) !== null) {
    const tag = match[1].toLowerCase().trim();
    if (!seen.has(tag) && tag.length >= 2) {
      seen.add(tag);
      tags.push(tag);
    }
  }

  // 提取常见中文关键词（简单实现）
  const keywordPatterns = [
    { pattern: /(?:问题|bug|fix|修复|解决)[\s:：]*/gi, tag: '问题修复' },
    { pattern: /(?:待办|todo|任务|task)[\s:：]*/gi, tag: '待办' },
    { pattern: /(?:想法|idea|灵感|思考)[\s:：]*/gi, tag: '想法' },
    { pattern: /(?:笔记|note|记录)[\s:：]*/gi, tag: '笔记' },
    { pattern: /(?:会议|meeting|讨论|talk)[\s:：]*/gi, tag: '会议' },
    { pattern: /(?:代码|code|编程|开发)[\s:：]*/gi, tag: '代码' },
    { pattern: /(?:设计|design|ui|ux)[\s:：]*/gi, tag: '设计' },
    { pattern: /(?:学习|study|阅读|book)[\s:：]*/gi, tag: '学习' },
  ];

  for (const kp of keywordPatterns) {
    if (kp.pattern.test(content)) {
      const normalizedTag = kp.tag.toLowerCase();
      if (!seen.has(normalizedTag)) {
        seen.add(normalizedTag);
        tags.push(kp.tag);
      }
    }
  }

  return tags.slice(0, 8); // 最多 8 个标签
}

export async function autoRemember(input: AutoRememberInput): Promise<AutoRememberResult> {
  const { content, source, agentId, isolationMode, currentProject, conversationRound } = input;

  if (!content || content.trim().length < 10) {
    return { recorded: false, reason: '内容过短，不值得记录' };
  }

  const evaluation = await evaluate(content, { currentProject, conversationRound });

  if (evaluation.action === 'ignore') {
    return { recorded: false, reason: 'SelfCheck 评估为忽略', evaluation };
  }

  if (evaluation.action === 'suggest') {
    return { recorded: false, reason: 'SelfCheck 建议记录，但需要确认', evaluation };
  }

  const layer = suggestLayer(content, evaluation);
  const title = extractTitle(content);
  const projects = extractProjects(content);
  const project = projects[0] || currentProject;
  const tags = extractTags(content);

  const entities = extractEntities(content);
  const metadata: Record<string, unknown> = {
    context: `auto-remember via ${agentId || 'unknown'}`,
    importance: layer === 'long' ? 'high' : layer === 'short' ? 'medium' : 'low',
  };
  if (entities.length > 0) metadata.entities = entities;
  if (currentProject) metadata.project = currentProject;

  const mem = createMemory({
    title,
    content: content.trim(),
    layer,
    project,
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
