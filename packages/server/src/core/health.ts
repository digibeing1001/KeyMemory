import type { HealthReport, Layer, Memory } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, embed, bufferToEmbedding } from '../embed/onnx.js';
import { listMemories } from './atom.js';
import { rowToMemory } from '../db/mapper.js';

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

  const duplicateScore = Math.max(0, 100 - duplicateCount * 5);
  const orphanScore = Math.max(0, 100 - orphanCount * 3);
  const conflictScore = Math.max(0, 100 - conflictCount * 10);
  const decayScore = Math.max(0, 100 - decayingCount * 2);

  const score = Math.round((duplicateScore + orphanScore + conflictScore + decayScore) / 4);

  return {
    score,
    duplicateCount,
    orphanCount,
    conflictCount,
    decayingCount,
    layerDistribution,
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
      AND m.project IS NULL
      AND m.layer NOT IN ('flash')
  `).get() as { cnt: number }).cnt;
}

function countConflicts(): number {
  const db = getDatabase();
  const contradictionPatterns = ['不是', '错误', '相反', '否定', 'not', 'wrong', 'opposite'];

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
      SELECT content FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ? AND m.status = 'active'
    `).all(entity.id) as { content: string }[];

    for (const m of mems) {
      if (contradictionPatterns.some(p => m.content.toLowerCase().includes(p))) {
        count++;
        break;
      }
    }
  }

  return count;
}

export async function injectContext(options: { project?: string; query?: string; limit?: number }): Promise<Memory[]> {
  const limit = options.limit ?? 5;

  if (options.project) {
    const projectMems = listMemories({ project: options.project, status: 'active', limit });
    if (projectMems.length > 0) return projectMems;
  }

  if (options.query) {
    const db = getDatabase();
    const queryVec = await embed(options.query);

    const rows = db.prepare(`
      SELECT m.*, e.embedding FROM memories m
      JOIN embeddings e ON e.memory_id = m.id
      WHERE m.status = 'active'
    `).all() as (Record<string, unknown> & { embedding: Buffer })[];

    const scored = rows.map(r => {
      const vec = bufferToEmbedding(r.embedding);
      return { row: r, score: cosineSimilarity(queryVec, vec) };
    });

    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(s => rowToMemory(s.row));
  }

  return listMemories({ status: 'active', limit });
}
