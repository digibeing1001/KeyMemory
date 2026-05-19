#!/usr/bin/env node

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const isBackground = process.argv.includes('--background') || process.argv.includes('-b');

console.log('🌐 KeyMemory Web UI 一键启动');
console.log('============================');

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
const WSL_DATA_DIR = WSL ? path.join(os.homedir(), '.keymemory-wsl') : null;

if (WSL) {
  console.log('');
  console.log('🔍 检测到 WSL 环境');
  console.log('   数据目录: ' + WSL_DATA_DIR);
  console.log('   这会与 Windows 桌面版本的数据目录隔离');
  console.log('');
}

try {
  const packageJson = require('./package.json');
  console.log(`KeyMemory 版本: ${packageJson.version}`);
} catch (e) {
  console.log('❌ 请先运行: pnpm install');
  process.exit(1);
}

const hasServerBuild = fs.existsSync(path.join(__dirname, 'packages/server/dist'));
const hasWebBuild = fs.existsSync(path.join(__dirname, 'packages/web/dist/index.html'));

if (!hasServerBuild || !hasWebBuild) {
  console.log('🔨 首次使用，先构建项目...');
  const buildProcess = spawn('pnpm', ['build'], {
    cwd: __dirname, stdio: 'inherit' });
  buildProcess.on('close', (code) => {
    if (code === 0) {
      startServices();
    } else {
      console.log('❌ 构建失败，请检查错误信息');
      process.exit(1);
    }
  });
} else {
  startServices();
}

function getServerPort() {
  try {
    const constants = require('./packages/shared/dist/constants.js');
    return constants.DEFAULT_PORT || 3721;
  } catch {
    return 3721;
  }
}

function waitForServer(port, maxRetries = 30) {
  return new Promise((resolve) => {
    let retries = 0;
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          retry();
        }
      });
      req.on('error', () => {
        retry();
      });
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      retries++;
      if (retries >= maxRetries) {
        resolve(false);
      } else {
        setTimeout(check, 1000);
      }
    };

    check();
  });
}

function openBrowser(url) {
  const platform = process.platform;
  let command;
  if (platform === 'win32') {
    command = `start ${url}`;
  } else if (platform === 'darwin') {
    command = `open ${url}`;
  } else {
    command = `xdg-open ${url}`;
  }
  exec(command, (err) => {
    if (err) {
      console.log(`💡 请手动打开浏览器访问: ${url}`);
    }
  });
}

async function startServices() {
  console.log('');

  const port = getServerPort();

  const baseEnv = {
    ...process.env,
    KEYMEMORY_PRESET: 'hermes',
  };

  if (WSL && WSL_DATA_DIR) {
    baseEnv.KEYMEMORY_DATA_DIR = WSL_DATA_DIR;
  }

  const spawnOptions = {
    cwd: __dirname,
    stdio: isBackground ? 'ignore' : 'inherit',
    env: baseEnv,
    detached: isBackground,
    windowsHide: isBackground,
  };

  const mcpProcess = spawn('pnpm', ['start:mcp'], spawnOptions);

  if (isBackground) {
    mcpProcess.unref();
    console.log('✅ MCP 服务器已在后台启动');
  }

  console.log('⏳ 等待服务器就绪...');

  const serverReady = await waitForServer(port);

  if (!serverReady) {
    console.log('⚠️  服务器启动超时，请检查日志');
    console.log(`   尝试手动访问: http://localhost:${port}`);
    if (!isBackground) return;
  }

  const url = `http://localhost:${port}`;

  console.log('');
  console.log('📋 服务信息:');
  console.log(`  - Web UI: ${url}`);
  console.log('  - MCP 服务器: 已启动');
  console.log('');

  if (isBackground) {
    console.log('✅ 所有服务已在后台运行');
    console.log('   关闭此终端不会影响服务');
    console.log('');
    console.log('💡 停止服务: 任务管理器中结束 node 进程');
    console.log('');
    process.exit(0);
  } else {
    openBrowser(url);
    console.log('💡 按 Ctrl+C 停止');
    console.log('');
  }
}
