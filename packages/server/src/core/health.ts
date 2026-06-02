import type { HealthReport, Layer, Memory } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, bufferToEmbedding } from '../embed/onnx.js';
import { listMemories } from './atom.js';
import { findProjectRef } from './project.js';
import { searchHybrid } from './query.js';

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
    privacyRedactedCount,
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
  const rows = db.prepare(`
    SELECT m.project_id as projectId, p.name as projectName, p.path as projectPath
    FROM memories m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.status = 'active'
      AND m.id NOT IN (SELECT memory_id FROM memory_entities)
      AND m.layer NOT IN ('flash')
  `).all() as { projectId: string | null; projectName: string | null; projectPath: string | null }[];

  return rows.filter(row => !hasConcreteProject(row)).length;
}

const GENERIC_PROJECT_NAMES = new Set([
  '未分类',
  'uncategorized',
  'unclassified',
  'default',
  'general',
  'global',
  'migrated',
  'memory',
  'memories',
]);

function normalizeProjectName(value: string): string {
  return value.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function isUsefulProjectName(value: string): boolean {
  const normalized = normalizeProjectName(value);
  if (!normalized || GENERIC_PROJECT_NAMES.has(normalized)) return false;
  if (/[\u3400-\u9fff]/u.test(normalized)) return normalized.length >= 2;
  return normalized.length >= 4;
}

function hasConcreteProject(row: { projectId: string | null; projectName: string | null; projectPath: string | null }): boolean {
  if (!row.projectId || !row.projectName || !row.projectPath) return false;
  return isUsefulProjectName(row.projectName) || isUsefulProjectName(row.projectPath);
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
