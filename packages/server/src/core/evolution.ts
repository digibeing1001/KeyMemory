import { v4 as uuid } from 'uuid';
import type { EvolutionTask, EvolutionTaskType } from '@keymemory/shared';
import { EVOLUTION_THRESHOLDS } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, embed, bufferToEmbedding } from '../embed/onnx.js';
import { findConflictMatch } from './conflict-detector.js';

export async function runDailyInspection(): Promise<EvolutionTask[]> {
  const tasks: EvolutionTask[] = [];

  tasks.push(...await scanFlashUnsorted());
  tasks.push(...await scanShortSolidify());
  tasks.push(...await detectDuplicates());
  tasks.push(...await detectOrphans());
  tasks.push(...await detectConflicts());

  return tasks;
}

async function scanFlashUnsorted(): Promise<EvolutionTask[]> {
  const db = getDatabase();
  const threshold = EVOLUTION_THRESHOLDS.flashUnsortedDays;

  const candidates = db.prepare(`
    SELECT id, title FROM memories
    WHERE layer = 'flash'
      AND status = 'active'
      AND created_at <= datetime('now', ? || ' days')
  `).all(`-${threshold}`) as { id: string; title: string }[];

  const tasks: EvolutionTask[] = [];
  for (const c of candidates) {
    const task = createTask('archive', [c.id], `闪念「${c.title}」已超过${threshold}天未整理，建议归档或提升到短期层`);
    tasks.push(task);
  }
  return tasks;
}

async function scanShortSolidify(): Promise<EvolutionTask[]> {
  const db = getDatabase();
  const hitThreshold = EVOLUTION_THRESHOLDS.shortSolidifyHits;

  const candidates = db.prepare(`
    SELECT id, title, hit_count FROM memories
    WHERE layer = 'short'
      AND status = 'active'
      AND hit_count >= ?
  `).all(hitThreshold) as { id: string; title: string; hit_count: number }[];

  const tasks: EvolutionTask[] = [];
  for (const c of candidates) {
    const task = createTask('solidify', [c.id], `短期记忆「${c.title}」已被命中${c.hit_count}次，建议固化为长期记忆`);
    tasks.push(task);
  }
  return tasks;
}

async function detectDuplicates(): Promise<EvolutionTask[]> {
  const db = getDatabase();
  const threshold = EVOLUTION_THRESHOLDS.duplicateSimilarity;

  const memories = db.prepare(`
    SELECT m.id, m.title, e.embedding
    FROM memories m
    JOIN embeddings e ON e.memory_id = m.id
    WHERE m.status = 'active'
    ORDER BY m.created_at DESC
    LIMIT 100
  `).all() as { id: string; title: string; embedding: Buffer }[];

  const tasks: EvolutionTask[] = [];
  const checked = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    for (let j = i + 1; j < memories.length; j++) {
      const key = `${memories[i].id}-${memories[j].id}`;
      if (checked.has(key)) continue;
      checked.add(key);

      const vecA = bufferToEmbedding(memories[i].embedding);
      const vecB = bufferToEmbedding(memories[j].embedding);
      const sim = cosineSimilarity(vecA, vecB);

      if (sim > threshold) {
        const task = createTask(
          'merge',
          [memories[i].id, memories[j].id],
          `「${memories[i].title}」与「${memories[j].title}」相似度${sim.toFixed(2)}，建议合并`
        );
        tasks.push(task);
      }
    }
  }

  return tasks;
}

async function detectOrphans(): Promise<EvolutionTask[]> {
  const db = getDatabase();

  const orphans = db.prepare(`
    SELECT m.id, m.title FROM memories m
    WHERE m.status = 'active'
      AND m.id NOT IN (SELECT memory_id FROM memory_entities)
      AND m.layer NOT IN ('flash')
      AND (m.tags IS NULL OR m.tags = '[]')
      AND NOT EXISTS (SELECT 1 FROM memory_relations r WHERE r.source_memory_id = m.id OR r.target_memory_id = m.id)
      AND NOT EXISTS (SELECT 1 FROM mail_thread_memories tm WHERE tm.memory_id = m.id)
  `).all() as { id: string; title: string }[];

  const tasks: EvolutionTask[] = [];
  for (const o of orphans) {
    const task = createTask('orphan', [o.id], `「${o.title}」缺少实体、标签、记忆关系或邮件主题等关联线索，建议补充线索或归档`);
    tasks.push(task);
  }
  return tasks;
}

async function detectConflicts(): Promise<EvolutionTask[]> {
  const db = getDatabase();

  const entities = db.prepare(`
    SELECT e.id, e.name, COUNT(me.memory_id) as mem_count
    FROM entities e
    JOIN memory_entities me ON me.entity_id = e.id
    JOIN memories m ON m.id = me.memory_id AND m.status = 'active'
    GROUP BY e.id
    HAVING mem_count >= 2
  `).all() as { id: string; name: string; mem_count: number }[];

  const tasks: EvolutionTask[] = [];
  for (const entity of entities) {
    const mems = db.prepare(`
      SELECT m.id, m.title, m.content FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ? AND m.status = 'active'
    `).all(entity.id) as { id: string; title: string; content: string }[];

    if (mems.length < 2) continue;

    const match = findConflictMatch(entity.name, mems);
    if (match) tasks.push(createTask('conflict', [match.positive.id, match.negative.id], `实体「${entity.name}」在同一事项中存在相反表述：「${match.positive.title}」称“${match.positiveWord}”，而「${match.negative.title}」称“${match.negativeWord}”`));
  }

  return tasks;
}

function createTask(taskType: EvolutionTaskType, sourceIds: string[], suggestion: string): EvolutionTask {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO evolution_tasks (id, task_type, source_ids, suggestion, status, created_at)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, taskType, JSON.stringify(sourceIds), suggestion, now);

  return { id, taskType, sourceIds, suggestion, status: 'pending', createdAt: now };
}

export function getPendingTasks(): EvolutionTask[] {
  const db = getDatabase();
  return db.prepare(`SELECT * FROM evolution_tasks WHERE status = 'pending' ORDER BY created_at DESC`).all() as EvolutionTask[];
}

export function resolveTask(taskId: string, action: 'accepted' | 'rejected'): EvolutionTask | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  // 事务保护：确保 task 状态更新和 memories 变更原子性
  // 之前无事务，中途失败会导致 task 标记为 accepted 但 memories 未变更
  return db.transaction(() => {
    db.prepare(`UPDATE evolution_tasks SET status = ?, resolved_at = ? WHERE id = ?`).run(action, now, taskId);

    const task = db.prepare(`SELECT * FROM evolution_tasks WHERE id = ?`).get(taskId) as Record<string, unknown> | undefined;
    if (!task) return null;

    if (action === 'accepted') {
      const sourceIds = JSON.parse(task.source_ids as string) as string[];
      switch (task.task_type) {
        case 'solidify':
          for (const id of sourceIds) {
            db.prepare(`UPDATE memories SET layer = 'long', updated_at = ? WHERE id = ?`).run(now, id);
          }
          break;
        case 'archive':
          for (const id of sourceIds) {
            db.prepare(`UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, id);
          }
          break;
      }
    }

    return task as unknown as EvolutionTask;
  })();
}
