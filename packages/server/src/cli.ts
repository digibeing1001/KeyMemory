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
import { getHealthReport } from './core/health.js';
import { listEntities, getEntityGraph, extractEntities } from './graph/entity.js';
import { initEmbedding } from './embed/onnx.js';
import type { Layer, MemoryStatus, ForgetMethod } from '@keymemory/shared';
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
  .action(async (query, opts) => {
    const results = await searchHybrid(query, {
      limit: parseInt(opts.limit, 10),
      layer: opts.layer as Layer | undefined,
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

    const app = Fastify({ logger: true });
    await app.register(cors, { origin: true });
    registerRoutes(app);
    registerMCPRoutes(app);
    registerWebUI(app);

    await app.listen({ port: parseInt(opts.port, 10), host: opts.host });
    console.log(`KeyMemory server running at http://${opts.host}:${opts.port}`);
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
