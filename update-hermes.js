#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);

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

console.log('🔄 KeyMemory 增量更新');
console.log('====================');

const isGitRepo = fs.existsSync(path.join(ROOT, '.git'));
if (!isGitRepo) {
  console.error('\n❌ 当前目录不是 Git 仓库，无法增量更新。');
  console.error('   请使用 git clone 重新获取项目。');
  process.exit(1);
}

const currentVersion = getCurrentVersion();
console.log(`\n📦 当前版本: v${currentVersion}`);

const remote = runQuiet('git remote get-url origin');
if (!remote) {
  console.error('\n❌ 未配置远程仓库 (origin)。');
  process.exit(1);
}
console.log(`🌐 远程仓库: ${remote}`);

const currentBranch = runQuiet('git rev-parse --abbrev-ref HEAD');
console.log(`🌿 当前分支: ${currentBranch}`);

let stashed = false;

console.log('\n📋 第 1/4 步：检查本地修改...');
const statusOutput = runQuiet('git status --porcelain');
if (statusOutput) {
  const changedFiles = statusOutput.split('\n').filter(Boolean);
  console.log(`\n⚠️  检测到 ${changedFiles.length} 个本地修改：`);
  changedFiles.slice(0, 10).forEach(f => console.log(`   ${f}`));
  if (changedFiles.length > 10) {
    console.log(`   ... 还有 ${changedFiles.length - 10} 个文件`);
  }

  const stashChoice = process.argv.includes('--stash');
  if (stashChoice) {
    console.log('\n📦 暂存本地修改 (git stash)...');
    run('git stash push -m "keymemory-update-auto-stash"');
    stashed = true;
  } else {
    console.log('\n💡 提示：本地修改可能导致合并冲突。');
    console.log('   选项：');
    console.log('     1. 手动提交或还原修改后重新运行');
    console.log('     2. 使用 --stash 参数自动暂存修改');
    console.log('        例: node update-hermes.js --stash');
    console.log('\n⚠️  跳过更新。请处理本地修改后重试。');
    process.exit(1);
  }
} else {
  console.log('✅ 工作目录干净');
}

function restoreStash() {
  if (!stashed) return;
  const stashList = runQuiet('git stash list');
  if (stashList.includes('keymemory-update-auto-stash')) {
    console.log('\n📦 恢复暂存的本地修改...');
    const popResult = run('git stash pop', { allowFail: true });
    if (popResult === null) {
      console.log('⚠️  stash pop 有冲突，请手动处理：git stash pop');
    }
  }
}

console.log('\n📋 第 2/4 步：拉取远程更新...');
const localHash = runQuiet('git rev-parse HEAD');
console.log(`   本地提交: ${localHash.slice(0, 8)}`);

run('git fetch origin');

const remoteHash = runQuiet(`git rev-parse origin/${currentBranch}`);
console.log(`   远程提交: ${remoteHash.slice(0, 8)}`);

if (localHash === remoteHash) {
  console.log('\n✅ 已经是最新版本，无需更新！');
  restoreStash();
  process.exit(0);
}

const commitCount = runQuiet(`git rev-list ${localHash}..origin/${currentBranch} --count`);
console.log(`   新增提交: ${commitCount} 个`);

console.log('\n📋 第 3/4 步：合并更新...');
const pullResult = run('git pull --ff-only origin ' + currentBranch, { allowFail: true });
if (pullResult === null) {
  console.error('\n❌ 合并失败！可能存在冲突。');
  restoreStash();
  console.error('   请手动解决：');
  console.error('     1. git pull origin ' + currentBranch);
  console.error('     2. 解决冲突后 git commit');
  console.error('     3. 重新运行 node update-hermes.js');
  process.exit(1);
}
console.log('✅ 更新合并成功');

const newVersion = getCurrentVersion();
console.log(`\n📦 版本变化: v${currentVersion} → v${newVersion}`);

console.log('\n📋 第 4/4 步：重新构建...');
console.log('   安装依赖...');
run('pnpm install');

console.log('   构建项目...');
run('pnpm build');

if (process.argv.includes('--stash')) {
  restoreStash();
}

console.log('\n✅ KeyMemory 更新完成！');
console.log(`\n🚀 下一步：`);
console.log('   1. 重启 Claude Desktop');
console.log('   2. 运行 start-hermes.bat 启动服务');
console.log(`\n📊 更新摘要：`);
console.log(`   版本: v${currentVersion} → v${newVersion}`);
console.log(`   提交: +${commitCount}`);
