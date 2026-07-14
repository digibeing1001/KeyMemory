import type { Memory } from '@keymemory/shared';

/**
 * Internal temporal helpers. Agent-facing callers must still enforce adapter
 * visibility before using these helpers to mutate or expose a memory.
 */
export function normalizeIsoTimestamp(value: string, fieldName: string): string {
  const trimmed = value.trim();
  const time = Date.parse(trimmed);
  if (!trimmed || !Number.isFinite(time)) {
    throw new Error(`${fieldName} must be a valid ISO 8601 timestamp`);
  }
  return new Date(time).toISOString();
}

export function resolveAsOf(value?: string): string {
  return value ? normalizeIsoTimestamp(value, 'asOf') : new Date().toISOString();
}

export function validateValidityWindow(validFrom: string, validTo?: string): { validFrom: string; validTo?: string } {
  const normalizedFrom = normalizeIsoTimestamp(validFrom, 'validFrom');
  const normalizedTo = validTo ? normalizeIsoTimestamp(validTo, 'validTo') : undefined;
  if (normalizedTo && normalizedTo <= normalizedFrom) {
    throw new Error('validTo must be later than validFrom');
  }
  return { validFrom: normalizedFrom, validTo: normalizedTo };
}

export function isMemoryValidAt(memory: Memory, asOf: string): boolean {
  const instant = resolveAsOf(asOf);
  return memory.validFrom <= instant && (!memory.validTo || memory.validTo > instant);
}
