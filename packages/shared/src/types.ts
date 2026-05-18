export type Layer = 'flash' | 'short' | 'long' | 'project' | 'entity';
export type MemoryStatus = 'active' | 'archived' | 'decayed' | 'deleted';
export type EntityType = 'person' | 'tool' | 'concept' | 'organization' | 'location' | 'event' | 'time' | 'project';
export type ChangeType = 'create' | 'update' | 'layer_move' | 'merge' | 'restore';
export type EvolutionTaskType = 'merge' | 'archive' | 'solidify' | 'conflict' | 'orphan';
export type IsolationMode = 'isolated' | 'shared' | 'hybrid' | 'project';
export type ForgetMethod = 'archive' | 'decay' | 'delete';

export interface Memory {
  id: string;
  title: string;
  content: string;
  layer: Layer;
  project?: string;
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
  layerDistribution: Record<Layer, number>;
}

export interface CreateMemoryInput {
  title: string;
  content: string;
  layer: Layer;
  project?: string;
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
  project?: string;
  confidence?: number;
  tags?: string[];
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface SearchQuery {
  q: string;
  layer?: Layer;
  project?: string;
  status?: MemoryStatus;
  limit?: number;
  offset?: number;
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
  project?: string;
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

export interface AutoRememberResult {
  recorded: boolean;
  reason: string;
  memory?: Memory;
  evaluation?: SelfCheckResult;
  entities?: Entity[];
}
