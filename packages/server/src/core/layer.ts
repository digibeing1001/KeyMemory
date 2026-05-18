import type { Layer } from '@keymemory/shared';
import { LAYERS, LAYER_CONFIG, EVOLUTION_THRESHOLDS } from '@keymemory/shared';
import { getMemory, updateMemory, recordHit } from './atom.js';
import { getDatabase } from '../db/sqlite.js';

export function canMoveToLayer(from: Layer, to: Layer): boolean {
  const validLayers: Layer[] = ['flash', 'short', 'long', 'project', 'entity'];
  return validLayers.includes(from) && validLayers.includes(to);
}

export function moveLayer(memoryId: string, targetLayer: Layer, reason?: string): boolean {
  const mem = getMemory(memoryId);
  if (!mem) return false;
  if (!canMoveToLayer(mem.layer, targetLayer)) return false;

  const result = updateMemory(memoryId, { layer: targetLayer }, reason);
  return result !== null;
}

export function checkFlashToShortPromotions(): string[] {
  const db = getDatabase();
  const threshold = EVOLUTION_THRESHOLDS.flashUnsortedDays;

  const candidates = db.prepare(`
    SELECT m.id, m.hit_count
    FROM memories m
    WHERE m.layer = 'flash'
      AND m.status = 'active'
      AND m.created_at <= datetime('now', ? || ' days')
      AND (
        m.hit_count >= 2
        OR m.id IN (
          SELECT me.memory_id FROM memory_entities me
          UNION
          SELECT m2.id FROM memories m2 WHERE m2.project IS NOT NULL AND m2.id = m.id
        )
      )
  `).all(`-${threshold}`) as { id: string }[];

  return candidates.map(c => c.id);
}

export function checkShortToLongPromotions(): string[] {
  const db = getDatabase();
  const hitThreshold = EVOLUTION_THRESHOLDS.shortSolidifyHits;

  const candidates = db.prepare(`
    SELECT id FROM memories
    WHERE layer = 'short'
      AND status = 'active'
      AND hit_count >= @hitThreshold
  `).all({ hitThreshold }) as { id: string }[];

  return candidates.map(c => c.id);
}

export function getLayerStats(): Record<Layer, { count: number; active: number }> {
  const db = getDatabase();
  const stats = {} as Record<Layer, { count: number; active: number }>;

  for (const layer of LAYERS) {
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE layer = ?`).get(layer) as { cnt: number }).cnt;
    const active = (db.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE layer = ? AND status = 'active'`).get(layer) as { cnt: number }).cnt;
    stats[layer] = { count: total, active };
  }

  return stats;
}
