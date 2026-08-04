/**
 * eval-retrieval.mjs — KM-003：中文为主的检索质量评测集
 *
 * 隔离数据库中生成 ≥200 条确定性记忆与 ≥60 条带 gold 标注的 query，
 * 覆盖六类：事实检索 / 偏好检索 / 时点查询(as-of) / 实体关联 / 冲突事实 / 长尾稀疏。
 * 特别包含「新写入且从未命中（hit_count=0）」的记忆作为召回目标（直接检验 D2/KM-104）。
 *
 * 指标：Recall@5 / Recall@10 / MRR / P95 延迟 / LIKE 降级触发率。
 * 同时输出「旧方案模拟」基线：无 bigram 的 FTS（中文整句单 token → 0 命中）
 * 降级为 LIKE 按 updated_at 排序，用于量化修复收益。
 *
 * 运行：pnpm eval:retrieval   （或 node scripts/eval-retrieval.mjs）
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-retrieval-eval-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;
process.env.KEYMEMORY_DB_PATH = path.join(dataDir, 'data.db');

const { initDatabase, closeDatabase, getDatabase } = await import('../packages/server/dist/db/sqlite.js');
const { createMemory } = await import('../packages/server/dist/core/atom.js');
const { searchHybrid } = await import('../packages/server/dist/core/query.js');
const { ensureEntity, linkMemoryEntity } = await import('../packages/server/dist/graph/entity.js');
initDatabase();
const db = getDatabase();

/* ---------------- 确定性词表（无随机数，保证可复现） ---------------- */
const ENTITIES = [
  '青龙调度器', '白泽网关', '麒麟报表', '貔貅缓存', '饕餮消息队列',
  '王小明', '李工程', '张测试', '陈运维', '刘产品',
  '数据中台', '结算系统', '风控引擎', '推荐服务', '日志平台',
  '移动端首页', '订单中心', '库存服务', '支付网关', '客服机器人',
  '灰度发布平台', '监控大盘', '权限中心', '搜索服务', '文件存储',
  '配置中心', '任务编排器', '审计日志', '容灾切换', '链路追踪',
  '账单系统', '优惠券引擎', '直播服务', '评论系统', '通知中心',
  '报表导出', '数据同步器', '接口网关', '沙箱环境', '压测平台',
];
const FEATURES = ['增量同步', '秒级回滚', '多租户隔离', '冷启动优化', '熔断降级', '灰度分流', '幂等重试', '分片扩容'];
const TECHS = ['Rust 重写', '分库分表', '读写分离', '本地缓存', '批量合并', '异步落盘'];
const REASONS = ['旧方案在高峰期超时率超过 8%', '运维成本翻倍', '依赖的组件停止维护', '合规要求数据不出境'];
const ENVS = ['预发', '灰度', '生产', '压测'];
const BUGS = ['内存泄漏', '连接池耗尽', '时区错乱', '重复消费'];
const CAUSES = ['未关闭游标', '超时配置过短', '夏令时切换', '消费位点回退'];
const TASKS = ['容量评估', '权限梳理', '链路改造', '预案演练'];
const FORMATS = ['紧凑 JSON', 'Markdown 表格', '带引用的长文'];

const memories = []; // { id, entity, kind, text }
const queries = [];  // { id, category, query, gold: string[], options? }

function addMemory(text, opts = {}) {
  const mem = createMemory({
    title: opts.title ?? text.slice(0, 30),
    content: text,
    layer: opts.layer ?? 'short',
    tags: opts.tags,
    source: 'retrieval-eval',
    bypassQualityGate: true,
    validFrom: opts.validFrom,
    validTo: opts.validTo,
  });
  memories.push({ id: mem.id, ...opts.meta });
  return mem;
}

/* ---------------- 生成 200 条基础记忆（40 实体 × 5 类） ---------------- */
ENTITIES.forEach((entity, i) => {
  const feature = FEATURES[i % FEATURES.length];
  const tech = TECHS[i % TECHS.length];
  const reason = REASONS[i % REASONS.length];
  const env = ENVS[i % ENVS.length];
  const bug = BUGS[i % BUGS.length];
  const cause = CAUSES[i % CAUSES.length];
  const task = TASKS[i % TASKS.length];
  const format = FORMATS[i % FORMATS.length];

  addMemory(`用户偏好：${entity} 相关的输出格式统一用${format}，评审时按此呈现。`, { meta: { entity, kind: 'preference' } });
  addMemory(`${entity} 在 2026 年 3 月上线了${feature}能力，整体耗时 ${5 + (i % 9)} 天，回归全部通过。`, { meta: { entity, kind: 'fact', feature } });
  addMemory(`决定：${entity} 改用${tech}方案推进，因为${reason}。该决策已经过评审确认。`, { meta: { entity, kind: 'decision' } });
  addMemory(`踩坑记录：${entity} 在${env}环境出现${bug}，排查后确认根因是${cause}，已加入巡检项。`, { meta: { entity, kind: 'pitfall', bug } });
  addMemory(`任务：${entity} 的${task}还在待办中，验收标准是演练通过并留档，优先级高。`, { meta: { entity, kind: 'task' } });
});

/* ---------------- 时点查询：10 个实体的新旧两版决策（as-of 真值） ---------------- */
const ASOF_ENTITIES = ENTITIES.slice(0, 10);
ASOF_ENTITIES.forEach((entity, i) => {
  const oldTech = TECHS[i % TECHS.length];
  const newTech = TECHS[(i + 3) % TECHS.length];
  addMemory(`决策历史：${entity} 曾决定采用${oldTech}路线，当时是基于成本考虑。`, {
    meta: { entity, kind: 'decision-old', tech: oldTech },
    validFrom: '2025-06-01T00:00:00.000Z',
    validTo: '2026-01-01T00:00:00.000Z',
  });
  addMemory(`最新决策：${entity} 自 2026 年起改为${newTech}路线，替换此前的${oldTech}方案。`, {
    meta: { entity, kind: 'decision-new', tech: newTech },
    validFrom: '2026-01-01T00:00:00.000Z',
  });
});

/* ---------------- 冲突事实：8 个实体的对立表述 ---------------- */
const CONFLICT_ENTITIES = ENTITIES.slice(10, 18);
CONFLICT_ENTITIES.forEach((entity, i) => {
  const oldTech = TECHS[(i + 1) % TECHS.length];
  const newTech = TECHS[(i + 4) % TECHS.length];
  addMemory(`${entity} 的基础设施仍在使用${oldTech}，短期内没有替换计划。`, { meta: { entity, kind: 'conflict-a' } });
  addMemory(`${entity} 的基础设施已经迁移到${newTech}，旧的${oldTech}只保留只读副本。`, { meta: { entity, kind: 'conflict-b' } });
});

/* ---------------- 长尾稀疏：10 条含唯一罕见词的记忆 ---------------- */
const RARE_TOKENS = ['氙灯校准', '钨丝熔断', '釉面开片', '榫卯错位', '声呐旁瓣', '铋晶体孪晶', '荧光猝灭', '驻波节点', '磁滞回线', '毛细爬升'];
RARE_TOKENS.forEach((token, i) => {
  addMemory(`实验记录：${token}现象出现在第 ${i + 3} 组样本中，重复三次均可复现，需要专项分析。`, { meta: { entity: token, kind: 'rare', token } });
});

assert.ok(memories.length >= 200, `记忆数量需 ≥200，实际 ${memories.length}`);

/* ---------------- KM-107/108：实体路由与多跳用例 ----------------
 * hopA 正文含“青鸾链路”（可被 FTS 命中）；hopB 正文完全不含查询词，
 * 仅通过实体链接与 hopA 共享实体“青鸾链路”。首跳候选稀疏时必须经
 * 实体一跳扩展才能召回 hopB——直接检验 KM-108。 */
const hopA = addMemory('青鸾链路改造由专项小组主导，压测全部通过，报告已经归档留存。', { meta: { entity: '青鸾链路', kind: 'hop-a' } });
const hopB = addMemory('回滚预案存放在运维空间并演练过两次，随时可以执行。', { meta: { entity: '青鸾链路', kind: 'hop-b' } });
const hopEntity = ensureEntity('青鸾链路', 'concept');
linkMemoryEntity(hopA.id, hopEntity.id);
linkMemoryEntity(hopB.id, hopEntity.id);
queries.push({ category: 'multihop', query: '青鸾链路 压测 报告', gold: [hopA.id, hopB.id] });

/* ---------------- 生成 60+ 条 query（六类，每类 ≥10 条） ---------------- */
const byKind = (entity, kind) => memories.filter(m => m.entity === entity && m.kind === kind).map(m => m.id);

// 1. 事实检索（12）：实体 + 功能词
for (let i = 0; i < 12; i++) {
  const entity = ENTITIES[i];
  const fact = memories.find(m => m.entity === entity && m.kind === 'fact');
  queries.push({ category: 'fact', query: `${entity} 上线 能力 回归`, gold: [fact.id] });
}
// 2. 偏好检索（10）
for (let i = 0; i < 10; i++) {
  const entity = ENTITIES[i + 12];
  queries.push({ category: 'preference', query: `${entity} 输出格式 偏好`, gold: byKind(entity, 'preference') });
}
// 3. 时点查询（10）：asOf 在切换点前后，gold 为对应有效版本
ASOF_ENTITIES.forEach((entity) => {
  queries.push({
    category: 'asof',
    query: `${entity} 决策 路线`,
    gold: byKind(entity, 'decision-old'),
    options: { asOf: '2025-09-01T00:00:00.000Z' },
  });
});
// 3b. 时点查询（asOf 之后 → 新版本，另计 10 条）
ASOF_ENTITIES.forEach((entity) => {
  queries.push({
    category: 'asof',
    query: `${entity} 决策 路线 最新`,
    gold: byKind(entity, 'decision-new'),
    options: { asOf: '2026-03-01T00:00:00.000Z' },
  });
});
// 4. 实体关联（10）：仅实体名，gold 为该实体全部基础记忆
for (let i = 0; i < 10; i++) {
  const entity = ENTITIES[i + 22];
  queries.push({
    category: 'entity',
    query: entity,
    gold: memories.filter(m => m.entity === entity && ['preference', 'fact', 'decision', 'pitfall', 'task'].includes(m.kind)).map(m => m.id),
  });
}
// 5. 冲突事实（8）：gold 为对立双方
CONFLICT_ENTITIES.forEach((entity) => {
  queries.push({ category: 'conflict', query: `${entity} 基础设施 迁移`, gold: [...byKind(entity, 'conflict-a'), ...byKind(entity, 'conflict-b')] });
});
// 6. 长尾稀疏（10）
RARE_TOKENS.forEach((token) => {
  queries.push({ category: 'sparse', query: `${token} 现象 复现`, gold: byKind(token, 'rare') });
});

assert.ok(queries.length >= 60, `query 数量需 ≥60，实际 ${queries.length}`);

/* ---------------- 评测执行 ---------------- */
function metricsFor(rankedIds, goldSet) {
  const rank5 = rankedIds.slice(0, 5).filter(id => goldSet.has(id)).length;
  const rank10 = rankedIds.slice(0, 10).filter(id => goldSet.has(id)).length;
  const firstHit = rankedIds.findIndex(id => goldSet.has(id));
  return { recall5: rank5 / goldSet.size, recall10: rank10 / goldSet.size, rr: firstHit >= 0 ? 1 / (firstHit + 1) : 0 };
}

/** 旧方案模拟：无 bigram 的 FTS（中文整句单 token → 0 命中）→ LIKE 按 updated_at 排序。 */
function legacySearch(queryText, options) {
  const terms = queryText.split(/[\s,，。；;]+/).filter(Boolean).slice(0, 6);
  const conds = terms.map((_, i) => `(m.title LIKE @t${i} OR m.content LIKE @t${i} OR m.tags LIKE @t${i})`);
  const params = {};
  terms.forEach((t, i) => { params[`t${i}`] = `%${t}%`; });
  let asOfCond = '';
  if (options?.asOf) {
    params.asOf = options.asOf;
    // 与 addSearchFilters 一致的时态过滤：validFrom/validTo 存于 metadata JSON。
    asOfCond = ` AND COALESCE(CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata) THEN json_extract(m.metadata, '$.validFrom') END, m.created_at) <= @asOf
      AND (CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata) THEN json_extract(m.metadata, '$.validTo') END IS NULL
        OR CASE WHEN m.metadata IS NOT NULL AND json_valid(m.metadata) THEN json_extract(m.metadata, '$.validTo') END > @asOf)`;
  }
  const rows = db.prepare(`
    SELECT m.id FROM memories m
    WHERE m.status = 'active' AND (${conds.join(' OR ')})${asOfCond}
    ORDER BY m.updated_at DESC LIMIT 10
  `).all(params);
  return rows.map(r => r.id);
}

async function runEval(label, searchFn) {
  const latencies = [];
  let sumR5 = 0, sumR10 = 0, sumMRR = 0, degraded = 0;
  const byCategory = {};
  for (const q of queries) {
    const start = Date.now();
    const results = await searchFn(q);
    latencies.push(Date.now() - start);
    const ranked = results.map(r => r.memory.id);
    const m = metricsFor(ranked, new Set(q.gold));
    sumR5 += m.recall5; sumR10 += m.recall10; sumMRR += m.rr;
    if (results.some(r => r.degraded)) degraded += 1;
    const cat = byCategory[q.category] ?? { r5: 0, r10: 0, mrr: 0, n: 0 };
    cat.r5 += m.recall5; cat.r10 += m.recall10; cat.mrr += m.rr; cat.n += 1;
    byCategory[q.category] = cat;
  }
  const n = queries.length;
  latencies.sort((a, b) => a - b);
  return {
    label,
    queries: n,
    recallAt5: Number((sumR5 / n).toFixed(4)),
    recallAt10: Number((sumR10 / n).toFixed(4)),
    mrr: Number((sumMRR / n).toFixed(4)),
    p95LatencyMs: latencies[Math.min(n - 1, Math.floor(n * 0.95))],
    degradedQueries: degraded,
    byCategory: Object.fromEntries(Object.entries(byCategory).map(([k, v]) => [k, {
      recallAt5: Number((v.r5 / v.n).toFixed(4)), recallAt10: Number((v.r10 / v.n).toFixed(4)), mrr: Number((v.mrr / v.n).toFixed(4)),
    }])),
  };
}

const current = await runEval('current (KM-101/103/104/106)', async (q) =>
  searchHybrid(q.query, { limit: 10, status: 'active', ...(q.options ?? {}) }));

const legacy = await runEval('legacy-simulated (no bigram, LIKE by updated_at)', async (q) =>
  legacySearch(q.query, q.options).map(id => ({ memory: { id }, degraded: undefined })));

// KM-001 验证：query_logs 可还原完整排序过程
const logged = db.prepare(`
  SELECT query_id, rank, score, latency_ms, candidate_count, degraded_reason
  FROM query_logs WHERE match_type = 'hybrid' AND query_id IS NOT NULL
`).all();
assert.ok(logged.length > 0, 'query_logs 必须记录 hybrid 命中的完整指标');
assert.ok(logged.every(r => typeof r.score === 'number' && r.rank > 0), '每条日志需含 rank 与 score');

const report = {
  generatedAt: new Date().toISOString(),
  dataset: { memories: memories.length, queries: queries.length, dataDir },
  current,
  legacyBaseline: legacy,
  queryLogRows: logged.length,
};
console.log(JSON.stringify(report, null, 2));

closeDatabase();
fs.rmSync(dataDir, { recursive: true, force: true });

// 硬门槛：中文检索修复后 Recall@5 必须显著高于旧方案模拟基线
assert.ok(current.recallAt5 > legacy.recallAt5, `Recall@5 (${current.recallAt5}) 必须高于旧方案基线 (${legacy.recallAt5})`);
assert.ok(current.recallAt5 >= 0.5, `Recall@5 需 ≥0.5，实际 ${current.recallAt5}`);
console.error(`\n✅ retrieval eval 通过：Recall@5 ${legacy.recallAt5} → ${current.recallAt5}，MRR ${current.mrr}，P95 ${current.p95LatencyMs}ms`);
process.exit(0);
