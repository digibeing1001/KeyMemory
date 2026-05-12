#!/usr/bin/env node
/**
 * KeyMemory Hermes 一键启动脚本
 * 小白用户友好，一键启动 KeyMemory 服务
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 KeyMemory Hermes 一键启动');
console.log('============================');

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

  // 启动 MCP 服务器
  const mcpProcess = spawn('pnpm', ['start:mcp'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, KEYMEMORY_PRESET: 'hermes' }
  });

  // 启动 Web UI（可选）
  console.log('⏳ 等待 2 秒后启动 Web UI...');
  setTimeout(() => {
    const webProcess = spawn('pnpm', ['dev:web'], {
      cwd: __dirname,
      stdio: 'inherit'
    });
  }, 2000);
}
