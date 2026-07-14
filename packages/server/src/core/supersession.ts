import type { Memory, Relation } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { createMemoryRelation } from '../graph/entity.js';
import { getMemory, updateMemory } from './atom.js';
import { normalizeIsoTimestamp } from './temporal.js';

export interface SupersessionResult {
  source: Memory;
  target: Memory;
  relation: Relation;
  effectiveAt: string;
}

/**
 * Internal-only state transition. Agent-facing callers must validate that both
 * memories are visible through their adapter before invoking it.
 */
export function supersedeMemory(
  sourceId: string,
  targetId: string,
  options: { effectiveAt?: string; reason: string },
): SupersessionResult {
  if (sourceId === targetId) throw new Error('A memory cannot supersede itself');
  const reason = options.reason.trim();
  if (!reason) throw new Error('Supersession reason is required');

  const source = getMemory(sourceId);
  const target = getMemory(targetId);
  if (!source) throw new Error(`Memory not found: ${sourceId}`);
  if (!target) throw new Error(`Memory not found: ${targetId}`);

  let effectiveAt = options.effectiveAt
    ? normalizeIsoTimestamp(options.effectiveAt, 'effectiveAt')
    : source.validFrom;
  if (effectiveAt <= target.validFrom) {
    if (options.effectiveAt) {
      throw new Error('effectiveAt must be later than the older memory validFrom');
    }
    effectiveAt = new Date(Date.parse(target.validFrom) + 1).toISOString();
  }

  const db = getDatabase();
  return db.transaction(() => {
    if (source.validFrom !== effectiveAt) {
      const updatedSource = updateMemory(
        sourceId,
        { validFrom: effectiveAt },
        `supersession effective time: ${reason}`,
      );
      if (!updatedSource) throw new Error(`Memory not found: ${sourceId}`);
    }

    const targetValidTo = target.validTo && target.validTo < effectiveAt ? target.validTo : effectiveAt;
    if (target.validTo !== targetValidTo) {
      const updatedTarget = updateMemory(
        targetId,
        { validTo: targetValidTo },
        `superseded by ${sourceId}: ${reason}`,
      );
      if (!updatedTarget) throw new Error(`Memory not found: ${targetId}`);
    }

    const relation = createMemoryRelation(sourceId, targetId, 'supersedes', 1, reason);
    return {
      source: getMemory(sourceId)!,
      target: getMemory(targetId)!,
      relation,
      effectiveAt,
    };
  })();
}
