#!/usr/bin/env node

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(ROOT, 'packages', 'server', 'dist', 'mcp-server.js');
const LOG_DIR = process.env.KEYMEMORY_LOG_DIR || path.join(os.homedir(), '.keymemory', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'mcp.log');

function ensureLogDir() {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {}
}

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, line, 'utf8');
  } catch {}
  process.stderr.write(line);
}

function runAutoBuild() {
  if (process.env.KEYMEMORY_AUTO_BUILD !== '1') return false;

  log('[launcher] mcp-server.js missing; KEYMEMORY_AUTO_BUILD=1, running pnpm build');
  const result = spawnSync('pnpm', ['build'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.stdout) log(result.stdout.trimEnd());
  if (result.stderr) log(result.stderr.trimEnd());
  return result.status === 0;
}

function failMissingEntry() {
  log('[launcher] ERROR: MCP entry not found: ' + ENTRY);
  log('[launcher] Run: cd "' + ROOT + '" && pnpm build');
  log('[launcher] Then run: keymemory doctor');
  process.exit(1);
}

if (!fs.existsSync(ENTRY)) {
  const built = runAutoBuild();
  if (!built || !fs.existsSync(ENTRY)) failMissingEntry();
}

log('[launcher] starting MCP server: ' + ENTRY);

const child = spawn(process.execPath, [ENTRY], {
  cwd: ROOT,
  env: {
    ...process.env,
    KEYMEMORY_STDIO: '1',
    KEYMEMORY_PROJECT_ROOT: ROOT,
  },
  stdio: ['inherit', 'inherit', 'pipe'],
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  try {
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, text, 'utf8');
  } catch {}
  process.stderr.write(text);
});

child.on('error', (err) => {
  log('[launcher] failed to start MCP server: ' + err.message);
  process.exit(1);
});

child.on('close', (code, signal) => {
  log('[launcher] MCP server exited code=' + code + ' signal=' + signal);
  process.exit(code ?? 0);
});

function forward(signal) {
  if (!child.killed) child.kill(signal);
}

process.on('SIGINT', () => forward('SIGINT'));
process.on('SIGTERM', () => forward('SIGTERM'));
