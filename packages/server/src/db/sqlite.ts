import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { DATA_DIR_NAME, DB_NAME } from '@keymemory/shared';

let db: Database.Database | null = null;

export function getDataDir(): string {
  const dir = process.env.KEYMEMORY_DATA_DIR || path.join(os.homedir(), DATA_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDbPath(): string {
  if (process.env.KEYMEMORY_DB_PATH) {
    return process.env.KEYMEMORY_DB_PATH;
  }
  return path.join(getDataDir(), DB_NAME);
}

export function initDatabase(): Database.Database {
  if (db) return db;

  const dbPath = getDbPath();
  console.log(`[KeyMemory] Database path: ${dbPath}`);

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

    CREATE TABLE IF NOT EXISTS consolidation_plans (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'planned',
      actions TEXT NOT NULL,
      snapshot_count INTEGER DEFAULT 0,
      summary TEXT,
      created_at TEXT NOT NULL,
      executed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS consolidation_snapshots (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      layer TEXT NOT NULL,
      status TEXT NOT NULL,
      tags TEXT,
      metadata TEXT,
      project TEXT,
      agent_space TEXT DEFAULT 'global',
      confidence REAL DEFAULT 1.0,
      decay_factor REAL DEFAULT 1.0,
      captured_at TEXT NOT NULL,
      FOREIGN KEY (plan_id) REFERENCES consolidation_plans(id)
    );

    CREATE TABLE IF NOT EXISTS dream_reports (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      total_candidates INTEGER DEFAULT 0,
      promoted INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      merged INTEGER DEFAULT 0,
      sessions TEXT NOT NULL,
      todo_items TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS dream_signals (
      id TEXT PRIMARY KEY,
      report_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      relevance REAL DEFAULT 0,
      frequency REAL DEFAULT 0,
      query_diversity REAL DEFAULT 0,
      recency REAL DEFAULT 0,
      consolidation REAL DEFAULT 0,
      conceptual_richness REAL DEFAULT 0,
      total_score REAL DEFAULT 0,
      phase TEXT NOT NULL,
      promoted INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (report_id) REFERENCES dream_reports(id)
    );

    CREATE TABLE IF NOT EXISTS scheduler_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS query_logs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      memory_id TEXT,
      match_type TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
    CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project);
    CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_versions_memory_id ON versions(memory_id);
    CREATE INDEX IF NOT EXISTS idx_evolution_tasks_status ON evolution_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_consolidation_snapshots_plan ON consolidation_snapshots(plan_id);
    CREATE INDEX IF NOT EXISTS idx_consolidation_snapshots_memory ON consolidation_snapshots(memory_id);
    CREATE INDEX IF NOT EXISTS idx_consolidation_plans_status ON consolidation_plans(status);
    CREATE INDEX IF NOT EXISTS idx_dream_reports_status ON dream_reports(status);
    CREATE INDEX IF NOT EXISTS idx_dream_signals_report ON dream_signals(report_id);
    CREATE INDEX IF NOT EXISTS idx_dream_signals_memory ON dream_signals(memory_id);
    CREATE INDEX IF NOT EXISTS idx_query_logs_memory ON query_logs(memory_id);
    CREATE INDEX IF NOT EXISTS idx_query_logs_created ON query_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
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
    'ALTER TABLE dream_reports ADD COLUMN todo_items TEXT',
  ];
  for (const stmt of alterStatements) {
    try {
      db.exec(stmt);
    } catch {}
  }

  ensureWelcomeMemory(db);
}

function ensureWelcomeMemory(db: Database.Database): void {
  const WELCOME_SOURCE_ID = 'keymemory-welcome';
  const existing = db.prepare("SELECT id FROM memories WHERE source_id = ? AND status = 'active'").get(WELCOME_SOURCE_ID);
  if (existing) return;

  const id = uuidv4();
  const now = new Date().toISOString();
  const title = '欢迎使用 KeyMemory';
  const content = `## 关于 KeyMemory

KeyMemory 是一个五层记忆系统，帮助 AI Agent 拥有持久化的记忆能力。

### 五层记忆模型

| 层级 | 名称 | 用途 |
|------|------|------|
| 闪念 | flash | 灵感、想法、临时笔记 |
| 短期 | short | 近期任务、待办事项 |
| 长期 | long | 知识、经验、学习笔记 |
| 项目 | project | 项目相关的会议、决策、进展 |
| 人事物 | entity | 人物、组织、关键对象 |

### 核心功能

- **记忆存储**：支持五个层级，每条记忆自动提取标签
- **语义搜索**：基于内容相似度搜索相关记忆
- **星云图**：可视化记忆之间的关联网络
- **标签云**：直观展示记忆内容的分布
- **时间线**：按时间追溯记忆的创建与更新
- **MCP 接口**：AI Agent 通过标准协议读写记忆

### 使用方式

1. 在侧边栏切换层级筛选记忆
2. 点击记忆卡片查看详情
3. 使用搜索框进行语义搜索
4. 切换到星云图查看记忆关联
5. 切换到标签云浏览内容分布

> 这是一条系统介绍记忆，安装后自动创建。`;
  const tags = JSON.stringify(['KeyMemory', '介绍', '使用指南']);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, title, content, layer, agent_space, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, source, source_id)
      VALUES (@id, @title, @content, @layer, @agentSpace, @confidence, @hitCount, @status, @decayFactor, @createdAt, @updatedAt, @tags, @source, @sourceId)
    `).run({
      id, title, content,
      layer: 'long',
      agentSpace: 'global',
      confidence: 1.0,
      hitCount: 0,
      status: 'active',
      decayFactor: 1.0,
      createdAt: now,
      updatedAt: now,
      tags,
      source: 'system',
      sourceId: WELCOME_SOURCE_ID,
    });

    db.prepare(`
      INSERT INTO memories_fts (rowid, title, content, project)
      VALUES ((SELECT rowid FROM memories WHERE id = @id), @title, @content, @project)
    `).run({ id, title, content, project: null });
  })();
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
