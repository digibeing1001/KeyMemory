import fs from 'fs';
import os from 'os';
import path from 'path';
import type { CreateMemoryInput, Layer } from '@keymemory/shared';
import { createMemory } from './atom.js';
import { extractTags } from './auto.js';
import { extractProjectPathFromContent, inferMemoryKind, normalizeMemoryInput } from './memory-schema.js';
import { runDreamCycle } from './dreaming.js';
import { getDatabase } from '../db/sqlite.js';

export type ImportFormat = 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
export type MigrationSourceKind = 'file' | 'directory';

export interface MigrationOptions {
  source?: string;
  format?: ImportFormat;
  defaultLayer?: Layer;
  defaultProjectPath?: string;
  runDream?: boolean;
  dryRun?: boolean;
  recursive?: boolean;
  maxFiles?: number;
  sourceIdPrefix?: string;
  sourceRoot?: string;
}

export interface MigrationResult {
  total: number;
  imported: number;
  skipped: number;
  failed: number;
  files: number;
  projectPaths: string[];
  memoryKinds: Record<string, number>;
  errors: { item?: string; error: string }[];
  dreamReportId?: string;
  dryRun?: boolean;
}

export interface MigrationSourceCandidate {
  id: string;
  name: string;
  source: string;
  path: string;
  kind: MigrationSourceKind;
  format: ImportFormat;
  confidence: number;
  reason: string;
  defaultProjectPath?: string;
  fileCount?: number;
}

export interface MigrationDiscoveryOptions {
  roots?: string[];
  includeMissing?: boolean;
  includeHome?: boolean;
  maxFilesPerDirectory?: number;
}

interface RawMemory {
  title?: string;
  content?: string;
  text?: string;
  memory?: string;
  value?: string;
  note?: string;
  summary?: string;
  name?: string;
  layer?: Layer;
  project?: string;
  projectPath?: string;
  tags?: string[] | string;
  metadata?: Record<string, unknown>;
  source?: string;
  sourceId?: string;
}

interface FileImportPayload {
  filePath: string;
  rows: RawMemory[];
  source: string;
  sourceIdPrefix: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.json', '.jsonl', '.ndjson', '.md', '.markdown', '.txt']);
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.vite']);

function detectFormat(filePath: string, requested?: ImportFormat): ImportFormat {
  if (requested && requested !== 'auto') return requested;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.jsonl' || ext === '.ndjson') return 'jsonl';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  return 'text';
}

function titleFromContent(content: string, fallback: string): string {
  const first = content.split(/\r?\n/).map(line => line.trim()).find(Boolean);
  if (!first) return fallback;
  return first.replace(/^#+\s*/, '').slice(0, 80);
}

function contentFromRaw(raw: RawMemory): string {
  const value = [raw.content, raw.text, raw.memory, raw.value, raw.note, raw.summary]
    .find((item): item is string => typeof item === 'string');
  return value?.trim() ?? '';
}

function validLayer(layer: unknown): Layer | undefined {
  return layer === 'flash' || layer === 'short' || layer === 'long' || layer === 'entity' ? layer : undefined;
}

function normalizeTags(rawTags: RawMemory['tags'], content: string): string[] {
  const explicit = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === 'string'
      ? rawTags.split(/[,，\s#]+/g)
      : [];
  return [...new Set([...explicit.map(t => t.trim()).filter(Boolean), ...extractTags(content)])];
}

const GENERIC_SOURCE_SEGMENTS = new Set([
  '.claude',
  '.codex',
  '.cursor',
  '.gemini',
  '.hermes',
  '.mem0',
  '.openclaw',
  '.openmemory',
  'agent',
  'agents',
  'build',
  'cache',
  'config',
  'configs',
  'data',
  'dist',
  'export',
  'exports',
  'hermes',
  'keymemory',
  'memory',
  'memories',
  'note',
  'notes',
  'openclaw',
  'rule',
  'rules',
  'tmp',
  'temp',
  'user',
]);

const PROJECT_HINT_FIELDS = [
  'projectPath',
  'project_path',
  'project',
  'workspace',
  'workspacePath',
  'workspace_path',
  'workingDirectory',
  'working_directory',
  'cwd',
  'repo',
  'repoPath',
  'repo_path',
  'repository',
  'repositoryPath',
  'repository_path',
  'projectRoot',
  'project_root',
];

function cleanProjectSegment(value: string): string | undefined {
  const cleaned = value
    .replace(/\.[a-z0-9]{1,12}$/i, '')
    .replace(/^[.\s_-]+|[.\s_-]+$/g, '')
    .replace(/[<>:"|?*\x00-\x1F]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length < 2 || cleaned.length > 50) return undefined;
  if (GENERIC_SOURCE_SEGMENTS.has(cleaned.toLowerCase())) return undefined;
  return cleaned;
}

function isAbsolutePathLike(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('/') || value.startsWith('~/') || value.startsWith('~\\');
}

function basenameFromAnyPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/g, '');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? normalized;
}

function projectPathFromHint(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (isAbsolutePathLike(trimmed)) return cleanProjectSegment(basenameFromAnyPath(trimmed));
  const parts = trimmed
    .replace(/\[\[|\]\]/g, '')
    .split(/[\/\\>]+|::|->/g)
    .map(cleanProjectSegment)
    .filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join('/') : undefined;
}

function projectPathFromRawMetadata(raw: RawMemory): string | undefined {
  const direct = raw as RawMemory & Record<string, unknown>;
  for (const field of PROJECT_HINT_FIELDS) {
    const value = projectPathFromHint(direct[field]);
    if (value) return value;
  }
  const metadata = raw.metadata ?? {};
  for (const field of PROJECT_HINT_FIELDS) {
    const value = projectPathFromHint(metadata[field]);
    if (value) return value;
  }
  return undefined;
}

function projectPathFromSourceFile(filePath: string, sourceRoot?: string): string | undefined {
  const resolvedFile = path.resolve(filePath);
  if (sourceRoot) {
    const resolvedRoot = path.resolve(sourceRoot);
    const relative = path.relative(resolvedRoot, resolvedFile);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      const relativeDir = path.dirname(relative);
      const parts = relativeDir === '.'
        ? []
        : relativeDir.split(/[\\/]+/g).map(cleanProjectSegment).filter((part): part is string => Boolean(part));
      if (parts.length > 0) return parts.join('/');
      const rootName = cleanProjectSegment(path.basename(resolvedRoot));
      if (rootName) return rootName;
    }
  }
  return cleanProjectSegment(path.basename(path.dirname(resolvedFile)));
}

function workspaceProjectPath(root: string, suffix?: string): string {
  const workspaceName = cleanProjectSegment(path.basename(path.resolve(root))) ?? 'Workspace';
  return suffix ? `Workspaces/${workspaceName}/${suffix}` : `Workspaces/${workspaceName}`;
}

function parseJson(raw: string): RawMemory[] {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed as RawMemory[];
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.memories)) return obj.memories as RawMemory[];
    if (Array.isArray(obj.items)) return obj.items as RawMemory[];
    return [obj as RawMemory];
  }
  return [];
}

function mergeMetadata(raw: RawMemory, extra: Record<string, unknown>): RawMemory {
  const metadata: Record<string, unknown> = { ...(raw.metadata ?? {}) };
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) metadata[key] = value;
  }
  return Object.keys(metadata).length > 0 ? { ...raw, metadata } : raw;
}

function objectToRawMemory(value: unknown, fallbackTitle: string, metadata: Record<string, unknown> = {}): RawMemory | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  const direct = obj as RawMemory;
  if (contentFromRaw(direct)) {
    return mergeMetadata({
      ...direct,
      title: direct.title ?? direct.name ?? fallbackTitle,
    }, metadata);
  }

  for (const key of ['payload', 'data', 'item', 'memory']) {
    const nested = obj[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const raw = objectToRawMemory(nested, fallbackTitle, {
        ...metadata,
        jsonlWrapper: key,
        jsonlType: typeof obj.type === 'string' ? obj.type : undefined,
      });
      if (raw) return raw;
    }
  }

  const message =
    typeof obj.event_msg === 'string' ? obj.event_msg :
    typeof obj.message === 'string' ? obj.message :
    typeof obj.text === 'string' ? obj.text :
    typeof obj.value === 'string' ? obj.value :
    undefined;
  if (!message?.trim()) return null;

  return mergeMetadata({
    title: typeof obj.title === 'string' ? obj.title : fallbackTitle,
    content: message,
    tags: Array.isArray(obj.tags) || typeof obj.tags === 'string' ? obj.tags as RawMemory['tags'] : undefined,
  }, {
    ...metadata,
    jsonlType: typeof obj.type === 'string' ? obj.type : undefined,
  });
}

function rawRowsFromJsonLike(value: unknown, fallbackTitle: string): RawMemory[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => rawRowsFromJsonLike(item, `${fallbackTitle} #${index + 1}`));
  if (!value || typeof value !== 'object') return [];

  const obj = value as Record<string, unknown>;
  const rows: RawMemory[] = [];
  for (const key of ['memories', 'items']) {
    if (Array.isArray(obj[key])) {
      rows.push(...(obj[key] as unknown[]).flatMap((item, index) => rawRowsFromJsonLike(item, `${fallbackTitle} ${key} #${index + 1}`)));
    }
  }
  const direct = objectToRawMemory(obj, fallbackTitle);
  if (direct) rows.push(direct);
  return rows;
}

function parseJsonl(raw: string, basename: string): RawMemory[] {
  const rows: RawMemory[] = [];
  const lines = raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i]) as unknown;
      rows.push(...rawRowsFromJsonLike(parsed, `${basename} #${i + 1}`));
    } catch {
      // JSONL exports often interleave comments or corrupt tail lines; keep valid memories moving.
    }
  }
  return rows;
}

function parseMarkdown(raw: string, basename: string): RawMemory[] {
  const sections = raw.split(/^---\s*$/gm).map(s => s.trim()).filter(Boolean);
  const chunks = sections.length > 1 ? sections : raw.split(/\n(?=^#{1,3}\s+)/gm).map(s => s.trim()).filter(Boolean);
  return chunks.map((content, index) => ({
    title: titleFromContent(content, `${basename} #${index + 1}`),
    content,
  }));
}

function parseText(raw: string, basename: string): RawMemory[] {
  const chunks = raw.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  return chunks.map((content, index) => ({
    title: titleFromContent(content, `${basename} #${index + 1}`),
    content,
  }));
}

function normalizeRawMemory(raw: RawMemory, options: MigrationOptions, index: number, filePath?: string): CreateMemoryInput {
  const content = contentFromRaw(raw);
  if (!content) throw new Error('empty content');

  const explicitProjectPath = raw.projectPath ?? raw.project ?? extractProjectPathFromContent(content);
  const metadataProjectPath = projectPathFromRawMetadata(raw);
  const sourceProjectPath = filePath ? projectPathFromSourceFile(filePath, options.sourceRoot) : undefined;
  const projectPath = explicitProjectPath ?? metadataProjectPath ?? options.defaultProjectPath ?? sourceProjectPath;
  const tags = normalizeTags(raw.tags, content);
  const title = raw.title?.trim() || raw.name?.trim() || titleFromContent(content, `Imported memory #${index + 1}`);
  const memoryKind = inferMemoryKind(content, title);
  const source = options.source ?? raw.source ?? 'migration';
  const sourceId = raw.sourceId ?? (options.sourceIdPrefix ? `${options.sourceIdPrefix}#${index + 1}` : undefined);
  const projectRouting = projectPath ? {
    inferredPath: projectPath,
    method: explicitProjectPath ? 'content-pattern' : metadataProjectPath ? 'source-metadata' : options.defaultProjectPath ? 'source-default' : 'source-path',
    sourcePath: filePath,
  } : undefined;

  return {
    title,
    content,
    // 迁移默认层从 long 改为 short：避免历史长内容一律进 long 形成只进不出
    // task 类→short；其余未指定→short，由 dream 升格到 long
    layer: validLayer(raw.layer) ?? options.defaultLayer ?? (memoryKind === 'task' ? 'short' : 'short'),
    projectPath,
    tags,
    metadata: {
      ...(raw.metadata ?? {}),
      importedAt: new Date().toISOString(),
      importSource: source,
      originalSourceId: sourceId,
      ...(projectRouting ? { projectRouting } : {}),
    },
    source,
    sourceId,
  };
}

function createEmptyResult(): MigrationResult {
  return {
    total: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    files: 0,
    projectPaths: [],
    memoryKinds: {},
    errors: [],
  };
}

function mergeResult(target: MigrationResult, next: MigrationResult): void {
  if (next.dryRun) target.dryRun = true;
  target.total += next.total;
  target.imported += next.imported;
  target.skipped += next.skipped;
  target.failed += next.failed;
  target.files += next.files;
  for (const [kind, count] of Object.entries(next.memoryKinds)) {
    target.memoryKinds[kind] = (target.memoryKinds[kind] ?? 0) + count;
  }
  target.projectPaths = [...new Set([...target.projectPaths, ...next.projectPaths])].sort();
  target.errors.push(...next.errors);
}

function sourceIdExists(source: string | undefined, sourceId: string | undefined): boolean {
  if (!source || !sourceId) return false;
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id FROM memories
    WHERE source = ? AND source_id = ? AND status != 'deleted'
    LIMIT 1
  `).get(source, sourceId);
  return Boolean(row);
}

function parseFile(filePath: string, options: MigrationOptions = {}): FileImportPayload {
  const format = detectFormat(filePath, options.format);
  const raw = fs.readFileSync(filePath, 'utf8');
  const basename = path.basename(filePath);
  const rows =
    format === 'json' ? parseJson(raw) :
    format === 'jsonl' ? parseJsonl(raw, basename) :
    format === 'markdown' ? parseMarkdown(raw, basename) :
    parseText(raw, basename);
  const resolved = path.resolve(filePath);

  return {
    filePath: resolved,
    rows,
    source: options.source ?? 'migration',
    sourceIdPrefix: options.sourceIdPrefix ?? resolved,
  };
}

async function importRows(payload: FileImportPayload, options: MigrationOptions): Promise<MigrationResult> {
  const result = createEmptyResult();
  if (options.dryRun) result.dryRun = true;
  result.files = 1;
  result.total = payload.rows.length;
  const projectPaths = new Set<string>();

  for (let i = 0; i < payload.rows.length; i++) {
    try {
      const input = normalizeRawMemory(payload.rows[i], {
        ...options,
        source: options.source ?? payload.source,
        sourceIdPrefix: payload.sourceIdPrefix,
      }, i, payload.filePath);
      if (sourceIdExists(input.source, input.sourceId)) {
        result.skipped++;
        continue;
      }
      if (options.dryRun) {
        const normalized = normalizeMemoryInput(input);
        const kind = normalized.metadata?.memoryKind as string | undefined;
        if (kind) result.memoryKinds[kind] = (result.memoryKinds[kind] ?? 0) + 1;
        if (normalized.projectPath) projectPaths.add(normalized.projectPath);
        result.imported++;
        continue;
      }
      const mem = createMemory(input);
      // 后处理（实体链接 + embedding + autoAssociate）已内聚到 createMemory 内部

      const kind = (mem.metadata as Record<string, unknown> | undefined)?.memoryKind as string | undefined;
      if (kind) result.memoryKinds[kind] = (result.memoryKinds[kind] ?? 0) + 1;
      if (input.projectPath) projectPaths.add(input.projectPath);
      result.imported++;
    } catch (err) {
      result.failed++;
      result.errors.push({ item: payload.rows[i]?.title ?? `${path.basename(payload.filePath)} #${i + 1}`, error: (err as Error).message });
    }
  }

  result.projectPaths = Array.from(projectPaths).sort();
  return result;
}

export async function migrateMemoriesFromFile(filePath: string, options: MigrationOptions = {}): Promise<MigrationResult> {
  const payload = parseFile(filePath, options);
  const result = await importRows(payload, options);

  if (options.runDream && !options.dryRun && result.imported > 0) {
    const report = runDreamCycle();
    result.dreamReportId = report.id;
  }

  return result;
}

function collectSupportedFiles(dirPath: string, recursive: boolean, maxFiles: number): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    if (files.length >= maxFiles) return;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !IGNORED_DIRS.has(entry.name)) walk(fullPath);
        continue;
      }
      if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  };
  walk(dirPath);
  return files;
}

export async function migrateMemoriesFromPath(targetPath: string, options: MigrationOptions = {}): Promise<MigrationResult> {
  const resolved = path.resolve(targetPath);
  const stat = fs.statSync(resolved);
  if (stat.isFile()) {
    return migrateMemoriesFromFile(resolved, options);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Unsupported migration path: ${targetPath}`);
  }

  const aggregate = createEmptyResult();
  if (options.dryRun) aggregate.dryRun = true;
  const maxFiles = options.maxFiles ?? 200;
  const files = collectSupportedFiles(resolved, options.recursive !== false, maxFiles);
  for (const file of files) {
    const next = await migrateMemoriesFromFile(file, { ...options, runDream: false, sourceIdPrefix: path.resolve(file), sourceRoot: options.sourceRoot ?? resolved });
    mergeResult(aggregate, next);
  }
  aggregate.files = files.length;

  if (options.runDream && !options.dryRun && aggregate.imported > 0) {
    const report = runDreamCycle();
    aggregate.dreamReportId = report.id;
  }

  return aggregate;
}

function candidateId(source: string, candidatePath: string): string {
  return `${source}:${path.resolve(candidatePath).toLowerCase()}`;
}

function fileCount(candidatePath: string, maxFiles: number): number | undefined {
  try {
    const stat = fs.statSync(candidatePath);
    if (stat.isFile()) return 1;
    if (stat.isDirectory()) return collectSupportedFiles(candidatePath, true, maxFiles).length;
  } catch {
    return undefined;
  }
  return undefined;
}

function addCandidate(
  candidates: MigrationSourceCandidate[],
  input: Omit<MigrationSourceCandidate, 'id' | 'fileCount'>,
  options: MigrationDiscoveryOptions
): void {
  const exists = fs.existsSync(input.path);
  if (!exists && !options.includeMissing) return;
  const count = exists ? fileCount(input.path, options.maxFilesPerDirectory ?? 200) : undefined;
  if (exists && input.kind === 'directory' && count === 0) return;
  candidates.push({
    ...input,
    id: candidateId(input.source, input.path),
    fileCount: count,
  });
}

function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

function configPath(...parts: string[]): string {
  if (process.platform === 'win32' && process.env.APPDATA) return path.join(process.env.APPDATA, ...parts);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.config'), ...parts);
}

export function discoverMigrationSources(options: MigrationDiscoveryOptions = {}): MigrationSourceCandidate[] {
  const candidates: MigrationSourceCandidate[] = [];
  const roots = options.roots?.map(r => path.resolve(r)).filter(Boolean) ?? [process.cwd()];
  const includeHome = options.includeHome !== false;

  if (includeHome) {
    addCandidate(candidates, {
      name: 'Codex memories',
      source: 'codex',
      path: homePath('.codex', 'memories'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.95,
      reason: 'Codex durable memory folder',
      defaultProjectPath: 'Migrated/Codex',
    }, options);

    addCandidate(candidates, {
      name: 'Codex MEMORY.md',
      source: 'codex',
      path: homePath('.codex', 'memories', 'MEMORY.md'),
      kind: 'file',
      format: 'markdown',
      confidence: 0.98,
      reason: 'Codex memory registry',
      defaultProjectPath: 'Migrated/Codex',
    }, options);

    addCandidate(candidates, {
      name: 'Claude Code global memory',
      source: 'claude-code',
      path: homePath('.claude', 'CLAUDE.md'),
      kind: 'file',
      format: 'markdown',
      confidence: 0.85,
      reason: 'Claude Code global CLAUDE.md',
      defaultProjectPath: 'Migrated/Claude Code',
    }, options);

    addCandidate(candidates, {
      name: 'Claude Code memories',
      source: 'claude-code',
      path: homePath('.claude', 'memories'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.8,
      reason: 'Claude Code local memory folder',
      defaultProjectPath: 'Migrated/Claude Code',
    }, options);

    addCandidate(candidates, {
      name: 'Hermes memories',
      source: 'hermes',
      path: homePath('.hermes', 'memories'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.78,
      reason: 'Hermes local memory folder',
      defaultProjectPath: 'Migrated/Hermes',
    }, options);

    addCandidate(candidates, {
      name: 'Cursor rules',
      source: 'cursor',
      path: configPath('Cursor', 'User', 'rules'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.7,
      reason: 'Cursor user rules often contain persistent preferences',
      defaultProjectPath: 'Migrated/Cursor',
    }, options);

    addCandidate(candidates, {
      name: 'Gemini global memory',
      source: 'gemini',
      path: homePath('.gemini', 'GEMINI.md'),
      kind: 'file',
      format: 'markdown',
      confidence: 0.75,
      reason: 'Gemini CLI persistent instruction file',
      defaultProjectPath: 'Migrated/Gemini',
    }, options);

    addCandidate(candidates, {
      name: 'OpenClaw memories',
      source: 'openclaw',
      path: homePath('.openclaw', 'memories'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.78,
      reason: 'OpenClaw local memory folder',
      defaultProjectPath: 'Migrated/OpenClaw',
    }, options);

    addCandidate(candidates, {
      name: 'OpenClaw config memories',
      source: 'openclaw',
      path: configPath('openclaw', 'memories'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.72,
      reason: 'OpenClaw config-scoped memory folder',
      defaultProjectPath: 'Migrated/OpenClaw',
    }, options);

    addCandidate(candidates, {
      name: 'OpenMemory local store',
      source: 'openmemory',
      path: homePath('.openmemory'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.7,
      reason: 'OpenMemory local data directory',
      defaultProjectPath: 'Migrated/OpenMemory',
    }, options);

    addCandidate(candidates, {
      name: 'Mem0 local store',
      source: 'mem0',
      path: homePath('.mem0'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.7,
      reason: 'Mem0 local data directory',
      defaultProjectPath: 'Migrated/Mem0',
    }, options);
  }

  for (const root of roots) {
    addCandidate(candidates, {
      name: 'Workspace AGENTS.md',
      source: 'workspace-agents',
      path: path.join(root, 'AGENTS.md'),
      kind: 'file',
      format: 'markdown',
      confidence: 0.65,
      reason: 'Agent project instructions can be migrated as project preferences',
      defaultProjectPath: workspaceProjectPath(root),
    }, options);
    addCandidate(candidates, {
      name: 'Workspace .cursor/rules',
      source: 'cursor',
      path: path.join(root, '.cursor', 'rules'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.72,
      reason: 'Workspace Cursor rules',
      defaultProjectPath: workspaceProjectPath(root, 'Cursor Rules'),
    }, options);
    addCandidate(candidates, {
      name: 'Workspace .claude',
      source: 'claude-code',
      path: path.join(root, '.claude'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.72,
      reason: 'Workspace Claude Code memory/instructions',
      defaultProjectPath: workspaceProjectPath(root, 'Claude Code'),
    }, options);
    addCandidate(candidates, {
      name: 'Workspace .hermes',
      source: 'hermes',
      path: path.join(root, '.hermes'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.72,
      reason: 'Workspace Hermes memory/instructions',
      defaultProjectPath: workspaceProjectPath(root, 'Hermes'),
    }, options);
    addCandidate(candidates, {
      name: 'Workspace .openclaw',
      source: 'openclaw',
      path: path.join(root, '.openclaw'),
      kind: 'directory',
      format: 'auto',
      confidence: 0.72,
      reason: 'Workspace OpenClaw memory/instructions',
      defaultProjectPath: workspaceProjectPath(root, 'OpenClaw'),
    }, options);
  }

  const seen = new Set<string>();
  return candidates
    .filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));
}

export async function migrateMigrationSources(
  sources: MigrationSourceCandidate[],
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const aggregate = createEmptyResult();
  for (const source of sources) {
    const next = await migrateMemoriesFromPath(source.path, {
      ...options,
      source: options.source ?? source.source,
      format: options.format ?? source.format,
      defaultProjectPath: options.defaultProjectPath ?? source.defaultProjectPath,
      sourceRoot: source.kind === 'directory' ? source.path : path.dirname(source.path),
      runDream: false,
    });
    mergeResult(aggregate, next);
  }

  if (options.runDream && !options.dryRun && aggregate.imported > 0) {
    const report = runDreamCycle();
    aggregate.dreamReportId = report.id;
  }

  return aggregate;
}
