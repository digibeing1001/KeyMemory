import type { Memory, Layer, CreateMemoryInput, UpdateMemoryInput, HealthReport, Version, SearchResult } from '@keymemory/shared';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null;
  const isMutating = options?.method === 'POST' || options?.method === 'PUT' || options?.method === 'PATCH';
  const headers: Record<string, string> = (hasBody || isMutating) ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getHealth(): Promise<HealthReport & { status: string; timestamp: string }> {
  return request('/health/report');
}

export async function listMemories(params?: {
  layer?: Layer;
  project?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<Memory[]> {
  const sp = new URLSearchParams();
  if (params?.layer) sp.set('layer', params.layer);
  if (params?.project) sp.set('project', params.project);
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

export async function searchMemories(query: string, layer?: Layer, limit?: number): Promise<SearchResult[]> {
  const sp = new URLSearchParams();
  sp.set('q', query);
  if (layer) sp.set('layer', layer);
  if (limit) sp.set('limit', String(limit));
  return request(`/memories/search?${sp.toString()}`);
}

export async function getVersions(memoryId: string): Promise<Version[]> {
  return request(`/versions/${memoryId}`);
}

export async function getLayerStats(): Promise<Record<Layer, { count: number; active: number }>> {
  return request('/layers/stats');
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
  project?: string;
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
  console.log('[API] DELETE /dream/reports/' + reportId);
  const result = await request<{ success: boolean }>('/dream/reports/' + reportId, {
    method: 'DELETE',
    headers: { Accept: 'application/json' },
  });
  console.log('[API] Delete result:', result);
  return result;
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
