#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(PROJECT_DIR, 'bin');
const IS_WIN = os.platform() === 'win32';

console.log('');
console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m 安装向导');
console.log('  \x1b[2m─────────────────────────\x1b[0m');
console.log('');

console.log('  \x1b[1m[1/3]\x1b[0m 安装依赖...');
try {
  execSync('pnpm install', { cwd: PROJECT_DIR, stdio: 'inherit' });
} catch {
  console.log('  \x1b[31m❌ 依赖安装失败，请检查 pnpm 是否已安装\x1b[0m');
  console.log('  \x1b[2m安装 pnpm: npm install -g pnpm\x1b[0m');
  process.exit(1);
}

console.log('');
console.log('  \x1b[1m[2/3]\x1b[0m 构建项目...');
try {
  execSync('pnpm build', { cwd: PROJECT_DIR, stdio: 'inherit' });
} catch {
  console.log('  \x1b[31m❌ 构建失败\x1b[0m');
  process.exit(1);
}

console.log('');
console.log('  \x1b[1m[3/3]\x1b[0m 注册全局命令...');

if (IS_WIN) {
  const currentPath = [require('child_process').execSync(
    `powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"`,
    { encoding: 'utf-8' }
  ).trim()];

  const pathStr = currentPath[0];
  if (pathStr.toLowerCase().split(';').some(p => p.toLowerCase() === BIN_DIR.toLowerCase())) {
    console.log('  \x1b[32m✓ keymemory 命令已注册\x1b[0m');
  } else {
    try {
      execSync(
        `powershell -NoProfile -Command "[Environment]::SetEnvironmentVariable('Path','${pathStr};${BIN_DIR}','User')"`,
        { stdio: 'inherit' }
      );
      console.log('  \x1b[32m✓ keymemory 命令已注册到系统 PATH\x1b[0m');
    } catch {
      console.log('  \x1b[33m⚠ 自动注册失败，请手动添加到 PATH: ' + BIN_DIR + '\x1b[0m');
    }
  }
} else {
  const shellRc = path.join(os.homedir(), '.bashrc');
  const zshRc = path.join(os.homedir(), '.zshrc');
  const exportLine = `\nexport PATH="$PATH:${BIN_DIR}"`;

  const targetRc = fs.existsSync(zshRc) ? zshRc : shellRc;

  if (fs.existsSync(targetRc)) {
    const content = fs.readFileSync(targetRc, 'utf-8');
    if (content.includes(BIN_DIR)) {
      console.log('  \x1b[32m✓ keymemory 命令已注册\x1b[0m');
    } else {
      fs.appendFileSync(targetRc, exportLine);
      console.log(`  \x1b[32m✓ 已添加到 ${path.basename(targetRc)}\x1b[0m`);
    }
  } else {
    fs.writeFileSync(targetRc, exportLine);
    console.log(`  \x1b[32m✓ 已创建 ${path.basename(targetRc)}\x1b[0m`);
  }
}

console.log('');
console.log('  \x1b[32m✓ 安装完成！\x1b[0m');
console.log('');
console.log('  \x1b[1m启动方式:\x1b[0m');
console.log('');
console.log('    \x1b[36mkeymemory dashboard\x1b[0m  一键启动 Web UI');
console.log('    \x1b[36mkeymemory update\x1b[0m     更新 KeyMemory');
console.log('    \x1b[36mpnpm start:ui\x1b[0m        从项目目录启动');
console.log('');
console.log('  \x1b[2m⚠ 新终端窗口需要重新打开才能使用 keymemory 命令\x1b[0m');
console.log('');
