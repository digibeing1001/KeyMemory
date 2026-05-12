import { v4 as uuid } from 'uuid';
import type { SelfCheckResult } from '@keymemory/shared';
import { SELFCHECK_WEIGHTS, SELFCHECK_THRESHOLDS } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, embed } from '../embed/onnx.js';
import { bufferToEmbedding } from '../embed/onnx.js';

export async function evaluate(
  content: string,
  options?: {
    currentProject?: string;
    conversationRound?: number;
    userEmphasis?: number;
  }
): Promise<SelfCheckResult> {
  const projectRelevance = await scoreProjectRelevance(content, options?.currentProject);
  const longTermValue = scoreLongTermValue(content);
  const novelty = await scoreNovelty(content);
  const userEmphasis = options?.userEmphasis ?? 0.5;
  const reusability = scoreReusability(content);

  const total =
    projectRelevance * SELFCHECK_WEIGHTS.projectRelevance +
    longTermValue * SELFCHECK_WEIGHTS.longTermValue +
    novelty * SELFCHECK_WEIGHTS.novelty +
    userEmphasis * SELFCHECK_WEIGHTS.userEmphasis +
    reusability * SELFCHECK_WEIGHTS.reusability;

  const action: SelfCheckResult['action'] =
    total > SELFCHECK_THRESHOLDS.autoRecord ? 'auto_record' :
    total > SELFCHECK_THRESHOLDS.suggest ? 'suggest' : 'ignore';

  const result: SelfCheckResult = {
    projectRelevance,
    longTermValue,
    novelty,
    userEmphasis,
    reusability,
    total,
    action,
  };

  const db = getDatabase();
  db.prepare(`
    INSERT INTO selfcheck_logs (id, memory_id, conversation_round, scores, total, action, created_at)
    VALUES (?, NULL, ?, ?, ?, ?, ?)
  `).run(
    uuid(),
    options?.conversationRound ?? 0,
    JSON.stringify({ projectRelevance, longTermValue, novelty, userEmphasis, reusability }),
    total,
    action,
    new Date().toISOString()
  );

  return result;
}

async function scoreProjectRelevance(content: string, currentProject?: string): Promise<number> {
  if (!currentProject) return 0.3;
  const db = getDatabase();
  const projectMemories = db.prepare(`
    SELECT e.embedding FROM memories m
    JOIN embeddings e ON e.memory_id = m.id
    WHERE m.project = ? AND m.status = 'active'
    LIMIT 10
  `).all(currentProject) as { embedding: Buffer }[];

  if (projectMemories.length === 0) return 0.5;

  const contentVec = await embed(content);
  let maxSim = 0;
  for (const pm of projectMemories) {
    const vec = bufferToEmbedding(pm.embedding);
    const sim = cosineSimilarity(contentVec, vec);
    if (sim > maxSim) maxSim = sim;
  }
  return Math.min(maxSim + 0.2, 1.0);
}

function scoreLongTermValue(content: string): number {
  const methodologyKeywords = ['方法论', '原则', '规则', '经验', '教训', '最佳实践', '方法论', '策略', '框架', '模式', 'methodology', 'principle', 'rule', 'lesson', 'best practice'];
  const decisionKeywords = ['决定', '选择', '因为', '所以', '原因', '结论', 'decided', 'because', 'therefore', 'conclusion'];

  const lower = content.toLowerCase();
  let score = 0.3;

  for (const kw of methodologyKeywords) {
    if (lower.includes(kw)) { score += 0.15; break; }
  }
  for (const kw of decisionKeywords) {
    if (lower.includes(kw)) { score += 0.15; break; }
  }

  if (content.length > 200) score += 0.1;

  return Math.min(score, 1.0);
}

async function scoreNovelty(content: string): Promise<number> {
  const db = getDatabase();
  const recentEmbeddings = db.prepare(`
    SELECT e.embedding FROM memories m
    JOIN embeddings e ON e.memory_id = m.id
    WHERE m.status = 'active'
    ORDER BY m.created_at DESC
    LIMIT 20
  `).all() as { embedding: Buffer }[];

  if (recentEmbeddings.length === 0) return 0.8;

  const contentVec = await embed(content);
  let maxSim = 0;
  for (const re of recentEmbeddings) {
    const vec = bufferToEmbedding(re.embedding);
    const sim = cosineSimilarity(contentVec, vec);
    if (sim > maxSim) maxSim = sim;
  }

  return Math.max(1.0 - maxSim, 0.1);
}

function scoreReusability(content: string): number {
  const reusablePatterns = ['配置', '模板', '脚本', '命令', '步骤', '流程', 'config', 'template', 'script', 'command', 'step', 'workflow'];
  const lower = content.toLowerCase();
  let score = 0.3;
  for (const p of reusablePatterns) {
    if (lower.includes(p)) { score += 0.2; break; }
  }
  return Math.min(score, 1.0);
}
