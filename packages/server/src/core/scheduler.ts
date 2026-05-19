import { getDatabase } from '../db/sqlite.js';
import { runDreamCycle } from './dreaming.js';
import { DREAM_CONFIG } from '@keymemory/shared';

export interface SchedulerConfig {
  dreamingEnabled: boolean;
  dreamingCron: string;
  lastDreamRun: string | null;
}

const DEFAULT_CONFIG: SchedulerConfig = {
  dreamingEnabled: true,
  dreamingCron: DREAM_CONFIG.defaultCron,
  lastDreamRun: null,
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
      case 'lastDreamRun': config.lastDreamRun = row.value || null; break;
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
  ];

  if (updates.lastDreamRun !== undefined) entries.push(['lastDreamRun', merged.lastDreamRun || '']);

  const transaction = db.transaction(() => {
    for (const [key, value] of entries) {
      upsert.run(key, value, now);
    }
  });
  transaction();

  return merged;
}

let dreamTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleNextDream(): void {
  if (dreamTimer) clearTimeout(dreamTimer);
  const config = getSchedulerConfig();
  if (!config.dreamingEnabled) return;

  const delay = msUntilNextRun(config.dreamingCron);
  console.log(`[Scheduler] Next dream cycle in ${Math.round(delay / 60000)} minutes`);

  dreamTimer = setTimeout(() => {
    try {
      console.log('[Scheduler] Running scheduled dream cycle...');
      const report = runDreamCycle();
      updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
      console.log(`[Scheduler] Dream completed: ${report.promoted} promoted, ${report.archived} archived, ${report.merged} merged`);
    } catch (err) {
      console.error('[Scheduler] Dream cycle failed:', (err as Error).message);
    }
    scheduleNextDream();
  }, delay);
}

let signalHandlersRegistered = false;

export function startScheduler(): void {
  const config = getSchedulerConfig();
  console.log(`[Scheduler] Starting scheduler (dreaming: ${config.dreamingEnabled}, cron: ${config.dreamingCron})`);

  // 漏跑检测：如果今天还没运行过且已经过了运行时间，立即补跑一次
  if (config.dreamingEnabled && config.lastDreamRun) {
    const lastRun = new Date(config.lastDreamRun);
    const now = new Date();
    const { hour, minute } = parseCron(config.dreamingCron);

    const todayRunTime = new Date(now);
    todayRunTime.setHours(hour, minute, 0, 0);

    const lastRunDay = new Date(lastRun);
    lastRunDay.setHours(0, 0, 0, 0);
    const todayDay = new Date(now);
    todayDay.setHours(0, 0, 0, 0);

    // 如果今天已经过了运行时间，但上次运行不是今天，立即补跑
    if (now.getTime() > todayRunTime.getTime() && lastRunDay.getTime() < todayDay.getTime()) {
      console.log('[Scheduler] Detected missed dream cycle today, running now...');
      try {
        const report = runDreamCycle();
        updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
        console.log(`[Scheduler] Missed dream completed: ${report.promoted} promoted, ${report.archived} archived, ${report.merged} merged`);
      } catch (err) {
        console.error('[Scheduler] Missed dream cycle failed:', (err as Error).message);
      }
    }
  }

  scheduleNextDream();

  if (!signalHandlersRegistered) {
    process.on('SIGINT', stopScheduler);
    process.on('SIGTERM', stopScheduler);
    signalHandlersRegistered = true;
  }
}

export function restartScheduler(): void {
  console.log('[Scheduler] Restarting scheduler with updated config');
  scheduleNextDream();
}

export function stopScheduler(): void {
  if (dreamTimer) clearTimeout(dreamTimer);
  dreamTimer = null;
  console.log('[Scheduler] Stopped');
}
