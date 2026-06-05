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
  | 'raw_note';

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
}

export interface CreateMemoryInput {
  title: string;
  content: string;
  layer: Layer;
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
  type: 'orphan' | 'conflict';
  memoryId: string;
  title: string;
  reason: string;
}

export interface DreamReportDetails {
  promoted: { memoryId: string; title: string; score: number }[];
  archived: { memoryId: string; title: string; reason: string }[];
  merged: { memoryId: string; title: string; intoId: string; intoTitle: string }[];
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
}

export interface AutoRememberResult {
  recorded: boolean;
  reason: string;
  memory?: Memory;
  evaluation?: SelfCheckResult;
  entities?: Entity[];
}
