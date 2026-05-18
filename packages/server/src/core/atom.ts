import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { Memory, CreateMemoryInput, UpdateMemoryInput, Layer, MemoryStatus } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { rowToMemory } from '../db/mapper.js';

export function createMemory(input: CreateMemoryInput): Memory {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuid();

  const mem: Memory = {
    id,
    title: input.title,
    content: input.content,
    layer: input.layer,
    project: input.project,
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
      INSERT INTO memories (id, title, content, layer, project, agent_space, owner_agent_id, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, metadata, source, source_id)
      VALUES (@id, @title, @content, @layer, @project, @agentSpace, @ownerAgentId, @confidence, @hitCount, @status, @decayFactor, @createdAt, @updatedAt, @tags, @metadata, @source, @sourceId)
    `).run({
      id: mem.id,
      title: mem.title,
      content: mem.content,
      layer: mem.layer,
      project: mem.project ?? null,
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

    db.prepare(`
      INSERT INTO memories_fts (rowid, title, content, project)
      VALUES ((SELECT rowid FROM memories WHERE id = @id), @title, @content, @project)
    `).run({
      id: mem.id,
      title: mem.title,
      content: `${mem.content}${mem.tags && mem.tags.length > 0 ? ' ' + mem.tags.join(' ') : ''}`,
      project: mem.project ?? '',
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

    return mem;
  })();
}

export function getMemory(id: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToMemory(row);
}

export function listMemories(options?: { layer?: Layer; project?: string; status?: MemoryStatus; agentSpaces?: string[]; limit?: number; offset?: number }): Memory[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (options?.layer) {
    conditions.push('layer = @layer');
    params.layer = options.layer;
  }
  if (options?.project) {
    conditions.push('project = @project');
    params.project = options.project;
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
  if (input.project !== undefined) {
    updates.push('project = @project');
    params.project = input.project;
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

    if (input.title !== undefined || input.content !== undefined) {
      const updated = getMemory(id)!;
      db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(id);
      db.prepare(`
        INSERT INTO memories_fts (rowid, title, content, project)
        VALUES ((SELECT rowid FROM memories WHERE id = @id), @title, @content, @project)
      `).run({
        id,
        title: updated.title,
        content: `${updated.content}${updated.tags && updated.tags.length > 0 ? ' ' + updated.tags.join(' ') : ''}`,
        project: updated.project ?? '',
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

    return updated;
  })();
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
      db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    } else {
      db.prepare(`UPDATE memories SET status = 'deleted', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
    }
    return true;
  })();
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
