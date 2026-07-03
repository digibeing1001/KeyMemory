import type { Memory, Layer, MemoryStatus, LoopRun, LoopRunStatus } from '@keymemory/shared';

export function rowToMemory(row: Record<string, unknown>): Memory {
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    layer: row.layer as Layer,
    projectId: (row.project_id as string) || '',
    agentSpace: (row.agent_space as string) || 'global',
    ownerAgentId: (row.owner_agent_id as string) || undefined,
    confidence: row.confidence as number,
    hitCount: row.hit_count as number,
    lastHitAt: (row.last_hit_at as string) || undefined,
    status: row.status as MemoryStatus,
    decayFactor: row.decay_factor as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    tags: row.tags ? JSON.parse(row.tags as string) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
    source: (row.source as string) || undefined,
    sourceId: (row.source_id as string) || undefined,
  };
}

// 用于 UI 展示近期 loop 运行——把 loop_runs 表行映射成 LoopRun。
// 字段对齐 loop-harness.ts 的 rowToRun，但单独导出以便 rest.ts 直接用。
export function rowToLoopRunSummary(row: Record<string, unknown>): LoopRun {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try {
      const parsed = JSON.parse(row.metadata as string);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        metadata = parsed;
      }
    } catch {
      // metadata 损坏时忽略
    }
  }
  return {
    id: String(row.id),
    objective: String(row.objective ?? ''),
    projectId: row.project_id ? String(row.project_id) : undefined,
    projectPath: row.project_path ? String(row.project_path) : undefined,
    agentId: String(row.agent_id ?? ''),
    status: String(row.status ?? 'running') as LoopRunStatus,
    checkpointVersion: Number(row.checkpoint_version ?? 0),
    lastEventSequence: Number(row.last_event_sequence ?? 0),
    traceId: String(row.trace_id ?? ''),
    leaseOwner: String(row.lease_owner ?? ''),
    leaseExpiresAt: String(row.lease_expires_at ?? ''),
    metadata,
    tokenBudget: row.token_budget != null ? Number(row.token_budget) : undefined,
    tokenUsed: Number(row.token_used ?? 0),
    costUsdBudget: row.cost_usd_budget != null ? Number(row.cost_usd_budget) : undefined,
    costUsdUsed: Number(row.cost_usd_used ?? 0),
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    lastErrorSignature: row.last_error_signature ? String(row.last_error_signature) : undefined,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}
