import { getDatabase } from '../db/sqlite.js';
import { runDreamCycle } from './dreaming.js';
import { runAutoConsolidation } from './consolidation.js';
import { DREAM_CONFIG } from '@keymemory/shared';

export interface SchedulerConfig {
  dreamingEnabled: boolean;
  dreamingCron: string;
  consolidationEnabled: boolean;
  consolidationCron: string;
  lastDreamRun: string | null;
  lastConsolidationRun: string | null;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  dreamingEnabled: true,
  dreamingCron: DREAM_CONFIG.defaultCron,
  consolidationEnabled: true,
  consolidationCron: '0 4 * * *',
  lastDreamRun: null,
  lastConsolidationRun: null,
};

function parseCron(cron: string): { hour: number; minute: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return { hour: 3, minute: 0 };
  return {
    minute: parseInt(parts[0], 10),
    hour: parseInt(parts[1], 10),
  };
}

function msUntilNextRun(cron: string): number {
  const { hour, minute } = parseCron(cron);
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);

  let diff = target.getTime() - now.getTime();
  if (diff <= 0) diff += 86400000;
  return diff;
}

export function getSchedulerConfig(): SchedulerConfig {
  const db = getDatabase();
  const rows = db.prepare(`SELECT key, value FROM scheduler_config`).all() as { key: string; value: string }[];

  const config = { ...DEFAULT_CONFIG };
  for (const row of rows) {
    switch (row.key) {
      case 'dreamingEnabled': config.dreamingEnabled = row.value === 'true'; break;
      case 'dreamingCron': config.dreamingCron = row.value; break;
      case 'consolidationEnabled': config.consolidationEnabled = row.value === 'true'; break;
      case 'consolidationCron': config.consolidationCron = row.value; break;
      case 'lastDreamRun': config.lastDreamRun = row.value; break;
      case 'lastConsolidationRun': config.lastConsolidationRun = row.value; break;
    }
  }
  return config;
}

export function updateSchedulerConfig(updates: Partial<SchedulerConfig>): SchedulerConfig {
  const db = getDatabase();
  const now = new Date().toISOString();
  const current = getSchedulerConfig();
  const merged = { ...current, ...updates };

  const upsert = db.prepare(`
    INSERT INTO scheduler_config (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);

  const entries: [string, string][] = [
    ['dreamingEnabled', String(merged.dreamingEnabled)],
    ['dreamingCron', merged.dreamingCron],
    ['consolidationEnabled', String(merged.consolidationEnabled)],
    ['consolidationCron', merged.consolidationCron],
  ];

  if (updates.lastDreamRun !== undefined) entries.push(['lastDreamRun', merged.lastDreamRun || '']);
  if (updates.lastConsolidationRun !== undefined) entries.push(['lastConsolidationRun', merged.lastConsolidationRun || '']);

  const transaction = db.transaction(() => {
    for (const [key, value] of entries) {
      upsert.run(key, value, now);
    }
  });
  transaction();

  return merged;
}

let dreamTimer: ReturnType<typeof setTimeout> | null = null;
let consolidationTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextDream(): void {
  if (dreamTimer) clearTimeout(dreamTimer);
  const config = getSchedulerConfig();
  if (!config.dreamingEnabled) return;

  const delay = msUntilNextRun(config.dreamingCron);
  console.log(`[Scheduler] Next dream cycle in ${Math.round(delay / 60000)} minutes`);

  dreamTimer = setTimeout(async () => {
    try {
      console.log('[Scheduler] Running scheduled dream cycle...');
      const report = runDreamCycle();
      updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
      console.log(`[Scheduler] Dream cycle completed: ${report.promoted} memories promoted`);
    } catch (err) {
      console.error('[Scheduler] Dream cycle failed:', (err as Error).message);
    }
    scheduleNextDream();
  }, delay);
}

function scheduleNextConsolidation(): void {
  if (consolidationTimer) clearTimeout(consolidationTimer);
  const config = getSchedulerConfig();
  if (!config.consolidationEnabled) return;

  const delay = msUntilNextRun(config.consolidationCron);
  console.log(`[Scheduler] Next consolidation in ${Math.round(delay / 60000)} minutes`);

  consolidationTimer = setTimeout(async () => {
    try {
      console.log('[Scheduler] Running scheduled consolidation...');
      const plan = runAutoConsolidation();
      updateSchedulerConfig({ lastConsolidationRun: new Date().toISOString() });
      console.log(`[Scheduler] Consolidation completed: ${plan.actions.length} actions`);
    } catch (err) {
      console.error('[Scheduler] Consolidation failed:', (err as Error).message);
    }
    scheduleNextConsolidation();
  }, delay);
}

export function startScheduler(): void {
  const config = getSchedulerConfig();
  console.log(`[Scheduler] Starting scheduler (dreaming: ${config.dreamingEnabled}, consolidation: ${config.consolidationEnabled})`);
  scheduleNextDream();
  scheduleNextConsolidation();
}

export function restartScheduler(): void {
  console.log('[Scheduler] Restarting scheduler with updated config');
  scheduleNextDream();
  scheduleNextConsolidation();
}

export function stopScheduler(): void {
  if (dreamTimer) clearTimeout(dreamTimer);
  if (consolidationTimer) clearTimeout(consolidationTimer);
  dreamTimer = null;
  consolidationTimer = null;
  console.log('[Scheduler] Stopped');
}
