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
const hasWebBuild = fs.existsSync(path.join(PROJECT_DIR, 'packages/web/dist'));
if (!hasServerBuild || !hasWebBuild) {
  console.log('  \x1b[33m🔨 首次启动，构建项目...\x1b[0m');
  try {
    execSync('pnpm build', { cwd: PROJECT_DIR, stdio: 'inherit' });
  } catch {
    console.log('  \x1b[31m❌ 构建失败\x1b[0m');
    process.exit(1);
  }
}

const serverProc = spawn(IS_WIN ? 'pnpm.cmd' : 'pnpm', ['start'], {
  cwd: PROJECT_DIR,
  stdio: 'inherit',
  env: { ...process.env, KEYMEMORY_PRESET: 'hermes' },
});

console.log('  \x1b[2m⏳ 启动服务...\x1b[0m');

setTimeout(() => {
  console.log('');
  console.log('  \x1b[32m✓ 服务已启动\x1b[0m');
  console.log('');
  console.log('  \x1b[1mWeb UI:\x1b[0m    http://127.0.0.1:3210');
  console.log('  \x1b[1mAPI:\x1b[0m       http://127.0.0.1:3210/api/health/report');
  console.log('');
  console.log('  \x1b[2m按 Ctrl+C 停止服务\x1b[0m');
  console.log('');
}, 2000);

serverProc.on('close', () => {
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('');
  console.log('  \x1b[33m正在停止服务...\x1b[0m');
  serverProc.kill();
  process.exit(0);
});
