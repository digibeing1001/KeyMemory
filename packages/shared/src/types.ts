export type Layer = 'flash' | 'short' | 'long' | 'entity';
export type MemoryStatus = 'active' | 'archived' | 'decayed' | 'deleted';
export type EntityType = 'person' | 'tool' | 'concept' | 'organization' | 'location' | 'event' | 'time' | 'project';
export type ChangeType = 'create' | 'update' | 'layer_move' | 'merge' | 'restore';
export type EvolutionTaskType = 'merge' | 'archive' | 'solidify' | 'conflict' | 'orphan';
export type IsolationMode = 'isolated' | 'shared' | 'hybrid' | 'project';
export type ForgetMethod = 'archive' | 'decay' | 'delete';
export type MemoryKind =
  | 'preference'
  | 'project_fact'
  | 'decision'
  | 'task'
  | 'procedure'
  | 'concept'
  | 'relationship'
  | 'event'
  | 'constraint'
  | 'raw_note'
  | 'project_journal';

export interface Project {
  id: string;
  parentId: string | null;
  name: string;
  description?: string;
  path: string;
  depth: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface Memory {
  id: string;
  title: string;
  content: string;
  layer: Layer;
  projectId: string;
  agentSpace: string;
  ownerAgentId?: string;
  confidence: number;
  hitCount: number;
  lastHitAt?: string;
  status: MemoryStatus;
  decayFactor: number;
  createdAt: string;
  updatedAt: string;
  entities?: Entity[];
  tags?: string[];
  source?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  strength: number;
  reason?: string;
  createdAt: string;
}

export interface Version {
  id: string;
  memoryId: string;
  version: number;
  title: string;
  content: string;
  changeType: ChangeType;
  changeReason?: string;
  createdAt: string;
}

export interface SelfCheckResult {
  projectRelevance: number;
  longTermValue: number;
  novelty: number;
  userEmphasis: number;
  reusability: number;
  total: number;
  action: 'auto_record' | 'suggest' | 'ignore';
}

export interface ProjectSuggestion {
  id: string;
  projectIds: string[];
  suggestedParentName: string;
  reason: string;
  confidence: number;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface ToolSecret {
  id: string;
  tool: string;
  name: string;
  valueHash: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt?: string;
}

export interface ToolSecretValue extends ToolSecret {
  value: string;
}

export interface EvolutionTask {
  id: string;
  taskType: EvolutionTaskType;
  sourceIds: string[];
  suggestion: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
  resolvedAt?: string;
}

export interface SearchResult {
  memory: Memory;
  score: number;
  matchType: 'fulltext' | 'semantic' | 'hybrid';
}

export interface HealthReport {
  score: number;
  duplicateCount: number;
  orphanCount: number;
  conflictCount: number;
  decayingCount: number;
  privacyRedactedCount: number;
  layerDistribution: Record<Layer, number>;
  /** 数据流动度明细：短期层 active 数量；为 0 说明短期层空转 */
  shortActive?: number;
  /** 待整理层 active 数量；为 0 说明新写入不进 flash */
  flashActive?: number;
  /** 长期层零命中记忆数；高则说明 long 只进不出 */
  longZeroHit?: number;
  /** 最近 10 次 dream 的总产出；0 说明 dream 空转 */
  dreamEffectiveness?: number;
  /** loop_runs 表运行数；0 说明从未作为 loop 上下文使用 */
  loopRuns?: number;
  /** 流动度评分（0-100） */
  flowScore?: number;
}

export interface CreateMemoryInput {
  title: string;
  content: string;
  /**
   * 记忆层级。可选——未指定时由 normalizeMemoryInput 依据内容与元数据推断：
   * 实体类→entity；偏好/规则/原则/决定→long；待办/临时→short；其余默认 short。
   * 不再以"长度>200"作为 long 兜底，避免大量长内容被误投到长期层。
   */
  layer?: Layer;
  projectId?: string;
  projectPath?: string;
  agentSpace?: string;
  ownerAgentId?: string;
  tags?: string[];
  source?: string;
  sourceId?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  layer?: Layer;
  projectId?: string;
  projectPath?: string;
  confidence?: number;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchQuery {
  q: string;
  layer?: Layer;
  projectId?: string;
  includeDescendants?: boolean;
  includeSuperseded?: boolean;
  memoryKind?: MemoryKind;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
}

export interface AgentContextPackRequest {
  query?: string;
  project?: string;
  projectId?: string;
  includeDescendants?: boolean;
  memoryKinds?: MemoryKind[];
  maxItems?: number;
  maxChars?: number;
  /**
   * 当前 agent 可见的 agent_space 集合（如 ['global', 'agent:foo']）。
   * 传入后 context pack 只检索/扩展这些空间内的记忆，防止跨 agent 私有空间泄露。
   * 未传时不做 agent_space 过滤（向后兼容）。
   */
  agentSpaces?: string[];
}

export interface AgentContextRelation {
  memoryId: string;
  title: string;
  relationType: string;
  direction: 'outgoing' | 'incoming';
  strength: number;
  reason?: string;
}

export interface AgentContextItem {
  id: string;
  title: string;
  content: string;
  layer: Layer;
  memoryKind: MemoryKind;
  projectId?: string;
  projectPath?: string;
  tags?: string[];
  source?: string;
  updatedAt: string;
  score: number;
  relations?: AgentContextRelation[];
}

export interface AgentContextSection {
  kind: MemoryKind;
  title: string;
  items: AgentContextItem[];
}

export interface AgentContextPack {
  query?: string;
  project?: string;
  projectId?: string;
  generatedAt: string;
  totalItems: number;
  usedChars: number;
  sections: AgentContextSection[];
  markdown: string;
}

export type LoopRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type LoopEventSeverity = 'debug' | 'info' | 'warn' | 'error';
/**
 * 单次 attempt 的结局分类：
 * 'success' | 'failure' | 'noop'
 * - success: 该 attempt 达成目标
 * - failure: 该 attempt 失败（触发 consecutive_failures 递增）
 * - noop: 该 attempt 无操作（early-exit / 空闲轮询）
 */
export type LoopAttemptOutcome = 'success' | 'failure' | 'noop';

export interface LoopRun {
  id: string;
  objective: string;
  projectId?: string;
  projectPath?: string;
  agentId: string;
  status: LoopRunStatus;
  checkpointVersion: number;
  lastEventSequence: number;
  traceId: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  metadata?: Record<string, unknown>;
  /** 单次 run 累计 token 硬上限（可选；对应 CircuitBreakerConfig.tokenBudget） */
  tokenBudget?: number;
  /** 累计已用 token（每个 checkpoint 的 tokenUsage 累加） */
  tokenUsed: number;
  /** 美元硬上限（可选；对应 loop-cost 的 suggested_daily_cap 概念） */
  costUsdBudget?: number;
  /** 累计已用美元 */
  costUsdUsed: number;
  /** 连续失败计数（达到 noProgressThreshold=5 触发 circuit breaker） */
  consecutiveFailures: number;
  /** 最后错误签名（达到 stagnationThreshold=3 触发 circuit breaker） */
  lastErrorSignature?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface LoopCheckpoint {
  id: string;
  runId: string;
  version: number;
  phase: string;
  summary: string;
  state: Record<string, unknown>;
  nextActions: string[];
  artifacts: string[];
  memoryRefs: string[];
  createdAt: string;
}

export interface LoopEvent {
  id: string;
  runId: string;
  sequence: number;
  eventName: string;
  severity: LoopEventSeverity;
  traceId: string;
  spanId?: string;
  body?: string;
  attributes: Record<string, unknown>;
  timestamp: string;
}

export interface LoopCursor {
  checkpointVersion: number;
  eventSequence: number;
}

export interface LoopHarnessError {
  code: string;
  message: string;
  retryable: boolean;
  expectedVersion?: number;
  actualVersion?: number;
}

export interface LoopObservation<T = unknown> {
  schemaVersion: 'keymemory.loop-observation.v1';
  status: 'success' | 'warning' | 'error';
  summary: string;
  nextActions: string[];
  artifacts: string[];
  data?: T;
  cursor?: LoopCursor;
  error?: LoopHarnessError;
}

export interface LoopRunStartRequest {
  objective: string;
  project?: string;
  projectId?: string;
  agentId: string;
  idempotencyKey: string;
  leaseOwner: string;
  leaseTtlSeconds?: number;
  query?: string;
  maxItems?: number;
  maxChars?: number;
  metadata?: Record<string, unknown>;
  /** 单次 run 累计 token 硬上限（可选；对应 CircuitBreakerConfig.tokenBudget） */
  tokenBudget?: number;
  /** 美元硬上限（可选） */
  costUsdBudget?: number;
}

export interface LoopContextRequest {
  runId: string;
  leaseOwner: string;
  renewLeaseSeconds?: number;
  query?: string;
  afterSequence?: number;
  maxEvents?: number;
  maxItems?: number;
  maxChars?: number;
}

export interface LoopCheckpointRequest {
  runId: string;
  expectedVersion: number;
  idempotencyKey: string;
  leaseOwner: string;
  leaseTtlSeconds?: number;
  phase: string;
  summary: string;
  state?: Record<string, unknown>;
  nextActions?: string[];
  artifacts?: string[];
  memoryRefs?: string[];
  status?: 'running' | 'waiting';
  eventName?: string;
  severity?: LoopEventSeverity;
  spanId?: string;
  /** 本次 attempt 消耗的 token 数（累加到 run 的 tokenUsed；对应 Attempt.tokensUsed） */
  tokenUsage?: number;
  /** 本次 attempt 的结局（对应 Attempt.outcome；'failure' 触发 consecutive_failures 递增） */
  attemptOutcome?: LoopAttemptOutcome;
  /** 失败时的错误信息（用于生成 errorSignature 做 stagnation 检测） */
  error?: string;
}

export interface LoopFinishRequest {
  runId: string;
  expectedVersion: number;
  idempotencyKey: string;
  leaseOwner: string;
  status: 'completed' | 'failed' | 'cancelled';
  summary: string;
  state?: Record<string, unknown>;
  artifacts?: string[];
  memoryRefs?: string[];
  spanId?: string;
  /** 本次 attempt 消耗的 token 数（累加到 run 的 tokenUsed） */
  tokenUsage?: number;
  /** 本次 attempt 的结局（'failure' 触发 consecutive_failures 递增） */
  attemptOutcome?: LoopAttemptOutcome;
  /** 失败时的错误信息（用于生成 errorSignature） */
  error?: string;
}

/**
 * Circuit breaker 状态快照。
 * 触发顺序 stagnation → no-progress → token-budget → max-iterations。
 * 仅在 triggered=true 时 reason/nextActions 有值；未触发时为 triggered=false。
 */
export interface LoopCircuitBreakerStatus {
  triggered: boolean;
  reason?: string;
  /** 触发时建议的升级/中止动作（来源 checkCircuitBreaker 返回的 nextActions） */
  nextActions: string[];
  /** 当前连续失败计数（consecutiveFailures，便于调用方做阈值判断） */
  consecutiveFailures: number;
  /** 当前累计 token / 预算（tokenUsed / tokenBudget）；tokenBudget 未设时为 undefined */
  tokenUsed: number;
  tokenBudget?: number;
  /** 当前 checkpoint 次数 / 上限（checkpointVersion / maxIterations=10） */
  checkpointVersion: number;
  maxIterations: number;
}

export interface LoopContextData {
  run: LoopRun;
  checkpoint: LoopCheckpoint;
  events: LoopEvent[];
  contextPack: AgentContextPack;
  contextFingerprint: string;
  /** Circuit breaker 评估结果。getLoopContext 总是返回，便于调用方判断是否应升级。 */
  circuitBreaker: LoopCircuitBreakerStatus;
}

export type ConsolidationActionType = 'merge' | 'deduplicate' | 'archive_stale' | 'archive_flash' | 'solidify';

export interface ConsolidationAction {
  id: string;
  type: ConsolidationActionType;
  sourceIds: string[];
  targetId?: string;
  description: string;
  status: 'pending' | 'executed' | 'rolled_back' | 'skipped';
}

export interface ConsolidationSnapshot {
  id: string;
  planId: string;
  memoryId: string;
  title: string;
  content: string;
  layer: Layer;
  status: MemoryStatus;
  tags?: string[];
  metadata?: Record<string, unknown>;
  projectId: string;
  agentSpace: string;
  confidence: number;
  decayFactor: number;
  capturedAt: string;
}

export interface ConsolidationPlan {
  id: string;
  actions: ConsolidationAction[];
  status: 'planned' | 'executing' | 'completed' | 'rolled_back' | 'partial_rollback';
  snapshotCount: number;
  createdAt: string;
  executedAt?: string;
  summary?: ConsolidationSummary;
}

export interface ConsolidationSummary {
  totalActions: number;
  merged: number;
  deduplicated: number;
  archivedStale: number;
  archivedFlash: number;
  solidified: number;
  skipped: number;
  memoriesBefore: number;
  memoriesAfter: number;
}

export type DreamPhase = 'light' | 'rem' | 'deep';

export interface DreamCandidate {
  memoryId: string;
  title: string;
  content: string;
  layer: Layer;
  tags: string[];
  hitCount: number;
  uniqueQueryCount: number;
  daysSinceCreation: number;
  score: number;
  signals: DreamSignals;
}

export interface DreamSignals {
  relevance: number;
  frequency: number;
  queryDiversity: number;
  recency: number;
  consolidation: number;
  conceptualRichness: number;
}

export interface DreamSession {
  id: string;
  phase: DreamPhase;
  candidatesProcessed: number;
  candidatesPromoted: number;
  signals: Record<string, number>;
  startedAt: string;
  completedAt?: string;
  summary?: string;
}

export interface DreamTodoItem {
  type: 'orphan' | 'conflict' | 'archive' | 'merge' | 'promote' | 'assign_project';
  memoryId: string;
  title: string;
  reason: string;
  description?: string;
  targetId?: string;
  confidence?: number;
  status?: 'pending' | 'auto_executed' | 'auto_execute_failed' | 'auto_resolved_stale' | 'confirmed' | 'rejected';
  autoExecutedAt?: string;
  autonomyLevel?: string;
  requiresNotification?: boolean;
}

export interface DreamReportDetails {
  promoted: { memoryId: string; title: string; score: number }[];
  archived: { memoryId: string; title: string; reason: string }[];
  merged: { memoryId: string; title: string; intoId: string; intoTitle: string }[];
  /** Phase 6: LLM 关联推理建立的演化关系 */
  relationReasoned?: { memoryId: string; title: string; relationsCreated: number }[];
  /** Phase 7: 标记为需要项目接龙注入的项目 */
  projectJournalInjected?: { projectId: string; projectName: string; lastActivityAt: string }[];
}

export interface DreamReport {
  id: string;
  sessions: DreamSession[];
  totalCandidates: number;
  promoted: number;
  archived: number;
  merged: number;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
  todoItems: DreamTodoItem[];
  details?: DreamReportDetails;
  /** Phase 6: LLM 关联推理建立的关系总数 */
  relationsReasoned?: number;
  /** Phase 7: 标记需要接龙注入的项目数 */
  projectJournalsInjected?: number;
}

/**
 * LLM Provider 配置（OpenAI 兼容协议）
 *
 * 存储在 tool_secrets 表（tool='llm-provider'），API key 加密保存。
 * 用户在 Web UI 填写 baseUrl + apiKey → 点检测 → 拉取模型列表 → 下拉选择 → 保存。
 */
export interface LLMProviderConfig {
  /** Base URL，如 https://api.openai.com/v1 或 http://localhost:11434/v1 */
  baseUrl: string;
  /** 选定的模型 ID，如 gpt-4o / qwen2.5:7b / deepseek-chat */
  model: string;
  /** 是否启用 LLM 关联推理（关闭则 Dream Phase 6 跳过） */
  enabled: boolean;
  /** 上次连通性检测通过的时间 */
  lastVerifiedAt?: string;
  /** 上次检测可用的模型列表（供下拉框使用） */
  availableModels?: string[];
}

/** LLM 连通性检测结果 */
export interface LLMVerifyResult {
  ok: boolean;
  models: string[];
  error?: string;
  latencyMs?: number;
}

/** LLM 推理请求 */
export interface LLMChatRequest {
  /** 系统提示词 */
  systemPrompt: string;
  /** 用户消息 */
  userMessage: string;
  /** 温度，关联推理用 0.1，项目日志总结用 0.3 */
  temperature?: number;
  /** 最大输出 token */
  maxTokens?: number;
}

/** LLM 推理响应 */
export interface LLMChatResponse {
  content: string;
  model: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
  latencyMs: number;
}

/**
 * LLM 关联推理单条判定结果。
 *
 * 强制 JSON 结构，禁止 LLM 自由发挥。
 * relation 必须是 5 个枚举值之一，evidence_quote 必须来自旧记忆原文。
 */
export interface LLMRelationJudgment {
  /** 候选旧记忆的 ID */
  target_id: string;
  /** 关系类型：extends 延伸 / reverses 反转 / reinforces 补强 / bridges 桥接 / none 无 */
  relation: 'extends' | 'reverses' | 'reinforces' | 'bridges' | 'none';
  /** 关系强度 0-1，低于 0.5 建议选 none */
  strength: number;
  /** 一句话说明为什么是这个关系（允许洞见，但必须基于证据） */
  reason: string;
  /** 从旧记忆原文摘的证据片段（不得改写或编造） */
  evidence_quote: string;
}

/** 一次关联推理的完整输出 */
export interface LLMRelationReasoningResult {
  /** 锚记忆 ID */
  anchorId: string;
  /** 对每条候选的判定 */
  judgments: LLMRelationJudgment[];
  /** LLM 推理耗时 ms */
  latencyMs: number;
  /** token 用量 */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

/**
 * 项目接龙注入状态。
 *
 * 当 Dream 检测到某项目近 N 天有记忆活动但缺少 project_journal 时，
 * 标记为 pending。agent 检索命中该项目记忆时，context-pack 注入写日志指令。
 * agent 写入 project_journal 后，状态转为 injected。
 */
export interface ProjectJournalInjection {
  id: string;
  projectId: string;
  /** pending: 待注入 / injected: 已注入指令 / logged: agent 已写入日志 */
  status: 'pending' | 'injected' | 'logged';
  /** 上次检测到项目有记忆活动的时间 */
  lastActivityAt: string;
  /** 注入指令发送时间 */
  injectedAt?: string;
  /** agent 写入的 project_journal 记忆 ID */
  journalMemoryId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoRememberResult {
  recorded: boolean;
  reason: string;
  memory?: Memory;
  evaluation?: SelfCheckResult;
  entities?: Entity[];
}
