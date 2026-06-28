/**
 * 一次性标签清理脚本。
 *
 * 批量清洗已有记忆的 tags，应用与 normalizeTags 相同的清洗规则：
 *  - 剥离命名空间前缀（type:/source:/kind:/scope:/domain:/project: 等）
 *  - 剥离路径型标签（含 / \ ~）
 *  - 剥离超长标签（>30 字符）
 *  - 剥离日期版本号、流程状态标签
 *  - 剥离含括号的长描述
 *  - 去重 + 最多保留 8 个
 *
 * 用法：node scripts/clean-tags.mjs [--dry-run]
 */

import { resolve } from 'path';
import { homedir } from 'os';
import { createRequire } from 'module';

// ESM 不向上查找 node_modules，用 createRequire 从 server 包加载 better-sqlite3
const require = createRequire(resolve(homedir(), 'KeyMemory/packages/server/package.json'));
const Database = require('better-sqlite3');

const DB_PATH = resolve(homedir(), '.keymemory/data.db');
const dryRun = process.argv.includes('--dry-run');

// ---- 清洗规则（与 memory-schema.ts 的 normalizeTags 保持一致）----
const TAG_NAMESPACE_PREFIXES = /^(type|source|kind|scope|domain|project|sensitivity|layer|status):/i;
const TAG_DATE_VERSION = /^v?\d{4}-\d{2}-\d{2}|^verified-\d{4}|^fixed-\d{4}|^global-rules-\d{4}/i;
const TAG_PROCESS_STATE = /^(step-\d|cli-stage|final-result|pull-after-build|smoke-verification|\d+-of-\d+-pass)/i;

function isMeaningfulTag(tag) {
  const trimmed = tag.trim();
  if (trimmed.length < 2 || trimmed.length > 30) return false;
  if (TAG_NAMESPACE_PREFIXES.test(trimmed)) return false;
  if (TAG_DATE_VERSION.test(trimmed)) return false;
  if (TAG_PROCESS_STATE.test(trimmed)) return false;
  if (/[\/\\~]/.test(trimmed)) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  if (/^[\d\W_]+$/.test(trimmed)) return false;
  if (trimmed.includes('（') || trimmed.includes('(')) return false;
  return true;
}

function cleanTag(tag) {
  return tag.trim().replace(/^["'""''「『]+|["'""''」』]+$/g, '');
}

function normalizeTags(tags) {
  if (!tags || tags.length === 0) return [];
  const seen = new Set();
  const result = [];
  for (const tag of tags) {
    const cleaned = cleanTag(tag);
    const key = cleaned.toLowerCase();
    if (!seen.has(key) && isMeaningfulTag(cleaned)) {
      seen.add(key);
      result.push(cleaned);
    }
  }
  return result.slice(0, 8);
}

// ---- 主逻辑 ----
const db = new Database(DB_PATH, { readonly: dryRun });
console.log(`[clean-tags] DB: ${DB_PATH}`);
console.log(`[clean-tags] Mode: ${dryRun ? 'DRY RUN' : 'WRITE'}`);

const rows = db.prepare(`
  SELECT id, title, tags FROM memories WHERE status = 'active' AND tags IS NOT NULL
`).all();

console.log(`[clean-tags] Found ${rows.length} active memories with tags`);

let updated = 0;
let removedTagCount = 0;
const updateStmt = db.prepare(`UPDATE memories SET tags = ? WHERE id = ?`);

for (const row of rows) {
  let oldTags;
  try {
    oldTags = JSON.parse(row.tags);
  } catch {
    continue;
  }
  if (!Array.isArray(oldTags) || oldTags.length === 0) continue;

  const newTags = normalizeTags(oldTags);
  const oldStr = JSON.stringify(oldTags);
  const newStr = JSON.stringify(newTags);

  if (oldStr !== newStr) {
    removedTagCount += (oldTags.length - newTags.length);
    if (!dryRun) {
      updateStmt.run(newStr, row.id);
    }
    updated++;
    if (updated <= 10 || updated % 20 === 0) {
      console.log(`  [${updated}] ${row.id.slice(0, 8)} "${row.title?.slice(0, 30)}"`);
      console.log(`    旧(${oldTags.length}): ${oldTags.slice(0, 6).join(', ')}${oldTags.length > 6 ? '...' : ''}`);
      console.log(`    新(${newTags.length}): ${newTags.slice(0, 6).join(', ')}${newTags.length > 6 ? '...' : ''}`);
    }
  }
}

console.log(`\n[clean-tags] Done: ${updated} memories updated, ~${removedTagCount} tags removed`);
if (dryRun) {
  console.log('[clean-tags] (dry-run, no changes written)');
}
db.close();
