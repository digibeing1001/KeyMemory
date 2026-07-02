import type { AgentContextPack, AgentContextPackRequest, Memory, Layer, CreateMemoryInput, UpdateMemoryInput, HealthReport, Version, SearchResult, Project, ProjectSuggestion, LoopRun } from '@keymemory/shared';

const BASE = '/api';
const API_KEY_STORAGE_KEY = 'keymemory_api_key';
const USER_TOKEN_STORAGE_KEY = 'keymemory_user_token';

export type UserRole = 'boss' | 'exec' | 'pm' | 'member' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isMainAccount: boolean;
  userStatus: string;
  companyId: string | null;
}

export interface ListedUser extends AuthUser {
  createdAt: string;
  updatedAt: string;
}

export class ApiUnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'ApiUnauthorizedError';
  }
}

export function getStoredApiKey(): string {
  return sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
}

export function setStoredApiKey(apiKey: string): void {
  const trimmed = apiKey.trim();
  if (trimmed) {
    sessionStorage.setItem(API_KEY_STORAGE_KEY, trimmed);
  } else {
    sessionStorage.removeItem(API_KEY_STORAGE_KEY);
  }
}

export function clearStoredApiKey(): void {
  sessionStorage.removeItem(API_KEY_STORAGE_KEY);
}

// === 用户 token（多用户鉴权）===
export function getUserToken(): string {
  return sessionStorage.getItem(USER_TOKEN_STORAGE_KEY) ?? '';
}

export function setUserToken(token: string): void {
  const trimmed = token.trim();
  if (trimmed) {
    sessionStorage.setItem(USER_TOKEN_STORAGE_KEY, trimmed);
  } else {
    sessionStorage.removeItem(USER_TOKEN_STORAGE_KEY);
  }
}

export function clearUserToken(): void {
  sessionStorage.removeItem(USER_TOKEN_STORAGE_KEY);
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  const isMutating = options?.method === 'POST' || options?.method === 'PUT' || options?.method === 'PATCH';
  const headers: Record<string, string> = (hasBody || isMutating) ? { 'Content-Type': 'application/json' } : {};
  // 优先使用用户 token；如无则回退到旧 API key（向后兼容）
  const userToken = getUserToken();
  if (userToken) {
    headers.Authorization = `Bearer ${userToken}`;
    headers['x-user-token'] = userToken;
  } else {
    const apiKey = getStoredApiKey();
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  }
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('keymemory:unauthorized'));
      throw new ApiUnauthorizedError(body.error || 'Unauthorized');
    }
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// === 鉴权 API ===
export interface AuthLoginResponse {
  token: string;
  expiresAt?: string;
  user: AuthUser;
}

export async function authLogin(email: string, password: string): Promise<AuthLoginResponse> {
  return request<AuthLoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

export async function authRegister(input: {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
}): Promise<AuthLoginResponse> {
  return request<AuthLoginResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function authLogout(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/auth/logout', { method: 'POST' });
}

export async function authMe(): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>('/auth/me');
}

export async function listUsers(): Promise<{ users: ListedUser[] }> {
  return request<{ users: ListedUser[] }>('/users');
}

export async function updateUserRole(id: string, role: UserRole): Promise<{ user: AuthUser }> {
  return request<{ user: AuthUser }>(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function getHealth(): Promise<HealthReport & { status: string; timestamp: string }> {
  return request('/health/report');
}

export async function listMemories(params?: {
  layer?: Layer;
  projectId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<Memory[]> {
  const sp = new URLSearchParams();
  if (params?.layer) sp.set('layer', params.layer);
  if (params?.projectId) sp.set('projectId', params.projectId);
  if (params?.status) sp.set('status', params.status);
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.offset) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return request(`/memories${qs ? `?${qs}` : ''}`);
}

export async function getMemory(id: string): Promise<Memory> {
  return request(`/memories/${id}`);
}

export async function createMemory(data: CreateMemoryInput): Promise<Memory> {
  return request('/memories', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMemory(id: string, data: UpdateMemoryInput): Promise<Memory> {
  return request(`/memories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function deleteMemory(id: string, permanent?: boolean): Promise<{ success: boolean }> {
  const qs = permanent ? '?permanent=true' : '';
  return request(`/memories/${id}${qs}`, { method: 'DELETE' });
}

export async function moveLayer(id: string, layer: Layer, reason?: string): Promise<Memory> {
  return request(`/memories/${id}/layer`, {
    method: 'PATCH',
    body: JSON.stringify({ layer, reason }),
  });
}

export async function searchMemories(query: string, layer?: Layer, projectId?: string, limit?: number): Promise<SearchResult[]> {
  const sp = new URLSearchParams();
  sp.set('q', query);
  if (layer) sp.set('layer', layer);
  if (projectId) sp.set('projectId', projectId);
  if (limit) sp.set('limit', String(limit));
  return request(`/memories/search?${sp.toString()}`);
}

export async function buildAgentContextPack(data: AgentContextPackRequest): Promise<AgentContextPack> {
  return request('/context/pack', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// 近期工作集：让 UI 能直接展示"哪些记忆被实际命中/最近被写入"，
// 而不是只看到长期层堆满了从未被用过的条目。这是把 KeyMemory 当作 loop
// 上下文集库时的核心观测入口。
export async function listRecentHitMemories(limit?: number): Promise<Memory[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return request(`/memories/recent-hits${qs}`);
}

export async function listRecentCreatedMemories(limit?: number): Promise<Memory[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return request(`/memories/recent-created${qs}`);
}

export async function listLoopRuns(limit?: number): Promise<LoopRun[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return request(`/loop/runs${qs}`);
}

export async function getVersions(memoryId: string): Promise<Version[]> {
  return request(`/versions/${memoryId}`);
}

export async function getLayerStats(): Promise<Record<Layer, { count: number; active: number }>> {
  return request('/layers/stats');
}

export async function listProjects(): Promise<Project[]> {
  return request('/projects');
}

export async function listProjectSuggestions(status?: ProjectSuggestion['status']): Promise<ProjectSuggestion[]> {
  const qs = status ? `?status=${status}` : '';
  return request(`/project-suggestions${qs}`);
}

export async function acceptProjectSuggestion(id: string, customName?: string): Promise<{ success: boolean; project?: Project; error?: string }> {
  return request(`/project-suggestions/${id}/accept`, {
    method: 'POST',
    body: JSON.stringify({ customName }),
  });
}

export async function rejectProjectSuggestion(id: string): Promise<{ success: boolean }> {
  return request(`/project-suggestions/${id}/reject`, { method: 'POST' });
}

export async function forgetMemory(id: string, method: 'archive' | 'decay' | 'delete' = 'archive'): Promise<{ success: boolean }> {
  return request(`/memories/${id}/forget`, {
    method: 'POST',
    body: JSON.stringify({ method }),
  });
}

export interface GraphNode {
  id: string;
  title: string;
  layer: string;
  tags?: string[];
  projectId?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
  label?: string;
}

export interface MemoryGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export async function getMemoryConnections(): Promise<MemoryGraphData> {
  return request('/graph/memory-connections');
}

export interface TagItem {
  name: string;
  count: number;
  layers?: Record<string, number>;
}

export interface TagCloudData {
  tags: TagItem[];
  projects: Array<{ name: string; count: number }>;
  totalMemories: number;
}

export async function getTagCloud(): Promise<TagCloudData> {
  return request('/graph/tag-cloud');
}

export interface AgentInfo {
  agentId: string;
  agentSpace: string;
  memoryCount: number;
}

export async function getAgents(): Promise<AgentInfo[]> {
  return request('/agents');
}

export interface DreamSession {
  id: string;
  phase: 'light' | 'rem' | 'deep';
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
  targetId?: string;
  description?: string;
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

export interface DreamSignalEntry {
  memoryId: string;
  title: string;
  score: number;
  promoted: boolean;
  signals: {
    relevance: number;
    frequency: number;
    queryDiversity: number;
    recency: number;
    consolidation: number;
    conceptualRichness: number;
  };
}

export interface SchedulerConfig {
  dreamingEnabled: boolean;
  dreamingCron: string;
  lastDreamRun: string | null;
  nextDreamRunAt?: string | null;
}

export async function runDream(): Promise<DreamReport> {
  return request('/dream/run', { method: 'POST' });
}

export async function listDreamReports(limit?: number): Promise<DreamReport[]> {
  const qs = limit ? `?limit=${limit}` : '';
  return request(`/dream/reports${qs}`);
}

export async function getDreamReport(reportId: string): Promise<DreamReport> {
  return request(`/dream/reports/${reportId}`);
}

export async function getDreamSignals(reportId: string): Promise<DreamSignalEntry[]> {
  return request(`/dream/reports/${reportId}/signals`);
}

export async function rollbackDream(reportId: string): Promise<DreamReport> {
  return request('/dream/rollback/' + reportId, { method: 'POST' });
}

export type ConflictAction = 'keep_memory' | 'keep_target' | 'merge_into_memory' | 'merge_into_target' | 'delete_memory' | 'delete_target';

export async function resolveConflict(memoryId: string, targetId: string, action: ConflictAction, mergeData?: { title?: string; content?: string; tags?: string[] }): Promise<{ success: boolean; keptId?: string; removedId?: string; message: string }> {
  return request('/dream/conflicts/resolve', {
    method: 'POST',
    body: JSON.stringify({ memoryId, targetId, action, ...mergeData }),
  });
}

export async function listRecycleBin(params?: { layer?: Layer; limit?: number; offset?: number }): Promise<Memory[]> {
  const sp = new URLSearchParams();
  if (params?.layer) sp.set('layer', params.layer);
  if (params?.limit) sp.set('limit', String(params.limit));
  if (params?.offset) sp.set('offset', String(params.offset));
  const qs = sp.toString();
  return request(`/recycle-bin${qs ? `?${qs}` : ''}`);
}

export async function restoreFromRecycleBin(id: string): Promise<Memory> {
  return request(`/recycle-bin/${id}/restore`, { method: 'POST' });
}

export async function permanentlyDeleteMemory(id: string): Promise<{ success: boolean }> {
  return request(`/recycle-bin/${id}`, { method: 'DELETE' });
}

export async function deleteDreamReport(reportId: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>('/dream/reports/' + reportId, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
}

export interface RelatedMemory {
  memoryId: string;
  title: string;
  layer: string;
  relationType: string;
  strength: number;
}

export async function getRelatedMemories(memoryId: string, type?: string): Promise<RelatedMemory[]> {
  const qs = type ? `?type=${type}` : '';
  return request(`/memories/${memoryId}/related${qs}`);
}

export async function relateMemory(memoryId: string, targetId: string, relationType: string, strength?: number): Promise<unknown> {
  return request(`/memories/${memoryId}/relate`, {
    method: 'POST',
    body: JSON.stringify({ targetId, relationType, strength }),
  });
}

export async function getTagNamespaces(): Promise<Record<string, string[]>> {
  return request('/tags/namespaces');
}

export async function getSchedulerConfig(): Promise<SchedulerConfig> {
  return request('/scheduler/config');
}

export async function updateSchedulerConfig(updates: Partial<SchedulerConfig>): Promise<SchedulerConfig> {
  return request('/scheduler/config', { method: 'POST', body: JSON.stringify(updates) });
}

export interface MigrationResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  files: number;
  projectPaths: string[];
  memoryKinds: Record<string, number>;
  errors: { item?: string; error: string }[];
  dreamReportId?: string;
  dryRun?: boolean;
  backup?: BackupSummary;
}

export interface BackupSummary {
  filePath?: string;
  bytes?: number;
  valid: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
  totalRows: number;
  includedTables: string[];
  omittedTables: string[];
}

export interface MigrationSourceCandidate {
  id: string;
  name: string;
  source: string;
  path: string;
  kind: 'file' | 'directory';
  format: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
  confidence: number;
  reason: string;
  defaultProjectPath?: string;
  fileCount?: number;
}

export async function importMemoryFile(data: {
  filePath: string;
  format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
  source?: string;
  defaultLayer?: Layer;
  defaultProjectPath?: string;
  runDream?: boolean;
  dryRun?: boolean;
  createBackupBeforeImport?: boolean;
}): Promise<MigrationResult> {
  return request('/migration/import-file', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function discoverMigrationSources(root?: string): Promise<MigrationSourceCandidate[]> {
  const sp = new URLSearchParams();
  if (root) sp.set('root', root);
  const qs = sp.toString();
  return request(`/migration/sources${qs ? `?${qs}` : ''}`);
}

export async function importMemoryPath(data: {
  path: string;
  format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
  source?: string;
  defaultLayer?: Layer;
  defaultProjectPath?: string;
  recursive?: boolean;
  maxFiles?: number;
  runDream?: boolean;
  dryRun?: boolean;
  createBackupBeforeImport?: boolean;
}): Promise<MigrationResult> {
  return request('/migration/import-path', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function importDiscoveredMemories(data: {
  root?: string;
  minConfidence?: number;
  defaultLayer?: Layer;
  defaultProjectPath?: string;
  maxFiles?: number;
  runDream?: boolean;
  dryRun?: boolean;
  createBackupBeforeImport?: boolean;
}): Promise<MigrationResult & { sources: MigrationSourceCandidate[] }> {
  return request('/migration/import-discovered', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
