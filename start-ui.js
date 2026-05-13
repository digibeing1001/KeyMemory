#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🌐 KeyMemory Web UI 一键启动');
console.log('============================');

try {
  const packageJson = require('./package.json');
  console.log(`KeyMemory 版本: ${packageJson.version}`);
} catch (e) {
  console.log('❌ 请先运行: pnpm install');
  process.exit(1);
}

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

  const mcpProcess = spawn('pnpm', ['start:mcp'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, KEYMEMORY_PRESET: 'hermes' }
  });

  console.log('⏳ 等待 MCP 服务器启动...');
  setTimeout(() => {
    const webProcess = spawn('pnpm', ['dev:web'], {
      cwd: __dirname,
      stdio: 'inherit'
    });

    console.log('');
    console.log('📋 服务信息:');
    console.log('  - Web UI: http://localhost:5173');
    console.log('  - MCP 服务器: 已启动');
    console.log('');
    console.log('💡 按 Ctrl+C 停止');
    console.log('');
  }, 2000);
}
