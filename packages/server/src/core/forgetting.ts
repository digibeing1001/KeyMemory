import type { ForgetMethod, Layer } from '@keymemory/shared';
import { LAYER_CONFIG } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { getMemory } from './atom.js';

export function applyDecay(): { flashDecayed: number; shortDecayed: number; autoArchived: number } {
  const db = getDatabase();
  const now = new Date().toISOString();

  const flashConfig = LAYER_CONFIG.flash;
  const flashResult = db.prepare(`
    UPDATE memories
    SET decay_factor = decay_factor * @rate, updated_at = @now
    WHERE layer = 'flash'
      AND status = 'active'
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', ? || ' days'))
      AND decay_factor > 0.01
  `).run({ rate: flashConfig.decayRate, now }, `-${flashConfig.decayDays}`);

  const shortConfig = LAYER_CONFIG.short;
  const shortResult = db.prepare(`
    UPDATE memories
    SET decay_factor = decay_factor * @rate, updated_at = @now
    WHERE layer = 'short'
      AND status = 'active'
      AND (last_hit_at IS NULL OR last_hit_at <= datetime('now', ? || ' days'))
      AND decay_factor > 0.01
  `).run({ rate: shortConfig.decayRate, now }, `-${shortConfig.decayDays}`);

  const autoArchive = db.prepare(`
    UPDATE memories SET status = 'decayed', updated_at = @now
    WHERE decay_factor <= 0.01 AND status = 'active'
  `).run({ now });

  return {
    flashDecayed: flashResult.changes,
    shortDecayed: shortResult.changes,
    autoArchived: autoArchive.changes,
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
      db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
      return true;
    })();
  }

  if (method === 'archive') {
    return db.transaction(() => {
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(id);
      db.prepare(`UPDATE memories SET status = 'archived', updated_at = ? WHERE id = ?`).run(now, id);
      return true;
    })();
  } else if (method === 'decay') {
    return db.transaction(() => {
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(id);
      db.prepare(`UPDATE memories SET confidence = 0, decay_factor = 0, status = 'decayed', updated_at = ? WHERE id = ?`).run(now, id);
      return true;
    })();
  }

  return true;
}

export function restoreMemory(id: string): boolean {
  const db = getDatabase();
  const existing = getMemory(id);
  if (!existing) return false;

  const now = new Date().toISOString();

  const result = db.prepare(`
    UPDATE memories SET status = 'active', decay_factor = 1.0, confidence = 1.0, updated_at = ?
    WHERE id = ? AND status IN ('archived', 'decayed')
  `).run(now, id);

  return result.changes > 0;
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
