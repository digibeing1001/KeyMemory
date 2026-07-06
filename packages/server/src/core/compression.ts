/**
 * 记忆压缩（Compression）
 *
 * 双模式设计：
 * - LLM 模式（推荐）：当 LLM 已配置且可用时，调用 LLM 做语义级摘要，
 *   生成连贯、有重点、去冗余的项目/实体摘要。
 * - 拼接模式（fallback）：LLM 不可用时，回退到原来的"前 2-3 行拼接"逻辑，
 *   保证功能可用但质量较低。
 *
 * 调用方无需感知模式切换，函数内部自动判断。
 */
import { getDatabase } from '../db/sqlite.js';
import { findProjectRef } from './project.js';
import { isLLMAvailable, chatWithLLM } from './llm-provider.js';

export interface CompressionResult {
  projectId?: string;
  entityId?: string;
  sourceCount: number;
  summary: string;
  /** 摘要生成模式：llm（语义摘要）| concat（拼接回退） */
  mode: 'llm' | 'concat';
  /** LLM 模式下的耗时 ms；concat 模式为 0 */
  latencyMs?: number;
}

/**
 * 单条记忆送入 LLM 的最大字符数。
 * 太长会浪费 token，太短会丢失上下文。800 字符约 200-400 token，够 LLM 理解要点。
 */
const MAX_MEMORY_CHARS_FOR_LLM = 800;

/**
 * 拼接模式下的最大记忆条数。
 * 避免项目记忆过多时拼接出超长摘要。
 */
const MAX_CONCAT_MEMORIES = 30;

export async function compressProjectMemories(project: string): Promise<CompressionResult | null> {
  const db = getDatabase();
  const projectInfo = findProjectRef(project);
  if (!projectInfo) return null;

  const memories = db.prepare(`
    SELECT m.id, m.title, m.content FROM memories m
    JOIN projects p ON p.id = m.project_id
    WHERE (p.id = @projectId OR p.path LIKE @pathPattern)
      AND m.status = 'active'
    ORDER BY created_at ASC
  `).all({ projectId: projectInfo.id, pathPattern: `${projectInfo.path}/%` }) as { id: string; title: string; content: string }[];

  if (memories.length < 3) return null;

  // LLM 模式
  if (isLLMAvailable()) {
    const llmResult = await summarizeWithLLM({
      kind: 'project',
      subjectName: projectInfo.path,
      memories,
    });
    if (llmResult) {
      return {
        projectId: projectInfo.id,
        sourceCount: memories.length,
        summary: llmResult.summary,
        mode: 'llm',
        latencyMs: llmResult.latencyMs,
      };
    }
    // LLM 调用失败 → 回退到拼接模式
  }

  // 拼接模式（fallback）
  const summary = buildConcatSummary({
    title: `${projectInfo.path} 项目摘要`,
    memories: memories.slice(0, MAX_CONCAT_MEMORIES),
    firstLinesCount: 3,
  });

  return {
    projectId: projectInfo.id,
    sourceCount: memories.length,
    summary,
    mode: 'concat',
    latencyMs: 0,
  };
}

export async function compressEntityMemories(entityId: string): Promise<CompressionResult | null> {
  const db = getDatabase();

  const entity = db.prepare(`SELECT name FROM entities WHERE id = ?`).get(entityId) as { name: string } | undefined;
  if (!entity) return null;

  const memories = db.prepare(`
    SELECT m.id, m.title, m.content FROM memories m
    JOIN memory_entities me ON me.memory_id = m.id
    WHERE me.entity_id = ? AND m.status = 'active'
    ORDER BY m.created_at ASC
  `).all(entityId) as { id: string; title: string; content: string }[];

  if (memories.length < 2) return null;

  // LLM 模式
  if (isLLMAvailable()) {
    const llmResult = await summarizeWithLLM({
      kind: 'entity',
      subjectName: entity.name,
      memories,
    });
    if (llmResult) {
      return {
        entityId,
        sourceCount: memories.length,
        summary: llmResult.summary,
        mode: 'llm',
        latencyMs: llmResult.latencyMs,
      };
    }
    // LLM 调用失败 → 回退到拼接模式
  }

  // 拼接模式（fallback）
  const summary = buildConcatSummary({
    title: `${entity.name} 实体摘要`,
    memories: memories.slice(0, MAX_CONCAT_MEMORIES),
    firstLinesCount: 2,
  });

  return {
    entityId,
    sourceCount: memories.length,
    summary,
    mode: 'concat',
    latencyMs: 0,
  };
}

export function listCompressibleProjects(): { project: string; count: number }[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT p.path as project, COUNT(*) as count FROM memories m
    JOIN projects p ON p.id = m.project_id
    WHERE m.status = 'active'
    GROUP BY p.path
    HAVING count >= 3
    ORDER BY count DESC
  `).all() as { project: string; count: number }[];
}

/**
 * 用 LLM 生成语义摘要。
 *
 * 设计原则（与 relation-reasoner 一致）：
 * - 确认性优先：摘要必须基于输入记忆原文，不得引入外部知识
 * - 不创造事实：LLM 只做"提炼与重组"，不做"推断与补全"
 * - 失败容错：任何异常都返回 null，让调用方回退到拼接模式
 */
async function summarizeWithLLM(params: {
  kind: 'project' | 'entity';
  subjectName: string;
  memories: { id: string; title: string; content: string }[];
}): Promise<{ summary: string; latencyMs: number } | null> {
  const { kind, subjectName, memories } = params;

  const kindLabel = kind === 'project' ? '项目' : '实体';
  const systemPrompt = `你是一个记忆压缩助手。你的任务是把多条记忆提炼成一份连贯的摘要，供人类和 Agent 快速回顾。

## 核心原则

1. **只基于输入记忆**：摘要必须来自输入的多条记忆原文，不得引入外部知识或常识
2. **确认而非创造**：你的角色是提炼与重组，不是推断与补全；如果记忆里没有的内容，不要写进摘要
3. **保留关键事实**：时间、数字、决策结论、技术选型、人物、状态变更等关键事实必须保留
4. **去重去冗**：重复表述合并，无关废话剔除
5. **结构化输出**：用 markdown 列表组织，每条要点独立成行

## 输出格式

\`\`\`markdown
# ${subjectName} ${kindLabel}摘要

共 N 条记忆，关键要点：

- 要点 1（含关键事实）
- 要点 2
- ...
\`\`\`

只输出 markdown，不要输出其他内容。`;

  const memoriesText = memories.map((m, i) => {
    const truncated = m.content.length > MAX_MEMORY_CHARS_FOR_LLM
      ? m.content.slice(0, MAX_MEMORY_CHARS_FOR_LLM) + '...'
      : m.content;
    return `### 记忆 ${i + 1}
- 标题: ${m.title}
- 内容: ${truncated}`;
  }).join('\n\n');

  const userMessage = `## ${kindLabel}：${subjectName}

## 关联记忆（共 ${memories.length} 条）

${memoriesText}

## 任务

请基于以上 ${memories.length} 条记忆，生成一份 ${kindLabel}摘要。`;

  const start = Date.now();
  try {
    const resp = await chatWithLLM({
      systemPrompt,
      userMessage,
      temperature: 0.2, // 摘要要稳定，低温度
      maxTokens: 1500,
    });
    const summary = resp.content.trim();
    if (!summary) return null;
    return { summary, latencyMs: Date.now() - start };
  } catch (err) {
    console.error(`[Compression] LLM 摘要失败 (${kind}=${subjectName}):`, (err as Error).message);
    return null;
  }
}

/**
 * 拼接模式摘要（fallback）。
 *
 * 原 compression.ts 的逻辑：取每条记忆的前 N 行拼接。
 */
function buildConcatSummary(params: {
  title: string;
  memories: { id: string; title: string; content: string }[];
  firstLinesCount: number;
}): string {
  const { title, memories, firstLinesCount } = params;
  const keyPoints: string[] = [];
  for (const m of memories) {
    const lines = m.content.split('\n').filter(l => l.trim().length > 0);
    const firstLines = lines.slice(0, firstLinesCount).map(l => l.trim());
    keyPoints.push(`- ${m.title}: ${firstLines.join(' ')}`);
  }

  return `# ${title}\n\n共 ${memories.length} 条记忆，关键要点：\n\n${keyPoints.join('\n')}`;
}
