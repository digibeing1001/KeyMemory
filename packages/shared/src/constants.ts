import type { Layer } from './types.js';

export const LAYERS: Layer[] = ['flash', 'short', 'long', 'entity'];

export const LAYER_CONFIG: Record<Layer, { label: string; color: string; decayDays: number; decayRate: number }> = {
  // flash 衰减率由 0.9 调到 0.95、窗口由 7 天扩到 14 天，避免刚写入即被衰减死
  flash: { label: '待整理', color: '#f59e0b', decayDays: 14, decayRate: 0.95 },
  // short 衰减率由 0.95 调到 0.98、窗口由 30 天扩到 60 天，给 dream 整理留时间
  short: { label: '近期有用', color: '#3b82f6', decayDays: 60, decayRate: 0.98 },
  // long 不再 Infinity：180 天未命中的内容每次衰减 1%，配合反向降级让 long 不再只进不出
  long: { label: '长期保留', color: '#10b981', decayDays: 180, decayRate: 0.99 },
  // entity 仍保持 Infinity：实体由显式合并/删除管理，不参与时间衰减
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

/**
 * 通用/无指向性项目名黑名单。
 * 这些词没有明确的项目指向（如 dev、test、tmp、src、notes、工作、学习），
 * 不应被当作独立项目创建或参与项目聚类建议。
 *
 * 判定原则：一个能被称为"项目"的名字，应当指向一个具体的产品/事项/交付物
 * （如 "KeyMemory"、"订单中台"、"Q3 财报"），而非一个目录、状态、类别或动作。
 */
export const GENERIC_PROJECT_NAMES: ReadonlySet<string> = new Set([
  // 中文通用名
  '未分类', '工作', '学习', '笔记', '临时', '杂项', '其他', '其它', '默认', '全部', '所有',
  '日常', '琐事', '事项', '内容', '资料', '文档', '记录', '想法', '灵感', '待办', '任务',
  // 英文通用名（含常见目录/占位名）
  'uncategorized', 'unclassified', 'default', 'general', 'global', 'misc', 'miscellaneous',
  'migrated', 'memory', 'memories', 'notes', 'note', 'temp', 'tmp', 'test', 'tests', 'testing',
  'dev', 'devel', 'develop', 'development', 'src', 'source', 'lib', 'libs', 'bin', 'build',
  'docs', 'doc', 'work', 'works', 'study', 'learning', 'learn', 'projects', 'project',
  'stuff', 'things', 'other', 'others', 'all', 'inbox', 'draft', 'drafts', 'archive', 'archived',
]);

/**
 * 判断一个项目名是否"有明确指向性"（非通用名）。
 * 中文要求 >= 2 字且不在黑名单；英文要求 >= 4 字且不在黑名单。
 */
export function isSpecificProjectName(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || GENERIC_PROJECT_NAMES.has(normalized)) return false;
  if (/[\u3400-\u9fff]/u.test(normalized)) return normalized.length >= 2;
  return normalized.length >= 4;
}
