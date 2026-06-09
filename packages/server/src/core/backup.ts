import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { getDataDir, getDatabase, getDbPath } from '../db/sqlite.js';

const APP_VERSION = '0.1.0';
const BACKUP_FORMAT = 'keymemory-portable-backup';
const BACKUP_FORMAT_VERSION = 1;

const CORE_TABLES = [
  'projects',
  'memories',
  'entities',
  'relations',
  'memory_relations',
  'memory_entities',
  'versions',
  'selfcheck_logs',
  'evolution_tasks',
  'isolation_rules',
  'consolidation_plans',
  'consolidation_snapshots',
  'dream_reports',
  'dream_signals',
  'project_suggestions',
  'scheduler_config',
] as const;

const OPTIONAL_TABLES = ['embeddings', 'query_logs'] as const;
const REQUIRED_TABLES = ['projects', 'memories', 'versions'] as const;

export interface BackupOptions {
  includeEmbeddings?: boolean;
  includeOperationalLogs?: boolean;
}

export interface BackupTableSnapshot {
  columns: string[];
  rows: Record<string, unknown>[];
}

export interface KeyMemoryBackup {
  format: typeof BACKUP_FORMAT;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  appVersion: string;
  createdAt: string;
  sourceDbPath: string;
  options: Required<BackupOptions>;
  omittedTables: string[];
  rebuildableTables: string[];
  counts: Record<string, number>;
  checksums: Record<string, string>;
  tables: Record<string, BackupTableSnapshot>;
}

export interface BackupSummary {
  filePath?: string;
  bytes?: number;
  format?: string;
  formatVersion?: number;
  appVersion?: string;
  createdAt?: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
  totalRows: number;
  includedTables: string[];
  omittedTables: string[];
  rebuildableTables: string[];
  checksums: Record<string, string>;
  dryRun?: boolean;
  wouldRestore?: boolean;
  restored?: boolean;
  preRestoreBackupPath?: string;
}

export interface RestoreBackupOptions {
  dryRun?: boolean;
  replace?: boolean;
  preRestoreBackupPath?: string;
}

function backupFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(getDataDir(), 'backups', `keymemory-${stamp}.json`);
}

function preRestoreBackupFileName(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(getDataDir(), 'backups', `pre-restore-${stamp}.json`);
}

function serializeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return { __keymemoryType: 'base64', value: value.toString('base64') };
  }
  return value;
}

function deserializeValue(value: unknown): unknown {
  if (
    value &&
    typeof value === 'object' &&
    '__keymemoryType' in value &&
    (value as { __keymemoryType?: unknown }).__keymemoryType === 'base64'
  ) {
    return Buffer.from(String((value as { value?: unknown }).value ?? ''), 'base64');
  }
  return value;
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, serializeValue(value)])
  );
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as Record<string, unknown>).sort());
}

function hashTable(table: BackupTableSnapshot): string {
  return createHash('sha256').update(JSON.stringify(table.rows)).digest('hex');
}

function parseBackupFile(filePath: string): { backup: Partial<KeyMemoryBackup>; summary: BackupSummary } {
  const target = path.resolve(filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(target, 'utf8');
  } catch (err) {
    const msg = (err as Error).message;
    throw new Error(`无法读取备份文件: ${msg}`);
  }
  let backup: Partial<KeyMemoryBackup>;
  try {
    backup = JSON.parse(raw) as Partial<KeyMemoryBackup>;
  } catch {
    throw new Error('备份文件格式损坏，无法解析 JSON');
  }
  return {
    backup,
    summary: summarizeBackup(backup, target, Buffer.byteLength(raw, 'utf8')),
  };
}

const VALID_TABLE_NAMES = new Set([...CORE_TABLES, ...OPTIONAL_TABLES]);

function listColumns(table: string): string[] {
  if (!VALID_TABLE_NAMES.has(table as any)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  const db = getDatabase();
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map(row => row.name);
}

function readTable(table: string): BackupTableSnapshot {
  if (!VALID_TABLE_NAMES.has(table as any)) {
    throw new Error(`Invalid table name: ${table}`);
  }
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
  return {
    columns: listColumns(table),
    rows: rows.map(serializeRow),
  };
}

function tableNames(options: BackupOptions): string[] {
  const names: string[] = [...CORE_TABLES];
  if (options.includeEmbeddings) names.push('embeddings');
  if (options.includeOperationalLogs) names.push('query_logs');
  return names;
}

function restoreDeleteOrder(): string[] {
  return [
    'embeddings',
    'query_logs',
    'memory_entities',
    'versions',
    'dream_signals',
    'memory_relations',
    'relations',
    'memories',
    'project_suggestions',
    'dream_reports',
    'consolidation_snapshots',
    'consolidation_plans',
    'isolation_rules',
    'evolution_tasks',
    'selfcheck_logs',
    'entities',
    'scheduler_config',
    'projects',
  ];
}

function restoreInsertOrder(includedTables: string[]): string[] {
  const order = [
    'projects',
    'scheduler_config',
    'entities',
    'memories',
    'memory_relations',
    'relations',
    'memory_entities',
    'versions',
    'embeddings',
    'selfcheck_logs',
    'evolution_tasks',
    'isolation_rules',
    'consolidation_plans',
    'consolidation_snapshots',
    'dream_reports',
    'dream_signals',
    'project_suggestions',
    'query_logs',
  ];
  return order.filter(table => includedTables.includes(table));
}

function sortedRowsForRestore(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (table !== 'projects') return rows;
  return [...rows].sort((a, b) => Number(a.depth ?? 0) - Number(b.depth ?? 0));
}

function insertRows(table: string, rows: Record<string, unknown>[]): void {
  if (rows.length === 0) return;
  const db = getDatabase();
  const allowedColumns = new Set(listColumns(table));
  const columns = Object.keys(rows[0]).filter(column => allowedColumns.has(column));
  if (columns.length === 0) return;
  const placeholders = columns.map(column => `@${column}`).join(', ');
  const stmt = db.prepare(`
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES (${placeholders})
  `);

  for (const row of sortedRowsForRestore(table, rows)) {
    const params = Object.fromEntries(
      columns.map(column => [column, deserializeValue(row[column])])
    );
    stmt.run(params);
  }
}

function rebuildFullTextIndex(): void {
  const db = getDatabase();
  db.exec(`
    DROP TABLE IF EXISTS memories_fts;
    CREATE VIRTUAL TABLE memories_fts USING fts5(
      title, content, project,
      tokenize='unicode61'
    );
  `);
  const rows = db.prepare(`
    SELECT m.rowid as rowid, m.title, m.content, m.tags, p.name as project
    FROM memories m
    LEFT JOIN projects p ON p.id = m.project_id
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

function restoreBackupSnapshot(backup: Partial<KeyMemoryBackup>): void {
  const db = getDatabase();
  const includedTables = Object.keys(backup.tables ?? {});
  const unknownTables = includedTables.filter(table => ![...CORE_TABLES, ...OPTIONAL_TABLES].includes(table as any));
  if (unknownTables.length > 0) {
    throw new Error(`backup contains unsupported table(s): ${unknownTables.join(', ')}`);
  }

  db.transaction(() => {
    for (const table of restoreDeleteOrder()) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    for (const table of restoreInsertOrder(includedTables)) {
      insertRows(table, backup.tables![table].rows);
    }
    rebuildFullTextIndex();
  })();
}

export function createBackupSnapshot(options: BackupOptions = {}): KeyMemoryBackup {
  const normalized: Required<BackupOptions> = {
    includeEmbeddings: options.includeEmbeddings === true,
    includeOperationalLogs: options.includeOperationalLogs === true,
  };
  const tables: Record<string, BackupTableSnapshot> = {};
  const counts: Record<string, number> = {};
  const checksums: Record<string, string> = {};

  for (const table of tableNames(normalized)) {
    const snapshot = readTable(table);
    tables[table] = snapshot;
    counts[table] = snapshot.rows.length;
    checksums[table] = hashTable(snapshot);
  }

  const omittedTables = OPTIONAL_TABLES.filter(table => !tableNames(normalized).includes(table));

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    createdAt: new Date().toISOString(),
    sourceDbPath: getDbPath(),
    options: normalized,
    omittedTables,
    rebuildableTables: ['memories_fts'],
    counts,
    checksums,
    tables,
  };
}

function summarizeBackup(backup: Partial<KeyMemoryBackup>, filePath?: string, bytes?: number): BackupSummary {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tables = backup.tables ?? {};
  const counts = backup.counts ?? {};
  const checksums = backup.checksums ?? {};
  const includedTables = Object.keys(tables);

  if (backup.format !== BACKUP_FORMAT) errors.push(`invalid format: ${String(backup.format)}`);
  if (backup.formatVersion !== BACKUP_FORMAT_VERSION) errors.push(`unsupported formatVersion: ${String(backup.formatVersion)}`);
  for (const table of REQUIRED_TABLES) {
    if (!tables[table]) errors.push(`missing required table: ${table}`);
  }
  for (const [tableName, table] of Object.entries(tables)) {
    if (!Array.isArray(table?.rows)) {
      errors.push(`table ${tableName} rows must be an array`);
      continue;
    }
    if ((counts[tableName] ?? table.rows.length) !== table.rows.length) {
      errors.push(`table ${tableName} count mismatch`);
    }
    const expected = checksums[tableName];
    if (expected && expected !== hashTable(table)) {
      errors.push(`table ${tableName} checksum mismatch`);
    }
  }
  if (!includedTables.includes('embeddings')) {
    warnings.push('embeddings omitted; run rebuild-embeddings after restore');
  }
  if (!includedTables.includes('query_logs')) {
    warnings.push('query_logs omitted by default for privacy');
  }

  return {
    filePath,
    bytes,
    format: backup.format,
    formatVersion: backup.formatVersion,
    appVersion: backup.appVersion,
    createdAt: backup.createdAt,
    valid: errors.length === 0,
    errors,
    warnings,
    counts,
    totalRows: Object.values(counts).reduce((sum, count) => sum + count, 0),
    includedTables,
    omittedTables: backup.omittedTables ?? [],
    rebuildableTables: backup.rebuildableTables ?? [],
    checksums,
  };
}

export function createBackupFile(filePath?: string, options: BackupOptions = {}): BackupSummary {
  const target = path.resolve(filePath ?? backupFileName());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const backup = createBackupSnapshot(options);
  const payload = JSON.stringify(backup, null, 2);
  fs.writeFileSync(target, payload, 'utf8');
  return summarizeBackup(backup, target, Buffer.byteLength(payload, 'utf8'));
}

export function inspectBackupFile(filePath: string): BackupSummary {
  return parseBackupFile(filePath).summary;
}

export function verifyBackupFile(filePath: string): BackupSummary {
  return inspectBackupFile(filePath);
}

export function restoreBackupFile(filePath: string, options: RestoreBackupOptions = {}): BackupSummary {
  const { backup, summary } = parseBackupFile(filePath);
  if (options.dryRun === true) {
    return {
      ...summary,
      dryRun: true,
      wouldRestore: summary.valid,
    };
  }

  if (options.replace !== true) {
    throw new Error('restore requires --dry-run or --replace');
  }
  if (!summary.valid) {
    return {
      ...summary,
      restored: false,
      wouldRestore: false,
    };
  }

  const preRestoreBackup = createBackupFile(options.preRestoreBackupPath ?? preRestoreBackupFileName(), {
    includeEmbeddings: true,
    includeOperationalLogs: true,
  });
  restoreBackupSnapshot(backup);
  return {
    ...summary,
    restored: true,
    wouldRestore: true,
    preRestoreBackupPath: preRestoreBackup.filePath,
  };
}

export function backupSummaryFingerprint(summary: BackupSummary): string {
  return createHash('sha256').update(stableJson({
    format: summary.format,
    formatVersion: summary.formatVersion,
    counts: summary.counts,
    checksums: summary.checksums,
  })).digest('hex');
}
