#!/usr/bin/env node
/**
 * KeyMemory Hermes 一键启动脚本
 * 小白用户友好，一键启动 KeyMemory 服务
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🚀 KeyMemory Hermes 一键启动');
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

// 检查是否已安装依赖
try {
  const packageJson = require('./package.json');
  console.log(`KeyMemory 版本: ${packageJson.version}`);
} catch (e) {
  console.log('❌ 请先运行: pnpm install');
  process.exit(1);
}

// 检查是否已构建
const hasBuild = fs.existsSync(path.join(__dirname, 'packages/server/dist'));
if (!hasBuild) {
  console.log('🔨 首次使用，先构建项目...');
  const buildProcess = spawn('pnpm', ['build'], { 
    cwd: __dirname, stdio: 'inherit' });
  buildProcess.on('close', (code) => {
    if (code === 0) {
      startServices();
    }
  });
} else {
  startServices();
}

function startServices() {
  console.log('');
  console.log('📋 服务信息:');
  console.log('  - MCP 服务器: 已启动');
  console.log('  - Web 管理界面: http://localhost:5173');
  console.log('  - Hermes 空间: agent:hermes');
  console.log('');
  console.log('💡 按 Ctrl+C 停止');
  console.log('');

  const env = {
    ...process.env,
    KEYMEMORY_PRESET: 'hermes',
  };

  if (WSL && WSL_DATA_DIR) {
    env.KEYMEMORY_DATA_DIR = WSL_DATA_DIR;
  }

  const mcpProcess = spawn('pnpm', ['start:mcp'], {
    cwd: __dirname,
    stdio: 'inherit',
    env,
  });

  console.log('⏳ 等待 2 秒后启动 Web UI...');
  setTimeout(() => {
    const webEnv = {
      ...process.env,
    };
    if (WSL && WSL_DATA_DIR) {
      webEnv.KEYMEMORY_DATA_DIR = WSL_DATA_DIR;
    }
    const webProcess = spawn('pnpm', ['dev:web'], {
      cwd: __dirname,
      stdio: 'inherit',
      env: webEnv,
    });
  }, 2000);
}
