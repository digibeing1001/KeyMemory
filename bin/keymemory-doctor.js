#!/usr/bin/env node

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.KEYMEMORY_PORT || 3210);
const DATA_DIR = process.env.KEYMEMORY_DATA_DIR || path.join(os.homedir(), '.keymemory');
const DB_PATH = process.env.KEYMEMORY_DB_PATH || path.join(DATA_DIR, 'data.db');
const CLI_ENTRY = path.join(ROOT, 'packages', 'server', 'dist', 'cli.js');
const MCP_ENTRY = path.join(ROOT, 'packages', 'server', 'dist', 'mcp-server.js');
const MCP_LAUNCHER = path.join(ROOT, 'bin', 'keymemory-mcp.js');
const LOG_FILE = path.join(DATA_DIR, 'logs', 'mcp.log');

let failures = 0;
let warnings = 0;

function mark(label, ok, detail, severity = 'fail') {
  const icon = ok ? 'OK ' : severity === 'warn' ? 'WARN' : 'FAIL';
  console.log(`  ${icon} ${label}${detail ? ': ' + detail : ''}`);
  if (!ok && severity === 'warn') warnings += 1;
  if (!ok && severity !== 'warn') failures += 1;
}

function exists(filePath) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function commandVersion(command, args) {
  try {
    return execSync([command, ...args].join(' '), {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}

function checkRuntime() {
  console.log('\nRuntime');
  const major = Number(process.versions.node.split('.')[0]);
  mark('Node.js', major >= 20, process.version + (major >= 20 ? '' : ' (need >=20)'));
  mark('pnpm', Boolean(commandVersion('pnpm', ['--version'])), commandVersion('pnpm', ['--version']) || 'not found', 'warn');
}

function checkFiles() {
  console.log('\nProject');
  mark('project root', exists(path.join(ROOT, 'package.json')), ROOT);
  mark('CLI build output', exists(CLI_ENTRY), CLI_ENTRY);
  mark('MCP launcher', exists(MCP_LAUNCHER), MCP_LAUNCHER);
  mark('MCP build output', exists(MCP_ENTRY), MCP_ENTRY);
  mark('shared build output', exists(path.join(ROOT, 'packages', 'shared', 'dist')), path.join(ROOT, 'packages', 'shared', 'dist'), 'warn');
  mark('Web UI build output', exists(path.join(ROOT, 'packages', 'web', 'dist')), path.join(ROOT, 'packages', 'web', 'dist'), 'warn');
}

function checkData() {
  console.log('\nData');
  mark('data dir', exists(DATA_DIR), DATA_DIR, 'warn');
  mark('database', exists(DB_PATH), DB_PATH, 'warn');
  mark('MCP log file', exists(LOG_FILE), LOG_FILE, 'warn');
}

function requestHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/health/report`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ ok: res.statusCode === 200, status: res.statusCode, body }));
    });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
  });
}

async function checkServer() {
  console.log('\nServer');
  const health = await requestHealth();
  if (health.ok) {
    let score = null;
    try {
      score = JSON.parse(health.body).score;
    } catch {}
    mark('Web/API health', true, `http://127.0.0.1:${PORT} score=${score ?? 'unknown'}`);
  } else {
    mark('Web/API health', false, health.error || `HTTP ${health.status}`, 'warn');
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function extractJsPaths(text) {
  const matches = text.match(/(?:[A-Za-z]:[\\/]|\/)[^\s"',]+mcp-server\.js/g) || [];
  return Array.from(new Set(matches));
}

function normalizeCandidateConfigPaths() {
  const home = os.homedir();
  return [
    process.env.KEYMEMORY_MCP_CONFIG,
    path.join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'),
    path.join(home, '.openclaw', 'config.json'),
    path.join(home, '.config', 'openclaw', 'config.json'),
    path.join(home, '.gateway', 'config.yaml'),
    path.join(home, '.config', 'gateway', 'config.yaml'),
    path.join(home, 'gateway', 'config.yaml'),
  ].filter(Boolean);
}

function checkConfigPath(configPath) {
  if (!exists(configPath)) return;
  console.log(`\nConfig: ${configPath}`);

  const raw = fs.readFileSync(configPath, 'utf8');
  if (configPath.endsWith('.json')) {
    const config = readJson(configPath);
    if (!config) {
      mark('parse config', false, 'invalid JSON');
      return;
    }

    const server = config.mcpServers?.keymemory;
    if (!server) {
      mark('keymemory MCP config', false, 'not configured', 'warn');
      return;
    }

    const command = server.command || '';
    const args = Array.isArray(server.args) ? server.args : [];
    mark('keymemory command', true, [command, ...args].join(' '));

    for (const arg of args) {
      if (typeof arg !== 'string') continue;
      if (arg.endsWith('mcp-server.js')) {
        mark('direct dist path', false, 'use bin/keymemory-mcp.js launcher instead', 'warn');
        mark('configured mcp-server.js exists', exists(arg), arg);
      }
      if (arg.endsWith('keymemory-mcp.js')) {
        mark('configured launcher exists', exists(arg), arg);
      }
    }
    return;
  }

  const paths = extractJsPaths(raw);
  if (paths.length === 0) {
    mark('MCP path scan', false, 'no mcp-server.js path found', 'warn');
    return;
  }

  for (const p of paths) {
    mark('configured mcp-server.js exists', exists(p), p);
    mark('direct dist path', false, 'use bin/keymemory-mcp.js launcher instead', 'warn');
  }
}

function checkConfigs() {
  const configs = normalizeCandidateConfigPaths();
  let found = false;
  for (const configPath of configs) {
    if (configPath && exists(configPath)) {
      found = true;
      checkConfigPath(configPath);
    }
  }
  if (!found) {
    console.log('\nConfig');
    mark('known MCP configs', false, 'none found; set KEYMEMORY_MCP_CONFIG=/path/to/config.yaml to inspect gateway config', 'warn');
  }
}

function runJsonCli(args, dataDir) {
  const stdout = execFileSync(process.execPath, [CLI_ENTRY, '--format', 'json', '--data-dir', dataDir, ...args], {
    cwd: ROOT,
    env: { ...process.env, KEYMEMORY_DATA_DIR: dataDir },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  return JSON.parse(stdout);
}

function checkCapabilities() {
  console.log('\nCore capabilities');
  if (!exists(CLI_ENTRY)) {
    mark('capability smoke', false, 'run pnpm build first');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-doctor-'));
  const backupFile = path.join(tempDir, 'doctor-backup.json');
  const migrationFile = path.join(tempDir, 'doctor-migration.md');
  fs.writeFileSync(migrationFile, [
    '# Doctor migration',
    '[[Doctor/Migration]] Preference: doctor validates migration import and project routing.',
  ].join('\n'), 'utf8');

  try {
    const created = runJsonCli([
      'create',
      '--title',
      'Doctor project memory',
      '--content',
      '[[Doctor/Agent/Project]] Preference: doctor validates context pack, project tree, and backup readiness.',
      '--layer',
      'long',
    ], tempDir);
    mark('project-tree write', Boolean(created.id && created.projectId), created.projectId || 'missing projectId');

    const contextPack = runJsonCli([
      'context',
      'backup readiness',
      '--project',
      'Doctor/Agent',
      '--max-items',
      '4',
      '--max-chars',
      '2000',
    ], tempDir);
    mark('agent context pack', contextPack.totalItems >= 1 && String(contextPack.markdown || '').includes('User Preferences'), `${contextPack.totalItems || 0} item(s)`);

    const dryRunMigration = runJsonCli(['migrate', migrationFile, '--source', 'doctor', '--dry-run'], tempDir);
    mark('migration dry-run', dryRunMigration.dryRun && dryRunMigration.imported >= 1 && dryRunMigration.files === 1, `${dryRunMigration.imported || 0} preview item(s)`);

    const migration = runJsonCli(['migrate', migrationFile, '--source', 'doctor'], tempDir);
    mark('migration import', migration.imported >= 1 && migration.files === 1, `${migration.imported || 0} imported`);

    const relationSource = runJsonCli([
      'create',
      '--title',
      'Doctor new relation',
      '--content',
      '[[Doctor/Relations]] Decision: doctor validates newer guidance relation.',
      '--layer',
      'long',
    ], tempDir);
    const relationTarget = runJsonCli([
      'create',
      '--title',
      'Doctor old relation',
      '--content',
      '[[Doctor/Relations]] Decision: doctor validates older guidance relation.',
      '--layer',
      'long',
    ], tempDir);
    const relation = runJsonCli(['relate', relationSource.id, relationTarget.id, '--type', 'supersedes', '--reason', 'doctor capability smoke'], tempDir);
    const related = runJsonCli(['related', relationSource.id, '--type', 'supersedes'], tempDir);
    mark('memory relation', relation.relationType === 'supersedes' && related.some(item => item.memoryId === relationTarget.id), `${related.length || 0} related`);

    const scheduler = runJsonCli(['scheduler'], tempDir);
    mark('dream scheduler', Boolean(scheduler.nextDreamRunAt) && scheduler.dreamingEnabled === true, scheduler.nextDreamRunAt || 'missing next run');

    const agentConfig = runJsonCli(['agent-config', 'codex', '--mode', 'mcp'], tempDir);
    mark('agent config generator', String(agentConfig.snippet || '').includes('[mcp_servers.keymemory]'), agentConfig.target || 'missing target');

    const backup = runJsonCli(['backup-create', backupFile], tempDir);
    mark('portable backup', backup.valid && backup.counts?.memories >= 1 && exists(backupFile), backupFile);

    const restore = runJsonCli(['backup-restore', backupFile, '--dry-run'], tempDir);
    mark('dry-run restore', restore.valid && restore.dryRun && restore.wouldRestore, restore.valid ? 'ready' : 'invalid');
  } catch (err) {
    mark('capability smoke', false, err.message);
  }
}

function printNextSteps() {
  console.log('\nNext steps');
  if (!exists(CLI_ENTRY) || !exists(MCP_ENTRY)) {
    console.log('  - Run: pnpm build');
  }
  console.log('  - Configure agents with launcher: node "' + MCP_LAUNCHER + '"');
  console.log('  - Start Web UI: keymemory dashboard');
  console.log('  - Re-run diagnostics: keymemory doctor');
}

async function main() {
  console.log('KeyMemory doctor');
  console.log('Root: ' + ROOT);
  checkRuntime();
  checkFiles();
  checkData();
  await checkServer();
  checkCapabilities();
  checkConfigs();
  printNextSteps();
  console.log(`\nSummary: ${failures} failure(s), ${warnings} warning(s)`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
