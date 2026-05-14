#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_DIR = path.resolve(__dirname, '..');
const IS_WIN = os.platform() === 'win32';

console.log('');
console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m Web UI');
console.log('  \x1b[2m─────────────────────\x1b[0m');
console.log('');

if (!fs.existsSync(path.join(PROJECT_DIR, 'node_modules'))) {
  console.log('  \x1b[33m⚡ 首次启动，安装依赖...\x1b[0m');
  try {
    execSync('pnpm install', { cwd: PROJECT_DIR, stdio: 'inherit' });
  } catch {
    console.log('  \x1b[31m❌ 依赖安装失败，请检查 pnpm 是否已安装\x1b[0m');
    process.exit(1);
  }
}

const hasServerBuild = fs.existsSync(path.join(PROJECT_DIR, 'packages/server/dist'));
if (!hasServerBuild) {
  console.log('  \x1b[33m🔨 首次启动，构建服务端...\x1b[0m');
  try {
    execSync('pnpm build', { cwd: PROJECT_DIR, stdio: 'inherit' });
  } catch {
    console.log('  \x1b[31m❌ 构建失败\x1b[0m');
    process.exit(1);
  }
}

let serverReady = false;

const serverProc = spawn(IS_WIN ? 'pnpm.cmd' : 'pnpm', ['start:mcp'], {
  cwd: PROJECT_DIR,
  stdio: 'inherit',
  env: { ...process.env, KEYMEMORY_PRESET: 'hermes' },
});

console.log('  \x1b[2m⏳ 启动记忆服务...\x1b[0m');

setTimeout(() => {
  serverReady = true;

  const webProc = spawn(IS_WIN ? 'pnpm.cmd' : 'pnpm', ['dev:web'], {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
  });

  console.log('');
  console.log('  \x1b[32m✓ 服务已启动\x1b[0m');
  console.log('');
  console.log('  \x1b[1mWeb UI:\x1b[0m    http://localhost:5173');
  console.log('  \x1b[1mAPI:\x1b[0m       http://127.0.0.1:3210');
  console.log('');
  console.log('  \x1b[2m按 Ctrl+C 停止所有服务\x1b[0m');
  console.log('');

  webProc.on('close', () => {
    serverProc.kill();
    process.exit(0);
  });
}, 2500);

serverProc.on('close', () => {
  if (serverReady) process.exit(0);
});

process.on('SIGINT', () => {
  console.log('');
  console.log('  \x1b[33m正在停止服务...\x1b[0m');
  serverProc.kill();
  process.exit(0);
});
