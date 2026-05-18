#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

const WSL = isWSL();

console.log('');
console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m Web UI (WSL 专用版)');
console.log('  \x1b[2m────────────────────────────\x1b[0m');
console.log('');

const WSL_DATA_DIR = path.join(os.homedir(), '.keymemory-wsl');

console.log('  \x1b[1m环境信息:\x1b[0m');
console.log('    WSL: ' + (WSL ? '\x1b[32m是\x1b[0m' : '\x1b[33m否\x1b[0m'));
console.log('    项目路径: ' + PROJECT_DIR);
console.log('    数据目录: ' + WSL_DATA_DIR);
console.log('');

if (WSL) {
  console.log('  \x1b[32m✓ 正在使用 WSL 专用数据目录\x1b[0m');
  console.log('  \x1b[2m  这会与 Windows 桌面版本的数据目录完全隔离\x1b[0m');
  console.log('');
}

const needsBuild = !fs.existsSync(SERVER_ENTRY) || !fs.existsSync(WEB_DIST) || !fs.existsSync(SHARED_DIST);

if (needsBuild) {
  console.log('  \x1b[33m🔨 首次启动，安装依赖并构建项目...\x1b[0m');
  console.log('');

  console.log('  \x1b[2m[1/3] 安装依赖...\x1b[0m');
  try {
    execSync('pnpm install --ignore-scripts', { cwd: PROJECT_DIR, stdio: 'inherit' });
  } catch {
    const nodeModulesExists = fs.existsSync(path.join(PROJECT_DIR, 'node_modules'));
    if (!nodeModulesExists) {
      console.log('');
      console.log('  \x1b[31m❌ 依赖安装失败，请检查 pnpm 是否已安装\x1b[0m');
      console.log('  \x1b[2m安装 pnpm: npm install -g pnpm\x1b[0m');
      process.exit(1);
    }
  }

  console.log('');
  console.log('  \x1b[2m[2/3] 编译原生模块...\x1b[0m');
  try {
    execSync('cd packages/server && pnpm rebuild better-sqlite3', { cwd: PROJECT_DIR, stdio: 'inherit' });
  } catch {
    console.log('  \x1b[33m⚠ 原生模块编译失败\x1b[0m');
    console.log('  \x1b[2m请确保已安装编译工具: sudo apt install -y build-essential python3\x1b[0m');
    process.exit(1);
  }

  console.log('');
  console.log('  \x1b[2m[3/3] 构建项目...\x1b[0m');
  try {
    execSync('cd packages/shared && pnpm exec tsc', { cwd: PROJECT_DIR, stdio: 'inherit' });
    execSync('cd packages/server && pnpm exec tsc', { cwd: PROJECT_DIR, stdio: 'inherit' });
    execSync('cd packages/web && pnpm exec vite build', { cwd: PROJECT_DIR, stdio: 'inherit' });
  } catch {
    if (!fs.existsSync(SERVER_ENTRY)) {
      console.log('');
      console.log('  \x1b[31m❌ 构建失败\x1b[0m');
      process.exit(1);
    }
    console.log('  \x1b[33m⚠ 部分构建失败，将尝试启动已有构建产物...\x1b[0m');
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

function getWSLIP() {
  try {
    const output = execSync('hostname -I', { encoding: 'utf-8' }).trim();
    const firstIp = output.split(/\s+/)[0];
    if (firstIp && firstIp !== '127.0.0.1') return firstIp;
  } catch {}
  try {
    const lines = fs.readFileSync('/proc/net/fib_trie', 'utf-8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/\b(172\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/);
      if (match && match[1] !== '172.0.0.0') return match[1];
    }
  } catch {}
  return null;
}

function checkWindowsPortConflict() {
  if (!WSL) return null;
  try {
    const netstat = execSync('/mnt/c/Windows/System32/cmd.exe /c "netstat.exe -ano | findstr :' + PORT + '"', {
      encoding: 'utf-8',
      timeout: 3000,
      cwd: '/mnt/c/Windows',
    });
    const lines = netstat.trim().split('\n').filter(l => l.includes('LISTENING') && l.includes(':' + PORT));
    if (lines.length > 0) {
      const pids = [...new Set(lines.map(l => l.trim().split(/\s+/).pop()))];
      return pids;
    }
  } catch {}
  return null;
}

const windowsConflictPids = checkWindowsPortConflict();
const wslIp = WSL ? getWSLIP() : null;

if (WSL && windowsConflictPids) {
  console.log('  \x1b[33m⚠ 检测到 Windows 进程占用了 ' + PORT + ' 端口\x1b[0m');
  console.log('  \x1b[2mPID: ' + windowsConflictPids.join(', ') + '\x1b[0m');
  console.log('  \x1b[2m原因: Windows 上的进程会拦截 localhost 请求，导致 WSL2 服务无法通过 127.0.0.1 访问\x1b[0m');
  console.log('');
}

const env = {
  ...process.env,
  KEYMEMORY_PRESET: 'hermes',
  KEYMEMORY_DATA_DIR: WSL_DATA_DIR,
};

const serverProc = spawn(process.execPath, [SERVER_ENTRY], {
  cwd: PROJECT_DIR,
  stdio: 'inherit',
  env,
});

console.log('  \x1b[2m⏳ 启动服务...\x1b[0m');
console.log('');

let started = false;
const http = require('http');
const checkInterval = setInterval(() => {
  const req = http.get(`http://127.0.0.1:${PORT}/api/health/report`, (res) => {
    if (res.statusCode === 200 && !started) {
      started = true;
      clearInterval(checkInterval);
      console.log('  \x1b[32m✓ 服务已启动\x1b[0m');
      console.log('');
      if (fs.existsSync(WEB_DIST)) {
        console.log('  \x1b[1mWeb UI:\x1b[0m    http://127.0.0.1:' + PORT);
        if (WSL && wslIp) {
          console.log('            http://' + wslIp + ':' + PORT + ' \x1b[2m(WSL2 直连)\x1b[0m');
        }
      }
      console.log('  \x1b[1mAPI:\x1b[0m       http://127.0.0.1:' + PORT + '/api/health/report');
      if (WSL && wslIp) {
        console.log('            http://' + wslIp + ':' + PORT + '/api/health/report \x1b[2m(WSL2 直连)\x1b[0m');
      }
      if (WSL && windowsConflictPids) {
        console.log('');
        console.log('  \x1b[33m⚠ Windows 进程占用了 ' + PORT + ' 端口，localhost 可能无法访问\x1b[0m');
        console.log('  \x1b[33m  请使用 WSL2 IP 访问: http://' + wslIp + ':' + PORT + '\x1b[0m');
      }
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
