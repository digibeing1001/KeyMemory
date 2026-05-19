#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(cmd, options = {}) {
  try {
    return execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options,
    });
  } catch (e) {
    if (options.allowFail) return null;
    console.error(`\n❌ 命令执行失败: ${cmd}`);
    console.error(e.message);
    process.exit(1);
  }
}

function runQuiet(cmd) {
  return run(cmd, { silent: true, allowFail: true })?.trim() || '';
}

function getCurrentVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
}

function showHelp() {
  console.log('');
  console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m CLI');
  console.log('  \x1b[2m─────────────────────\x1b[0m');
  console.log('');
  console.log('  \x1b[1m用法:\x1b[0m keymemory \x1b[36m<命令>\x1b[0m [选项]');
  console.log('');
  console.log('  \x1b[1m命令:\x1b[0m');
  console.log('    \x1b[36mupdate\x1b[0m      更新 KeyMemory 到最新版本');
  console.log('    \x1b[36mui\x1b[0m          启动 Web UI 服务');
  console.log('    \x1b[36mversion\x1b[0m     显示当前版本');
  console.log('    \x1b[36mhelp\x1b[0m        显示帮助信息');
  console.log('');
  console.log('  \x1b[1m选项:\x1b[0m');
  console.log('    \x1b[36m--stash\x1b[0m     自动暂存本地修改（update 命令）');
  console.log('');
  console.log('  \x1b[1m示例:\x1b[0m');
  console.log('    keymemory update');
  console.log('    keymemory update --stash');
  console.log('    keymemory ui');
  console.log('');
}

function showVersion() {
  const version = getCurrentVersion();
  console.log(`\x1b[1m\x1b[36mKeyMemory\x1b[0m v${version}`);
}

function doUpdate() {
  console.log('');
  console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m 更新');
  console.log('  \x1b[2m─────────────────────\x1b[0m');
  console.log('');

  const isGitRepo = fs.existsSync(path.join(ROOT, '.git'));
  if (!isGitRepo) {
    console.error('  \x1b[31m❌ 当前目录不是 Git 仓库，无法更新\x1b[0m');
    console.error('  \x1b[2m请使用 git clone 重新获取项目\x1b[0m');
    process.exit(1);
  }

  const currentVersion = getCurrentVersion();
  console.log(`  \x1b[2m当前版本:\x1b[0m v${currentVersion}`);

  const remote = runQuiet('git remote get-url origin');
  if (!remote) {
    console.error('  \x1b[31m❌ 未配置远程仓库\x1b[0m');
    process.exit(1);
  }
  console.log(`  \x1b[2m远程仓库:\x1b[0m ${remote}`);

  const currentBranch = runQuiet('git rev-parse --abbrev-ref HEAD');
  console.log(`  \x1b[2m当前分支:\x1b[0m ${currentBranch}`);

  let stashed = false;

  console.log('');
  console.log('  \x1b[1m[1/4]\x1b[0m 检查本地修改...');
  const statusOutput = runQuiet('git status --porcelain');
  if (statusOutput) {
    const changedFiles = statusOutput.split('\n').filter(Boolean);
    console.log(`  \x1b[33m⚠ 检测到 ${changedFiles.length} 个本地修改\x1b[0m`);

    const stashChoice = process.argv.includes('--stash');
    if (stashChoice) {
      console.log('  \x1b[2m暂存本地修改...\x1b[0m');
      run('git stash push -m "keymemory-update-auto-stash"');
      stashed = true;
    } else {
      console.log('');
      console.log('  \x1b[33m💡 提示: 本地修改可能导致合并冲突\x1b[0m');
      console.log('  \x1b[2m选项:\x1b[0m');
      console.log('    1. 手动提交或还原修改后重新运行');
      console.log('    2. 使用 \x1b[36mkeymemory update --stash\x1b[0m 自动暂存');
      console.log('');
      process.exit(1);
    }
  } else {
    console.log('  \x1b[32m✓ 工作目录干净\x1b[0m');
  }

  function restoreStash() {
    if (!stashed) return;
    const stashList = runQuiet('git stash list');
    if (stashList.includes('keymemory-update-auto-stash')) {
      console.log('  \x1b[2m恢复暂存的本地修改...\x1b[0m');
      const popResult = run('git stash pop', { allowFail: true });
      if (popResult === null) {
        console.log('  \x1b[33m⚠ stash pop 有冲突，请手动处理\x1b[0m');
      }
    }
  }

  console.log('');
  console.log('  \x1b[1m[2/4]\x1b[0m 拉取远程更新...');
  const localHash = runQuiet('git rev-parse HEAD');
  console.log(`  \x1b[2m本地: ${localHash.slice(0, 8)}\x1b[0m`);

  run('git fetch origin');

  const remoteHash = runQuiet(`git rev-parse origin/${currentBranch}`);
  console.log(`  \x1b[2m远程: ${remoteHash.slice(0, 8)}\x1b[0m`);

  if (localHash === remoteHash) {
    console.log('');
    console.log('  \x1b[32m✓ 已经是最新版本！\x1b[0m');
    restoreStash();
    process.exit(0);
  }

  const commitCount = runQuiet(`git rev-list ${localHash}..origin/${currentBranch} --count`);
  console.log(`  \x1b[2m新增: ${commitCount} 个提交\x1b[0m`);

  console.log('');
  console.log('  \x1b[1m[3/4]\x1b[0m 合并更新...');
  const pullResult = run('git pull --ff-only origin ' + currentBranch, { allowFail: true });
  if (pullResult === null) {
    console.error('  \x1b[31m❌ 合并失败！\x1b[0m');
    restoreStash();
    process.exit(1);
  }
  console.log('  \x1b[32m✓ 合并成功\x1b[0m');

  const newVersion = getCurrentVersion();
  if (currentVersion !== newVersion) {
    console.log(`  \x1b[2m版本: v${currentVersion} → v${newVersion}\x1b[0m`);
  }

  console.log('');
  console.log('  \x1b[1m[4/4]\x1b[0m 重新构建...');
  console.log('  \x1b[2m安装依赖...\x1b[0m');
  run('pnpm install');

  console.log('  \x1b[2m构建项目...\x1b[0m');
  run('pnpm build');

  if (stashed) {
    restoreStash();
  }

  console.log('');
  console.log('  \x1b[32m✅ KeyMemory 更新完成！\x1b[0m');
  console.log('');
  console.log('  \x1b[1m下一步:\x1b[0m');
  console.log('    1. 重启 Claude Desktop');
  console.log('    2. 运行 \x1b[36mkeymemory ui\x1b[0m 启动服务');
  console.log('');
}

function doUi() {
  require('./keymemory-ui');
}

// 主命令路由
const command = process.argv[2];

switch (command) {
  case 'update':
    doUpdate();
    break;
  case 'ui':
    doUi();
    break;
  case 'version':
  case '-v':
  case '--version':
    showVersion();
    break;
  case 'help':
  case '-h':
  case '--help':
  default:
    if (command && command !== 'help' && command !== '-h' && command !== '--help') {
      console.log(`\x1b[31m未知命令: ${command}\x1b[0m`);
    }
    showHelp();
    break;
}
