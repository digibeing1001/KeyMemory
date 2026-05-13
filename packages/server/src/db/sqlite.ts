import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { DATA_DIR_NAME, DB_NAME } from '@keymemory/shared';

let db: Database.Database | null = null;

export function getDataDir(): string {
  const dir = path.join(os.homedir(), DATA_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function initDatabase(): Database.Database {
  if (db) return db;

  const dataDir = getDataDir();
  const dbPath = path.join(dataDir, DB_NAME);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      layer TEXT NOT NULL,
      project TEXT,
      agent_space TEXT DEFAULT 'global',
      owner_agent_id TEXT,
      confidence REAL DEFAULT 1.0,
      hit_count INTEGER DEFAULT 0,
      last_hit_at TEXT,
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decay_factor REAL DEFAULT 1.0,
      tags TEXT,
      metadata TEXT,
      source TEXT,
      source_id TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title, content, project,
      content=memories,
      content_rowid=rowid,
      tokenize='unicode61'
    );

    CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      properties TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS relations (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      strength REAL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES entities(id),
      FOREIGN KEY (target_id) REFERENCES entities(id)
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      PRIMARY KEY (memory_id, entity_id),
      FOREIGN KEY (memory_id) REFERENCES memories(id),
      FOREIGN KEY (entity_id) REFERENCES entities(id)
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      change_type TEXT NOT NULL,
      change_reason TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );

    CREATE TABLE IF NOT EXISTS embeddings (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      model TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );

    CREATE TABLE IF NOT EXISTS selfcheck_logs (
      id TEXT PRIMARY KEY,
      memory_id TEXT,
      conversation_round INTEGER,
      scores TEXT NOT NULL,
      total REAL NOT NULL,
      action TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS evolution_tasks (
      id TEXT PRIMARY KEY,
      task_type TEXT NOT NULL,
      source_ids TEXT NOT NULL,
      suggestion TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );

    CREATE TABLE IF NOT EXISTS isolation_rules (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      rule_type TEXT NOT NULL,
      pattern TEXT NOT NULL,
      target_space TEXT NOT NULL,
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_versions_memory_id ON versions(memory_id);
    CREATE INDEX IF NOT EXISTS idx_evolution_tasks_status ON evolution_tasks(status);
  `);

  const alterStatements = [
    'ALTER TABLE memories ADD COLUMN agent_space TEXT DEFAULT \'global\'',
    'ALTER TABLE memories ADD COLUMN owner_agent_id TEXT',
    'ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 1.0',
    'ALTER TABLE memories ADD COLUMN last_hit_at TEXT',
    'ALTER TABLE memories ADD COLUMN decay_factor REAL DEFAULT 1.0',
    'ALTER TABLE memories ADD COLUMN tags TEXT',
    'ALTER TABLE memories ADD COLUMN metadata TEXT',
    'ALTER TABLE memories ADD COLUMN source TEXT',
    'ALTER TABLE memories ADD COLUMN source_id TEXT',
  ];
  for (const stmt of alterStatements) {
    try {
      db.exec(stmt);
    } catch {}
  }
}

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
