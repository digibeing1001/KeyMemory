import type { ForgetMethod, Layer } from '@keymemory/shared';
import { LAYER_CONFIG, DECAY_CONFIG } from '@keymemory/shared';
import { randomUUID } from 'node:crypto';
import { getDatabase } from '../db/sqlite.js';
import { deleteChunks } from './chunking.js';
import { invalidateEmbeddingCache } from './embedding-cache.js';
import { getMemory } from './atom.js';
import { insertIntoFts } from './fts-helpers.js';

export function applyDecay(): { flashDecayed: number; shortDecayed: number; longDecayed: number; autoArchived: number; demotedToShort: number; demotedToFlash: number } {
  const db = getDatabase();
  const now = new Date().toISOString();

  const flashConfig = LAYER_CONFIG.flash;
  const flashResult = db.prepare(`
    UPDATE memories
    SET decay_factor = decay_factor * @rate,
        confidence = MAX(0.1, confidence * @rate),
        updated_at = @now
    WHERE layer = 'flash'
      AND status = 'active'
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', ? || ' days'))
      AND decay_factor > @floor
  `).run({ rate: flashConfig.decayRate, now, floor: DECAY_CONFIG.decayFloor }, `-${flashConfig.decayDays}`);

  const shortConfig = LAYER_CONFIG.short;
  const shortResult = db.prepare(`
    UPDATE memories
    SET decay_factor = decay_factor * @rate,
        confidence = MAX(0.1, confidence * @rate),
        updated_at = @now
    WHERE layer = 'short'
      AND status = 'active'
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', ? || ' days'))
      AND decay_factor > @floor
  `).run({ rate: shortConfig.decayRate, now, floor: DECAY_CONFIG.decayFloor }, `-${shortConfig.decayDays}`);

  // long 层衰减：180 天未命中的内容每次衰减 1%（rate=0.99），不再"只进不出"
  const longConfig = LAYER_CONFIG.long;
  const longResult = db.prepare(`
    UPDATE memories
    SET decay_factor = decay_factor * @rate,
        confidence = MAX(0.1, confidence * @rate),
        updated_at = @now
    WHERE layer = 'long'
      AND status = 'active'
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', ? || ' days'))
      AND decay_factor > @floor
  `).run({ rate: longConfig.decayRate, now, floor: DECAY_CONFIG.decayFloor }, `-${longConfig.decayDays}`);

  // 反向降级 1：long 层长期未被命中的低 decay 内容降级到 short
  // 条件：decay_factor < demoteLongDecayFactor 且 demoteLongDays 天未命中 → layer_move long→short
  // 写入 versions 记录，让降级可追溯
  const demoteLongRows = db.prepare(`
    SELECT id FROM memories
    WHERE layer = 'long'
      AND status = 'active'
      AND decay_factor < @threshold
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', @days || ' days'))
  `).all({ threshold: DECAY_CONFIG.demoteLongDecayFactor, days: `-${DECAY_CONFIG.demoteLongDays}` }) as { id: string }[];
  const demotedToShort = demoteLongRows.length;
  for (const row of demoteLongRows) {
    // 事务保护：layer 变更 + versions 审计记录必须原子性
    // 之前无事务，UPDATE 成功但 INSERT versions 失败会破坏版本链完整性
    db.transaction(() => {
      db.prepare(`UPDATE memories SET layer = 'short', decay_factor = @reset, updated_at = @now WHERE id = @id`)
        .run({ id: row.id, now, reset: DECAY_CONFIG.demotedResetDecayFactor });
      db.prepare(`
        INSERT INTO versions (id, memory_id, version, title, content, change_type, change_reason, created_at)
        SELECT @vid, @mid, (SELECT COUNT(*) FROM versions WHERE memory_id = @mid) + 1,
               title, content, 'layer_move', 'long→short 反向降级：长期未命中', @now
        FROM memories WHERE id = @mid
      `).run({ vid: randomUUID(), mid: row.id, now });
    })();
  }

  // 反向降级 2：short 层长期未被命中的极低 decay 内容降级到 flash
  // 条件：decay_factor < demoteShortDecayFactor 且 demoteShortDays 天未命中 → layer_move short→flash
  const demoteShortRows = db.prepare(`
    SELECT id FROM memories
    WHERE layer = 'short'
      AND status = 'active'
      AND decay_factor < @threshold
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', @days || ' days'))
  `).all({ threshold: DECAY_CONFIG.demoteShortDecayFactor, days: `-${DECAY_CONFIG.demoteShortDays}` }) as { id: string }[];
  const demotedToFlash = demoteShortRows.length;
  for (const row of demoteShortRows) {
    // 事务保护：layer 变更 + versions 审计记录必须原子性
    db.transaction(() => {
      db.prepare(`UPDATE memories SET layer = 'flash', updated_at = @now WHERE id = @id`)
        .run({ id: row.id, now });
      db.prepare(`
        INSERT INTO versions (id, memory_id, version, title, content, change_type, change_reason, created_at)
        SELECT @vid, @mid, (SELECT COUNT(*) FROM versions WHERE memory_id = @mid) + 1,
               title, content, 'layer_move', 'short→flash 反向降级：长期未命中', @now
        FROM memories WHERE id = @mid
      `).run({ vid: randomUUID(), mid: row.id, now });
    })();
  }

  const autoArchive = db.prepare(`
    UPDATE memories SET status = 'decayed', updated_at = @now
    WHERE decay_factor <= @threshold AND status = 'active'
  `).run({ now, threshold: DECAY_CONFIG.autoArchiveDecayFactor });

  return {
    flashDecayed: flashResult.changes,
    shortDecayed: shortResult.changes,
    longDecayed: longResult.changes,
    autoArchived: autoArchive.changes,
    demotedToShort,
    demotedToFlash,
  };
}

export function forgetMemory(id: string, method: ForgetMethod): boolean {
  const db = getDatabase();
  const existing = getMemory(id);
  if (!existing) return false;

  const now = new Date().toISOString();

  if (method === 'delete') {
    return db.transaction(() => {
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`DELETE FROM versions WHERE memory_id = ?`).run(id);
      db.prepare(`DELETE FROM memory_entities WHERE memory_id = ?`).run(id);
      db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(id);
      deleteChunks(id);
      db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
      invalidateEmbeddingCache(id);
      return true;
    })();
  }

  if (method === 'archive') {
    return db.transaction(() => {
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(id);
      deleteChunks(id);
      db.prepare(`UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, id);
      invalidateEmbeddingCache(id);
      return true;
    })();
  } else if (method === 'decay') {
    return db.transaction(() => {
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(id);
      deleteChunks(id);
      db.prepare(`UPDATE memories SET confidence = 0, decay_factor = 0, status = 'decayed', updated_at = ? WHERE id = ?`).run(now, id);
      invalidateEmbeddingCache(id);
      return true;
    })();
  }

  // method 类型已穷尽 ('archive' | 'decay' | 'delete')，不应到达此处
  return false;
}

export function restoreMemory(id: string): boolean {
  const db = getDatabase();
  const existing = getMemory(id);
  if (!existing) return false;

  const now = new Date().toISOString();

  // 事务保护：UPDATE 状态 + 重建 FTS 索引必须原子性
  // 之前无事务，UPDATE 成功但 insertIntoFts 失败时，记忆已 active 但全文搜索永久不可见
  return db.transaction(() => {
    const result = db.prepare(`
      UPDATE memories SET status = 'active', decay_factor = 1.0, confidence = 1.0, updated_at = ?
      WHERE id = ? AND status IN ('archived', 'decayed')
    `).run(now, id);

    // 恢复成功后重建 FTS 索引，否则恢复的记忆无法被全文搜索到
    if (result.changes > 0) {
      insertIntoFts(db, id);
    }

    return result.changes > 0;
  })();
}

export function getDecayingMemories(): { id: string; title: string; layer: Layer; decayFactor: number; daysSinceHit: number }[] {
  const db = getDatabase();

  const rows = db.prepare(`
    SELECT id, title, layer, decay_factor,
           CAST(julianday('now') - julianday(last_hit_at) AS INTEGER) as days_since_hit
    FROM memories
    WHERE status = 'active'
      AND decay_factor < 1.0
      AND decay_factor > 0.01
    ORDER BY decay_factor ASC
  `).all() as { id: string; title: string; layer: Layer; decay_factor: number; days_since_hit: number }[];

  return rows.map(r => ({
    id: r.id,
    title: r.title,
    layer: r.layer,
    decayFactor: r.decay_factor,
    daysSinceHit: r.days_since_hit,
  }));
}
