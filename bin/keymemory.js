#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CLI_ENTRY = path.join(ROOT, 'packages', 'server', 'dist', 'cli.js');
const SHARED_ENTRY = path.join(ROOT, 'packages', 'shared', 'dist', 'index.js');

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
  console.log('    \x1b[36mdashboard\x1b[0m   启动 Web UI 服务');
  console.log('    \x1b[36mdoctor\x1b[0m      诊断 MCP/Web UI 配置与健康');
  console.log('    \x1b[36mmcp\x1b[0m         启动 MCP server (供 Agent 配置使用)');
  console.log('    \x1b[36mui\x1b[0m          启动 Web UI 服务 (别名: dashboard)');
  console.log('    \x1b[36mstatus\x1b[0m      查看系统健康状态');
  console.log('    \x1b[36mcontext\x1b[0m     生成 Agent 上下文包 (透传 server CLI)');
  console.log('    \x1b[36mmigrate-auto\x1b[0m 一键迁移旧记忆 (透传 server CLI)');
  console.log('    \x1b[36monboard\x1b[0m     首次入门：迁移预览/导入 + Agent 配置 (透传 server CLI)');
  console.log('    \x1b[36mbackup-create\x1b[0m 创建可携备份 (透传 server CLI)');
  console.log('    \x1b[36mversion\x1b[0m     显示当前版本');
  console.log('    \x1b[36mhelp\x1b[0m        显示帮助信息');
  console.log('');
  console.log('  \x1b[1m选项:\x1b[0m');
  console.log('    \x1b[36m--stash\x1b[0m     自动暂存本地修改（update 命令）');
  console.log('');
  console.log('  \x1b[1m示例:\x1b[0m');
  console.log('    keymemory update');
  console.log('    keymemory update --stash');
  console.log('    keymemory dashboard');
  console.log('    keymemory doctor');
  console.log('    keymemory context "当前任务" --project "KeyMemory/发布"');
  console.log('    keymemory onboard --yes --run-dream');
  console.log('    keymemory backup-create ./keymemory-backup.json');
  console.log('    keymemory backup-restore ./keymemory-backup.json --dry-run');
  console.log('    keymemory status');
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
  console.log('    2. 运行 \x1b[36mkeymemory dashboard\x1b[0m 启动服务');
  console.log('');
}

function doUi() {
  require('./keymemory-ui');
}

function doDoctor() {
  require('./keymemory-doctor.js');
}

function doMcp() {
  require('./keymemory-mcp.js');
}

function ensureCliBuilt() {
  if (fs.existsSync(CLI_ENTRY) && fs.existsSync(SHARED_ENTRY)) return;
  console.log('');
  console.log('  \x1b[33m⚠ 构建产物不存在或不完整，正在执行 pnpm build...\x1b[0m');
  run('pnpm build');
}

function doCliPassthrough(args) {
  ensureCliBuilt();
  const result = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

function doStatus() {
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const PORT = 3210;
  const DATA_DIR = process.env.KEYMEMORY_DATA_DIR || path.join(os.homedir(), '.keymemory');
  const DB_PATH = process.env.KEYMEMORY_DB_PATH || path.join(DATA_DIR, 'data.db');

  console.log('');
  console.log('  \x1b[1m\x1b[36mKeyMemory\x1b[0m 健康状态');
  console.log('  \x1b[2m─────────────────────\x1b[0m');
  console.log('');

  // 检查数据库文件
  const dbExists = fs.existsSync(DB_PATH);
  console.log('  \x1b[1m数据存储:\x1b[0m');
  console.log('    数据库: ' + (dbExists ? '\x1b[32m✓ 存在\x1b[0m' : '\x1b[31m✗ 不存在\x1b[0m'));
  if (dbExists) {
    const stats = fs.statSync(DB_PATH);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log('    大小:   ' + sizeMB + ' MB');
    console.log('    路径:   ' + DB_PATH);
  }
  console.log('');

  // 尝试连接 API
  const req = http.get(`http://127.0.0.1:${PORT}/api/health/report`, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const health = JSON.parse(data);
        console.log('  \x1b[1mServer 状态:\x1b[0m \x1b[32m✓ 运行中\x1b[0m');
        console.log('    地址:   http://127.0.0.1:' + PORT);
        console.log('    健康度: ' + health.score + '/100');
        console.log('    重复:   ' + health.duplicateCount);
        console.log('    孤儿:   ' + health.orphanCount);
        console.log('    冲突:   ' + health.conflictCount);
        console.log('    衰减:   ' + health.decayingCount);
      } catch {
        console.log('  \x1b[1mServer 状态:\x1b[0m \x1b[32m✓ 运行中\x1b[0m (健康数据解析失败)');
      }
      console.log('');
      checkScheduler();
    });
  });

  req.on('error', () => {
    console.log('  \x1b[1mServer 状态:\x1b[0m \x1b[31m✗ 未运行\x1b[0m');
    console.log('    \x1b[2mKeyMemory Server 没有在 ' + PORT + ' 端口运行\x1b[0m');
    console.log('    \x1b[2m运行 \x1b[36mkeymemory dashboard\x1b[0m \x1b[2m启动服务\x1b[0m');
    console.log('');
    checkScheduler();
  });

  req.setTimeout(2000, () => {
    req.destroy();
  });

  function checkScheduler() {
    // 如果数据库存在，直接读取 scheduler 配置
    if (dbExists) {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(DB_PATH, { readonly: true });
        const rows = db.prepare("SELECT key, value FROM scheduler_config").all();
        const config = {};
        for (const row of rows) config[row.key] = row.value;

        console.log('  \x1b[1m梦境调度器:\x1b[0m');
        console.log('    状态:   ' + (config.dreamingEnabled === 'true' ? '\x1b[32m开启\x1b[0m' : '\x1b[31m关闭\x1b[0m'));
        console.log('    时间:   ' + (config.dreamingCron || '0 3 * * *'));
        console.log('    上次:   ' + (config.lastDreamRun ? new Date(config.lastDreamRun).toLocaleString('zh-CN') : '\x1b[33m从未运行\x1b[0m'));

        // 检查最近梦境报告
        const reports = db.prepare("SELECT status, created_at, completed_at, promoted, archived, merged FROM dream_reports ORDER BY created_at DESC LIMIT 3").all();
        console.log('');
        console.log('  \x1b[1m最近梦境:\x1b[0m');
        if (reports.length === 0) {
          console.log('    \x1b[2m无记录\x1b[0m');
        } else {
          reports.forEach(r => {
            const time = r.completed_at ? new Date(r.completed_at).toLocaleString('zh-CN') : new Date(r.created_at).toLocaleString('zh-CN');
            const statusColor = r.status === 'completed' ? '\x1b[32m' : r.status === 'failed' ? '\x1b[31m' : '\x1b[33m';
            console.log('    ' + statusColor + r.status + '\x1b[0m | ' + time + ' | 升' + r.promoted + ' 归' + r.archived + ' 并' + r.merged);
          });
        }
        db.close();
      } catch (e) {
        console.log('  \x1b[1m梦境调度器:\x1b[0m \x1b[33m无法读取 (better-sqlite3 未安装)\x1b[0m');
      }
    }
    console.log('');
    console.log('  \x1b[1m建议:\x1b[0m');
    console.log('    1. 如需自动梦境，确保 Server 常驻运行');
    console.log('    2. 运行 \x1b[36mkeymemory dashboard\x1b[0m 启动 Web UI 并常驻');
    console.log('    3. 或使用 \x1b[36mnode packages/server/dist/cli.js dream\x1b[0m 手动运行梦境');
    console.log('');
  }
}

// 主命令路由
const command = process.argv[2];

switch (command) {
  case 'update':
    doUpdate();
    break;
  case 'dashboard':
  case 'ui':
    doUi();
    break;
  case 'doctor':
    doDoctor();
    break;
  case 'mcp':
    doMcp();
    break;
  case 'version':
  case '-v':
  case '--version':
    showVersion();
    break;
  case 'status':
    doStatus();
    break;
  case 'help':
  case '-h':
  case '--help':
  case undefined:
    showHelp();
    break;
  default:
    doCliPassthrough(process.argv.slice(2));
    break;
}
