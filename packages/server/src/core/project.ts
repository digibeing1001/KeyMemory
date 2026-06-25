import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { Project, ProjectSuggestion } from '@keymemory/shared';
import { isSpecificProjectName } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';

export function createProject(input: {
  name: string;
  parentId?: string | null;
  description?: string;
  metadata?: Record<string, unknown>;
}): Project {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuid();

  let path = input.name;
  let depth = 0;

  if (input.parentId) {
    const parent = db.prepare('SELECT path, depth FROM projects WHERE id = ?').get(input.parentId) as { path: string; depth: number } | undefined;
    if (parent) {
      path = `${parent.path}/${input.name}`;
      depth = parent.depth + 1;
    }
  }

  db.prepare(`
    INSERT INTO projects (id, parent_id, name, description, path, depth, created_at, updated_at, metadata)
    VALUES (@id, @parentId, @name, @description, @path, @depth, @createdAt, @updatedAt, @metadata)
  `).run({
    id,
    parentId: input.parentId ?? null,
    name: input.name,
    description: input.description ?? null,
    path,
    depth,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
  });

  return {
    id,
    parentId: input.parentId ?? null,
    name: input.name,
    description: input.description,
    path,
    depth,
    createdAt: now,
    updatedAt: now,
    metadata: input.metadata,
  };
}

export function getProject(id: string): Project | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return rowToProject(row);
}

export function listProjects(parentId?: string | null): Project[] {
  const db = getDatabase();
  let rows: Record<string, unknown>[];

  if (parentId === undefined) {
    rows = db.prepare('SELECT * FROM projects ORDER BY path').all() as Record<string, unknown>[];
  } else {
    rows = db.prepare('SELECT * FROM projects WHERE parent_id IS ? ORDER BY path').all(parentId) as Record<string, unknown>[];
  }

  return rows.map(rowToProject);
}

export function listProjectTree(): Project[] {
  return listProjects();
}

export function normalizeProjectPath(pathLike: string): string[] {
  // 修复路径切碎：真实数据中 "Node（pnpm/npm/yarn）" 被切成多段，
  // URL "http://172.24.127.251:5173/" 中的 :// 也被误切。
  // 处理顺序：
  //   1) 剥离 URL/IP/端口（含 http://、https://、ftp://、IP:port）—— 它们不是项目名
  //   2) 剥离 [[ ]] 标记
  //   3) 去掉中英文括号及其内部内容（"Node（pnpm/npm/yarn）" → "Node"），
  //      避免括号内的并列项被当作独立路径段
  //   4) 按分隔符切分（/、\、>、::、->、→、›、＞、／）
  //   5) 清理每段两侧空白与残留标点，过滤空段
  return pathLike
    .replace(/https?:\/\/[^\s\/]+(?:\/[^\s]*)?/gi, ' ')
    .replace(/ftp:\/\/[^\s]+/gi, ' ')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(?::\d+)?\b/g, ' ')
    .replace(/\[\[|\]\]/g, '')
    .replace(/[（(][^（）()]*[）)]/g, ' ')
    .split(/[\/\\>]+|::|->|→|›|＞|／/u)
    .map(part => part.trim().replace(/^[:：·]+|[:：·]+$/g, '').trim())
    .filter(Boolean);
}

export function ensureProjectPath(pathLike: string, rootParentId: string | null = null): Project | null {
  const parts = normalizeProjectPath(pathLike);
  if (parts.length === 0) return null;

  // 根级项目（单段、无父级）必须是具体名字，过滤 dev/test/notes 等无指向性通用名；
  // 子项目（多段或有 rootParentId 提供上下文）允许通用名作叶子，如 Legacy/Default
  if (parts.length === 1 && rootParentId === null && !isSpecificProjectName(parts[0])) return null;

  const db = getDatabase();
  let parentId = rootParentId;
  let current: Project | null = null;

  return db.transaction(() => {
    for (const name of parts) {
      const row = db.prepare(`
        SELECT * FROM projects
        WHERE name = @name AND parent_id IS @parentId
        LIMIT 1
      `).get({ name, parentId }) as Record<string, unknown> | undefined;

      current = row ? rowToProject(row) : createProject({
        name,
        parentId,
        metadata: { createdBy: 'auto-project-routing' },
      });
      parentId = current.id;
    }

    return current;
  })();
}

export function resolveProjectRef(projectRef: string): Project | null {
  return findProjectRef(projectRef) ?? ensureProjectPath(projectRef);
}

export function findProjectRef(projectRef: string): Project | null {
  const db = getDatabase();
  const exact = db.prepare(`
    SELECT * FROM projects WHERE id = @ref OR path = @ref OR name = @ref
    ORDER BY CASE WHEN id = @ref THEN 0 WHEN path = @ref THEN 1 ELSE 2 END
    LIMIT 1
  `).get({ ref: projectRef }) as Record<string, unknown> | undefined;
  if (exact) return rowToProject(exact);
  return null;
}

export function getProjectPath(id: string): string[] {
  const db = getDatabase();
  const row = db.prepare('SELECT path FROM projects WHERE id = ?').get(id) as { path: string } | undefined;
  if (!row) return [];
  return row.path.split('/');
}

export function getProjectDescendants(id: string): Project[] {
  const db = getDatabase();
  const project = getProject(id);
  if (!project) return [];

  const rows = db.prepare(`
    SELECT * FROM projects WHERE path LIKE @pathPattern AND id != @id ORDER BY path
  `).all({ pathPattern: `${project.path}/%`, id }) as Record<string, unknown>[];

  return rows.map(rowToProject);
}

export function updateProject(
  id: string,
  input: { name?: string; description?: string; metadata?: Record<string, unknown> }
): Project | null {
  const db = getDatabase();
  const existing = getProject(id);
  if (!existing) return null;

  const updates: string[] = [];
  const params: Record<string, unknown> = { id };

  if (input.name !== undefined && input.name !== existing.name) {
    updates.push('name = @name');
    params.name = input.name;

    // Cascade update path for this project and all descendants
    const oldPathPrefix = existing.path;
    const newPathPrefix = existing.parentId
      ? `${getProjectPath(existing.parentId).join('/')}/${input.name}`
      : input.name;

    db.prepare(`
      UPDATE projects
      SET path = @newPathPrefix || SUBSTR(path, LENGTH(@oldPathPrefix) + 1)
      WHERE path = @oldPathPrefix OR path LIKE @oldPathPattern
    `).run({
      newPathPrefix,
      oldPathPrefix,
      oldPathPattern: `${oldPathPrefix}/%`,
    });
  }

  if (input.description !== undefined) {
    updates.push('description = @description');
    params.description = input.description;
  }

  if (input.metadata !== undefined) {
    updates.push('metadata = @metadata');
    params.metadata = JSON.stringify(input.metadata);
  }

  if (updates.length === 0) return existing;

  updates.push('updated_at = @updatedAt');
  params.updatedAt = new Date().toISOString();

  db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = @id`).run(params);

  return getProject(id);
}

export function moveProject(id: string, newParentId: string | null): Project | null {
  const db = getDatabase();
  const existing = getProject(id);
  if (!existing) return null;

  // Prevent moving a project to itself or its descendants
  if (newParentId) {
    if (newParentId === id) return null;
    const descendants = getProjectDescendants(id);
    if (descendants.some(d => d.id === newParentId)) return null;
  }

  const newParent = newParentId ? getProject(newParentId) : null;
  const newPath = newParent ? `${newParent.path}/${existing.name}` : existing.name;
  const newDepth = newParent ? newParent.depth + 1 : 0;

  const oldPathPrefix = existing.path;
  const depthDelta = newDepth - existing.depth;

  // Fetch descendants BEFORE transaction to avoid path mismatch
  const descendants = getProjectDescendants(id);

  db.transaction(() => {
    // Update this project's parent, path, and depth
    db.prepare(`
      UPDATE projects SET parent_id = @parentId, path = @path, depth = @depth, updated_at = @updatedAt WHERE id = @id
    `).run({
      id,
      parentId: newParentId,
      path: newPath,
      depth: newDepth,
      updatedAt: new Date().toISOString(),
    });

    // Update all descendants' paths and depths
    for (const desc of descendants) {
      const relativePath = desc.path.slice(oldPathPrefix.length);
      const updatedPath = newPath + relativePath;
      db.prepare(`
        UPDATE projects SET path = @path, depth = depth + @depthDelta WHERE id = @id
      `).run({
        id: desc.id,
        path: updatedPath,
        depthDelta,
      });
    }
  })();

  return getProject(id);
}

export function deleteProject(id: string, strategy: 'cascade' | 'promote' = 'cascade'): boolean {
  const db = getDatabase();
  const existing = getProject(id);
  if (!existing) return false;

  // Prevent deletion of the root uncategorized project
  if (existing.parentId === null && existing.name === '未分类') {
    console.error('[Project] Cannot delete root uncategorized project');
    return false;
  }

  // For promote strategy, move children BEFORE the delete transaction
  // to avoid nested transaction issues with moveProject
  if (strategy === 'promote') {
    const children = listProjects(id);
    for (const child of children) {
      const ok = moveProject(child.id, existing.parentId);
      if (!ok) {
        console.error(`[Project] Failed to move child project ${child.id} during delete`);
        return false;
      }
    }
  }

  return db.transaction(() => {
    if (strategy === 'cascade') {
      // Cascade: find all descendant projects and delete their memories first
      const allProjectIds = [id, ...getProjectDescendants(id).map(d => d.id)];
      for (const pid of allProjectIds) {
        // Delete related records for each memory in this project
        db.prepare(`DELETE FROM memories_fts WHERE rowid IN (SELECT rowid FROM memories WHERE project_id = ?)`).run(pid);
        db.prepare(`DELETE FROM versions WHERE memory_id IN (SELECT id FROM memories WHERE project_id = ?)`).run(pid);
        db.prepare(`DELETE FROM memory_entities WHERE memory_id IN (SELECT id FROM memories WHERE project_id = ?)`).run(pid);
        db.prepare(`DELETE FROM embeddings WHERE memory_id IN (SELECT id FROM memories WHERE project_id = ?)`).run(pid);
        db.prepare(`DELETE FROM dream_signals WHERE memory_id IN (SELECT id FROM memories WHERE project_id = ?)`).run(pid);
        db.prepare(`DELETE FROM query_logs WHERE memory_id IN (SELECT id FROM memories WHERE project_id = ?)`).run(pid);
        db.prepare(`DELETE FROM memories WHERE project_id = ?`).run(pid);
      }
      // Delete descendant projects (children first, then deeper)
      const descendants = getProjectDescendants(id);
      for (const desc of descendants.reverse()) {
        db.prepare('DELETE FROM projects WHERE id = ?').run(desc.id);
      }
    }

    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    return true;
  })();
}

export function getProjectMemories(
  projectId: string,
  options?: { layer?: string; includeDescendants?: boolean; limit?: number; offset?: number }
): { id: string; title: string; layer: string; status: string; createdAt: string }[] {
  const db = getDatabase();
  const project = getProject(projectId);
  if (!project) return [];

  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (options?.includeDescendants) {
    conditions.push('(p.path = @path OR p.path LIKE @pathPattern)');
    params.path = project.path;
    params.pathPattern = `${project.path}/%`;
  } else {
    conditions.push('m.project_id = @projectId');
    params.projectId = projectId;
  }

  if (options?.layer) {
    conditions.push('m.layer = @layer');
    params.layer = options.layer;
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = options?.limit ?? 50;
  const offset = options?.offset ?? 0;

  const rows = db.prepare(`
    SELECT m.id, m.title, m.layer, m.status, m.created_at
    FROM memories m
    JOIN projects p ON m.project_id = p.id
    ${where}
    ORDER BY m.updated_at DESC
    LIMIT @limit OFFSET @offset
  `).all({ ...params, limit, offset }) as Record<string, unknown>[];

  return rows.map(r => ({
    id: r.id as string,
    title: r.title as string,
    layer: r.layer as string,
    status: r.status as string,
    createdAt: r.created_at as string,
  }));
}

export function listProjectSuggestions(status?: 'pending' | 'accepted' | 'rejected'): ProjectSuggestion[] {
  const db = getDatabase();
  let rows: Record<string, unknown>[];

  if (status) {
    rows = db.prepare('SELECT * FROM project_suggestions WHERE status = ? ORDER BY created_at DESC').all(status) as Record<string, unknown>[];
  } else {
    rows = db.prepare('SELECT * FROM project_suggestions ORDER BY created_at DESC').all() as Record<string, unknown>[];
  }

  return rows.map(r => ({
    id: r.id as string,
    projectIds: JSON.parse(r.project_ids as string) as string[],
    suggestedParentName: r.suggested_parent_name as string,
    reason: r.reason as string,
    confidence: r.confidence as number,
    status: r.status as 'pending' | 'accepted' | 'rejected',
    createdAt: r.created_at as string,
  }));
}

export function acceptProjectSuggestion(id: string, customName?: string): { success: boolean; project?: Project; error?: string } {
  const db = getDatabase();
  const suggestion = db.prepare('SELECT * FROM project_suggestions WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!suggestion) return { success: false, error: 'Suggestion not found' };
  if (suggestion.status !== 'pending') return { success: false, error: 'Suggestion already processed' };

  const projectIds = JSON.parse(suggestion.project_ids as string) as string[];
  if (projectIds.length < 2) return { success: false, error: 'Invalid suggestion' };

  // Find common parent or use root
  const projects_data = projectIds.map(pid => getProject(pid)).filter(Boolean) as Project[];
  if (projects_data.length < 2) return { success: false, error: 'Projects not found' };

  const commonParentId = projects_data[0].parentId;
  const allSameParent = projects_data.every(p => p.parentId === commonParentId);

  const parentId = allSameParent ? commonParentId : null;
  const parentName = customName || (suggestion.suggested_parent_name as string);

  return db.transaction(() => {
    // Create new parent project
    const newProject = createProject({
      name: parentName,
      parentId,
    });

    // Move all suggested projects under new parent
    for (const pid of projectIds) {
      moveProject(pid, newProject.id);
    }

    // Mark suggestion as accepted
    db.prepare("UPDATE project_suggestions SET status = 'accepted' WHERE id = ?").run(id);

    return { success: true, project: newProject };
  })();
}

export function rejectProjectSuggestion(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare("UPDATE project_suggestions SET status = 'rejected' WHERE id = ? AND status = 'pending'").run(id);
  return result.changes > 0;
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string) || null,
    name: row.name as string,
    description: (row.description as string) || undefined,
    path: row.path as string,
    depth: row.depth as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : undefined,
  };
}
