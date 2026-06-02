import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-mcp-smoke-'));
const workspace = path.join(dataDir, 'workspace');
const agentFile = path.join(workspace, 'AGENTS.md');
const backupFile = path.join(dataDir, 'mcp-backup.json');

fs.mkdirSync(workspace, { recursive: true });
fs.writeFileSync(agentFile, [
  '# AGENTS',
  'MCP migration smoke remembers project [[MCP/Smoke/Import]] and prefers production release checks.',
].join('\n'), 'utf8');

const child = spawn(process.execPath, ['packages/server/dist/mcp-server.js'], {
  cwd: root,
  env: {
    ...process.env,
    KEYMEMORY_DATA_DIR: dataDir,
    KEYMEMORY_STDIO: '1',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let nextId = 1;
let buffer = '';
const pending = new Map();
const stderr = [];

child.stderr.on('data', chunk => {
  stderr.push(chunk.toString());
});

child.stdout.on('data', chunk => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = pending.get(message.id);
    if (!entry) continue;
    pending.delete(message.id);
    if (message.error) {
      entry.reject(new Error(JSON.stringify(message.error)));
    } else {
      entry.resolve(message.result);
    }
  }
});

function call(method, params = {}) {
  const id = nextId++;
  const payload = { jsonrpc: '2.0', id, method, params };
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP call timed out: ${method}`));
    }, 30000);
    pending.set(id, {
      resolve: value => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: error => {
        clearTimeout(timer);
        reject(error);
      },
    });
  });
  child.stdin.write(JSON.stringify(payload) + '\n');
  return promise;
}

function toolText(result) {
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') throw new Error(`unexpected tool result: ${JSON.stringify(result)}`);
  return text;
}

function createdMemoryId(result) {
  const match = toolText(result).match(/ID:\s*([0-9a-f-]{36})/i);
  if (!match) throw new Error(`could not parse created memory id: ${toolText(result)}`);
  return match[1];
}

try {
  await call('initialize');
  const listed = await call('tools/list');
  const toolNames = listed.tools.map(tool => tool.name);
  for (const required of ['keymemory', 'keymemory_create', 'keymemory_search', 'keymemory_context_pack', 'keymemory_auto_remember', 'memory_create', 'memory_search', 'memory_context_pack', 'memory_relate', 'memory_related', 'memory_migration_discover', 'memory_migration_import', 'memory_backup_create', 'memory_backup_inspect', 'memory_backup_restore_dry_run', 'memory_project_suggestions', 'memory_project_suggestion_accept', 'memory_project_suggestion_reject']) {
    if (!toolNames.includes(required)) throw new Error(`missing MCP tool: ${required}`);
  }

  const discovered = await call('tools/call', {
    name: 'memory_migration_discover',
    arguments: { root: workspace, includeHome: false },
  });
  const sources = JSON.parse(toolText(discovered));
  if (!Array.isArray(sources) || sources.length < 1) {
    throw new Error(`expected discovered sources, got ${JSON.stringify(sources)}`);
  }

  const dryImported = await call('tools/call', {
    name: 'memory_migration_import',
    arguments: { path: agentFile, source: 'mcp-smoke', format: 'markdown', dryRun: true },
  });
  const dryImportResult = JSON.parse(toolText(dryImported));
  if (!dryImportResult.dryRun || dryImportResult.imported !== 1 || dryImportResult.dreamReportId) {
    throw new Error(`expected MCP dry-run import preview, got ${JSON.stringify(dryImportResult)}`);
  }

  const imported = await call('tools/call', {
    name: 'memory_migration_import',
    arguments: { path: agentFile, source: 'mcp-smoke', format: 'markdown' },
  });
  const importResult = JSON.parse(toolText(imported));
  if (importResult.imported !== 1) {
    throw new Error(`expected imported=1, got ${JSON.stringify(importResult)}`);
  }

  const searched = await call('tools/call', {
    name: 'keymemory_search',
    arguments: { query: 'production release checks', limit: 3 },
  });
  const searchText = toolText(searched);
  if (!searchText.includes('production release checks') && !searchText.includes('MCP migration smoke')) {
    throw new Error(`expected MCP search result, got ${searchText}`);
  }

  const packed = await call('tools/call', {
    name: 'keymemory_context_pack',
    arguments: { query: 'production release checks', project: 'MCP/Smoke', maxItems: 4 },
  });
  const packText = toolText(packed);
  if (!packText.includes('# KeyMemory Context') || !packText.includes('User Preferences')) {
    throw new Error(`expected MCP context pack, got ${packText}`);
  }

  const sourceId = createdMemoryId(await call('tools/call', {
    name: 'keymemory_create',
    arguments: {
      title: 'MCP relation source',
      content: '[[MCP/Smoke/Relations]] New release guidance supersedes old release guidance.',
      layer: 'long',
    },
  }));
  const targetId = createdMemoryId(await call('tools/call', {
    name: 'keymemory',
    arguments: {
      title: 'MCP relation target',
      content: '[[MCP/Smoke/Relations]] Old release guidance should be superseded.',
      layer: 'long',
    },
  }));
  const relation = JSON.parse(toolText(await call('tools/call', {
    name: 'memory_relate',
    arguments: { sourceId, targetId, relationType: 'supersedes', reason: 'mcp smoke relation' },
  })));
  if (relation.relationType !== 'supersedes' || relation.targetId !== targetId) {
    throw new Error(`expected MCP supersedes relation, got ${JSON.stringify(relation)}`);
  }
  const related = JSON.parse(toolText(await call('tools/call', {
    name: 'memory_related',
    arguments: { id: sourceId, relationType: 'supersedes' },
  })));
  if (!Array.isArray(related) || !related.some(item => item.memoryId === targetId)) {
    throw new Error(`expected MCP related target, got ${JSON.stringify(related)}`);
  }
  const defaultRelationSearch = toolText(await call('tools/call', {
    name: 'memory_search',
    arguments: { query: 'old release guidance', limit: 5 },
  }));
  if (defaultRelationSearch.includes('MCP relation target')) {
    throw new Error(`expected MCP search to suppress superseded target, got ${defaultRelationSearch}`);
  }
  const inclusiveRelationSearch = toolText(await call('tools/call', {
    name: 'memory_search',
    arguments: { query: 'old release guidance', limit: 5, includeSuperseded: true },
  }));
  if (!inclusiveRelationSearch.includes('MCP relation target')) {
    throw new Error(`expected MCP includeSuperseded search to return target, got ${inclusiveRelationSearch}`);
  }

  const backup = JSON.parse(toolText(await call('tools/call', {
    name: 'memory_backup_create',
    arguments: { filePath: backupFile },
  })));
  if (!backup.valid || backup.counts?.memories < 1 || !fs.existsSync(backupFile)) {
    throw new Error(`expected MCP backup create to write a valid backup, got ${JSON.stringify(backup)}`);
  }
  const inspectedBackup = JSON.parse(toolText(await call('tools/call', {
    name: 'memory_backup_inspect',
    arguments: { filePath: backupFile },
  })));
  if (!inspectedBackup.valid || inspectedBackup.counts?.memories !== backup.counts.memories) {
    throw new Error(`expected MCP backup inspect to validate backup, got ${JSON.stringify(inspectedBackup)}`);
  }
  const restoreDryRun = JSON.parse(toolText(await call('tools/call', {
    name: 'memory_backup_restore_dry_run',
    arguments: { filePath: backupFile },
  })));
  if (!restoreDryRun.valid || !restoreDryRun.dryRun || !restoreDryRun.wouldRestore) {
    throw new Error(`expected MCP backup restore dry-run readiness, got ${JSON.stringify(restoreDryRun)}`);
  }
  const projectSuggestions = JSON.parse(toolText(await call('tools/call', {
    name: 'memory_project_suggestions',
    arguments: { status: 'pending' },
  })));
  if (!Array.isArray(projectSuggestions)) {
    throw new Error(`expected MCP project suggestions to return an array, got ${JSON.stringify(projectSuggestions)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    dataDir,
    tools: toolNames.length,
    discovered: sources.length,
    dryRunImported: dryImportResult.imported,
    imported: importResult.imported,
    related: related.length,
    backupTables: backup.includedTables.length,
    backupDryRun: Boolean(restoreDryRun.wouldRestore),
    projectSuggestionsListed: Array.isArray(projectSuggestions),
    searchSuppressed: true,
  }, null, 2));
} finally {
  child.stdin.end();
  child.kill();
  setTimeout(() => {
    if (!child.killed) child.kill('SIGKILL');
  }, 1000).unref();
}

child.on('exit', code => {
  if (code && code !== 0) {
    process.stderr.write(stderr.join(''));
  }
});
