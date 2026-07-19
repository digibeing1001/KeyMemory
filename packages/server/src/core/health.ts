import type { HealthReport, Layer, Memory } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, bufferToEmbedding } from '../embed/onnx.js';
import { listMemories } from './atom.js';
import { findProjectRef } from './project.js';
import { searchHybrid } from './query.js';
import { findConflictMatch } from './conflict-detector.js';

export async function getHealthReport(): Promise<HealthReport> {
  const db = getDatabase();

  const layerDistribution = {} as Record<Layer, number>;
  for (const layer of LAYERS) {
    const result = db.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE layer = ? AND status = 'active'`).get(layer) as { cnt: number };
    layerDistribution[layer] = result.cnt;
  }

  const duplicateCount = await countDuplicates();
  const orphanCount = countOrphans();
  const conflictCount = countConflicts();
  const decayingCount = (db.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE status = 'active' AND decay_factor < 1.0 AND decay_factor > 0.01`).get() as { cnt: number }).cnt;
  const privacyRedactedCount = (db.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE status = 'active' AND tags LIKE '%sensitivity:redacted%'`).get() as { cnt: number }).cnt;

  // 新增：数据流动度指标——衡量"短期中转层是否真正流动"
  // 这些指标直接反映系统是否还能作为 loop 上下文记忆库使用：
  //   - shortActive: 短期层 active 数量；为 0 说明短期层空转
  //   - flashActive: 待整理层 active 数量；为 0 说明新写入不进 flash
  //   - longZeroHit: 长期层"零命中"记忆数（从未被检索用到）；高则说明 long 只进不出
  //   - dreamEffectiveness: 最近 10 次 dream 的总产出（promoted+archived+merged）；
  //     全 0 说明 dream 空转
  //   - loopRuns: loop_runs 表的运行数；为 0 说明从未作为 loop 上下文使用
  const shortActive = layerDistribution.short ?? 0;
  const flashActive = layerDistribution.flash ?? 0;
  const longZeroHit = (db.prepare(`
    SELECT COUNT(*) as cnt FROM memories
    WHERE layer = 'long' AND status = 'active'
      AND (last_hit_at IS NULL OR hit_count = 0)
  `).get() as { cnt: number }).cnt;

  let dreamEffectiveness = 0;
  try {
    const dreamRow = db.prepare(`
      SELECT COALESCE(SUM(promoted), 0) + COALESCE(SUM(archived), 0) + COALESCE(SUM(merged), 0)
        + COALESCE(SUM(COALESCE(json_array_length(json_extract(details, '$.relationReasoned')), 0)), 0) as total
      FROM (SELECT promoted, archived, merged, details FROM dream_reports ORDER BY created_at DESC LIMIT 10)
    `).get() as { total: number } | undefined;
    dreamEffectiveness = dreamRow?.total ?? 0;
  } catch {
    // dream_reports 表可能不存在
  }

  let loopRuns = 0;
  try {
    loopRuns = (db.prepare(`SELECT COUNT(*) as cnt FROM loop_runs`).get() as { cnt: number }).cnt;
  } catch {
    // loop_runs 表可能不存在
  }

  const duplicateScore = Math.max(0, 100 - duplicateCount * 5);
  const orphanScore = Math.max(0, 100 - orphanCount * 3);
  const conflictScore = Math.max(0, 100 - conflictCount * 10);
  const decayScore = Math.max(0, 100 - decayingCount * 2);
  // 流动度评分：short 空 -25；flash 空 -10；long 零命中占比高 -最多 20；dream 空 -15；loop 未用 -10
  const longActive = layerDistribution.long ?? 0;
  const longZeroHitRatio = longActive > 0 ? longZeroHit / longActive : 0;
  const flowPenalty =
    (shortActive === 0 ? 25 : 0) +
    (flashActive === 0 ? 10 : 0) +
    Math.round(longZeroHitRatio * 20) +
    (dreamEffectiveness === 0 ? 15 : 0) +
    (loopRuns === 0 ? 10 : 0);
  const flowScore = Math.max(0, 100 - flowPenalty);

  // 健康分由原来 4 维改为 5 维，加入流动度。流动度差时健康分会被显著拉低，
  // 让用户在 UI 上能看到"系统没在流动"——而不是被表面高分掩盖。
  const score = Math.round((duplicateScore + orphanScore + conflictScore + decayScore + flowScore) / 5);

  return {
    score,
    duplicateCount,
    orphanCount,
    conflictCount,
    decayingCount,
    privacyRedactedCount,
    layerDistribution,
    shortActive,
    flashActive,
    longZeroHit,
    dreamEffectiveness,
    loopRuns,
    flowScore,
  };
}

async function countDuplicates(): Promise<number> {
  const db = getDatabase();
  const memories = db.prepare(`
    SELECT m.id, e.embedding FROM memories m
    JOIN embeddings e ON e.memory_id = m.id
    WHERE m.status = 'active'
    ORDER BY m.created_at DESC
    LIMIT 200
  `).all() as { id: string; embedding: Buffer }[];

  let count = 0;
  const checked = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < Math.min(i + 20, memories.length); j++) {
      const key = `${memories[i].id}-${memories[j].id}`;
      if (checked.has(key)) continue;
      checked.add(key);

      const vecA = bufferToEmbedding(memories[i].embedding);
      const vecB = bufferToEmbedding(memories[j].embedding);
      if (cosineSimilarity(vecA, vecB) > 0.9) count++;
    }
  }

  return count;
}

function countOrphans(): number {
  const db = getDatabase();
  return (db.prepare(`
    SELECT COUNT(*) as cnt FROM memories m
    WHERE m.status = 'active'
      AND m.id NOT IN (SELECT memory_id FROM memory_entities)
      AND m.layer != 'flash'
      AND (m.tags IS NULL OR m.tags = '[]')
      AND NOT EXISTS (SELECT 1 FROM memory_relations r WHERE r.source_memory_id = m.id OR r.target_memory_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM mail_thread_memories tm WHERE tm.memory_id = m.id)
  `).get() as { cnt: number }).cnt;
}

function countConflicts(): number {
  const db = getDatabase();
  let count = 0;
  const entities = db.prepare(`
    SELECT e.id FROM entities e
    JOIN memory_entities me ON me.entity_id = e.id
    JOIN memories m ON m.id = me.memory_id AND m.status = 'active'
    GROUP BY e.id
    HAVING COUNT(me.memory_id) >= 2
  `).all() as { id: string }[];

  for (const entity of entities) {
    const mems = db.prepare(`
      SELECT m.id, m.title, m.content FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ? AND m.status = 'active'
    `).all(entity.id) as { id: string; title: string; content: string }[];
    const name = (db.prepare('SELECT name FROM entities WHERE id = ?').get(entity.id) as { name: string }).name;
    if (findConflictMatch(name, mems)) count++;
  }

  return count;
}

function activeSupersededIds(): Set<string> {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT r.target_memory_id as id
    FROM memory_relations r
    JOIN memories source ON source.id = r.source_memory_id
    WHERE r.relation_type = 'supersedes'
      AND source.status = 'active'
  `).all() as { id: string }[];
  return new Set(rows.map(r => r.id));
}

function suppressSuperseded(memories: Memory[], includeSuperseded?: boolean): Memory[] {
  if (includeSuperseded) return memories;
  const superseded = activeSupersededIds();
  return memories.filter(memory => !superseded.has(memory.id));
}

export async function injectContext(options: { project?: string; query?: string; limit?: number; includeSuperseded?: boolean }): Promise<Memory[]> {
  const limit = options.limit ?? 5;
  let projectId: string | undefined;

  if (options.project) {
    const project = findProjectRef(options.project);
    if (!project) return [];
    projectId = project.id;
  }

  if (options.query) {
    const results = await searchHybrid(options.query, {
      projectId,
      includeDescendants: true,
      includeSuperseded: options.includeSuperseded,
      limit,
    });
    return results.map(result => result.memory);
  }

  if (projectId) {
    const projectMems = listMemories({ projectId, includeDescendants: true, status: 'active', limit: limit * 3 });
    return suppressSuperseded(projectMems, options.includeSuperseded).slice(0, limit);
  }

  return suppressSuperseded(listMemories({ status: 'active', limit: limit * 3 }), options.includeSuperseded).slice(0, limit);
}
