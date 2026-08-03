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

/**
 * KM-205：记忆策略单一真源。同一语义的阈值只允许在此定义一次，
 * 其余配置对象（EVOLUTION_THRESHOLDS / CONSOLIDATION_CONFIG / DREAM_CONFIG）
 * 中的重复项改为从这里派生，避免“行为取决于哪条代码路径先跑到”。
 */
export const MEMORY_POLICY = {
  /** 唯一固化阈值：short 层命中达此次数后候选固化。 */
  solidifyMinHits: 8,
  duplicateSimilarity: {
    /** 检出候选（去重扫描）。 */
    detect: 0.78,
    /** 建议合并（dream 提议）。 */
    suggest: 0.88,
    /** 自动合并（上调避免误合）。 */
    autoMerge: 0.92,
  },
  /** 乘性质量微调系数：score × (1 + factor × normalizedBoost)，normalizedBoost ∈ [0,1]。 */
  rankBoostFactor: 0.15,
  /** 共现边治理：最小共现次数、dream 周期衰减、剪枝阈值、扩展下限。 */
  coHitRelations: {
    minCoOccurrences: 3,
    dreamDecayFactor: 0.97,
    pruneBelow: 0.2,
    expandMinStrength: 0.5,
  },
  contextBudget: { maxTokens: 2000, hardMaxTokens: 8000 },
} as const;

export const EVOLUTION_THRESHOLDS = {
  flashUnsortedDays: 7,
  // KM-205：从 MEMORY_POLICY 派生，不再独立定义（原值 10 与固化真源 8 矛盾）。
  shortSolidifyHits: MEMORY_POLICY.solidifyMinHits,
  duplicateSimilarity: MEMORY_POLICY.duplicateSimilarity.autoMerge,
} as const;

/**
 * 衰减与反向降级配置
 *
 * 设计目的：把 forgetting.ts 中原本硬编码的衰减阈值集中到一处，
 * 便于后续调参与 A/B 测试，避免散落在 SQL 字符串里难以发现。
 *
 * - demoteLongDecayFactor：long 层 decay_factor 低于此值且 90 天未命中 → 降级到 short
 * - demoteLongDays：long 层降级到 short 的未命中天数
 * - demoteShortDecayFactor：short 层 decay_factor 低于此值且 30 天未命中 → 降级到 flash
 * - demoteShortDays：short 层降级到 flash 的未命中天数
 * - demotedResetDecayFactor：long→short 降级时重置 decay_factor 到此值（给 short 一个新起点）
 * - autoArchiveDecayFactor：decay_factor 低于或等于此值 → 自动标记为 decayed
 * - decayFloor：衰减下限（低于此值不再继续衰减，避免无限趋近 0）
 */
export const DECAY_CONFIG = {
  demoteLongDecayFactor: 0.3,
  demoteLongDays: 90,
  demoteShortDecayFactor: 0.2,
  demoteShortDays: 30,
  demotedResetDecayFactor: 0.5,
  autoArchiveDecayFactor: 0.01,
  decayFloor: 0.01,
} as const;

/**
 * 冲突检测词表（成对对立表述）
 *
 * 设计目的：统一 dreaming.ts 和 evolution.ts 的冲突检测逻辑，
 * 避免两处重复维护词表导致的不一致。
 *
 * 检测规则：同一实体下，若一条记忆命中 posSet 中的词，另一条命中 negSet 中的词，
 * 且两条记忆不同，则判定为潜在冲突。
 *
 * 与简单词表的区别：成对词表能识别"是 vs 不是"这种语义对立，
 * 而简单词表（如 ['不是', '错误']）只要出现就触发，误报率高。
 */
export const CONFLICT_PATTERNS: ReadonlyArray<readonly [readonly string[], readonly string[]]> = [
  [['喜欢', '喜爱', '爱'], ['讨厌', '厌恶', '恨', '不喜欢']],
  [['支持', '赞成', '同意'], ['反对', '否定', '拒绝', '不支持']],
  [['正确', '准确', '无误'], ['错误', '有误', '不正确']],
  [['开启', '打开', '启用'], ['关闭', '停用', '禁用']],
] as const;

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
  // KM-205：从 MEMORY_POLICY 派生，消除重复定义。
  duplicateSimilarity: MEMORY_POLICY.duplicateSimilarity.detect,
  staleDays: 60,
  flashMaxDays: LAYER_CONFIG.flash.decayDays,
  solidifyMinHits: MEMORY_POLICY.solidifyMinHits,
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
  // KM-205：从 MEMORY_POLICY 派生并上调（原 0.72/0.88 误合风险高）。
  semanticMergeThreshold: MEMORY_POLICY.duplicateSimilarity.suggest,
  semanticAutoMergeThreshold: MEMORY_POLICY.duplicateSimilarity.autoMerge,
  // 从 2000 降至 500：O(n²) 检测在 2000 条时需 ~2M 次比较（~200s 阻塞），
  // 500 条仅需 ~125K 次（~12s）。配合优先级排序确保最相关的记忆进入扫描窗口。
  // KM-204 将用近似 O(n log n) 方案替代，届时恢复至 2000。
  fullScanLimit: 500,
  // 快速梦境：仅扫描 flash+short 层（最需紧急清理），可高频运行。
  // 完整梦境扫描所有层，按 cron 低频运行。
  quickScanLimit: 200,
  quickIntervalHours: 4,
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

/**
 * 关联推理（LLM Relation Reasoning）配置
 *
 * 设计原则：
 * - 批量大小 = 未扫描存量（扫描所有未做过 LLM 推理的记忆）
 * - 不过分控制 token 成本
 * - 提示词要"有确认性，尽可能少自主发挥，但可以从中发现新的洞见"
 */
export const RELATION_REASONER_CONFIG = {
  /** 每条锚记忆的候选旧记忆数量（top-K，放大以保证召回） */
  topK: 12,
  /** 一次 Dream 周期最多处理多少条未扫描记忆（防止首次运行爆炸） */
  batchSize: 8,
  /** 语义相似度预筛阈值（低于此值不送 LLM，省 token 但不漏） */
  prefilterThreshold: 0.55,
  /** 关系强度阈值，低于此值的关系不建立 */
  minRelationStrength: 0.5,
  /** LLM 温度：关联推理要确定性，0.1 极低 */
  temperature: 0.1,
  /** LLM 最大输出 token */
  maxTokens: 2000,
  /** 请求超时 ms */
  timeoutMs: 30000,
} as const;

/**
 * 项目接龙（Project Handoff）注入配置
 *
 * 设计原则：
 * - 不是定时 LLM 生成日志，而是事件触发
 * - agent 接近项目记忆时，反向注入"请写日志"指令
 * - agent 自己写入 project_journal，形成跨会话接龙链
 */
export const PROJECT_JOURNAL_CONFIG = {
  /** 项目近 N 天有记忆活动但无 project_journal → 标记为待注入 */
  staleDays: 3,
  /** 一次 Dream 周期最多标记多少个项目（防止注入泛滥） */
  maxPendingPerCycle: 10,
  /** 注入指令在 context-pack 中的最大数量 */
  maxInjectionsInContext: 3,
  /** 注入指令冷却时间（小时），避免对同一项目重复注入 */
  injectionCooldownHours: 6,
} as const;

/** LLM Provider 默认配置（用户可在 Web UI 覆盖） */
export const LLM_PROVIDER_DEFAULTS = {
  /** 默认 Base URL（Ollama 本地） */
  defaultBaseUrl: 'http://localhost:11434/v1',
  /** 请求超时 ms */
  timeoutMs: 15000,
  /** 模型列表拉取路径 */
  modelsEndpoint: '/models',
  /** Chat 路径 */
  chatEndpoint: '/chat/completions',
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
