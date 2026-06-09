import type { Layer } from './types.js';

export const LAYERS: Layer[] = ['flash', 'short', 'long', 'entity'];

export const LAYER_CONFIG: Record<Layer, { label: string; color: string; decayDays: number; decayRate: number }> = {
  flash: { label: '待整理', color: '#f59e0b', decayDays: 7, decayRate: 0.9 },
  short: { label: '近期有用', color: '#3b82f6', decayDays: 30, decayRate: 0.95 },
  long: { label: '长期保留', color: '#10b981', decayDays: Infinity, decayRate: 1.0 },
  entity: { label: '人事物', color: '#ec4899', decayDays: Infinity, decayRate: 1.0 },
};

export const SELFCHECK_WEIGHTS = {
  projectRelevance: 0.3,
  longTermValue: 0.3,
  novelty: 0.2,
  userEmphasis: 0.1,
  reusability: 0.1,
} as const;

export const SELFCHECK_THRESHOLDS = {
  autoRecord: 0.75,
  suggest: 0.60,
} as const;

export const EVOLUTION_THRESHOLDS = {
  flashUnsortedDays: 7,
  shortSolidifyHits: 10,
  duplicateSimilarity: 0.9,
} as const;

export const SEARCH_WEIGHTS = {
  fulltext: 0.5,
  semantic: 0.5,
} as const;

export const SEARCH_CONFIG = {
  rrfK: 60,
  cacheTtlMinutes: 5,
  maxCacheEntries: 100,
} as const;

export const CONSOLIDATION_CONFIG = {
  duplicateSimilarity: 0.78,
  staleDays: 60,
  flashMaxDays: 14,
  solidifyMinHits: 8,
  maxActionsPerPlan: 100,
} as const;

export const DREAM_SIGNAL_WEIGHTS = {
  relevance: 0.30,
  frequency: 0.24,
  queryDiversity: 0.15,
  recency: 0.15,
  consolidation: 0.10,
  conceptualRichness: 0.06,
} as const;

export const DREAM_THRESHOLDS = {
  minScore: 0.8,
  minRecallCount: 3,
  minUniqueQueries: 3,
  lightJaccardThreshold: 0.65,
  lookbackDays: 30,
  recencyHalfLifeDays: 30,
  textSimilarityThreshold: 0.65,
  titleSimilarityThreshold: 0.72,
} as const;

export const DREAM_CONFIG = {
  defaultCron: '0 3 * * *',
  minIntervalHours: 4,
  minSessionsBeforeDream: 3,
  semanticMergeThreshold: 0.72,
  semanticAutoMergeThreshold: 0.88,
  fullScanLimit: 2000,
} as const;

/**
 * 梦境自治配置：控制 Dream 在无用户干预时的自动执行策略
 *
 * 三级自治：
 * - auto_execute: 高置信度，自动执行，仅记录日志
 * - auto_execute_with_note: 中置信度，自动执行，下次 Agent 对话时通知
 * - defer: 低置信度，等待用户确认
 */
export const DREAM_AUTONOMY = {
  /** 置信度高于此值 → 自动执行（静默） */
  autoExecuteConfidence: 0.85,
  /** 置信度高于此值 → 自动执行 + Agent 通知 */
  autoExecuteWithNoteConfidence: 0.72,
  /** 低于 autoExecuteWithNoteConfidence → 等待用户确认 */
  /** 待办项超过此天数未处理 → 自动以安全默认值处理 */
  staleTodoTTLHours: 72,
  /** 安全默认操作：archive（保守）而非 delete */
  staleDefaultAction: 'archive' as const,
  /** Agent 上下文中最多注入多少条待确认项 */
  maxTodosInContext: 5,
} as const;

export const DEFAULT_PORT = 3210;
export const DEFAULT_HOST = '127.0.0.1';
export const DATA_DIR_NAME = '.keymemory';
export const DB_NAME = 'data.db';
