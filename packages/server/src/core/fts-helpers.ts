/**
 * FTS5 全文搜索索引维护辅助函数
 *
 * 集中管理 memories_fts 的增删操作，确保所有写路径（创建、更新、删除、恢复、回滚）
 * 都正确维护 FTS 索引，避免"数据存在但搜不到"或"已删除但仍被搜到"的不一致问题。
 */

import type Database from 'better-sqlite3';
import { appendCjkBigrams } from './cjk.js';

/**
 * 从 FTS 索引中删除指定记忆的条目
 * 用于：软删除、归档、衰减等非永久删除操作（永久删除时行会随 DELETE CASCADE 自动消失）
 */
export function removeFromFts(db: Database.Database, memoryId: string): void {
  db.prepare(`DELETE FROM memories_fts WHERE rowid = (SELECT rowid FROM memories WHERE id = ?)`).run(memoryId);
}

/**
 * 将指定记忆重新写入 FTS 索引
 * 用于：恢复、回滚、重新激活等操作
 * 前提：memories 表中该行必须已存在
 */
export function insertIntoFts(db: Database.Database, memoryId: string): void {
  const row = db.prepare(`
    SELECT m.title, m.content, m.tags, p.name as project_name
    FROM memories m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.id = ?
  `).get(memoryId) as { title: string; content: string; tags: string | null; project_name: string | null } | undefined;

  if (!row) return;

  let tagText = '';
  try {
    const parsed = row.tags ? JSON.parse(row.tags) : [];
    tagText = Array.isArray(parsed) && parsed.length > 0 ? ' ' + parsed.join(' ') : '';
  } catch {
    tagText = '';
  }

  db.prepare(`
    INSERT INTO memories_fts (rowid, title, content, project)
    VALUES ((SELECT rowid FROM memories WHERE id = @id), @title, @content, @project)
  `).run({
    id: memoryId,
    // KM-103：中文 bigram 追加进索引，使 FTS 能命中中文词元。
    title: appendCjkBigrams(row.title),
    content: appendCjkBigrams(`${row.content}${tagText}`),
    project: row.project_name,
  });
}

/**
 * 更新 FTS 索引中的条目（先删后插）
 * 用于：内容/标题/标签/项目变更后刷新 FTS
 */
export function refreshFts(db: Database.Database, memoryId: string): void {
  removeFromFts(db, memoryId);
  insertIntoFts(db, memoryId);
}
