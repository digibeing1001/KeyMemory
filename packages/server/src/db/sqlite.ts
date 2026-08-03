import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { DATA_DIR_NAME, DB_NAME } from '@keymemory/shared';

let db: Database.Database | null = null;
const DEFAULT_PROJECT_NAME = '未分类';

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
  console.error(`[KeyMemory] Database path: ${dbPath}`);

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      name TEXT NOT NULL,
      description TEXT,
      path TEXT NOT NULL,
      depth INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      metadata TEXT,
      FOREIGN KEY (parent_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      layer TEXT NOT NULL,
      project_id TEXT NOT NULL,
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
      source_id TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      title, content, project,
      tokenize='trigram'
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

    CREATE TABLE IF NOT EXISTS memory_relations (
      id TEXT PRIMARY KEY,
      source_memory_id TEXT NOT NULL,
      target_memory_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      strength REAL DEFAULT 1.0,
      reason TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(source_memory_id, target_memory_id, relation_type),
      FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      FOREIGN KEY (target_memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS memory_entities (
      memory_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      context TEXT,
      PRIMARY KEY (memory_id, entity_id, project_id),
      FOREIGN KEY (memory_id) REFERENCES memories(id),
      FOREIGN KEY (entity_id) REFERENCES entities(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    CREATE TABLE IF NOT EXISTS entity_aliases (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(entity_id, alias),
      FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE
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
      captured_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS project_suggestions (
      id TEXT PRIMARY KEY,
      project_ids TEXT NOT NULL,
      suggested_parent_name TEXT NOT NULL,
      reason TEXT NOT NULL,
      confidence REAL DEFAULT 0.0,
      status TEXT DEFAULT 'pending',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduler_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_secrets (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      name TEXT NOT NULL,
      value_ciphertext TEXT NOT NULL,
      value_hash TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_accessed_at TEXT,
      UNIQUE(tool, name)
    );

    CREATE TABLE IF NOT EXISTS query_logs (
      id TEXT PRIMARY KEY,
      query TEXT NOT NULL,
      memory_id TEXT,
      match_type TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (memory_id) REFERENCES memories(id)
    );

    CREATE TABLE IF NOT EXISTS memory_chunks (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      model TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(memory_id, chunk_index),
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loop_runs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT NOT NULL UNIQUE,
      request_hash TEXT,
      objective TEXT NOT NULL,
      project_id TEXT,
      project_path TEXT,
      agent_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      checkpoint_version INTEGER NOT NULL DEFAULT 0,
      last_event_sequence INTEGER NOT NULL DEFAULT 0,
      trace_id TEXT NOT NULL,
      lease_owner TEXT NOT NULL,
      lease_expires_at TEXT NOT NULL,
      metadata TEXT,
      -- Loop cost & circuit-breaker 可观测性列
      -- token_budget: 单次 run 累计 token 硬上限（可选）
      token_budget INTEGER,
      -- token_used: 累计已用 token（每个 checkpoint 的 tokenUsage 累加）
      token_used INTEGER NOT NULL DEFAULT 0,
      -- cost_usd_budget: 美元硬上限（可选，仅审计观测，当前不作为熔断条件）
      cost_usd_budget REAL,
      -- cost_usd_used: 累计已用美元
      cost_usd_used REAL NOT NULL DEFAULT 0,
      -- consecutive_failures: 连续失败计数（达到 noProgressThreshold=5 触发 circuit breaker）
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      -- last_error_signature: 最后错误签名（达到 stagnationThreshold=3 触发 circuit breaker）
      last_error_signature TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS loop_checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      idempotency_key TEXT,
      request_hash TEXT,
      phase TEXT NOT NULL,
      summary TEXT NOT NULL,
      state TEXT NOT NULL,
      next_actions TEXT NOT NULL,
      artifacts TEXT NOT NULL,
      memory_refs TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      UNIQUE(run_id, version),
      UNIQUE(run_id, idempotency_key),
      FOREIGN KEY (run_id) REFERENCES loop_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS loop_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_name TEXT NOT NULL,
      severity TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      span_id TEXT,
      body TEXT,
      attributes TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(run_id, sequence),
      FOREIGN KEY (run_id) REFERENCES loop_runs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      is_main_account INTEGER DEFAULT 0,
      user_status TEXT NOT NULL DEFAULT 'active',
      company_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_used_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_layer ON memories(layer);
    CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);
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
    CREATE INDEX IF NOT EXISTS idx_memory_chunks_memory ON memory_chunks(memory_id);
    CREATE INDEX IF NOT EXISTS idx_relations_type ON relations(relation_type);
    CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
    CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relations_source ON memory_relations(source_memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relations_target ON memory_relations(target_memory_id);
    CREATE INDEX IF NOT EXISTS idx_memory_relations_type ON memory_relations(relation_type);
    CREATE INDEX IF NOT EXISTS idx_tool_secrets_tool ON tool_secrets(tool);
    CREATE INDEX IF NOT EXISTS idx_loop_runs_status ON loop_runs(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_loop_runs_agent ON loop_runs(agent_id, updated_at);
    CREATE INDEX IF NOT EXISTS idx_loop_checkpoints_run ON loop_checkpoints(run_id, version);
    CREATE INDEX IF NOT EXISTS idx_loop_events_run ON loop_events(run_id, sequence);
    -- 支撑 token/cost 预算超限扫描：只扫描活跃 run 中设置了预算的行
    CREATE INDEX IF NOT EXISTS idx_loop_runs_token_budget ON loop_runs(token_budget) WHERE token_budget IS NOT NULL;
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
    'ALTER TABLE dream_reports ADD COLUMN details TEXT',
    'ALTER TABLE memories ADD COLUMN project_id TEXT',
    'ALTER TABLE memory_entities ADD COLUMN project_id TEXT',
    'ALTER TABLE memory_entities ADD COLUMN context TEXT',
    'ALTER TABLE consolidation_snapshots ADD COLUMN project_id TEXT',
    'ALTER TABLE memory_relations ADD COLUMN reason TEXT',
    'ALTER TABLE loop_runs ADD COLUMN request_hash TEXT',
    'ALTER TABLE loop_checkpoints ADD COLUMN memory_refs TEXT NOT NULL DEFAULT \'[]\'',
    'ALTER TABLE memories ADD COLUMN owner_user_id TEXT',
    'ALTER TABLE projects ADD COLUMN owner_user_id TEXT',
    'ALTER TABLE loop_runs ADD COLUMN owner_user_id TEXT',
    'ALTER TABLE tool_secrets ADD COLUMN owner_user_id TEXT',
    'ALTER TABLE isolation_rules ADD COLUMN owner_user_id TEXT',
    // Loop cost & circuit-breaker 列
    'ALTER TABLE loop_runs ADD COLUMN token_budget INTEGER',
    'ALTER TABLE loop_runs ADD COLUMN token_used INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE loop_runs ADD COLUMN cost_usd_budget REAL',
    'ALTER TABLE loop_runs ADD COLUMN cost_usd_used REAL NOT NULL DEFAULT 0',
    'ALTER TABLE loop_runs ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE loop_runs ADD COLUMN last_error_signature TEXT',
  ];
  for (const stmt of alterStatements) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = (err as Error).message || '';
      if (!msg.includes('duplicate column')) {
        console.error('[Migration] Unexpected error:', msg);
      }
    }
  }

  // Migrate existing data: convert project strings to project_ids
  migrateProjectData(db);
  migrateMemoryRelationData(db);
  migrateLegacyProjectsToMailboxPool(db);
  ensureMemoryFtsSchema(db);

  // Create indexes for new columns (must run after ALTER TABLE)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memories_project_id ON memories(project_id);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_space ON memories(agent_space);
    CREATE INDEX IF NOT EXISTS idx_memories_last_hit_at ON memories(last_hit_at);
    CREATE INDEX IF NOT EXISTS idx_memories_owner_agent ON memories(owner_agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at);
    CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);
    CREATE INDEX IF NOT EXISTS idx_memories_confidence ON memories(confidence);
    CREATE INDEX IF NOT EXISTS idx_projects_parent ON projects(parent_id);
    CREATE INDEX IF NOT EXISTS idx_projects_path ON projects(path);
    CREATE INDEX IF NOT EXISTS idx_memory_entities_project ON memory_entities(project_id);
    -- entity 过滤：memory_entities 的 PRIMARY KEY 是 (memory_id, entity_id, project_id)，
    -- 按 entity_id 查询无法走主键前缀，需要单独索引支撑 entityId/entityName/entityType 过滤路径
    CREATE INDEX IF NOT EXISTS idx_memory_entities_entity ON memory_entities(entity_id);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_alias ON entity_aliases(alias);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_entity ON entity_aliases(entity_id);
    CREATE INDEX IF NOT EXISTS idx_project_suggestions_status ON project_suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_memories_owner_user ON memories(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_owner_user ON projects(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_loop_runs_owner_user ON loop_runs(owner_user_id);
  `);

  ensureWelcomeMemory(db);
}

/**
 * 邮箱成为项目上下文入口后，旧项目树只保留为兼容范围。
 *
 * 迁移会把记忆重新放回统一记忆池，并在 metadata 中保留原项目来源。
 * 旧 project 行不删除：历史 Loop、版本和外键仍可审计，但 Web UI 不再展示项目树。
 */
function migrateLegacyProjectsToMailboxPool(db: Database.Database): void {
  const markerKey = 'mailbox_v1_legacy_projects_flattened';
  const marker = db.prepare('SELECT value FROM scheduler_config WHERE key = ?').get(markerKey) as { value: string } | undefined;
  if (marker) return;

  const defaultProjectId = ensureDefaultProject(db);
  const defaultProject = db.prepare('SELECT id, name, path FROM projects WHERE id = ?').get(defaultProjectId) as { id: string; name: string; path: string };
  const memories = db.prepare(`
    SELECT m.id, m.project_id, m.metadata, p.name as project_name, p.path as project_path
    FROM memories m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.project_id IS NOT NULL AND m.project_id != ?
  `).all(defaultProjectId) as Array<{
    id: string;
    project_id: string;
    metadata: string | null;
    project_name: string | null;
    project_path: string | null;
  }>;

  let backupPath: string | undefined;
  const dbName = String((db as unknown as { name?: string }).name ?? '');
  if (memories.length > 0 && dbName && dbName !== ':memory:') {
    const backupDir = path.join(path.dirname(dbName), 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    backupPath = path.join(backupDir, `pre-mailbox-migration-${stamp}.db`);
    const escaped = backupPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escaped}'`);
  }

  const now = new Date().toISOString();
  let removedSuggestions = 0;
  const updateMemory = db.prepare('UPDATE memories SET project_id = ?, metadata = ?, updated_at = ? WHERE id = ?');
  const updateProject = db.prepare('UPDATE projects SET metadata = ?, updated_at = ? WHERE id = ?');

  db.transaction(() => {
    for (const memory of memories) {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = memory.metadata ? JSON.parse(memory.metadata) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        metadata = {};
      }
      metadata.legacyProject = {
        id: memory.project_id,
        name: memory.project_name,
        path: memory.project_path,
        detachedAt: now,
      };
      updateMemory.run(defaultProjectId, JSON.stringify(metadata), now, memory.id);
    }

    // memory_entities 的主键包含 project_id。先补目标行再删旧行，避免直接 UPDATE 冲突。
    db.prepare(`
      INSERT OR IGNORE INTO memory_entities (memory_id, entity_id, project_id, context)
      SELECT memory_id, entity_id, ?, context
      FROM memory_entities
      WHERE project_id != ?
    `).run(defaultProjectId, defaultProjectId);
    db.prepare('DELETE FROM memory_entities WHERE project_id != ?').run(defaultProjectId);

    const legacyProjects = db.prepare('SELECT id, metadata FROM projects WHERE id != ?').all(defaultProjectId) as Array<{ id: string; metadata: string | null }>;
    for (const project of legacyProjects) {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = project.metadata ? JSON.parse(project.metadata) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        metadata = {};
      }
      metadata.mailboxLegacyRetired = true;
      metadata.mailboxRetiredAt = now;
      updateProject.run(JSON.stringify(metadata), now, project.id);
    }

    removedSuggestions = db.prepare('DELETE FROM project_suggestions').run().changes;
    db.prepare(`
      INSERT INTO scheduler_config (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(markerKey, JSON.stringify({
      appliedAt: now,
      defaultProjectId,
      defaultProjectPath: defaultProject.path,
      movedMemories: memories.length,
      retiredProjects: legacyProjects.length,
      removedSuggestions,
      backupPath,
    }), now);
  })();

  if (memories.length > 0) {
    console.error(`[Mailbox Migration] Returned ${memories.length} memories to the shared pool; backup=${backupPath ?? 'not-required'}`);
  }
}

function ensureMemoryFtsSchema(db: Database.Database): void {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memories_fts'")
    .get() as { sql: string } | undefined;
  if (!row) return;

  // Detect old schemas that need rebuilding: either uses external content (legacy)
  // or uses unicode61 tokenizer (no Chinese support)
  const needsRebuild =
    /content\s*=\s*'?memories'?/i.test(row.sql) ||
    /tokenize\s*=\s*['"]?unicode61['"]?/i.test(row.sql);

  if (!needsRebuild) return;

  db.exec(`
    DROP TABLE IF EXISTS memories_fts;
    CREATE VIRTUAL TABLE memories_fts USING fts5(
      title, content, project,
      tokenize='trigram'
    );
  `);
  rebuildMemoryFtsRows(db);
  console.error('[KeyMemory] FTS5 索引已重建为 trigram（支持中文搜索）');
}

function rebuildMemoryFtsRows(db: Database.Database): void {
  const rows = db.prepare(`
    SELECT m.rowid as rowid, m.title, m.content, m.tags, p.name as project
    FROM memories m
    LEFT JOIN projects p ON p.id = m.project_id
    WHERE m.status != 'deleted'
  `).all() as { rowid: number; title: string; content: string; tags: string | null; project: string | null }[];

  const insert = db.prepare(`
    INSERT INTO memories_fts (rowid, title, content, project)
    VALUES (@rowid, @title, @content, @project)
  `);
  for (const row of rows) {
    let tags = '';
    try {
      const parsed = row.tags ? JSON.parse(row.tags) : [];
      tags = Array.isArray(parsed) ? ` ${parsed.join(' ')}` : '';
    } catch {
      tags = '';
    }
    insert.run({
      rowid: row.rowid,
      title: row.title,
      content: `${row.content}${tags}`,
      project: row.project,
    });
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some(row => row.name === column);
}

function ensureDefaultProject(db: Database.Database): string {
  const named = db.prepare('SELECT id FROM projects WHERE parent_id IS NULL AND name = ? LIMIT 1').get(DEFAULT_PROJECT_NAME) as { id: string } | undefined;
  if (named) return named.id;

  const existing = db.prepare('SELECT id FROM projects WHERE parent_id IS NULL ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined;
  if (existing) return existing.id;

  const now = new Date().toISOString();
  const id = uuidv4();
  db.prepare(`
    INSERT INTO projects (id, parent_id, name, path, depth, created_at, updated_at)
    VALUES (@id, NULL, @name, @name, 0, @createdAt, @updatedAt)
  `).run({ id, name: DEFAULT_PROJECT_NAME, createdAt: now, updatedAt: now });
  return id;
}

function getOrCreateProjectByPath(db: Database.Database, pathLike: string): string {
  const parts = pathLike
    .split(/[\/\\>]+|::|->|→|›|＞|／/u)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return ensureDefaultProject(db);

  let parentId: string | null = null;
  let currentPath = '';
  let depth = 0;
  let currentId = '';

  for (const name of parts) {
    const existing = db.prepare('SELECT id, path, depth FROM projects WHERE name = ? AND parent_id IS ? LIMIT 1').get(name, parentId) as { id: string; path: string; depth: number } | undefined;
    if (existing) {
      currentId = existing.id;
      currentPath = existing.path;
      depth = existing.depth + 1;
      parentId = existing.id;
      continue;
    }

    const now = new Date().toISOString();
    const id = uuidv4();
    currentPath = currentPath ? `${currentPath}/${name}` : name;
    db.prepare(`
      INSERT INTO projects (id, parent_id, name, path, depth, created_at, updated_at, metadata)
      VALUES (@id, @parentId, @name, @path, @depth, @createdAt, @updatedAt, @metadata)
    `).run({
      id,
      parentId,
      name,
      path: currentPath,
      depth,
      createdAt: now,
      updatedAt: now,
      metadata: JSON.stringify({ createdBy: 'migration' }),
    });
    currentId = id;
    parentId = id;
    depth++;
  }

  return currentId || ensureDefaultProject(db);
}

function migrateProjectData(db: Database.Database): void {
  // Check if migration already done using a dedicated marker
  const marker = db.prepare("SELECT value FROM scheduler_config WHERE key = 'migration_v1_done'").get() as { value: string } | undefined;
  const defaultProjectId = ensureDefaultProject(db);
  if (marker?.value === 'true') return;

  const hasLegacyProject = hasColumn(db, 'memories', 'project');

  db.transaction(() => {
    // 1. Extract unique legacy project names from older databases.
    const projectNames = hasLegacyProject
      ? db.prepare("SELECT DISTINCT project FROM memories WHERE project IS NOT NULL AND project != ''").all() as { project: string }[]
      : [];
    const projectMap = new Map<string, string>();
    projectMap.set(DEFAULT_PROJECT_NAME, defaultProjectId);

    for (const row of projectNames) {
      const projectId = getOrCreateProjectByPath(db, row.project);
      projectMap.set(row.project, projectId);
    }

    // 2. Update memories: set project_id based on old project string when present.
    if (hasLegacyProject) {
      db.prepare(`
        UPDATE memories SET project_id = @defaultProjectId WHERE project IS NULL OR project = ''
      `).run({ defaultProjectId });

      for (const [name, id] of projectMap) {
        if (name === DEFAULT_PROJECT_NAME) continue;
        db.prepare(`
          UPDATE memories SET project_id = @projectId WHERE project = @projectName
        `).run({ projectId: id, projectName: name });
      }
    }
    db.prepare(`UPDATE memories SET project_id = @defaultProjectId WHERE project_id IS NULL OR project_id = ''`).run({ defaultProjectId });

    // 3. Convert layer='project' memories to layer='long'
    db.prepare("UPDATE memories SET layer = 'long' WHERE layer = 'project'").run();

    // 4. Update memory_entities: set project_id from associated memory
    db.prepare(`
      UPDATE memory_entities
      SET project_id = (
        SELECT project_id FROM memories WHERE memories.id = memory_entities.memory_id
      )
      WHERE project_id IS NULL OR project_id = ''
    `).run();

    // 5. Normalize consolidation snapshots.
    db.prepare(`
      UPDATE consolidation_snapshots
      SET project_id = COALESCE(project_id, @defaultProjectId),
          agent_space = COALESCE(agent_space, 'global')
      WHERE project_id IS NULL OR project_id = ''
    `).run({ defaultProjectId });

    // Mark migration complete
    db.prepare("INSERT OR REPLACE INTO scheduler_config (key, value, updated_at) VALUES ('migration_v1_done', 'true', ?)")
      .run(new Date().toISOString());
  })();
}

function migrateMemoryRelationData(db: Database.Database): void {
  const marker = db.prepare("SELECT value FROM scheduler_config WHERE key = 'memory_relations_v1_done'").get() as { value: string } | undefined;
  if (marker?.value === 'true') return;

  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO memory_relations (id, source_memory_id, target_memory_id, relation_type, strength, reason, created_at)
      SELECT r.id, r.source_id, r.target_id, r.relation_type, r.strength, 'migrated from legacy relations', r.created_at
      FROM relations r
      JOIN memories source ON source.id = r.source_id
      JOIN memories target ON target.id = r.target_id
    `).run();

    db.prepare(`
      DELETE FROM relations
      WHERE id IN (
        SELECT r.id
        FROM relations r
        JOIN memories source ON source.id = r.source_id
        JOIN memories target ON target.id = r.target_id
      )
    `).run();

    db.prepare("INSERT OR REPLACE INTO scheduler_config (key, value, updated_at) VALUES ('memory_relations_v1_done', 'true', ?)")
      .run(new Date().toISOString());
  })();
}

function ensureWelcomeMemory(db: Database.Database, userId?: string): void {
  const WELCOME_SOURCE_ID = 'keymemory-welcome';
  // userId 提供时:按用户查重(每个用户一份欢迎记忆);未提供时:全局查重(旧行为)
  const existing = userId
    ? db.prepare("SELECT id FROM memories WHERE source_id = ? AND status = 'active' AND owner_user_id = ?").get(WELCOME_SOURCE_ID, userId)
    : db.prepare("SELECT id FROM memories WHERE source_id = ? AND status = 'active' AND owner_user_id IS NULL").get(WELCOME_SOURCE_ID);
  if (existing) return;

  // Get or create default root project
  let rootProject = db.prepare("SELECT id FROM projects WHERE parent_id IS NULL LIMIT 1").get() as { id: string } | undefined;
  if (!rootProject) {
    const now = new Date().toISOString();
    const rootId = uuidv4();
    db.prepare(`
      INSERT INTO projects (id, parent_id, name, path, depth, created_at, updated_at)
      VALUES (@id, NULL, '未分类', '未分类', 0, @createdAt, @updatedAt)
    `).run({ id: rootId, createdAt: now, updatedAt: now });
    rootProject = { id: rootId };
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const tags = JSON.stringify(['KeyMemory', '介绍', '使用指南']);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO memories (id, title, content, layer, project_id, agent_space, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, source, source_id, owner_user_id)
      VALUES (@id, @title, @content, @layer, @projectId, @agentSpace, @confidence, @hitCount, @status, @decayFactor, @createdAt, @updatedAt, @tags, @source, @sourceId, @ownerUserId)
    `).run({
      id, title, content,
      layer: 'long',
      projectId: rootProject.id,
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
      ownerUserId: userId ?? null,
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

export function isDatabaseInitialized(): boolean {
  return db !== null;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
