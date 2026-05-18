import type { Layer } from './types.js';

export const LAYERS: Layer[] = ['flash', 'short', 'long', 'project', 'entity'];

export const LAYER_CONFIG: Record<Layer, { label: string; color: string; decayDays: number; decayRate: number }> = {
  flash: { label: '闪念', color: '#f59e0b', decayDays: 7, decayRate: 0.9 },
  short: { label: '短期', color: '#3b82f6', decayDays: 30, decayRate: 0.95 },
  long: { label: '长期', color: '#10b981', decayDays: Infinity, decayRate: 1.0 },
  project: { label: '项目', color: '#8b5cf6', decayDays: Infinity, decayRate: 1.0 },
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
  duplicateSimilarity: 0.85,
  staleDays: 60,
  flashMaxDays: 14,
  solidifyMinHits: 8,
  maxActionsPerPlan: 50,
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
  lightJaccardThreshold: 0.9,
  lookbackDays: 7,
  recencyHalfLifeDays: 30,
} as const;

export const DREAM_CONFIG = {
  defaultCron: '0 3 * * *',
  minIntervalHours: 4,
  minSessionsBeforeDream: 3,
} as const;

export const DEFAULT_PORT = 3210;
export const DEFAULT_HOST = '0.0.0.0';
export const DATA_DIR_NAME = '.keymemory';
export const DB_NAME = 'data.db';
