#!/usr/bin/env node

const { execFileSync, execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_DIR = path.resolve(__dirname, '..');
const BIN_DIR = path.join(PROJECT_DIR, 'bin');
const IS_WIN = os.platform() === 'win32';
const POSIX_LAUNCHERS = ['keymemory', 'keymemory-mcp', 'keymemory-ui', 'keymemory-ui-wsl'];

console.log('');
console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m 安装向导');
console.log('  \x1b[2m─────────────────────────\x1b[0m');
console.log('');

console.log('  \x1b[1m[1/4]\x1b[0m 安装依赖...');
try {
  execSync('pnpm install', { cwd: PROJECT_DIR, stdio: 'inherit' });
} catch {
  console.log('  \x1b[31m❌ 依赖安装失败，请检查 pnpm 是否已安装\x1b[0m');
  console.log('  \x1b[2m安装 pnpm: npm install -g pnpm\x1b[0m');
  process.exit(1);
}

console.log('');
console.log('  \x1b[1m[2/4]\x1b[0m 构建项目...');
try {
  execSync('pnpm build', { cwd: PROJECT_DIR, stdio: 'inherit' });
} catch {
  console.log('  \x1b[31m❌ 构建失败\x1b[0m');
  process.exit(1);
}

console.log('');
console.log('  \x1b[1m[3/4]\x1b[0m 注册全局命令...');

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
  for (const name of POSIX_LAUNCHERS) {
    try {
      fs.chmodSync(path.join(BIN_DIR, name), 0o755);
    } catch {}
  }

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
console.log('  \x1b[1m[4/4]\x1b[0m 扫描并接入本机 Agent...');
try {
  execFileSync(process.execPath, [path.join(PROJECT_DIR, 'install-default-memory.js')], { cwd: PROJECT_DIR, stdio: 'inherit' });
} catch {
  console.log('  \x1b[33m⚠ Agent 接入向导未完成，可稍后运行 pnpm install-memory 继续\x1b[0m');
}

console.log('');
console.log('  \x1b[32m✓ 安装完成！\x1b[0m');
console.log('');
console.log('  \x1b[1m正在启动 KeyMemory，并打开首次使用引导...\x1b[0m');
try {
  const uiProcess = spawn(process.execPath, [path.join(BIN_DIR, 'keymemory-ui.js'), '--open', '--onboarding'], {
    cwd: PROJECT_DIR,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  uiProcess.unref();
  console.log('  \x1b[32m✓ Web UI 将在浏览器中自动打开\x1b[0m');
} catch {
  console.log('  \x1b[33m⚠ 自动启动失败，请运行 keymemory dashboard\x1b[0m');
}
console.log('');
console.log('  \x1b[1m启动方式:\x1b[0m');
console.log('');
console.log('    \x1b[36mkeymemory dashboard\x1b[0m  一键启动 Web UI');
console.log('    \x1b[36mkeymemory update\x1b[0m     更新 KeyMemory');
console.log('    \x1b[36mkeymemory doctor\x1b[0m     诊断 MCP/Web UI 状态');
console.log('    \x1b[36mpnpm install-memory\x1b[0m   重新扫描并接入本机 Agent');
console.log('    \x1b[36mnode install-default-memory.js --all\x1b[0m  自动接入全部已检测 Agent');
console.log('    \x1b[36mnode install-default-memory.js --prompt\x1b[0m  生成新 Agent 接入提示词');
console.log('    \x1b[36mpnpm start:ui\x1b[0m        从项目目录启动');
console.log('');
console.log('  \x1b[2m⚠ 新终端窗口需要重新打开才能使用 keymemory 命令\x1b[0m');
console.log('');
