import { getDatabase } from '../db/sqlite.js';
import { runDreamCycle, runDreamCycleAsync, autoResolveStaleTodos } from './dreaming.js';
import { runAutoConsolidation } from './consolidation.js';
import { DREAM_CONFIG, DREAM_AUTONOMY } from '@keymemory/shared';

export interface SchedulerConfig {
  dreamingEnabled: boolean;
  dreamingCron: string;
  lastDreamRun: string | null;
  nextDreamRunAt: string | null;
}

const DEFAULT_CONFIG: Omit<SchedulerConfig, 'nextDreamRunAt'> = {
  dreamingEnabled: true,
  dreamingCron: DREAM_CONFIG.defaultCron,
  lastDreamRun: null,
};

function parseCron(cron: string): { hour: number; minute: number } {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error('dreamingCron must be a daily 5-field cron: "M H * * *"');
  }
  if (parts[2] !== '*' || parts[3] !== '*' || parts[4] !== '*') {
    throw new Error('dreamingCron only supports daily schedules: day, month, and weekday must be "*"');
  }

  const minute = Number(parts[0]);
  const hour = Number(parts[1]);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('dreamingCron minute must be an integer from 0 to 59');
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new Error('dreamingCron hour must be an integer from 0 to 23');
  }
  return { hour, minute };
}

export function normalizeDreamCron(cron: string): string {
  const { hour, minute } = parseCron(cron);
  return `${minute} ${hour} * * *`;
}

export function getNextDreamRunAt(cron: string, from = new Date()): string {
  const { hour, minute } = parseCron(cron);
  const target = new Date(from);
  target.setHours(hour, minute, 0, 0);
  if (target.getTime() <= from.getTime()) target.setDate(target.getDate() + 1);
  return target.toISOString();
}

function msUntilNextRun(cron: string): number {
  return Math.max(1000, new Date(getNextDreamRunAt(cron)).getTime() - Date.now());
}

function attachNextRun(config: Omit<SchedulerConfig, 'nextDreamRunAt'>): SchedulerConfig {
  const dreamingCron = normalizeDreamCron(config.dreamingCron);
  return {
    ...config,
    dreamingCron,
    nextDreamRunAt: config.dreamingEnabled ? getNextDreamRunAt(dreamingCron) : null,
  };
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
  try {
    return attachNextRun(config);
  } catch {
    return attachNextRun({ ...config, dreamingCron: DEFAULT_CONFIG.dreamingCron });
  }
}

export function updateSchedulerConfig(updates: Partial<SchedulerConfig>): SchedulerConfig {
  const db = getDatabase();
  const now = new Date().toISOString();
  const current = getSchedulerConfig();
  const merged = { ...current, ...updates };
  if (updates.dreamingCron !== undefined) {
    merged.dreamingCron = normalizeDreamCron(String(updates.dreamingCron));
  }

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

  return attachNextRun({
    dreamingEnabled: merged.dreamingEnabled,
    dreamingCron: merged.dreamingCron,
    lastDreamRun: merged.lastDreamRun,
  });
}

let dreamTimer: ReturnType<typeof setTimeout> | null = null;
let quickDreamTimer: ReturnType<typeof setTimeout> | null = null;
let lastQuickDreamAt: number | null = null;
let staleTodoTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 调度器重入保护：避免 startScheduler 被多次调用导致多套定时器并行。
 * restartScheduler 不重置此标志，因为它只重排已有定时器。
 */
let schedulerStarted = false;

/**
 * Full Dream 互斥锁：full dream 涉及全库扫描 + O(n²) 合并 + LLM 关联推理，
 * 单次执行可能耗时数分钟。若上次 dream 未完成时下次触发时间已到，
 * 必须跳过本次执行，避免并发写 dream_reports 和重复整理同一批记忆。
 */
let dreamRunning = false;

function scheduleNextDream(): void {
  if (dreamTimer) clearTimeout(dreamTimer);
  const config = getSchedulerConfig();
  if (!config.dreamingEnabled) return;

  const delay = msUntilNextRun(config.dreamingCron);
  console.log(`[Scheduler] Next dream cycle in ${Math.round(delay / 60000)} minutes`);

  dreamTimer = setTimeout(async () => {
    // 互斥锁：上次 dream 仍在运行（耗时较长），跳过本次执行
    if (dreamRunning) {
      console.warn('[Scheduler] Previous dream still running, skipping this cycle');
      scheduleNextDream();
      return;
    }
    dreamRunning = true;
    try {
      console.log('[Scheduler] Running scheduled dream cycle...');
      const report = await runDreamCycleAsync();
      updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
      console.log(`[Scheduler] Dream completed: ${report.promoted} promoted, ${report.archived} archived, ${report.merged} merged, ${report.relationsReasoned ?? 0} relations reasoned`);
      // dream 完成后紧接执行 consolidation：让跨记忆的去重/归档/固化也有机会被定时跑，
      // 修复真实数据中 consolidation_plans 永远为 0 的问题。
      try {
        const plan = runAutoConsolidation();
        if (plan.actions.length > 0) {
          console.log(`[Scheduler] Consolidation plan ${plan.id.slice(0, 8)}: ${plan.actions.length} actions, status=${plan.status}`);
        }
      } catch (err) {
        console.error('[Scheduler] Consolidation failed:', (err as Error).message);
      }
    } catch (err) {
      console.error('[Scheduler] Dream cycle failed:', (err as Error).message);
    } finally {
      dreamRunning = false;
    }
    scheduleNextDream();
  }, delay);
}

/**
 * 快速梦境调度：高频运行 quickMode dream，仅清理 flash+short 层。
 *
 * 设计理由：full dream 扫描全库 + O(n²) 语义合并，只能低频运行（每日 cron）。
 * 但 flash 层记忆衰减快（14 天），如果只靠每日 full dream，flash 会堆积。
 * quick dream 跳过 Phase 4&5，扫描量小（quickScanLimit=200），可每 4 小时运行。
 *
 * 调度策略：
 * - 首次启动立即运行一次（清理可能积累的 flash 记忆）
 * - 之后每 quickIntervalHours 小时运行一次
 * - 不更新 lastDreamRun（那是 full dream 的专属字段）
 * - dreamingEnabled 关闭时一并禁用
 */
function scheduleNextQuickDream(): void {
  if (quickDreamTimer) clearTimeout(quickDreamTimer);
  const config = getSchedulerConfig();
  if (!config.dreamingEnabled) return;

  const intervalMs = DREAM_CONFIG.quickIntervalHours * 60 * 60 * 1000;
  let delay: number;
  if (lastQuickDreamAt === null) {
    // 首次启动：立即运行一次，清理可能积累的 flash 记忆
    delay = 0;
  } else {
    const elapsed = Date.now() - lastQuickDreamAt;
    delay = elapsed >= intervalMs ? 0 : intervalMs - elapsed;
  }

  console.log(`[Scheduler] Next quick dream in ${Math.round(delay / 60000)} minutes`);

  quickDreamTimer = setTimeout(() => {
    try {
      console.log('[Scheduler] Running quick dream cycle...');
      const report = runDreamCycle(true);
      lastQuickDreamAt = Date.now();
      console.log(`[Scheduler] Quick dream completed: ${report.promoted} promoted, ${report.archived} archived, ${report.merged} merged`);
    } catch (err) {
      console.error('[Scheduler] Quick dream cycle failed:', (err as Error).message);
    }
    scheduleNextQuickDream();
  }, delay);
}

/**
 * 启动过期待办自动处理的定时任务
 * 每隔 staleTodoTTLHours / 2 小时检查一次，自动处理超期待办
 */
function startStaleTodoResolution(): void {
  if (staleTodoTimer) clearInterval(staleTodoTimer);
  const intervalMs = Math.max(30 * 60 * 1000, (DREAM_AUTONOMY.staleTodoTTLHours / 2) * 60 * 60 * 1000);

  staleTodoTimer = setInterval(() => {
    try {
      const result = autoResolveStaleTodos();
      if (result.resolved > 0) {
        console.log(`[Scheduler] Auto-resolved ${result.resolved} stale todo items (${result.remaining} remaining)`);
      }
    } catch (err) {
      console.error('[Scheduler] Stale todo resolution failed:', (err as Error).message);
    }
  }, intervalMs);

  console.log(`[Scheduler] Stale todo auto-resolution enabled (interval: ${Math.round(intervalMs / 60000)} minutes)`);
}

let signalHandlersRegistered = false;

export async function startScheduler(): Promise<void> {
  // 重入保护：避免热重载或多次启动导致多套定时器并行
  if (schedulerStarted) {
    console.log('[Scheduler] Already started, skipping duplicate startScheduler call');
    return;
  }
  schedulerStarted = true;

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
    // 互斥锁保护：补跑也是 full dream
    if (now.getTime() > todayRunTime.getTime() && lastRunDay.getTime() < todayDay.getTime()) {
      console.log('[Scheduler] Detected missed dream cycle today, running now...');
      dreamRunning = true;
      try {
        const report = await runDreamCycleAsync();
        updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
        console.log(`[Scheduler] Missed dream completed: ${report.promoted} promoted, ${report.archived} archived, ${report.merged} merged, ${report.relationsReasoned ?? 0} relations reasoned`);
      } catch (err) {
        console.error('[Scheduler] Missed dream cycle failed:', (err as Error).message);
      } finally {
        dreamRunning = false;
      }
    }
  }

  scheduleNextDream();
  scheduleNextQuickDream();
  startStaleTodoResolution();

  if (!signalHandlersRegistered) {
    process.on('SIGINT', stopScheduler);
    process.on('SIGTERM', stopScheduler);
    signalHandlersRegistered = true;
  }
}

export function restartScheduler(): void {
  console.log('[Scheduler] Restarting scheduler with updated config');
  scheduleNextDream();
  scheduleNextQuickDream();
}

export function stopScheduler(): void {
  if (dreamTimer) clearTimeout(dreamTimer);
  dreamTimer = null;
  if (quickDreamTimer) clearTimeout(quickDreamTimer);
  quickDreamTimer = null;
  if (staleTodoTimer) clearInterval(staleTodoTimer);
  staleTodoTimer = null;
  // 重置标志，允许 stopScheduler 后重新 startScheduler（测试场景）
  schedulerStarted = false;
  dreamRunning = false;
  console.log('[Scheduler] Stopped');
}
