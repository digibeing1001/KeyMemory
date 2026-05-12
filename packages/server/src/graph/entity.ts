import { v4 as uuid } from 'uuid';
import type { Entity, EntityType, Relation } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';

const ENTITY_PATTERNS = [
  { regex: /@([\p{L}\p{N}_]+)/gu, type: 'person' as EntityType },
  { regex: /#([\p{L}\p{N}_]+)/gu, type: 'concept' as EntityType },
];

const PROJECT_PATTERN = /\[\[([^\]]+)\]\]/g;

export function extractEntities(content: string): { name: string; type: EntityType }[] {
  const entities: { name: string; type: EntityType }[] = [];
  const seen = new Set<string>();

  for (const pattern of ENTITY_PATTERNS) {
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      const name = match[1];
      const key = `${pattern.type}:${name}`;
      if (!seen.has(key)) {
        seen.add(key);
        entities.push({ name, type: pattern.type });
      }
    }
  }

  return entities;
}

export function extractProjects(content: string): string[] {
  const projects: string[] = [];
  let match;
  while ((match = PROJECT_PATTERN.exec(content)) !== null) {
    projects.push(match[1]);
  }
  return projects;
}

export function ensureEntity(name: string, type: EntityType): Entity {
  const db = getDatabase();
  const now = new Date().toISOString();

  const existing = db.prepare(`SELECT * FROM entities WHERE name = ?`).get(name) as Record<string, unknown> | undefined;
  if (existing) {
    return {
      id: existing.id as string,
      name: existing.name as string,
      type: existing.type as EntityType,
      properties: existing.properties ? JSON.parse(existing.properties as string) : undefined,
      createdAt: existing.created_at as string,
      updatedAt: existing.updated_at as string,
    };
  }

  const id = uuid();
  db.prepare(`
    INSERT INTO entities (id, name, type, properties, created_at, updated_at)
    VALUES (?, ?, ?, NULL, ?, ?)
  `).run(id, name, type, now, now);

  return { id, name, type, createdAt: now, updatedAt: now };
}

export function linkMemoryEntity(memoryId: string, entityId: string): void {
  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO memory_entities (memory_id, entity_id) VALUES (?, ?)
  `).run(memoryId, entityId);
}

export function processContent(memoryId: string, content: string): { entities: Entity[]; projects: string[] } {
  const extractedEntities = extractEntities(content);
  const projects = extractProjects(content);
  const db = getDatabase();

  const entities: Entity[] = [];
  for (const ext of extractedEntities) {
    const entity = ensureEntity(ext.name, ext.type);
    linkMemoryEntity(memoryId, entity.id);
    entities.push(entity);
  }

  if (projects.length > 0) {
    db.prepare(`UPDATE memories SET project = ?, updated_at = ? WHERE id = ?`).run(
      projects[0],
      new Date().toISOString(),
      memoryId
    );
  }

  return { entities, projects };
}

export function createRelation(sourceId: string, targetId: string, relationType: string, strength = 1.0): Relation {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO relations (id, source_id, target_id, relation_type, strength, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, sourceId, targetId, relationType, strength, now);

  return { id, sourceId, targetId, relationType, strength, createdAt: now };
}

export function getEntityGraph(entityId: string): { entity: Entity; relations: Relation[]; connectedEntities: Entity[] } {
  const db = getDatabase();

  const entity = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(entityId) as Record<string, unknown> | undefined;
  if (!entity) throw new Error('Entity not found');

  const relations = db.prepare(`
    SELECT * FROM relations WHERE source_id = ? OR target_id = ?
  `).all(entityId, entityId) as Record<string, unknown>[];

  const connectedIds = new Set<string>();
  for (const r of relations) {
    if (r.source_id !== entityId) connectedIds.add(r.source_id as string);
    if (r.target_id !== entityId) connectedIds.add(r.target_id as string);
  }

  const connectedEntities: Entity[] = [];
  for (const cid of connectedIds) {
    const e = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(cid) as Record<string, unknown> | undefined;
    if (e) {
      connectedEntities.push({
        id: e.id as string,
        name: e.name as string,
        type: e.type as EntityType,
        properties: e.properties ? JSON.parse(e.properties as string) : undefined,
        createdAt: e.created_at as string,
        updatedAt: e.updated_at as string,
      });
    }
  }

  return {
    entity: {
      id: entity.id as string,
      name: entity.name as string,
      type: entity.type as EntityType,
      properties: entity.properties ? JSON.parse(entity.properties as string) : undefined,
      createdAt: entity.created_at as string,
      updatedAt: entity.updated_at as string,
    },
    relations: relations.map(r => ({
      id: r.id as string,
      sourceId: r.source_id as string,
      targetId: r.target_id as string,
      relationType: r.relation_type as string,
      strength: r.strength as number,
      createdAt: r.created_at as string,
    })),
    connectedEntities,
  };
}

export function listEntities(type?: EntityType): Entity[] {
  const db = getDatabase();
  if (type) {
    return db.prepare(`SELECT * FROM entities WHERE type = ? ORDER BY name`).all(type) as Entity[];
  }
  return db.prepare(`SELECT * FROM entities ORDER BY name`).all() as Entity[];
}
