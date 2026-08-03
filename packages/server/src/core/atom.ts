import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { Memory, CreateMemoryInput, UpdateMemoryInput, Layer, MemoryStatus, EntityType } from '@keymemory/shared';
import { getDatabase, isDatabaseInitialized } from '../db/sqlite.js';
import { rowToMemory } from '../db/mapper.js';
import { extractEntities, ensureEntity, linkMemoryEntity, processContent, autoAssociate } from '../graph/entity.js';
import { normalizeMemoryInput, normalizeMemoryUpdate } from './memory-schema.js';
import { scheduleChunkAndEmbed, deleteChunks } from './chunking.js';
import { removeFromFts, insertIntoFts, refreshFts } from './fts-helpers.js';
import { invalidateEmbeddingCache } from './embedding-cache.js';
import { resolveAsOf } from './temporal.js';

function isClosedDatabaseError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('Database not initialized') || message.includes('database is not open');
}

export function createMemory(input: CreateMemoryInput): Memory {
  // ownerUserId 不在 shared 类型中（避免 shared 包感知多用户概念），此处通过扩展字段读取。
  // 未传时为 undefined，写入 NULL（向后兼容单用户/旧数据）。
  const ownerUserId = (input as CreateMemoryInput & { ownerUserId?: string }).ownerUserId;
  const db = getDatabase();
  input = normalizeMemoryInput(input);
  const now = new Date().toISOString();
  const id = uuid();

  let projectId = input.projectId;
  if (!projectId) {
    // 邮箱线程已经替代层层项目文件夹。原子记忆默认回到共享记忆池，
    // projectPath 仅保留在 metadata 中作为来源线索，不再自动创建目录。
    const rootProject = db.prepare("SELECT id FROM projects WHERE parent_id IS NULL AND name = '未分类' ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
    projectId = rootProject?.id ?? '';
  }

  const mem: Memory = {
    id,
    title: input.title,
    content: input.content,
    // normalizeMemoryInput 已保证 layer 非空；此处再兜底 short，防止绕过 normalize 的路径
    layer: input.layer ?? 'short',
    projectId,
    agentSpace: input.agentSpace ?? 'global',
    ownerAgentId: input.ownerAgentId,
    confidence: input.confidence ?? 1.0,
    hitCount: 0,
    status: 'active',
    decayFactor: 1.0,
    validFrom: input.validFrom!,
    validTo: input.validTo,
    createdAt: now,
    updatedAt: now,
    tags: input.tags,
    metadata: input.metadata,
    source: input.source,
    sourceId: input.sourceId,
  };

  return db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, title, content, layer, project_id, agent_space, owner_agent_id, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, metadata, source, source_id, owner_user_id)
      VALUES (@id, @title, @content, @layer, @projectId, @agentSpace, @ownerAgentId, @confidence, @hitCount, @status, @decayFactor, @createdAt, @updatedAt, @tags, @metadata, @source, @sourceId, @ownerUserId)
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
      ownerUserId: ownerUserId ?? null,
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
    // 兜底：如果正则提取不到任何实体，用标题作 concept 实体，确保每条记忆至少有一个实体关联，可被实体聚合/冲突检测/压缩等流程覆盖
    if (entities.length === 0 && mem.title && mem.title.trim().length >= 2) {
      const fallbackName = mem.title.trim().slice(0, 60);
      const entity = ensureEntity(fallbackName, 'concept');
      linkMemoryEntity(mem.id, entity.id, mem.projectId);
    }

    // 异步分块嵌入（不阻塞主流程）—— 传入 tags/metadata 作为全局前缀，与 ensureEmbedding 保持一致
    scheduleChunkAndEmbed(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined);

    // 异步后处理：整记忆向量 + 自动关联（不阻塞主流程）
    // 所有 createMemory 调用路径（REST/MCP/CLI/adapter/batch/import）自动获得完整处理链。
    // 历史问题：后处理散落在各调用点手动维护，新增入口必然遗漏（三个 adapter 全缺、
    // batchCreate/importMemories 全缺、CLI create 缺 autoAssociate）。内聚到此处一劳永逸。
    setImmediate(async () => {
      if (!isDatabaseInitialized()) return;
      try {
        const { ensureEmbedding } = await import('./query.js');
        await ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined);
        // embedding 就绪后建立自动关联（实体共现 + 语义相似度）
        await autoAssociate(mem.id);
      } catch (err) {
        if (isClosedDatabaseError(err)) return;
        console.error(`[CreateMemory] Post-process failed for ${mem.id}:`, (err as Error).message);
      }
    });

    // 项目接龙自动完成：当 agent 写入 kind:project_journal 记忆时，标记该项目注入为 logged
    // 设计目的：agent 接到接龙指令后写入日志，系统自动闭环注入状态，避免重复注入
    if (mem.projectId && mem.tags?.some(t => t === 'kind:project_journal')) {
      setImmediate(async () => {
        if (!isDatabaseInitialized()) return;
        try {
          const { markJournalLogged } = await import('./project-journal.js');
          const ok = markJournalLogged(mem.projectId!, mem.id);
          if (ok) {
            console.error(`[CreateMemory] Project journal handoff completed for project ${mem.projectId} (memory ${mem.id})`);
          }
        } catch (err) {
          if (isClosedDatabaseError(err)) return;
          console.error(`[CreateMemory] markJournalLogged failed for project ${mem.projectId}:`, (err as Error).message);
        }
      });
    }

    return mem;
  })();
}

export function getMemory(id: string): Memory | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToMemory(row);
}

export interface ListMemoriesOptions {
  layer?: Layer;
  projectId?: string;
  includeDescendants?: boolean;
  status?: MemoryStatus;
  agentSpaces?: string[];
  limit?: number;
  offset?: number;
  tags?: string[];
  tagsMatch?: 'any' | 'all';
  entityId?: string;
  entityName?: string;
  entityType?: EntityType;
  source?: string;
  minConfidence?: number;
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  lastHitAfter?: string;
  lastHitBefore?: string;
  asOf?: string;
  includeExpired?: boolean;
}

export function listMemories(options?: ListMemoriesOptions): Memory[] {
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

  // 标签过滤：与 query.ts addSearchFilters 保持一致，json_each 精确匹配 + json_valid 保护
  if (options?.tags && options.tags.length > 0) {
    const matchMode = options.tagsMatch ?? 'any';
    const tagClauses = options.tags.map((tag, i) => {
      const paramName = `tag${i}`;
      params[paramName] = tag;
      return `EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = @${paramName})`;
    });
    const connector = matchMode === 'all' ? ' AND ' : ' OR ';
    conditions.push(`(tags IS NOT NULL AND json_valid(tags) AND (${tagClauses.join(connector)}))`);
  }

  // 实体过滤：entityId 优先；否则 entityName/entityType 组合（AND 语义）
  // entityName 同时匹配 entity.name 和 entity_aliases.alias，确保别名实体也能被检索到
  if (options?.entityId) {
    params.entityId = options.entityId;
    conditions.push(`EXISTS (
      SELECT 1 FROM memory_entities me
      WHERE me.memory_id = memories.id AND me.entity_id = @entityId
    )`);
  } else if (options?.entityName || options?.entityType) {
    const entityConds: string[] = [];
    if (options.entityName) {
      params.entityName = options.entityName;
      entityConds.push('(e.name = @entityName OR EXISTS (SELECT 1 FROM entity_aliases ea WHERE ea.entity_id = e.id AND ea.alias = @entityName))');
    }
    if (options.entityType) {
      params.entityType = options.entityType;
      entityConds.push('e.type = @entityType');
    }
    conditions.push(`EXISTS (
      SELECT 1 FROM memory_entities me
      JOIN entities e ON e.id = me.entity_id
      WHERE me.memory_id = memories.id AND ${entityConds.join(' AND ')}
    )`);
  }

  if (options?.source) {
    conditions.push('source = @source');
    params.source = options.source;
  }

  if (typeof options?.minConfidence === 'number') {
    conditions.push('confidence >= @minConfidence');
    params.minConfidence = options.minConfidence;
  }

  if (options?.createdAfter) {
    conditions.push('created_at >= @createdAfter');
    params.createdAfter = options.createdAfter;
  }
  if (options?.createdBefore) {
    conditions.push('created_at <= @createdBefore');
    params.createdBefore = options.createdBefore;
  }
  if (options?.updatedAfter) {
    conditions.push('updated_at >= @updatedAfter');
    params.updatedAfter = options.updatedAfter;
  }
  if (options?.updatedBefore) {
    conditions.push('updated_at <= @updatedBefore');
    params.updatedBefore = options.updatedBefore;
  }
  if (options?.lastHitAfter) {
    conditions.push('last_hit_at IS NOT NULL AND last_hit_at >= @lastHitAfter');
    params.lastHitAfter = options.lastHitAfter;
  }
  if (options?.lastHitBefore) {
    conditions.push('last_hit_at IS NOT NULL AND last_hit_at <= @lastHitBefore');
    params.lastHitBefore = options.lastHitBefore;
  }

  // listMemories also serves the owner-facing dashboard, which needs to audit
  // expired facts. Temporal filtering is therefore explicit here; agent-facing
  // MCP/context callers pass includeExpired=false by default.
  if (options?.asOf || options?.includeExpired === false) {
    params.asOf = resolveAsOf(options.asOf);
    const validFrom = "COALESCE(CASE WHEN metadata IS NOT NULL AND json_valid(metadata) THEN json_extract(metadata, '$.validFrom') END, created_at)";
    const validTo = "CASE WHEN metadata IS NOT NULL AND json_valid(metadata) THEN json_extract(metadata, '$.validTo') END";
    conditions.push(`${validFrom} <= @asOf AND (${validTo} IS NULL OR ${validTo} > @asOf)`);
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
  // projectPath 不再创建或移动文件夹。显式 projectId 仍作为内部兼容范围可用。
  const nextProjectId = input.projectId;
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
  if (input.source !== undefined) {
    updates.push('source = @source');
    params.source = input.source;
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

    // 内容/标签/元数据变化时重新分块嵌入 + 刷新实体链接 + 重建关联
    // ensureEmbedding 的嵌入文本包含 title + content + tags + metadata，任一变化都需刷新
    if (input.content !== undefined || input.title !== undefined || input.tags !== undefined || input.metadata !== undefined) {
      scheduleChunkAndEmbed(id, updated.title, updated.content, updated.tags, updated.metadata as Record<string, unknown> | undefined);
      // 异步刷新整记忆向量 + 实体链接 + 关联（不阻塞主流程）
      // 历史问题：updateMemory 从不刷新实体链接和关联，用户改了 content 后旧实体仍挂着、
      // 新实体不会被提取、关联不会重建。此处统一修复所有 updateMemory 调用路径。
      setImmediate(async () => {
        if (!isDatabaseInitialized()) return;
        try {
          // content 变化时刷新实体链接（INSERT OR IGNORE 幂等，保留旧实体链接避免失去关联）
          if (input.content !== undefined) {
            processContent(id, input.content);
          }
          // 刷新整记忆向量（force=true）
          const { ensureEmbedding } = await import('./query.js');
          await ensureEmbedding(id, updated.title, updated.content, updated.tags, updated.metadata as Record<string, unknown> | undefined, true);
          // 重建关联（基于新实体共现 + 新 embedding 语义相似度）
          await autoAssociate(id);
        } catch (err) {
          if (isClosedDatabaseError(err)) return;
          console.error(`[UpdateMemory] Post-process failed for ${id}:`, (err as Error).message);
        }
      });
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

    // 版本回退后刷新 FTS 索引，确保搜索到的是回退后的内容
    refreshFts(db, memoryId);

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
      invalidateEmbeddingCache(id);
      db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    } else {
      // 软删除时也必须从 FTS 索引中移除，否则已删除的记忆仍会被全文搜索命中
      removeFromFts(db, id);
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
  // 事务保护：UPDATE 状态 + 重建 FTS 索引必须原子性
  // 之前无事务，UPDATE 成功但 insertIntoFts 失败时，记忆已 active 但全文搜索永久不可见
  db.transaction(() => {
    db.prepare(`UPDATE memories SET status = 'active', decay_factor = 1.0, updated_at = ? WHERE id = ?`).run(now, id);
    // 恢复后必须重建 FTS 索引，否则恢复的记忆无法被全文搜索到
    insertIntoFts(db, id);
  })();
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

/**
 * 更新记忆的 confidence 值，范围限制在 [0.1, 1.0]。
 * 非关键操作，失败只记录日志不抛异常。
 */
export function updateMemoryConfidence(id: string, newConfidence: number): void {
  try {
    const db = getDatabase();
    const clamped = Math.max(0.1, Math.min(1.0, newConfidence));
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE memories SET confidence = @confidence, updated_at = @now WHERE id = @id
    `).run({ id, confidence: clamped, now });
  } catch (err) {
    console.error(`[atom] updateMemoryConfidence failed for ${id} (non-fatal):`, (err as Error).message);
  }
}

/**
 * 记录记忆使用反馈（Agent 或用户显式标记）。
 * - 'useful'：confidence +0.02（上限 1.0）
 * - 'not_useful'：confidence -0.05（下限 0.1）
 */
export function recordMemoryFeedback(memoryId: string, feedback: 'useful' | 'not_useful'): void {
  const memory = getMemory(memoryId);
  if (!memory) return;

  const currentConfidence = memory.confidence ?? 0.8;
  let newConfidence: number;

  if (feedback === 'useful') {
    newConfidence = Math.min(1.0, currentConfidence + 0.02);
  } else {
    newConfidence = Math.max(0.1, currentConfidence - 0.05);
  }

  updateMemoryConfidence(memoryId, newConfidence);
}
