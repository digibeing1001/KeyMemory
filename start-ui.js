#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const isBackground = process.argv.includes('--background') || process.argv.includes('-b');

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

  const spawnOptions = {
    cwd: __dirname,
    stdio: isBackground ? 'ignore' : 'inherit',
    env: { ...process.env, KEYMEMORY_PRESET: 'hermes' },
    detached: isBackground,
    windowsHide: isBackground,
  };

  const mcpProcess = spawn('pnpm', ['start:mcp'], spawnOptions);

  if (isBackground) {
    mcpProcess.unref();
    console.log('✅ MCP 服务器已在后台启动');
  }

  console.log('⏳ 等待 MCP 服务器启动...');
  setTimeout(() => {
    const webSpawnOptions = {
      cwd: __dirname,
      stdio: isBackground ? 'ignore' : 'inherit',
      detached: isBackground,
      windowsHide: isBackground,
    };

    const webProcess = spawn('pnpm', ['dev:web'], webSpawnOptions);

    if (isBackground) {
      webProcess.unref();
    }

    console.log('');
    console.log('📋 服务信息:');
    console.log('  - Web UI: http://localhost:5173');
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
      console.log('💡 按 Ctrl+C 停止');
      console.log('');
    }
  }, 2000);
}
