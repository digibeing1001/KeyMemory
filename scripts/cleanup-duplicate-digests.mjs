#!/usr/bin/env node
/**
 * cleanup-duplicate-digests.mjs —— 一次性清理存量重复的记忆秘书 digest 邮件
 *
 * 背景：历史 bug 导致某些主题产生大量重复 digest（sender_type='secretary' 且
 * message_type='digest'）。本脚本按 thread 归簇识别重复，软删除（仅 UPDATE
 * status，绝不 DELETE），并在 --apply 前强制生成整库备份。
 *
 * 用法：
 *   node scripts/cleanup-duplicate-digests.mjs --db <path>            # dry-run，只输出报告
 *   node scripts/cleanup-duplicate-digests.mjs --db <path> --apply    # 备份后真正执行清理
 *   node scripts/cleanup-duplicate-digests.mjs --db <path> --apply --keep 2  # 每簇保留 2 封
 *
 * 参数：
 *   --db <path>   必填，目标 SQLite 数据库文件路径（避免误操作错误的库）
 *   --apply       真正执行；缺省为 dry-run（只读探查，不写任何数据，不备份）
 *   --keep <n>    每个重复簇保留几封（默认 1，保留 created_at 最新的一封）
 *
 * 重复识别规则（每个 thread 内独立归簇）：
 *   1. 优先使用 metadata.contentFingerprint 相同的归为一簇（新数据）；
 *   2. 无指纹的旧数据按 metadata.sourceMemoryIds 数组完全相同归簇；
 *   3. 两者皆无的消息不参与清理；
 *   4. 每簇保留 created_at 最新的 --keep 封，其余置为 status='superseded'。
 *
 * 安全说明：
 *   - 只 UPDATE mail_messages.status，不 DELETE，不动 mail_attachments /
 *     mail_receipts / mail_threads.current_summary；
 *   - 仅影响 sender_type='secretary' 且 message_type='digest' 的消息；
 *   - dry-run 以只读方式打开数据库；--apply 时才以读写方式打开并包裹在事务中；
 *   - --apply 前先用 SQLite VACUUM INTO 生成带时间戳的整库备份并打印路径；
 *   - 脚本会先检查 mail_messages.status 是否有 CHECK 约束：无约束直接写
 *     'superseded'；若有约束导致写入失败，则回滚事务并终止，报告原因。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

// ESM 不向上查找 node_modules，从 server 包解析 better-sqlite3
const serverRequire = createRequire(new URL('../packages/server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');

// ---------- 参数解析 ----------
function parseArgs(argv) {
  const args = { db: null, apply: false, keep: 1 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db') {
      args.db = argv[++i];
    } else if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--keep') {
      const value = Number.parseInt(argv[++i], 10);
      if (!Number.isInteger(value) || value < 1) {
        fail(`--keep 需要正整数，收到: ${argv[i]}`);
      }
      args.keep = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 30).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
      process.exit(0);
    } else {
      fail(`未知参数: ${arg}`);
    }
  }
  if (!args.db) fail('缺少必填参数 --db <path>');
  return args;
}

function fail(message) {
  console.error(`[cleanup-duplicate-digests] 错误: ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv);
const dbPath = path.resolve(args.db);
if (!fs.existsSync(dbPath)) fail(`数据库文件不存在: ${dbPath}`);

// ---------- 工具函数 ----------
function parseMetadata(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 归簇 key：优先 contentFingerprint，其次 sourceMemoryIds 完全相同 */
function clusterKey(metadata) {
  if (typeof metadata.contentFingerprint === 'string' && metadata.contentFingerprint.length > 0) {
    return `fp:${metadata.contentFingerprint}`;
  }
  if (Array.isArray(metadata.sourceMemoryIds) && metadata.sourceMemoryIds.length > 0) {
    return `src:${JSON.stringify(metadata.sourceMemoryIds)}`;
  }
  return null; // 无法识别归属，不参与清理
}

/** 检测 mail_messages.status 是否存在 CHECK 约束 */
function statusHasCheckConstraint(db) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'mail_messages'").get();
  if (!row || typeof row.sql !== 'string') fail('数据库中不存在 mail_messages 表，请确认 --db 指向了正确的 KeyMemory 库');
  return /\bCHECK\s*\([^)]*\bstatus\b/i.test(row.sql);
}

// ---------- 只读探查 & 制定清理计划 ----------
function buildPlan(db) {
  const rows = db.prepare(`
    SELECT m.id, m.thread_id, m.created_at, m.metadata, t.subject
    FROM mail_messages m
    JOIN mail_threads t ON t.id = m.thread_id
    WHERE m.sender_type = 'secretary'
      AND m.message_type = 'digest'
      AND m.status != 'superseded'
    ORDER BY m.thread_id, m.created_at DESC, m.id DESC
  `).all();

  /** threadId -> { subject, clusters: Map<key, rows[]> } */
  const threads = new Map();
  let skippedNoKey = 0;
  for (const row of rows) {
    const metadata = parseMetadata(row.metadata);
    const key = clusterKey(metadata);
    if (!key) {
      skippedNoKey += 1;
      continue;
    }
    if (!threads.has(row.thread_id)) threads.set(row.thread_id, { subject: row.subject, clusters: new Map() });
    const entry = threads.get(row.thread_id);
    if (!entry.clusters.has(key)) entry.clusters.set(key, []);
    entry.clusters.get(key).push(row); // 已按 created_at DESC 排序
  }

  const plan = [];
  for (const [threadId, { subject, clusters }] of threads) {
    const threadKeep = [];
    const threadCleanup = [];
    let dupClusters = 0;
    for (const [, members] of clusters) {
      if (members.length <= args.keep) continue;
      dupClusters += 1;
      threadKeep.push(...members.slice(0, args.keep).map((m) => m.id));
      threadCleanup.push(...members.slice(args.keep));
    }
    if (threadCleanup.length > 0) {
      plan.push({ threadId, subject, dupClusters, keepIds: threadKeep, cleanup: threadCleanup });
    }
  }
  return { plan, skippedNoKey, totalDigests: rows.length };
}

function printReport({ plan, skippedNoKey, totalDigests }) {
  const totalCleanup = plan.reduce((sum, t) => sum + t.cleanup.length, 0);
  console.log(`\n共扫描 digest 消息 ${totalDigests} 封（已排除 status='superseded'）；无法归簇（无指纹且无 sourceMemoryIds）${skippedNoKey} 封，不参与清理。`);
  if (plan.length === 0) {
    console.log('未发现重复簇，无需清理。');
    return;
  }
  console.log(`发现 ${plan.length} 个主题存在重复，待清理 ${totalCleanup} 封：\n`);
  for (const { threadId, subject, dupClusters, keepIds, cleanup } of plan) {
    console.log(`主题: ${subject}`);
    console.log(`  thread_id: ${threadId} | 重复簇: ${dupClusters} | 待清理: ${cleanup.length} 封`);
    console.log(`  保留消息 id: ${keepIds.join(', ')}`);
    console.log(`  清理消息 id: ${cleanup.map((m) => m.id).join(', ')}`);
    console.log('');
  }
}

// ---------- 备份（VACUUM INTO） ----------
function makeBackup(db) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath, path.extname(dbPath));
  const backupPath = path.join(dir, `${base}.cleanup-backup-${stamp}.db`);
  db.pragma('wal_checkpoint(TRUNCATE)').catch?.(() => {});
  db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  if (!fs.existsSync(backupPath)) fail('备份文件生成失败');
  return backupPath;
}

// ---------- 主流程 ----------
const mode = args.apply ? 'apply' : 'dry-run';
console.log(`[cleanup-duplicate-digests] 模式: ${mode} | 数据库: ${dbPath} | 每簇保留: ${args.keep} 封`);

// 第一步：只读探查（避免与运行中的服务产生写冲突）
const roDb = new Database(dbPath, { readonly: true, fileMustExist: true });
let planResult;
let hasCheckConstraint;
try {
  hasCheckConstraint = statusHasCheckConstraint(roDb);
  planResult = buildPlan(roDb);
} finally {
  roDb.close();
}

printReport(planResult);

if (!args.apply) {
  console.log('dry-run 结束，未修改任何数据。确认无误后追加 --apply 执行清理。');
  process.exit(0);
}

const idsToCleanup = planResult.plan.flatMap((t) => t.cleanup.map((m) => m.id));
if (idsToCleanup.length === 0) {
  console.log('没有需要清理的消息，--apply 无需执行。');
  process.exit(0);
}

// 第二步：读写打开，先备份，再在事务中执行 UPDATE
const db = new Database(dbPath, { fileMustExist: true });
try {
  db.pragma('busy_timeout = 5000');

  const backupPath = makeBackup(db);
  console.log(`\n已生成整库备份: ${backupPath}`);

  // status 列若有 CHECK 约束，先用单条试探；失败则整体回滚并说明
  const targetStatus = 'superseded';
  const update = db.prepare('UPDATE mail_messages SET status = ? WHERE id = ? AND sender_type = ? AND message_type = ?');
  try {
    db.transaction(() => {
      if (hasCheckConstraint) {
        // 试探：约束存在时若写入失败会抛错，事务自动回滚
        update.run(targetStatus, idsToCleanup[0], 'secretary', 'digest');
      }
      let updated = 0;
      for (const id of idsToCleanup) {
        // 限定 sender_type/message_type，确保对非 digest/非 secretary 消息零影响
        updated += update.run(targetStatus, id, 'secretary', 'digest').changes;
      }
      if (updated !== idsToCleanup.length) {
        throw new Error(`实际更新 ${updated} 条，与预期 ${idsToCleanup.length} 条不一致（数据可能已变化）`);
      }
      return updated;
    })();
  } catch (error) {
    fail(`清理事务已回滚，未修改数据${hasCheckConstraint ? '（mail_messages.status 疑似存在 CHECK 约束，请人工确认现有软删除状态值后调整脚本）' : ''}: ${error.message}`);
  }

  const remaining = db.prepare(`
    SELECT COUNT(*) AS count FROM mail_messages
    WHERE sender_type = 'secretary' AND message_type = 'digest' AND status != 'superseded'
  `).get();
  console.log(`\n清理完成：已将 ${idsToCleanup.length} 封重复 digest 置为 status='superseded'（软删除，未物理删除）。`);
  console.log(`剩余有效 digest: ${remaining.count} 封。备份文件: ${backupPath}`);
  console.log('注意：mail_attachments / mail_receipts / mail_threads.current_summary 均未改动。');
} finally {
  db.close();
}
