import type { Memory, Layer, MemoryStatus } from '@keymemory/shared';

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
