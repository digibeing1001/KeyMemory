#!/usr/bin/env node
/**
 * KeyMemory Web UI 一键启动脚本
 *
 * 自动打开浏览器的行为约定（Q2）：
 *  - 服务未在运行：启动服务，就绪后自动在默认浏览器打开 Web UI；
 *  - 服务已在运行：不重复启动、不重复弹出浏览器窗口（幂等）；
 *    如需强制再开一次窗口，使用 --open；
 *  - 关闭自动打开的开关（任选其一）：
 *      1) 环境变量 KEYMEMORY_AUTO_OPEN_BROWSER=0（也接受 false / no）
 *      2) 命令行参数 --no-open
 *    关闭后服务照常启动，手动访问 http://127.0.0.1:3210 即可；
 *  - 启动失败时按原因给出下一步操作提示，不静默失败。
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const isBackground = process.argv.includes('--background') || process.argv.includes('-b');
const forceOpen = process.argv.includes('--open');

// ---- 自动打开开关：默认开启，可用 --no-open 或 KEYMEMORY_AUTO_OPEN_BROWSER=0 关闭 ----
function autoOpenEnabled() {
  if (process.argv.includes('--no-open')) return false;
  const envValue = String(process.env.KEYMEMORY_AUTO_OPEN_BROWSER ?? '').trim().toLowerCase();
  if (envValue === '0' || envValue === 'false' || envValue === 'no' || envValue === 'off') return false;
  return true;
}

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
      console.log('   下一步: 确认已安装 Node.js 18+ 与 pnpm（npm install -g pnpm），然后重新运行本脚本');
      process.exit(1);
    }
  });
} else {
  startServices();
}

function getServerPort() {
  try {
    const constants = require('./packages/shared/dist/constants.js');
    return constants.DEFAULT_PORT || 3210;
  } catch {
    return 3210;
  }
}

/** 单次健康探测：判断服务是否已在运行（幂等检查用） */
function probeServer(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve(false);
    });
  });
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
  return new Promise((resolve) => {
    exec(command, (err) => {
      if (err) {
        console.log('⚠️  无法自动打开浏览器（可能处于无界面环境）');
        console.log(`💡 请手动打开浏览器访问: ${url}`);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function printStartupFailureHints(port, childExitCode) {
  console.log('');
  console.log('❌ 服务未能就绪。可能的原因与下一步：');
  if (childExitCode !== null && childExitCode !== undefined && childExitCode !== 0) {
    console.log(`   1) 服务进程提前退出（exit code ${childExitCode}），常见原因是端口被占用或依赖缺失`);
  }
  console.log(`   2) 检查 ${port} 端口是否被占用（PowerShell）: netstat -ano | findstr :${port}`);
  console.log('      若被占用：结束占用进程（taskkill /PID <pid> /F）后重试');
  console.log('   3) 查看运行日志: keymemory-web-dev.log（项目根目录）');
  console.log('   4) 运行环境自检: node bin/keymemory-doctor.js');
  console.log('');
}

async function startServices() {
  console.log('');

  const port = getServerPort();
  const url = `http://127.0.0.1:${port}`;
  const shouldAutoOpen = autoOpenEnabled();

  // ---- 幂等检查：服务已在运行时不重复启动、不重复弹出浏览器 ----
  const alreadyRunning = await probeServer(port);
  if (alreadyRunning) {
    console.log('✅ 检测到 KeyMemory 服务已在运行，不重复启动');
    console.log('');
    console.log('📋 服务信息:');
    console.log(`  - Web UI: ${url}`);
    console.log('');
    if (forceOpen) {
      await openBrowser(url);
    } else {
      console.log('💡 本次未重复打开浏览器（上次启动时已打开）');
      console.log('   如需强制再打开一次窗口，请运行: node start-ui.js --open');
    }
    console.log(`   关闭自动打开: 设置 KEYMEMORY_AUTO_OPEN_BROWSER=0 或追加 --no-open 参数`);
    console.log('');
    process.exit(0);
  }

  const baseEnv = {
    ...process.env,
    KEYMEMORY_PRESET: 'hermes',
  };

  if (WSL && WSL_DATA_DIR) {
    baseEnv.KEYMEMORY_DATA_DIR = WSL_DATA_DIR;
  }

  // 后台模式捕获 stderr 尾部用于失败诊断；前台模式直接继承终端输出
  let stderrTail = '';
  const spawnOptions = {
    cwd: __dirname,
    stdio: isBackground ? ['ignore', 'ignore', 'pipe'] : 'inherit',
    env: baseEnv,
    detached: isBackground,
    windowsHide: isBackground,
  };

  // 直接用当前 node 启动 REST/Web 服务入口（packages/server/dist/index.js）。
  // 注意：bin/keymemory-mcp.js 是 MCP stdio 通道（KEYMEMORY_STDIO=1，会禁用 REST 与 Web UI），
  // 不能用于启动 Web 服务；此处不再依赖 pnpm shim，避免 Windows 下 spawn pnpm ENOENT。
  const serverEntry = path.join(__dirname, 'packages', 'server', 'dist', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    console.log('❌ 服务端构建产物不存在: packages/server/dist/index.js');
    console.log('   下一步: 在项目根目录运行 pnpm build 后重试');
    process.exit(1);
  }
  const mcpProcess = spawn(process.execPath, [serverEntry], spawnOptions);
  let childExitCode = null;
  mcpProcess.on('exit', (code) => { childExitCode = code; });
  if (isBackground && mcpProcess.stderr) {
    mcpProcess.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
    });
    mcpProcess.unref();
  }

  console.log(isBackground ? '✅ 正在后台启动记忆服务 + Web UI...' : '✅ 正在启动记忆服务 + Web UI...');
  console.log('⏳ 等待服务器就绪...');

  const serverReady = await waitForServer(port);

  if (!serverReady) {
    printStartupFailureHints(port, childExitCode);
    if (stderrTail.trim()) {
      console.log('🧾 服务错误输出（尾部）:');
      console.log(stderrTail.trim().split('\n').map(l => '   ' + l).join('\n'));
      console.log('');
    }
    if (isBackground) process.exit(1);
    return;
  }

  console.log('');
  console.log('📋 服务信息:');
  console.log(`  - Web UI: ${url}`);
  console.log('  - 记忆服务: 已启动（REST API）');
  console.log('');

  // 只有本次真正启动了服务才打开浏览器（重复执行不会多开窗口）
  if (shouldAutoOpen || forceOpen) {
    await openBrowser(url);
    if (shouldAutoOpen) {
      console.log('💡 自动打开浏览器已启用；关闭方式: 设置 KEYMEMORY_AUTO_OPEN_BROWSER=0 或启动时追加 --no-open');
    }
  } else {
    console.log(`💡 自动打开浏览器已关闭（--no-open 或 KEYMEMORY_AUTO_OPEN_BROWSER=0）`);
    console.log(`   请手动访问: ${url}`);
  }

  if (isBackground) {
    console.log('');
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
}
