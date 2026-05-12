import type { Version, ChangeType } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';

export function getVersions(memoryId: string): Version[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM versions WHERE memory_id = ? ORDER BY version ASC`).all(memoryId) as Record<string, unknown>[];
  return rows.map(r => ({
    id: r.id as string,
    memoryId: r.memory_id as string,
    version: r.version as number,
    title: r.title as string,
    content: r.content as string,
    changeType: r.change_type as ChangeType,
    changeReason: (r.change_reason as string) || undefined,
    createdAt: r.created_at as string,
  }));
}

export function getVersion(memoryId: string, version: number): Version | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM versions WHERE memory_id = ? AND version = ?`).get(memoryId, version) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    memoryId: row.memory_id as string,
    version: row.version as number,
    title: row.title as string,
    content: row.content as string,
    changeType: row.change_type as ChangeType,
    changeReason: (row.change_reason as string) || undefined,
    createdAt: row.created_at as string,
  };
}

export function diffVersions(memoryId: string, fromVersion: number, toVersion: number): { from: Version; to: Version; titleChanged: boolean; contentDiff: string[] } | null {
  const from = getVersion(memoryId, fromVersion);
  const to = getVersion(memoryId, toVersion);
  if (!from || !to) return null;

  const titleChanged = from.title !== to.title;
  const contentDiff = simpleDiff(from.content, to.content);

  return { from, to, titleChanged, contentDiff };
}

export function rollbackToVersion(memoryId: string, targetVersion: number, reason?: string): boolean {
  const db = getDatabase();
  const target = getVersion(memoryId, targetVersion);
  if (!target) return false;

  const now = new Date().toISOString();
  const versionCount = (db.prepare(`SELECT COUNT(*) as cnt FROM versions WHERE memory_id = ?`).get(memoryId) as { cnt: number }).cnt;

  db.prepare(`
    INSERT INTO versions (id, memory_id, version, title, content, change_type, change_reason, created_at)
    VALUES (?, ?, ?, ?, ?, 'restore', ?, ?)
  `).run(
    crypto.randomUUID(),
    memoryId,
    versionCount + 1,
    target.title,
    target.content,
    reason ?? `Rollback to version ${targetVersion}`,
    now
  );

  db.prepare(`
    UPDATE memories SET title = ?, content = ?, updated_at = ? WHERE id = ?
  `).run(target.title, target.content, now, memoryId);

  return true;
}

function simpleDiff(oldText: string, newText: string): string[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: string[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) continue;
    if (oldLine === undefined) result.push(`+ ${newLine}`);
    else if (newLine === undefined) result.push(`- ${oldLine}`);
    else result.push(`~ ${oldLine} → ${newLine}`);
  }

  return result;
}
