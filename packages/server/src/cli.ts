#!/usr/bin/env node
import { Command } from 'commander';
import { initDatabase, closeDatabase, getDataDir, getDbPath } from './db/sqlite.js';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory, exportMemoriesAsJson, importMemories, listVersions, getVersion, revertToVersion, recordHit } from './core/atom.js';
import { searchHybrid, ensureEmbedding, findDuplicateMemories } from './core/query.js';
import { moveLayer, getLayerStats } from './core/layer.js';
import { autoRemember, extractTags } from './core/auto.js';
import { runDailyInspection, getPendingTasks, resolveTask } from './core/evolution.js';
import { forgetMemory, restoreMemory, getDecayingMemories, applyDecay } from './core/forgetting.js';
import { runDreamCycle, getDreamReport, listDreamReports, getDreamSignalsForReport, formatDreamReport, rollbackDream } from './core/dreaming.js';
import { getSchedulerConfig, updateSchedulerConfig } from './core/scheduler.js';
import { getHealthReport } from './core/health.js';
import { listEntities, getEntityGraph, extractEntities, createMemoryRelation, findRelatedMemories, MEMORY_RELATION_TYPES } from './graph/entity.js';
import { discoverMigrationSources, migrateMemoriesFromPath, migrateMigrationSources } from './core/migration.js';
import { buildAgentContextPack } from './core/context-pack.js';
import { buildAgentConfigSnippets, listAgentConfigTargets } from './core/agent-config.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile, verifyBackupFile } from './core/backup.js';
import { acceptProjectSuggestion, listProjectSuggestions, rejectProjectSuggestion } from './core/project.js';
import { initEmbedding } from './embed/onnx.js';
import { assertSafeServerBinding, createCorsOriginPolicy } from './core/security.js';
import type { Layer, MemoryKind, MemoryStatus, ForgetMethod } from '@keymemory/shared';
import { LAYER_CONFIG, DEFAULT_PORT, DEFAULT_HOST } from '@keymemory/shared';

type OutputFormat = 'json' | 'table' | 'compact';

function formatOutput(data: unknown, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(data, null, 2);
  }

  if (format === 'compact') {
    if (Array.isArray(data)) {
      return data.map(item => compactLine(item)).join('\n');
    }
    return compactLine(data);
  }

  return tableFormat(data);
}

function compactLine(item: any): string {
  if (item.memory) {
    const m = item.memory;
    return `${m.id}\t[${m.layer}]\t${m.title}`;
  }
  if (item.id && item.title) {
    return `${item.id}\t[${item.layer || '?'}]\t${item.title}`;
  }
  return JSON.stringify(item);
}

function tableFormat(data: unknown): string {
  if (typeof data !== 'object' || data === null) return String(data);

  if (Array.isArray(data)) {
    if (data.length === 0) return '(empty)';

    const items = data.map(d => {
      if (d && typeof d === 'object' && 'memory' in d) return d.memory;
      return d;
    });

    const rows = items.map((item: any) => {
      if (!item || typeof item !== 'object') return [String(item)];
      return [
        item.id?.slice(0, 8) || '-',
        item.layer || '-',
        (item.title || '-').slice(0, 40),
        item.status || '-',
        item.hitCount?.toString() || '0',
      ];
    });

    const headers = ['ID', 'Layer', 'Title', 'Status', 'Hits'];
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map(r => r[i].length)) + 2
    );

    const headerLine = headers.map((h, i) => h.padEnd(colWidths[i])).join('');
    const separator = colWidths.map(w => '-'.repeat(w)).join('  ');
    const dataLines = rows.map(r => r.map((c, i) => c.padEnd(colWidths[i])).join('  '));

    return [headerLine, separator, ...dataLines].join('\n');
  }

  const obj = data as Record<string, unknown>;
  const maxKeyLen = Math.max(...Object.keys(obj).map(k => k.length));
  return Object.entries(obj)
    .map(([k, v]) => {
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k.padEnd(maxKeyLen + 1)} ${val}`;
    })
    .join('\n');
}

function parseTags(val: string): string[] {
  return val.split(',').map(t => t.trim()).filter(Boolean);
}

function parseMetadata(val: string): Record<string, unknown> {
  try {
    return JSON.parse(val);
  } catch {
    const obj: Record<string, unknown> = {};
    for (const pair of val.split(',')) {
      const [k, ...rest] = pair.split(':');
      if (k) obj[k.trim()] = rest.join(':').trim();
    }
    return obj;
  }
}

function parsePathList(val?: string): string[] | undefined {
  if (!val) return undefined;
  return val.split(/[;,]/g).map(p => p.trim()).filter(Boolean);
}

function parseMemoryKinds(val?: string): MemoryKind[] | undefined {
  if (!val) return undefined;
  return val.split(',').map(t => t.trim()).filter(Boolean) as MemoryKind[];
}

function parseProjectSuggestionStatus(val?: string): 'pending' | 'accepted' | 'rejected' | undefined {
  if (!val) return undefined;
  if (val === 'pending' || val === 'accepted' || val === 'rejected') return val;
  printError(`Invalid project suggestion status: ${val}`);
}

function parseAgentTarget(val?: string): ReturnType<typeof listAgentConfigTargets>[number] | 'all' {
  const target = val ?? 'all';
  const allowed = new Set([...listAgentConfigTargets(), 'all']);
  if (!allowed.has(target as ReturnType<typeof listAgentConfigTargets>[number] | 'all')) {
    printError(`Unsupported agent-config target: ${target}`);
  }
  return target as ReturnType<typeof listAgentConfigTargets>[number] | 'all';
}

function ensureInit(): void {
  initDatabase();
  initEmbedding().catch(() => {});
}

function printAndExit(data: unknown, format: OutputFormat, exitCode = 0): never {
  process.stdout.write(formatOutput(data, format) + '\n');
  closeDatabase();
  process.exit(exitCode);
}

function printError(message: string, exitCode = 1): never {
  process.stderr.write(`Error: ${message}\n`);
  closeDatabase();
  process.exit(exitCode);
}

const program = new Command();

program
  .name('keymemory')
  .description('KeyMemory - Agent-friendly memory CLI')
  .version('0.1.0')
  .option('--format <type>', 'output format: json, table, compact', 'json')
  .option('--data-dir <path>', 'data directory path')
  .hook('preAction', () => {
    const opts = program.opts();
    if (opts.dataDir) {
      process.env.KEYMEMORY_DATA_DIR = opts.dataDir;
    }
    ensureInit();
  });

program
  .command('create')
  .description('Create a new memory')
  .requiredOption('-t, --title <title>', 'memory title')
  .requiredOption('-c, --content <content>', 'memory content')
  .requiredOption('-l, --layer <layer>', 'memory layer: flash|short|long|entity')
  .option('-p, --projectId <projectId>', 'associated project ID')
  .option('--project-path <projectPath>', 'project path, auto-created if missing')
  .option('--tags <tags>', 'comma-separated tags')
  .option('--metadata <json>', 'JSON metadata or key:val pairs')
  .option('--source <source>', 'memory source identifier')
  .option('--source-id <sourceId>', 'source system ID')
  .action(async (opts) => {
    const validLayers: Layer[] = ['flash', 'short', 'long', 'entity'];
    if (!validLayers.includes(opts.layer as Layer)) {
      printError(`Invalid layer: ${opts.layer}. Must be one of: ${validLayers.join(', ')}`);
    }

    const tags = opts.tags ? parseTags(opts.tags) : extractTags(opts.content);
    const metadata = opts.metadata ? parseMetadata(opts.metadata) : undefined;

    const mem = createMemory({
      title: opts.title,
      content: opts.content,
      layer: opts.layer as Layer,
      projectId: opts.projectId,
      projectPath: opts.projectPath,
      tags,
      metadata,
      source: opts.source,
      sourceId: opts.sourceId,
    });

    ensureEmbedding(mem.id, mem.title, mem.content, mem.tags, mem.metadata as Record<string, unknown> | undefined).catch(() => {});

    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(mem, format);
  });

program
  .command('read <id>')
  .description('Read a memory by ID')
  .action((id) => {
    const mem = getMemory(id);
    if (!mem) printError(`Memory not found: ${id}`);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(mem, format);
  });

program
  .command('update <id>')
  .description('Update an existing memory')
  .option('-t, --title <title>', 'new title')
  .option('-c, --content <content>', 'new content')
  .option('-l, --layer <layer>', 'new layer')
  .option('-p, --projectId <projectId>', 'new project ID')
  .option('--tags <tags>', 'new comma-separated tags')
  .option('--metadata <json>', 'new JSON metadata')
  .option('--reason <reason>', 'change reason')
  .action(async (id, opts) => {
    const updateData: any = {};
    if (opts.title !== undefined) updateData.title = opts.title;
    if (opts.content !== undefined) updateData.content = opts.content;
    if (opts.layer !== undefined) updateData.layer = opts.layer;
    if (opts.projectId !== undefined) updateData.projectId = opts.projectId;
    if (opts.tags !== undefined) updateData.tags = parseTags(opts.tags);
    if (opts.metadata !== undefined) updateData.metadata = parseMetadata(opts.metadata);

    const mem = updateMemory(id, updateData, opts.reason);
    if (!mem) printError(`Memory not found: ${id}`);

    if (updateData.title !== undefined || updateData.content !== undefined) {
      ensureEmbedding(mem!.id, mem!.title, mem!.content, mem!.tags, mem!.metadata as Record<string, unknown> | undefined, true).catch(() => {});
    }

    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(mem, format);
  });

program
  .command('delete <id>')
  .description('Delete a memory')
  .option('--permanent', 'permanently remove (cannot be restored)')
  .action((id, opts) => {
    const ok = deleteMemory(id, opts.permanent || false);
    if (!ok) printError(`Memory not found: ${id}`);
    printAndExit({ success: true, id, permanent: opts.permanent || false }, program.opts().format || 'json');
  });

program
  .command('search <query>')
  .description('Search memories (hybrid: fulltext + semantic)')
  .option('-n, --limit <number>', 'max results', '10')
  .option('-l, --layer <layer>', 'filter by layer')
  .option('-p, --projectId <projectId>', 'filter by project ID; includes descendants by default')
  .option('--no-descendants', 'exclude child projects when --projectId is used')
  .option('--kind <memoryKind>', 'filter by memory kind')
  .option('--include-superseded', 'include memories superseded by active newer memories')
  .action(async (query, opts) => {
    const results = await searchHybrid(query, {
      limit: parseInt(opts.limit, 10),
      layer: opts.layer as Layer | undefined,
      projectId: opts.projectId,
      includeDescendants: opts.descendants,
      includeSuperseded: Boolean(opts.includeSuperseded),
      memoryKind: opts.kind,
    });

    if (results.length === 0) {
      const format: OutputFormat = program.opts().format || 'json';
      if (format === 'json') {
        printAndExit([], format);
      } else {
        process.stdout.write('No memories found.\n');
        closeDatabase();
        process.exit(0);
      }
    }

    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(results, format);
  });

program
  .command('context [query]')
  .description('Build an agent-ready memory context pack')
  .option('--project <project>', 'project path/name/id; descendants included by default')
  .option('--project-id <projectId>', 'project ID')
  .option('--no-descendants', 'exclude child projects')
  .option('--kinds <memoryKinds>', 'comma-separated memory kinds')
  .option('--max-items <number>', 'max memories to include', '12')
  .option('--max-chars <number>', 'approximate character budget', '6000')
  .option('--markdown', 'print markdown context only')
  .action(async (query, opts) => {
    const pack = await buildAgentContextPack({
      query,
      project: opts.project,
      projectId: opts.projectId,
      includeDescendants: opts.descendants,
      memoryKinds: parseMemoryKinds(opts.kinds),
      maxItems: parseInt(opts.maxItems, 10),
      maxChars: parseInt(opts.maxChars, 10),
    });
    if (opts.markdown) {
      process.stdout.write(pack.markdown + '\n');
      closeDatabase();
      process.exit(0);
    }
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(pack, format);
  });

program
  .command('list')
  .description('List recent memories')
  .option('-l, --layer <layer>', 'filter by layer')
  .option('-p, --projectId <projectId>', 'filter by project ID')
  .option('-s, --status <status>', 'filter by status', 'active')
  .option('-n, --limit <number>', 'max results', '20')
  .action((opts) => {
    const mems = listMemories({
      layer: opts.layer as Layer | undefined,
      projectId: opts.projectId,
      status: opts.status as MemoryStatus | undefined,
      limit: parseInt(opts.limit, 10),
    });

    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(mems, format);
  });

program
  .command('auto-remember')
  .description('Auto-evaluate and record memory from content')
  .requiredOption('-c, --content <content>', 'content to evaluate')
  .option('--agent-id <agentId>', 'agent identifier')
  .option('--projectId <projectId>', 'current project ID')
  .action(async (opts) => {
    const result = await autoRemember({
      content: opts.content,
      agentId: opts.agentId,
      currentProjectId: opts.projectId,
    });

    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(result, format);
  });

program
  .command('import')
  .description('Import memories from a JSON file')
  .requiredOption('-f, --file <path>', 'JSON file to import')
  .option('--source <source>', 'source identifier for imported memories')
  .action(async (opts) => {
    const fs = await import('fs');
    const data = fs.readFileSync(opts.file, 'utf-8');
    const result = importMemories(data);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(result, format);
  });

program
  .command('migrate <path>')
  .description('Migrate one memory file or directory, then normalize project tree and memory schema')
  .option('--format <format>', 'auto|json|jsonl|markdown|text', 'auto')
  .option('--source <source>', 'source identifier, e.g. local-memory, mem0, obsidian, chatgpt', 'migration')
  .option('--default-layer <layer>', 'fallback layer: flash|short|long|entity', 'long')
  .option('--default-project-path <path>', 'fallback project path when source has none')
  .option('--no-recursive', 'when path is a directory, import only top-level files')
  .option('--max-files <number>', 'directory import file cap', '200')
  .option('--run-dream', 'run dream cycle after import')
  .option('--dry-run', 'preview migration counts without writing memories or running dream')
  .action(async (targetPath, opts) => {
    const result = await migrateMemoriesFromPath(targetPath, {
      format: opts.format,
      source: opts.source,
      defaultLayer: opts.defaultLayer as Layer,
      defaultProjectPath: opts.defaultProjectPath,
      recursive: opts.recursive,
      maxFiles: parseInt(opts.maxFiles, 10),
      runDream: Boolean(opts.runDream),
      dryRun: Boolean(opts.dryRun),
    });
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(result, format);
  });

program
  .command('migrate-discover')
  .description('Discover local memory sources for one-click migration')
  .option('--root <paths>', 'extra workspace roots, separated by ; or ,')
  .option('--no-home', 'skip home-directory memory sources')
  .option('--include-missing', 'include expected paths that do not exist')
  .action((opts) => {
    const sources = discoverMigrationSources({
      roots: parsePathList(opts.root),
      includeHome: opts.home,
      includeMissing: Boolean(opts.includeMissing),
    });
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(sources, format);
  });

program
  .command('migrate-auto')
  .description('One-click migrate all discovered local memory sources')
  .option('--root <paths>', 'extra workspace roots, separated by ; or ,')
  .option('--no-home', 'skip home-directory memory sources')
  .option('--min-confidence <number>', 'minimum discovery confidence', '0.7')
  .option('--default-layer <layer>', 'fallback layer: flash|short|long|entity', 'long')
  .option('--default-project-path <path>', 'fallback project path when source has none')
  .option('--max-files <number>', 'per-directory file cap', '200')
  .option('--run-dream', 'run dream cycle after import')
  .option('--dry-run', 'preview one-click migration counts without writing memories or running dream')
  .action(async (opts) => {
    const minConfidence = parseFloat(opts.minConfidence);
    const sources = discoverMigrationSources({ roots: parsePathList(opts.root), includeHome: opts.home })
      .filter(source => source.confidence >= minConfidence);
    const result = await migrateMigrationSources(sources, {
      defaultLayer: opts.defaultLayer as Layer,
      defaultProjectPath: opts.defaultProjectPath,
      maxFiles: parseInt(opts.maxFiles, 10),
      runDream: Boolean(opts.runDream),
      dryRun: Boolean(opts.dryRun),
    });
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit({ ...result, sources }, format);
  });

program
  .command('onboard')
  .description('Run first-time onboarding: discover old memories, optionally migrate them, and print Agent config snippets')
  .option('--root <paths>', 'extra workspace roots, separated by ; or ,')
  .option('--no-home', 'skip home-directory memory sources')
  .option('--min-confidence <number>', 'minimum discovery confidence', '0.7')
  .option('--default-layer <layer>', 'fallback layer: flash|short|long|entity', 'long')
  .option('--default-project-path <path>', 'fallback project path when source has none')
  .option('--max-files <number>', 'per-directory file cap', '200')
  .option('--run-dream', 'run dream cycle after migration')
  .option('--yes', 'write migrated memories; without this, onboarding is a dry-run preview')
  .option('--no-backup', 'skip safety backup before --yes migration')
  .option('--backup-file <path>', 'backup file path used before --yes migration')
  .option('--agent-target <target>', 'agent config target: generic|claude-desktop|claude-code|hermes|openclaw|codex|all', 'all')
  .option('--config-root <path>', 'KeyMemory project root for generated launcher path')
  .action(async (opts) => {
    const minConfidence = parseFloat(opts.minConfidence);
    const sources = discoverMigrationSources({
      roots: parsePathList(opts.root),
      includeHome: opts.home,
      maxFilesPerDirectory: parseInt(opts.maxFiles, 10),
    }).filter(source => source.confidence >= minConfidence);
    const dryRun = !Boolean(opts.yes);
    const agentTarget = parseAgentTarget(opts.agentTarget);
    const backup = !dryRun && opts.backup !== false
      ? createBackupFile(typeof opts.backupFile === 'string' ? opts.backupFile : undefined)
      : undefined;
    const migration = await migrateMigrationSources(sources, {
      defaultLayer: opts.defaultLayer as Layer,
      defaultProjectPath: opts.defaultProjectPath,
      maxFiles: parseInt(opts.maxFiles, 10),
      runDream: Boolean(opts.runDream),
      dryRun,
    });
    const agentConfigs = buildAgentConfigSnippets(agentTarget, opts.configRoot);
    const scheduler = getSchedulerConfig();

    const result = {
      mode: dryRun ? 'preview' : 'applied',
      writeEnabled: !dryRun,
      nextCommand: dryRun ? 'keymemory onboard --yes --run-dream' : 'keymemory doctor',
      dataDir: getDataDir(),
      dbPath: getDbPath(),
      sources,
      migration,
      backup,
      agentConfigs,
      scheduler,
    };
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(result, format);
  });

program
  .command('export')
  .description('Export memories as JSON')
  .option('-l, --layer <layer>', 'filter by layer')
  .option('-s, --status <status>', 'filter by status')
  .action((opts) => {
    const json = exportMemoriesAsJson({
      layer: opts.layer as Layer | undefined,
      status: opts.status as MemoryStatus | undefined,
    });
    process.stdout.write(json + '\n');
    closeDatabase();
    process.exit(0);
  });

program
  .command('backup-create [file]')
  .description('Create a portable JSON backup of KeyMemory data')
  .option('--include-embeddings', 'include embedding blobs; larger backup')
  .option('--include-operational-logs', 'include query logs; may contain sensitive user text')
  .action((file, opts) => {
    const summary = createBackupFile(file, {
      includeEmbeddings: Boolean(opts.includeEmbeddings),
      includeOperationalLogs: Boolean(opts.includeOperationalLogs),
    });
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(summary, format);
  });

program
  .command('backup-inspect <file>')
  .description('Inspect and validate a KeyMemory backup file')
  .action((file) => {
    const summary = inspectBackupFile(file);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(summary, format, summary.valid ? 0 : 1);
  });

program
  .command('backup-verify <file>')
  .description('Verify a KeyMemory backup file without changing current data')
  .action((file) => {
    const summary = verifyBackupFile(file);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(summary, format, summary.valid ? 0 : 1);
  });

program
  .command('backup-restore <file>')
  .description('Restore a KeyMemory backup file, or validate restore readiness')
  .option('--dry-run', 'validate restore plan without writing data')
  .option('--replace', 'replace current database content after creating a pre-restore backup')
  .option('--pre-restore-backup <file>', 'path for automatic safety backup before --replace')
  .action((file, opts) => {
    if (!opts.dryRun && !opts.replace) {
      printError('backup-restore requires --dry-run or --replace');
    }
    const summary = restoreBackupFile(file, {
      dryRun: Boolean(opts.dryRun),
      replace: Boolean(opts.replace),
      preRestoreBackupPath: opts.preRestoreBackup,
    });
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(summary, format, summary.valid ? 0 : 1);
  });

program
  .command('stats')
  .description('Show memory statistics by layer')
  .action(() => {
    const stats = getLayerStats();
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(stats, format);
  });

program
  .command('health')
  .description('Show health report')
  .action(async () => {
    const report = await getHealthReport();
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(report, format);
  });

program
  .command('decay')
  .description('Apply decay to aging memories')
  .action(() => {
    const result = applyDecay();
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(result, format);
  });

program
  .command('inspect')
  .description('Run daily evolution inspection')
  .action(async () => {
    const tasks = await runDailyInspection();
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(tasks, format);
  });

program
  .command('tasks')
  .description('List pending evolution tasks')
  .action(() => {
    const tasks = getPendingTasks();
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(tasks, format);
  });

program
  .command('resolve <taskId>')
  .description('Resolve an evolution task')
  .requiredOption('-a, --action <action>', 'action: accepted|rejected')
  .action((taskId, opts) => {
    if (!['accepted', 'rejected'].includes(opts.action)) {
      printError('Action must be accepted or rejected');
    }
    const task = resolveTask(taskId, opts.action);
    if (!task) printError(`Task not found: ${taskId}`);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(task, format);
  });

program
  .command('forget <id>')
  .description('Forget a memory (archive, decay, or delete)')
  .requiredOption('-m, --method <method>', 'method: archive|decay|delete')
  .action((id, opts) => {
    const validMethods: ForgetMethod[] = ['archive', 'decay', 'delete'];
    if (!validMethods.includes(opts.method as ForgetMethod)) {
      printError(`Invalid method: ${opts.method}. Must be one of: ${validMethods.join(', ')}`);
    }
    const ok = forgetMemory(id, opts.method as ForgetMethod);
    if (!ok) printError(`Memory not found: ${id}`);
    printAndExit({ success: true, id, method: opts.method }, program.opts().format || 'json');
  });

program
  .command('restore <id>')
  .description('Restore an archived/decayed memory')
  .action((id) => {
    const ok = restoreMemory(id);
    if (!ok) printError(`Cannot restore memory: ${id} (not found or not archived/decayed)`);
    printAndExit({ success: true, id }, program.opts().format || 'json');
  });

program
  .command('decaying')
  .description('List memories currently decaying')
  .action(() => {
    const mems = getDecayingMemories();
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(mems, format);
  });

program
  .command('move <id>')
  .description('Move a memory to a different layer')
  .requiredOption('-l, --layer <layer>', 'target layer')
  .option('--reason <reason>', 'reason for layer move')
  .action((id, opts) => {
    const validLayers: Layer[] = ['flash', 'short', 'long', 'entity'];
    if (!validLayers.includes(opts.layer as Layer)) {
      printError(`Invalid layer: ${opts.layer}. Must be one of: ${validLayers.join(', ')}`);
    }
    const ok = moveLayer(id, opts.layer as Layer, opts.reason);
    if (!ok) printError(`Failed to move memory: ${id}`);
    const mem = getMemory(id);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(mem, format);
  });

program
  .command('hit <id>')
  .description('Record a hit (access) on a memory')
  .action((id) => {
    recordHit(id);
    const mem = getMemory(id);
    if (!mem) printError(`Memory not found: ${id}`);
    printAndExit({ success: true, id, hitCount: mem!.hitCount }, program.opts().format || 'json');
  });

program
  .command('versions <id>')
  .description('List version history of a memory')
  .action((id) => {
    const versions = listVersions(id);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(versions, format);
  });

program
  .command('version-detail <id>')
  .description('Get a specific version of a memory')
  .requiredOption('-v, --version <number>', 'version number')
  .action((id, opts) => {
    const ver = getVersion(id, parseInt(opts.version, 10));
    if (!ver) printError(`Version not found: ${id} v${opts.version}`);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(ver, format);
  });

program
  .command('revert <id>')
  .description('Revert a memory to a previous version')
  .requiredOption('-v, --version <number>', 'target version number')
  .option('--reason <reason>', 'revert reason')
  .action((id, opts) => {
    const mem = revertToVersion(id, parseInt(opts.version, 10), opts.reason);
    if (!mem) printError(`Failed to revert: ${id} to v${opts.version}`);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(mem, format);
  });

program
  .command('entities')
  .description('List entities')
  .option('-t, --type <type>', 'filter by type: person|tool|concept|organization|location|event|time|project')
  .action((opts) => {
    const entities = listEntities(opts.type as import('@keymemory/shared').EntityType | undefined);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(entities, format);
  });

program
  .command('entity-graph <id>')
  .description('Get entity graph for an entity')
  .action((id) => {
    try {
      const graph = getEntityGraph(id);
      const format: OutputFormat = program.opts().format || 'json';
      printAndExit(graph, format);
    } catch (err) {
      printError((err as Error).message);
    }
  });

program
  .command('relate <sourceId> <targetId>')
  .description('Create or update a memory-to-memory relation')
  .option('--type <type>', 'relation type: part_of|derived_from|relates_to|supersedes|references', 'relates_to')
  .option('--strength <number>', 'relation strength 0..1', '1')
  .option('--reason <reason>', 'relation reason/provenance')
  .action((sourceId, targetId, opts) => {
    if (!MEMORY_RELATION_TYPES.includes(opts.type)) {
      printError(`Invalid relation type: ${opts.type}. Must be one of: ${MEMORY_RELATION_TYPES.join(', ')}`);
    }
    if (!getMemory(sourceId)) printError(`Memory not found: ${sourceId}`);
    if (!getMemory(targetId)) printError(`Memory not found: ${targetId}`);
    const strength = parseFloat(opts.strength);
    const relation = createMemoryRelation(sourceId, targetId, opts.type, strength, opts.reason);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(relation, format);
  });

program
  .command('related <id>')
  .description('List memories related to a memory')
  .option('--type <type>', 'filter relation type')
  .action((id, opts) => {
    if (!getMemory(id)) printError(`Memory not found: ${id}`);
    const related = findRelatedMemories(id, opts.type);
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(related, format);
  });

program
  .command('project-suggestions')
  .description('List dream-created project organization suggestions')
  .option('--status <status>', 'pending|accepted|rejected')
  .action((opts) => {
    const suggestions = listProjectSuggestions(parseProjectSuggestionStatus(opts.status));
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(suggestions, format);
  });

program
  .command('project-suggestion-accept <id>')
  .description('Accept a project organization suggestion and move suggested projects under a new parent')
  .option('--name <name>', 'custom parent project name')
  .action((id, opts) => {
    const result = acceptProjectSuggestion(id, opts.name);
    if (!result.success) printError(result.error ?? 'Failed to accept project suggestion');
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(result, format);
  });

program
  .command('project-suggestion-reject <id>')
  .description('Reject a project organization suggestion')
  .action((id) => {
    const ok = rejectProjectSuggestion(id);
    if (!ok) printError('Suggestion not found or already processed');
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit({ success: true, id }, format);
  });

program
  .command('duplicates')
  .description('Find duplicate memories')
  .option('--threshold <number>', 'similarity threshold', '0.9')
  .option('-n, --limit <number>', 'max results', '20')
  .action(async (opts) => {
    const dups = await findDuplicateMemories(
      parseFloat(opts.threshold),
      parseInt(opts.limit, 10)
    );
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(dups, format);
  });

program
  .command('rebuild-embeddings')
  .description('Rebuild all embeddings')
  .action(async () => {
    const { getDatabase } = await import('./db/sqlite.js');
    const db = getDatabase();
    const memories = db.prepare(`
      SELECT id, title, content, tags, metadata FROM memories WHERE status = 'active'
    `).all() as { id: string; title: string; content: string; tags: string | null; metadata: string | null }[];

    let success = 0;
    let failed = 0;

    for (const mem of memories) {
      try {
        const tags = mem.tags ? JSON.parse(mem.tags) : undefined;
        const metadata = mem.metadata ? JSON.parse(mem.metadata) : undefined;
        await ensureEmbedding(mem.id, mem.title, mem.content, tags, metadata, true);
        success++;
      } catch {
        failed++;
      }
    }

    printAndExit({ total: memories.length, success, failed }, program.opts().format || 'json');
  });

program
  .command('agent-config [target]')
  .description('Print MCP config snippets for Agent hosts: generic, claude-desktop, claude-code, hermes, openclaw, codex, or all')
  .option('--root <path>', 'KeyMemory project root for generated launcher path')
  .option('--list', 'list supported targets')
  .action((target = 'generic', opts) => {
    const format: OutputFormat = program.opts().format || 'json';
    if (opts.list) {
      printAndExit(listAgentConfigTargets(), format);
    }

    const allowed = new Set([...listAgentConfigTargets(), 'all']);
    if (!allowed.has(target)) {
      printError(`Unsupported agent-config target: ${target}`);
    }

    const snippets = buildAgentConfigSnippets(target, opts.root);
    if (format === 'json') {
      printAndExit(target === 'all' ? snippets : snippets[0], format);
    }

    const text = snippets.map(item => [
      `# ${item.label} (${item.target})`,
      item.configPathHints.length > 0 ? `Paths: ${item.configPathHints.join(', ')}` : 'Paths: MCP-compatible config file',
      item.snippet,
      item.notes.map(note => `- ${note}`).join('\n'),
    ].filter(Boolean).join('\n')).join('\n\n');
    process.stdout.write(text + '\n');
    closeDatabase();
    process.exit(0);
  });

program
  .command('info')
  .description('Show KeyMemory installation info')
  .action(() => {
    const info = {
      dataDir: getDataDir(),
      dbPath: getDbPath(),
      version: '0.1.0',
    };
    const format: OutputFormat = program.opts().format || 'json';
    printAndExit(info, format);
  });

program
  .command('scheduler')
  .description('Show or update dream scheduler config')
  .option('--enable', 'enable scheduled dream consolidation')
  .option('--disable', 'disable scheduled dream consolidation')
  .option('--cron <cron>', 'daily schedule: "M H * * *"')
  .action((opts) => {
    if (opts.enable && opts.disable) {
      printError('Use either --enable or --disable, not both');
    }

    const updates: { dreamingEnabled?: boolean; dreamingCron?: string } = {};
    if (opts.enable) updates.dreamingEnabled = true;
    if (opts.disable) updates.dreamingEnabled = false;
    if (opts.cron !== undefined) updates.dreamingCron = String(opts.cron);

    const format: OutputFormat = program.opts().format || 'json';
    try {
      const config = Object.keys(updates).length > 0
        ? updateSchedulerConfig(updates)
        : getSchedulerConfig();
      printAndExit(config, format);
    } catch (err) {
      printError((err as Error).message);
    }
  });

program
  .command('serve')
  .description('Start the REST API + Web UI server')
  .option('-p, --port <port>', 'port number', String(DEFAULT_PORT))
  .option('-h, --host <host>', 'host', DEFAULT_HOST)
  .action(async (opts) => {
    const Fastify = (await import('fastify')).default;
    const cors = (await import('@fastify/cors')).default;
    const { registerRoutes } = await import('./api/rest.js');
    const { registerMCPRoutes } = await import('./api/mcp.js');
    const { registerWebUI } = await import('./web-ui.js');

    const host = String(opts.host);
    assertSafeServerBinding(host);

    const app = Fastify({ logger: true });
    await app.register(cors, { origin: createCorsOriginPolicy() });
    registerRoutes(app);
    registerMCPRoutes(app);
    registerWebUI(app);

    await app.listen({ port: parseInt(opts.port, 10), host });
    console.log(`KeyMemory server running at http://${host}:${opts.port}`);
  });

program
  .command('consolidate')
  .description('(deprecated) Use "dream" command instead')
  .action(() => {
    process.stderr.write('Note: "consolidate" is deprecated. Use "keymemory dream --run" instead.\n');
    const format: OutputFormat = program.opts().format || 'json';
    const report = runDreamCycle();
    if (format !== 'json') {
      process.stdout.write(formatDreamReport(report) + '\n');
      closeDatabase();
      process.exit(0);
    }
    printAndExit(report, format);
  });

program
  .command('dream')
  .description('Run a dream cycle (Light → REM → Deep memory consolidation)')
  .option('--run', 'run a full dream cycle')
  .option('--list', 'list recent dream reports')
  .option('--show <reportId>', 'show dream report details')
  .option('--signals <reportId>', 'show dream signals for a report')
  .option('--rollback <reportId>', 'rollback a dream report')
  .action((opts) => {
    const format: OutputFormat = program.opts().format || 'json';

    if (opts.run) {
      const report = runDreamCycle();
      if (format !== 'json') {
        process.stdout.write(formatDreamReport(report) + '\n');
        closeDatabase();
        process.exit(0);
      }
      printAndExit(report, format);
    }

    if (opts.list) {
      const reports = listDreamReports();
      printAndExit(reports, format);
    }

    if (opts.show) {
      const report = getDreamReport(opts.show);
      if (!report) printError(`Report not found: ${opts.show}`);
      if (format !== 'json') {
        process.stdout.write(formatDreamReport(report!) + '\n');
        closeDatabase();
        process.exit(0);
      }
      printAndExit(report, format);
    }

    if (opts.signals) {
      const signals = getDreamSignalsForReport(opts.signals);
      printAndExit(signals, format);
    }

    if (opts.rollback) {
      try {
        const result = rollbackDream(opts.rollback);
        if (format !== 'json') {
          process.stdout.write(formatDreamReport(result) + '\n');
          closeDatabase();
          process.exit(0);
        }
        printAndExit(result, format);
      } catch (err) {
        printError((err as Error).message);
      }
      return;
    }

    program.help();
  });

program.parse();
