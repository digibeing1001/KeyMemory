import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { Memory, CreateMemoryInput, UpdateMemoryInput, Layer, MemoryStatus } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { rowToMemory } from '../db/mapper.js';
import { extractEntities, ensureEntity, linkMemoryEntity } from '../graph/entity.js';
import { ensureProjectPath } from './project.js';
import { extractProjectPathFromContent, normalizeMemoryInput, normalizeMemoryUpdate } from './memory-schema.js';
import { scheduleChunkAndEmbed, deleteChunks } from './chunking.js';

export function createMemory(input: CreateMemoryInput): Memory {
  const db = getDatabase();
  input = normalizeMemoryInput(input);
  const now = new Date().toISOString();
  const id = uuid();

  let projectId = input.projectId;
  const projectPath = input.projectPath || extractProjectPathFromContent(input.content);
  if (!projectId && projectPath) {
    projectId = ensureProjectPath(projectPath)?.id;
  }
  if (!projectId) {
    const rootProject = db.prepare("SELECT id FROM projects WHERE parent_id IS NULL LIMIT 1").get() as { id: string } | undefined;
    projectId = rootProject?.id ?? '';
  }

  const mem: Memory = {
    id,
    title: input.title,
    content: input.content,
    layer: input.layer,
    projectId,
    agentSpace: input.agentSpace ?? 'global',
    ownerAgentId: input.ownerAgentId,
    confidence: 1.0,
    hitCount: 0,
    status: 'active',
    decayFactor: 1.0,
    createdAt: now,
    updatedAt: now,
    tags: input.tags,
    metadata: input.metadata,
    source: input.source,
    sourceId: input.sourceId,
  };

  return db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, title, content, layer, project_id, agent_space, owner_agent_id, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, metadata, source, source_id)
      VALUES (@id, @title, @content, @layer, @projectId, @agentSpace, @ownerAgentId, @confidence, @hitCount, @status, @decayFactor, @createdAt, @updatedAt, @tags, @metadata, @source, @sourceId)
    `).run({
      id: mem.id,
      title: mem.title,
      content: mem.content,
      layer: mem.layer,
      projectId: mem.projectId,
      agentSpace: mem.agentSpace,
      ownerAgentId: mem.ownerAgentId ?? null,
      confidence: mem.confidence,
      hitCount: mem.hitCount,
      status: mem.status,
      decayFactor: mem.decayFactor,
      createdAt: mem.createdAt,
      updatedAt: mem.updatedAt,
      tags: mem.tags ? JSON.stringify(mem.tags) : null,
      metadata: mem.metadata ? JSON.stringify(mem.metadata) : null,
      source: mem.source ?? null,
      sourceId: mem.sourceId ?? null,
    });

    const projectName = mem.projectId ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(mem.projectId) as { name: string } | undefined)?.name || '' : '';
    db.prepare(`
      INSERT INTO memories_fts (rowid, title, content, project)
      VALUES ((SELECT rowid FROM memories WHERE id = @id), @title, @content, @project)
    `).run({
      id: mem.id,
      title: mem.title,
      content: `${mem.content}${mem.tags && mem.tags.length > 0 ? ' ' + mem.tags.join(' ') : ''}`,
      project: projectName,
    });

    db.prepare(`
      INSERT INTO versions (id, memory_id, version, title, content, change_type, change_reason, created_at)
      VALUES (@vid, @mid, 1, @title, @content, 'create', NULL, @createdAt)
    `).run({
      vid: uuid(),
      mid: mem.id,
      title: mem.title,
      content: mem.content,
      createdAt: now,
    });

    const entities = extractEntities(mem.content);
    for (const ext of entities) {
      const entity = ensureEntity(ext.name, ext.type);
      linkMemoryEntity(mem.id, entity.id, mem.projectId);
    }

    // 异步分块嵌入（不阻塞主流程）
    scheduleChunkAndEmbed(mem.id, mem.title, mem.content);

    return mem;
  })();
}

export function getMemory(id: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToMemory(row);
}

export function listMemories(options?: { layer?: Layer; projectId?: string; includeDescendants?: boolean; status?: MemoryStatus; agentSpaces?: string[]; limit?: number; offset?: number }): Memory[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (options?.layer) {
    conditions.push('layer = @layer');
    params.layer = options.layer;
  }
  if (options?.projectId) {
    params.projectId = options.projectId;
    if (options.includeDescendants) {
      conditions.push(`project_id IN (
        SELECT child.id
        FROM projects child
        JOIN projects root ON root.id = @projectId
        WHERE child.id = root.id OR child.path LIKE root.path || '/%'
      )`);
    } else {
      conditions.push('project_id = @projectId');
    }
  }
  if (options?.status) {
    conditions.push('status = @status');
    params.status = options.status;
  } else {
    conditions.push("status != 'deleted'");
  }
  if (options?.agentSpaces && options.agentSpaces.length > 0) {
    conditions.push(`agent_space IN (${options.agentSpaces.map((_, i) => `@agentSpace${i}`).join(', ')})`);
    options.agentSpaces.forEach((space, i) => {
      params[`agentSpace${i}`] = space;
    });
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db.prepare(`
    SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset }) as Record<string, unknown>[];

  return rows.map(rowToMemory);
}

export function updateMemory(id: string, input: UpdateMemoryInput, changeReason?: string): Memory | null {
  const db = getDatabase();
  const existing = getMemory(id);
  if (!existing) return null;
  input = normalizeMemoryUpdate(input, existing);

  const updates: string[] = [];
  const params: Record<string, unknown> = { id };

  if (input.title !== undefined) {
    updates.push('title = @title');
    params.title = input.title;
  }
  if (input.content !== undefined) {
    updates.push('content = @content');
    params.content = input.content;
  }
  if (input.layer !== undefined) {
    updates.push('layer = @layer');
    params.layer = input.layer;
  }
  const projectIdFromPath = input.projectPath !== undefined
    ? (input.projectPath.trim() ? ensureProjectPath(input.projectPath)?.id ?? '' : '')
    : undefined;
  const nextProjectId = input.projectId !== undefined ? input.projectId : projectIdFromPath;
  if (nextProjectId !== undefined) {
    updates.push('project_id = @projectId');
    params.projectId = nextProjectId;
  }
  if (input.confidence !== undefined) {
    updates.push('confidence = @confidence');
    params.confidence = input.confidence;
  }
  if (input.tags !== undefined) {
    updates.push('tags = @tags');
    params.tags = JSON.stringify(input.tags);
  }
  if (input.metadata !== undefined) {
    updates.push('metadata = @metadata');
    params.metadata = JSON.stringify(input.metadata);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = @updatedAt');
  params.updatedAt = new Date().toISOString();

  return db.transaction(() => {
    db.prepare(`UPDATE memories SET ${updates.join(', ')} WHERE id = @id`).run(params);

    if (input.title !== undefined || input.content !== undefined || input.tags !== undefined || nextProjectId !== undefined) {
      const afterUpdate = getMemory(id)!;
      const updatedProjectName = afterUpdate.projectId ? (db.prepare('SELECT name FROM projects WHERE id = ?').get(afterUpdate.projectId) as { name: string } | undefined)?.name || '' : '';
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`
        INSERT INTO memories_fts (rowid, title, content, project)
        VALUES ((SELECT rowid FROM memories WHERE id = @id), @title, @content, @project)
      `).run({
        id,
        title: afterUpdate.title,
        content: `${afterUpdate.content}${afterUpdate.tags && afterUpdate.tags.length > 0 ? ' ' + afterUpdate.tags.join(' ') : ''}`,
        project: updatedProjectName,
      });
    }

    const updated = getMemory(id)!;
    const versionCount = (db.prepare(`SELECT COUNT(*) as cnt FROM versions WHERE memory_id = ?`).get(id) as { cnt: number }).cnt;

    db.prepare(`
      INSERT INTO versions (id, memory_id, version, title, content, change_type, change_reason, created_at)
      VALUES (@vid, @mid, @version, @title, @content, @changeType, @changeReason, @createdAt)
    `).run({
      vid: uuid(),
      mid: id,
      version: versionCount + 1,
      title: updated.title,
      content: updated.content,
      changeType: input.layer !== undefined ? 'layer_move' : 'update',
      changeReason: changeReason ?? null,
      createdAt: new Date().toISOString(),
    });

    // 内容变化时重新分块嵌入
    if (input.content !== undefined || input.title !== undefined) {
      scheduleChunkAndEmbed(id, updated.title, updated.content);
    }

    return updated;
  })();
}

export function listVersions(memoryId: string): { id: string; version: number; title: string; changeType: string; changeReason: string | null; createdAt: string }[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT id, version, title, change_type, change_reason, created_at
    FROM versions
    WHERE memory_id = ?
    ORDER BY version DESC
  `).all(memoryId) as Record<string, unknown>[];

  return rows.map(r => ({
    id: r.id as string,
    version: r.version as number,
    title: r.title as string,
    changeType: r.change_type as string,
    changeReason: r.change_reason as string | null,
    createdAt: r.created_at as string,
  }));
}

export function getVersion(memoryId: string, version: number): { id: string; version: number; title: string; content: string; changeType: string; createdAt: string } | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, version, title, content, change_type, created_at
    FROM versions
    WHERE memory_id = ? AND version = ?
  `).get(memoryId, version) as Record<string, unknown> | undefined;

  if (!row) return null;

  return {
    id: row.id as string,
    version: row.version as number,
    title: row.title as string,
    content: row.content as string,
    changeType: row.change_type as string,
    createdAt: row.created_at as string,
  };
}

export function revertToVersion(memoryId: string, version: number, reason?: string): Memory | null {
  const db = getDatabase();
  const now = new Date().toISOString();

  const versionData = getVersion(memoryId, version);
  if (!versionData) return null;

  const current = getMemory(memoryId);
  if (!current) return null;

  return db.transaction(() => {
    db.prepare(`
      UPDATE memories
      SET title = @title, content = @content, updated_at = @now
      WHERE id = @id
    `).run({
      id: memoryId,
      title: versionData.title,
      content: versionData.content,
      now,
    });

    const versionCount = (db.prepare(`SELECT COUNT(*) as cnt FROM versions WHERE memory_id = ?`).get(memoryId) as { cnt: number }).cnt;

    db.prepare(`
      INSERT INTO versions (id, memory_id, version, title, content, change_type, change_reason, created_at)
      VALUES (@vid, @mid, @version, @title, @content, 'revert', @changeReason, @createdAt)
    `).run({
      vid: uuid(),
      mid: memoryId,
      version: versionCount + 1,
      title: versionData.title,
      content: versionData.content,
      changeReason: reason ?? `Reverted to version ${version}`,
      createdAt: now,
    });

    return getMemory(memoryId);
  })();
}

export function batchCreateMemories(inputs: CreateMemoryInput[]): { success: Memory[]; failed: { input: CreateMemoryInput; error: string }[] } {
  const success: Memory[] = [];
  const failed: { input: CreateMemoryInput; error: string }[] = [];

  for (const input of inputs) {
    try {
      const mem = createMemory(input);
      success.push(mem);
    } catch (err) {
      failed.push({ input, error: (err as Error).message });
    }
  }

  return { success, failed };
}

export function batchUpdateMemories(updates: { id: string; input: UpdateMemoryInput }[]): { success: Memory[]; failed: { id: string; error: string }[] } {
  const success: Memory[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const update of updates) {
    try {
      const mem = updateMemory(update.id, update.input);
      if (mem) {
        success.push(mem);
      } else {
        failed.push({ id: update.id, error: 'Memory not found' });
      }
    } catch (err) {
      failed.push({ id: update.id, error: (err as Error).message });
    }
  }

  return { success, failed };
}

export function batchDeleteMemories(ids: string[], permanent = false): { success: string[]; failed: { id: string; error: string }[] } {
  const success: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const id of ids) {
    try {
      const ok = deleteMemory(id, permanent);
      if (ok) {
        success.push(id);
      } else {
        failed.push({ id, error: 'Memory not found' });
      }
    } catch (err) {
      failed.push({ id, error: (err as Error).message });
    }
  }

  return { success, failed };
}

export function exportMemories(options?: { layer?: Layer; status?: MemoryStatus }): Memory[] {
  return listMemories(options);
}

export function exportMemoriesAsJson(options?: { layer?: Layer; status?: MemoryStatus }): string {
  const memories = listMemories(options);
  return JSON.stringify(memories, null, 2);
}

export function importMemories(jsonString: string): { success: number; failed: number } {
  let memories: Memory[];
  try {
    memories = JSON.parse(jsonString);
  } catch {
    return { success: 0, failed: 1 };
  }

  let success = 0;
  let failed = 0;

  for (const mem of memories) {
    try {
      createMemory({
        title: mem.title,
        content: mem.content,
        layer: mem.layer,
        projectId: mem.projectId,
        tags: mem.tags,
        metadata: mem.metadata,
        source: mem.source,
        sourceId: mem.sourceId,
        agentSpace: mem.agentSpace,
        ownerAgentId: mem.ownerAgentId,
      });
      success++;
    } catch {
      failed++;
    }
  }

  return { success, failed };
}

export function deleteMemory(id: string, permanent = false): boolean {
  const db = getDatabase();
  const existing = getMemory(id);
  if (!existing) return false;

  return db.transaction(() => {
    if (permanent) {
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`DELETE FROM versions WHERE memory_id = ?`).run(id);
      db.prepare(`DELETE FROM memory_entities WHERE memory_id = ?`).run(id);
      db.prepare(`DELETE FROM embeddings WHERE memory_id = ?`).run(id);
      deleteChunks(id);
      db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    } else {
      db.prepare(`UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
    }
    return true;
  })();
}

export function listRecycleBin(options?: { layer?: Layer; limit?: number; offset?: number }): Memory[] {
  const db = getDatabase();
  const conditions: string[] = ["status != 'active'"];
  const params: Record<string, unknown> = {};

  if (options?.layer) {
    conditions.push('layer = @layer');
    params.layer = options.layer;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db.prepare(`
    SELECT * FROM memories ${where} ORDER BY updated_at DESC LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset }) as Record<string, unknown>[];

  return rows.map(rowToMemory);
}

export function restoreFromRecycleBin(id: string): Memory | null {
  const db = getDatabase();
  const existing = getMemory(id);
  if (!existing || existing.status === 'active') return null;

  const now = new Date().toISOString();
  db.prepare(`UPDATE memories SET status = 'active', decay_factor = 1.0, updated_at = ? WHERE id = ?`).run(now, id);
  return getMemory(id);
}

export function permanentlyDeleteMemory(id: string): boolean {
  return deleteMemory(id, true);
}

export function recordHit(id: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  
  const row = db.prepare('SELECT decay_factor FROM memories WHERE id = ?').get(id) as { decay_factor: number } | undefined;
  if (!row) return;
  
  const newDecayFactor = Math.min(1.0, row.decay_factor * 1.2);
  
  db.prepare(`
    UPDATE memories 
    SET hit_count = hit_count + 1, 
        last_hit_at = @now, 
        updated_at = @now,
        decay_factor = @decayFactor
    WHERE id = @id
  `).run({ id, now, decayFactor: newDecayFactor });
}
