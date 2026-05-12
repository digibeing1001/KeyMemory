import { getDatabase } from '../db/sqlite.js';
import type { Layer } from '@keymemory/shared';

export interface CompressionResult {
  projectId?: string;
  entityId?: string;
  sourceCount: number;
  summary: string;
}

export function compressProjectMemories(project: string): CompressionResult | null {
  const db = getDatabase();

  const memories = db.prepare(`
    SELECT id, title, content FROM memories
    WHERE project = ? AND status = 'active'
    ORDER BY created_at ASC
  `).all(project) as { id: string; title: string; content: string }[];

  if (memories.length < 3) return null;

  const keyPoints: string[] = [];
  for (const m of memories) {
    const lines = m.content.split('\n').filter(l => l.trim().length > 0);
    const firstLines = lines.slice(0, 3).map(l => l.trim());
    keyPoints.push(`- ${m.title}: ${firstLines.join(' ')}`);
  }

  const summary = `# ${project} 项目摘要\n\n共 ${memories.length} 条记忆，关键要点：\n\n${keyPoints.join('\n')}`;

  return {
    projectId: project,
    sourceCount: memories.length,
    summary,
  };
}

export function compressEntityMemories(entityId: string): CompressionResult | null {
  const db = getDatabase();

  const entity = db.prepare(`SELECT name FROM entities WHERE id = ?`).get(entityId) as { name: string } | undefined;
  if (!entity) return null;

  const memories = db.prepare(`
    SELECT m.id, m.title, m.content FROM memories m
    JOIN memory_entities me ON me.memory_id = m.id
    WHERE me.entity_id = ? AND m.status = 'active'
    ORDER BY m.created_at ASC
  `).all(entityId) as { id: string; title: string; content: string }[];

  if (memories.length < 2) return null;

  const keyPoints: string[] = [];
  for (const m of memories) {
    const lines = m.content.split('\n').filter(l => l.trim().length > 0);
    const firstLines = lines.slice(0, 2).map(l => l.trim());
    keyPoints.push(`- ${firstLines.join(' ')}`);
  }

  const summary = `# ${entity.name} 实体摘要\n\n共 ${memories.length} 条关联记忆：\n\n${keyPoints.join('\n')}`;

  return {
    entityId,
    sourceCount: memories.length,
    summary,
  };
}

export function listCompressibleProjects(): { project: string; count: number }[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT project, COUNT(*) as count FROM memories
    WHERE project IS NOT NULL AND status = 'active'
    GROUP BY project
    HAVING count >= 3
    ORDER BY count DESC
  `).all() as { project: string; count: number }[];
}
