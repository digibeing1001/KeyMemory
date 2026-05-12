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
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length === 0) return 'Untitled';
  const first = lines[0].trim();
  return first.length > 50 ? first.slice(0, 50) + '...' : first;
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

  const mem = createMemory({
    title,
    content: content.trim(),
    layer,
    project,
    agentSpace: isolationMode === 'isolated' && agentId ? `agent:${agentId}` : 'global',
    ownerAgentId: agentId,
  });

  const entityResult = processContent(mem.id, content);

  try {
    const { ensureEmbedding } = await import('./query.js');
    await ensureEmbedding(mem.id, title, content.trim());
  } catch {}

  return {
    recorded: true,
    reason: `SelfCheck 评分 ${evaluation.total.toFixed(2)}，自动记录到${layer}层`,
    memory: mem,
    evaluation,
    entities: entityResult.entities,
  };
}
