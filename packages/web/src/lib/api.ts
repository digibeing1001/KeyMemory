import type { AgentContextPack, AgentContextPackRequest, Memory, Layer, CreateMemoryInput, UpdateMemoryInput, HealthReport, Version, SearchResult, Project, ProjectSuggestion, LoopRun, LLMProviderConfig, LLMVerifyResult, MailThread, MailThreadDetail, MailThreadContext, MailThreadFolder, MailThreadKind, MailThreadStatus, MailMessage, MailMessageType, MailboxMigrationReport } from '@keymemory/shared';

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

export interface OrphanIssue {
  memoryId: string;
  title: string;
  content: string;
  layer: Layer;
  tags: string[];
  updatedAt: string;
  missing: Array<'entity' | 'tag' | 'relation' | 'mail_thread'>;
}

export async function listOrphanIssues(limit: number = 100): Promise<OrphanIssue[]> {
  return request(`/health/issues?type=orphan&limit=${limit}`);
}

export async function markOrphanIndependent(memoryId: string): Promise<{ success: boolean }> {
  return request(`/health/orphans/${memoryId}/independent`, { method: 'POST' });
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

export type MailboxFolder = MailThreadFolder | 'all' | 'starred' | 'snoozed' | 'sent' | 'drafts' | 'scheduled';

export interface MailboxStats {
  inbox: number;
  unread: number;
  starred: number;
  snoozed: number;
  sent: number;
  drafts: number;
  scheduled: number;
  archive: number;
  trash: number;
  all: number;
}

export async function listMailboxThreads(folder: MailboxFolder = 'inbox', query?: string): Promise<MailThread[]> {
  const sp = new URLSearchParams({ folder });
  if (query?.trim()) sp.set('q', query.trim());
  return request(`/mailbox/threads?${sp.toString()}`);
}

export async function getMailboxStats(): Promise<MailboxStats> {
  return request('/mailbox/stats');
}

export async function getMailboxMigration(): Promise<MailboxMigrationReport> {
  return request('/mailbox/migration');
}

export async function getMailboxThread(id: string): Promise<MailThreadDetail> {
  return request(`/mailbox/threads/${encodeURIComponent(id)}`);
}

export async function getMailboxThreadContext(id: string): Promise<MailThreadContext> {
  return request(`/mailbox/threads/${encodeURIComponent(id)}/context`);
}

export async function createMailboxThread(data: {
  subject: string;
  kind: MailThreadKind;
  body: string;
  memoryIds?: string[];
}): Promise<MailThreadDetail> {
  return request('/mailbox/threads', { method: 'POST', body: JSON.stringify(data) });
}

export async function updateMailboxThread(id: string, data: {
  subject?: string;
  status?: MailThreadStatus;
  folder?: MailThreadFolder;
  starred?: boolean;
  snoozedUntil?: string | null;
}): Promise<MailThread> {
  return request(`/mailbox/threads/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function replyMailboxThread(id: string, data: {
  body: string;
  messageType?: MailMessageType;
  memoryIds?: string[];
}): Promise<MailMessage> {
  return request(`/mailbox/threads/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ ...data, senderType: 'human' }),
  });
}

export async function linkMailboxMemory(threadId: string, memoryId: string): Promise<unknown> {
  return request(`/mailbox/threads/${encodeURIComponent(threadId)}/memories`, {
    method: 'POST',
    body: JSON.stringify({ memoryId, relationType: 'reference' }),
  });
}

export async function unlinkMailboxMemory(threadId: string, memoryId: string): Promise<{ success: boolean }> {
  return request(`/mailbox/threads/${encodeURIComponent(threadId)}/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' });
}

export async function syncMailboxThread(id: string): Promise<{ sent: boolean; message?: MailMessage }> {
  return request(`/mailbox/threads/${encodeURIComponent(id)}/sync`, { method: 'POST' });
}

export async function syncMailbox(): Promise<{ checked: number; sent: number; messageIds: string[]; createdThreads: number; linkedMemories: number; skipped: string[] }> {
  return request('/mailbox/sync', { method: 'POST' });
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
  summary?: string;
  layer: string;
  tags?: string[];
  project?: string;
  valley?: string;
  updatedAt?: string;
  mailThreadId?: string;
  relations?: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
  label?: string;
  strength?: number;
  direction?: 'outgoing' | 'incoming';
}

export interface MemoryGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  nodesCount?: number;
}

export async function getMemoryConnections(): Promise<MemoryGraphData> {
  return request('/graph/memory-connections');
}

export interface TagItem {
  name: string;
  count: number;
  layers?: Record<string, number>;
  lastUsedAt?: string;
  aliases?: string[];
}

export interface SuspectTagItem {
  name: string;
  count: number;
  reason: string;
}

export interface TagCloudData {
  tags: TagItem[];
  suspectTags: SuspectTagItem[];
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

export interface AgentIntegrationStatus {
  id: string;
  label: string;
  detected: boolean;
  connected: boolean;
  automatic: boolean;
  recommendedMode: AgentConnectMode;
  availableModes: AgentConnectMode[];
  evidence: string[];
  configPathHints: string[];
  snippet: string;
  notes: string[];
}

export type AgentConnectMode = 'mcp' | 'cli' | 'skill';

export interface AgentDiscoveryReport {
  scannedAt: string;
  projectRoot: string;
  detectedCount: number;
  connectedCount: number;
  agents: AgentIntegrationStatus[];
  operatingRules: string;
  onboardingPrompt: string;
}

export async function discoverAgentIntegrations(): Promise<AgentDiscoveryReport> {
  return request('/integrations/discover');
}

export interface AgentConnectResult {
  success: boolean;
  agentId: string;
  mode: AgentConnectMode;
  changed: boolean;
  files: string[];
  backups: string[];
  restartRequired: boolean;
  message: string;
}

export async function connectAgentIntegration(agentId: string, mode: AgentConnectMode | 'auto' = 'auto'): Promise<{ result: AgentConnectResult; report: AgentDiscoveryReport }> {
  return request(`/integrations/${encodeURIComponent(agentId)}/connect`, {
    method: 'POST',
    body: JSON.stringify({ confirm: true, mode }),
  });
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

// ===== LLM Provider Config =====
// 关联推理的配置入口。用户配置自己的 LLM API（OpenAI 兼容协议），
// 用于自动整理记忆时的关联推理。详见 core/llm-provider.ts 和 core/relation-reasoner.ts。

export async function getLLMConfig(): Promise<LLMProviderConfig | null> {
  return request('/llm/config');
}

export async function saveLLMConfig(data: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  enabled: boolean;
  availableModels?: string[];
}): Promise<LLMProviderConfig> {
  return request('/llm/config', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function clearLLMConfig(): Promise<{ success: boolean }> {
  return request('/llm/config', { method: 'DELETE' });
}

export async function verifyLLMConnection(data: {
  baseUrl: string;
  apiKey?: string;
}): Promise<LLMVerifyResult> {
  return request('/llm/verify', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function fetchLLMModels(baseUrl: string, apiKey?: string): Promise<{ models: string[] }> {
  // 复用 POST 检测接口，避免把 API Key 放进 URL、访问日志或浏览器历史。
  const result = await verifyLLMConnection({ baseUrl, apiKey });
  if (!result.ok) throw new Error(result.error || 'LLM connection failed');
  return { models: result.models };
}

export async function getLLMStatus(): Promise<{ available: boolean; config: LLMProviderConfig | null }> {
  return request('/llm/status');
}

// ===== Relation reasoning & project handoff status and manual triggers =====
// 让用户在 LLM 配置页直接看到关联推理和项目接龙的运行状态，并提供手动触发入口。

export interface RelationReasoningStats {
  totalScanned: number;
  totalRelations: number;
  lastScanAt?: string;
}

export interface RelationReasoningRunReport {
  scanned: number;
  relationsCreated: number;
  details: { memoryId: string; title: string; relationsCreated: number; latencyMs: number }[];
  skipped: string[];
  durationMs: number;
}

export interface ProjectHandoffStats {
  pending: number;
  injected: number;
  logged: number;
  total: number;
}

export interface ProjectHandoffRunReport {
  marked: number;
  details: { projectId: string; projectName: string; lastActivityAt: string; memoryCount: number }[];
  durationMs: number;
}

export async function getRelationReasoningStats(): Promise<RelationReasoningStats> {
  return request('/relation-reasoning/stats');
}

export async function runRelationReasoning(): Promise<RelationReasoningRunReport> {
  return request('/relation-reasoning/run', { method: 'POST', body: '{}' });
}

export async function getProjectHandoffStats(): Promise<ProjectHandoffStats> {
  return request('/project-handoff/stats');
}

export async function runProjectHandoff(): Promise<ProjectHandoffRunReport> {
  return request('/project-handoff/run', { method: 'POST', body: '{}' });
}
