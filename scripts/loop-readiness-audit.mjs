// KeyMemory Loop Readiness Audit
// 22 项评分与 L1/L2/L3 等级阈值，所有分值与阈值为硬编码，本脚本不允许调整——只能调整仓库内容来提分。
//
// 用法：node scripts/loop-readiness-audit.mjs [repo-root]
// 输出：JSON，含逐项得分、总分、等级、附加硬性条件是否满足。

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();

// ===== 评分表（22 项硬编码）=====
// 不允许抽象化：每项有明确的检查目标与固定分值。
const SCORE_WEIGHTS = {
  base: 10,            // 仓库存在且非空
  stateFile: 18,       // 存在 .loop/state.json（或 loop-state.json）权威工作状态文件
  triage: 14,          // 存在 triage 脚本/skill（docs/triage.md 或 scripts/triage.*）
  loopConfig: 9,       // 存在 loop 配置（.loop/config.json 或 loop.config.*）
  agentsMd: 9,         // 存在 AGENTS.md
  skillsTwoPlus: 14,   // 注册了 ≥2 个 skill
  skillsOne: 7,        // 注册了 1 个 skill（与 skillsTwoPlus 互斥，取其一）
  verifier: 14,        // 存在验证器（scripts/verify.* 或 docs/verify.md）
  safetyLoopMd: 4,     // 存在 SAFETY-LOOP.md
  safetyDoc: 4,        // 存在 SAFETY.md 或 docs/safety.md
  github: 6,           // 存在 .github/ 目录
  githubWorkflows: 4,  // 存在 .github/workflows/*.yml
  mcp: 3,              // 存在 MCP 配置（.mcp.json 或 mcp-config.*）
  worktree: 3,         // 存在 worktree 配置或脚本
  registry: 2,         // 存在 pattern registry（docs/loop-patterns.md 或 registry.json）
  budgetDoc: 3,        // 存在预算文档（docs/loop-budget.md 或 BUDGET.md）
  runLog: 3,           // 存在运行日志（.loop/runs.jsonl 或 docs/run-log.md）
  loopMdBudget: 2,     // LOOP.md 中包含 budget 章节
  budgetSkill: 2,      // 存在预算相关 skill
  constraintsFile: 4,  // 存在约束文件（CONSTRAINTS.md 或 .loop/constraints.json）
  constraintsSkill: 2, // 存在约束相关 skill
  loopActivity: 6,     // loop 有真实活动（loop_runs 表有记录或 .loop/activity.jsonl 非空）
};

// ===== 等级阈值（硬编码）=====
const LEVEL_THRESHOLDS = { L1: 38, L2: 58, L3: 78 };

// ===== 附加硬性条件 =====
// L1 需 stateFile.present；L2 需 triage.present；
// L3 需 verifier.present + stateFile.present + costReady + hasRealActivity
// costReady = budgetDoc.present && runLog.present && loopMdBudget.present
// hasRealActivity = loopActivity.present

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function existsAny(relativePaths) {
  return relativePaths.some(p => exists(p));
}

function fileContains(relativePath, needle) {
  const full = path.join(repoRoot, relativePath);
  if (!fs.existsSync(full)) return false;
  try {
    const content = fs.readFileSync(full, 'utf-8');
    return content.toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

// ===== 逐项检查（每项返回 { item, present, score }）=====
function audit() {
  const checks = {};

  checks.base = { present: fs.readdirSync(repoRoot).length > 0, score: 0 };
  checks.stateFile = { present: existsAny(['.loop/state.json', '.loop/loop-state.json', 'loop-state.json']), score: 0 };
  checks.triage = { present: existsAny(['docs/triage.md', 'scripts/triage.mjs', 'scripts/triage.js', 'scripts/triage.sh']), score: 0 };
  checks.loopConfig = { present: existsAny(['.loop/config.json', 'loop.config.json', 'loop.config.yaml']), score: 0 };
  checks.agentsMd = { present: exists('AGENTS.md'), score: 0 };
  checks.skillsTwoPlus = { present: countSkills() >= 2, score: 0 };
  checks.skillsOne = { present: countSkills() === 1, score: 0 };
  checks.verifier = { present: existsAny(['scripts/verify.mjs', 'scripts/verify.js', 'scripts/verify.sh', 'docs/verify.md']), score: 0 };
  checks.safetyLoopMd = { present: exists('SAFETY-LOOP.md'), score: 0 };
  checks.safetyDoc = { present: existsAny(['SAFETY.md', 'docs/safety.md']), score: 0 };
  checks.github = { present: exists('.github'), score: 0 };
  checks.githubWorkflows = { present: exists('.github/workflows') && hasYamlInDir('.github/workflows'), score: 0 };
  checks.mcp = { present: existsAny(['.mcp.json', 'mcp-config.json', 'mcp-config.yaml']), score: 0 };
  checks.worktree = { present: existsAny(['.loop/worktree.json', 'scripts/worktree.mjs', 'scripts/worktree.sh']), score: 0 };
  checks.registry = { present: existsAny(['docs/loop-patterns.md', 'registry.json', '.loop/registry.json']), score: 0 };
  checks.budgetDoc = { present: existsAny(['docs/loop-budget.md', 'BUDGET.md', '.loop/budget.json']), score: 0 };
  checks.runLog = { present: existsAny(['.loop/runs.jsonl', '.loop/activity.jsonl', 'docs/run-log.md']), score: 0 };
  checks.loopMdBudget = { present: fileContains('LOOP.md', 'budget') || fileContains('docs/loop-harness.md', 'budget'), score: 0 };
  checks.budgetSkill = { present: hasSkillContaining('budget') || hasSkillContaining('cost'), score: 0 };
  checks.constraintsFile = { present: existsAny(['CONSTRAINTS.md', '.loop/constraints.json', 'docs/constraints.md']), score: 0 };
  checks.constraintsSkill = { present: hasSkillContaining('constraint'), score: 0 };
  checks.loopActivity = { present: hasLoopActivity(), score: 0 };

  // 计算分值：present 的项累加其权重
  // 注意 skillsTwoPlus 与 skillsOne 互斥：两者都 present 时只取 skillsTwoPlus
  for (const [key, check] of Object.entries(checks)) {
    check.score = check.present ? SCORE_WEIGHTS[key] : 0;
  }
  if (checks.skillsTwoPlus.present && checks.skillsOne.present) {
    checks.skillsOne.score = 0; // 互斥：已有 ≥2 skill，不再加 skillsOne 的分
  }

  const total = Object.values(checks).reduce((sum, c) => sum + c.score, 0);

  // 附加硬性条件
  const costReady = checks.budgetDoc.present && checks.runLog.present && checks.loopMdBudget.present;
  const hasRealActivity = checks.loopActivity.present;

  let level = 'L0';
  let levelBlocked = [];
  if (total >= LEVEL_THRESHOLDS.L1) {
    level = 'L1';
    if (!checks.stateFile.present) levelBlocked.push('L1 requires stateFile.present');
  }
  if (total >= LEVEL_THRESHOLDS.L2 && level === 'L1') {
    level = 'L2';
    if (!checks.triage.present) levelBlocked.push('L2 requires triage.present');
  }
  if (total >= LEVEL_THRESHOLDS.L3 && level === 'L2') {
    level = 'L3';
    if (!checks.verifier.present) levelBlocked.push('L3 requires verifier.present');
    if (!checks.stateFile.present) levelBlocked.push('L3 requires stateFile.present');
    if (!costReady) levelBlocked.push('L3 requires costReady (budgetDoc + runLog + loopMdBudget all present)');
    if (!hasRealActivity) levelBlocked.push('L3 requires hasRealActivity (loopActivity.present)');
  }

  // 如果有硬性条件未满足，降回上一级
  if (level === 'L3' && levelBlocked.length > 0) level = 'L2';
  if (level === 'L2' && levelBlocked.some(b => b.includes('triage'))) level = 'L1';
  if (level === 'L1' && levelBlocked.some(b => b.includes('stateFile'))) level = 'L0';

  return {
    repoRoot,
    total,
    maxPossible: Object.values(SCORE_WEIGHTS).reduce((s, v) => s + v, 0) - SCORE_WEIGHTS.skillsOne, // skillsTwoPlus 与 skillsOne 互斥
    level,
    levelBlocked,
    thresholds: LEVEL_THRESHOLDS,
    costReady,
    hasRealActivity,
    checks: Object.fromEntries(
      Object.entries(checks).map(([k, v]) => [k, { present: v.present, score: v.score, weight: SCORE_WEIGHTS[k] }]),
    ),
  };
}

function countSkills() {
  const skillsDir = path.join(repoRoot, '.loop', 'skills');
  if (fs.existsSync(skillsDir)) {
    return fs.readdirSync(skillsDir).filter(f => fs.statSync(path.join(skillsDir, f)).isDirectory()).length;
  }
  // 也检查 .claude/skills 或 skills/
  for (const dir of ['.claude/skills', 'skills']) {
    const full = path.join(repoRoot, dir);
    if (fs.existsSync(full)) {
      return fs.readdirSync(full).filter(f => fs.statSync(path.join(full, f)).isDirectory()).length;
    }
  }
  return 0;
}

function hasSkillContaining(keyword) {
  for (const dir of ['.loop/skills', '.claude/skills', 'skills']) {
    const full = path.join(repoRoot, dir);
    if (!fs.existsSync(full)) continue;
    for (const entry of fs.readdirSync(full)) {
      if (entry.toLowerCase().includes(keyword)) return true;
    }
  }
  return false;
}

function hasYamlInDir(relativeDir) {
  const full = path.join(repoRoot, relativeDir);
  if (!fs.existsSync(full)) return false;
  return fs.readdirSync(full).some(f => f.endsWith('.yml') || f.endsWith('.yaml'));
}

function hasLoopActivity() {
  // 检查 KeyMemory 数据库中的 loop_runs，或本地活动日志
  for (const candidate of ['.loop/runs.jsonl', '.loop/activity.jsonl']) {
    const full = path.join(repoRoot, candidate);
    if (fs.existsSync(full) && fs.statSync(full).size > 0) return true;
  }
  // 检查 KEYMEMORY_DATA_DIR 下的数据库是否有 loop_runs 记录
  const dataDir = process.env.KEYMEMORY_DATA_DIR;
  if (dataDir) {
    const dbPath = path.join(dataDir, 'data.db');
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0) {
      try {
        const { Database } = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        const count = db.prepare('SELECT COUNT(*) as count FROM loop_runs').get();
        db.close();
        if (count.count > 0) return true;
      } catch {
        // 数据库不存在或表不存在，忽略
      }
    }
  }
  return false;
}

const result = audit();
console.log(JSON.stringify(result, null, 2));
