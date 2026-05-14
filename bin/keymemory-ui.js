#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const PROJECT_DIR = path.resolve(__dirname, '..');
const SERVER_ENTRY = path.join(PROJECT_DIR, 'packages/server/dist/index.js');
const WEB_DIST = path.join(PROJECT_DIR, 'packages/web/dist');
const SHARED_DIST = path.join(PROJECT_DIR, 'packages/shared/dist');

function isWSL() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_DISTRO_NAME) return true;
  try {
    return fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

function isOnWindowsFS() {
  return PROJECT_DIR.startsWith('/mnt/');
}

function toWindowsPath(unixPath) {
  return unixPath.replace(/^\/mnt\/([a-z])/, (_, letter) => letter.toUpperCase() + ':').replace(/\//g, '\\');
}

const WSL = isWSL();
const ON_WIN_FS = isOnWindowsFS();
const USE_NODE_EXE = WSL && ON_WIN_FS;

console.log('');
console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m Web UI');
console.log('  \x1b[2m─────────────────────\x1b[0m');
console.log('');

if (USE_NODE_EXE) {
  console.log('  \x1b[2mℹ WSL 环境检测，将使用 Windows Node.js 运行服务\x1b[0m');
  console.log('');
}

const needsBuild = !fs.existsSync(SERVER_ENTRY) || !fs.existsSync(WEB_DIST) || !fs.existsSync(SHARED_DIST);

if (needsBuild) {
  console.log('  \x1b[33m🔨 首次启动，安装依赖并构建项目...\x1b[0m');
  console.log('');

  console.log('  \x1b[2m[1/2] 安装依赖...\x1b[0m');
  try {
    if (USE_NODE_EXE) {
      execSync('pnpm install', { cwd: PROJECT_DIR, stdio: 'inherit' });
    } else {
      execSync('pnpm install', { cwd: PROJECT_DIR, stdio: 'inherit' });
    }
  } catch {
    console.log('');
    console.log('  \x1b[31m❌ 依赖安装失败，请检查 pnpm 是否已安装\x1b[0m');
    console.log('  \x1b[2m安装 pnpm: npm install -g pnpm\x1b[0m');
    process.exit(1);
  }

  console.log('');
  console.log('  \x1b[2m[2/2] 构建项目...\x1b[0m');
  try {
    execSync('pnpm build', { cwd: PROJECT_DIR, stdio: 'inherit' });
  } catch {
    console.log('');
    console.log('  \x1b[31m❌ 构建失败\x1b[0m');
    process.exit(1);
  }
  console.log('');
}

if (!fs.existsSync(SERVER_ENTRY)) {
  console.log('  \x1b[31m❌ 服务端构建文件不存在\x1b[0m');
  console.log('  \x1b[2m请运行: pnpm install && pnpm build\x1b[0m');
  process.exit(1);
}

if (!fs.existsSync(WEB_DIST)) {
  console.log('  \x1b[33m⚠ Web UI 构建文件不存在，将仅启动 API 服务\x1b[0m');
  console.log('  \x1b[2m如需 Web UI，请运行: cd packages/web && pnpm build\x1b[0m');
  console.log('');
}

const PORT = 3210;

let nodeCmd, nodeArgs, nodeCwd, useShell;

if (USE_NODE_EXE) {
  nodeCmd = 'cmd.exe';
  nodeArgs = ['/c', 'node', toWindowsPath(SERVER_ENTRY)];
  nodeCwd = PROJECT_DIR;
  useShell = false;
} else {
  nodeCmd = 'node';
  nodeArgs = [SERVER_ENTRY];
  nodeCwd = PROJECT_DIR;
  useShell = false;
}

const spawnOpts = {
  cwd: nodeCwd,
  stdio: 'inherit',
  env: { ...process.env, KEYMEMORY_PRESET: 'hermes' },
  shell: useShell,
};

const serverProc = spawn(nodeCmd, nodeArgs, spawnOpts);

console.log('  \x1b[2m⏳ 启动服务...\x1b[0m');

let started = false;
const checkInterval = setInterval(() => {
  const req = http.get(`http://127.0.0.1:${PORT}/api/health/report`, (res) => {
    if (res.statusCode === 200 && !started) {
      started = true;
      clearInterval(checkInterval);
      console.log('');
      console.log('  \x1b[32m✓ 服务已启动\x1b[0m');
      console.log('');
      if (fs.existsSync(WEB_DIST)) {
        console.log('  \x1b[1mWeb UI:\x1b[0m    http://127.0.0.1:' + PORT);
      }
      console.log('  \x1b[1mAPI:\x1b[0m       http://127.0.0.1:' + PORT + '/api/health/report');
      console.log('');
      console.log('  \x1b[2m按 Ctrl+C 停止服务\x1b[0m');
      console.log('');
    }
    res.resume();
  });
  req.on('error', () => {});
}, 500);

setTimeout(() => {
  if (!started) {
    clearInterval(checkInterval);
    console.log('');
    console.log('  \x1b[33m⚠ 服务启动超时，请检查日志\x1b[0m');
    console.log('');
  }
}, 30000);

serverProc.on('close', (code) => {
  clearInterval(checkInterval);
  if (code !== 0 && code !== null) {
    console.log(`  \x1b[31m服务异常退出 (code: ${code})\x1b[0m`);
  }
  process.exit(code || 0);
});

process.on('SIGINT', () => {
  console.log('');
  console.log('  \x1b[33m正在停止服务...\x1b[0m');
  serverProc.kill();
  process.exit(0);
});
