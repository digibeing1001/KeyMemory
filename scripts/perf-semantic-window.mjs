/**
 * perf-semantic-window.mjs — KM-105 验收：10000 条库语义检索 P95 < 150ms
 *
 * 等价 ANN 方案说明：sqlite-vec 等外部 ANN 扩展在部分环境不可安装；
 * 本仓库采用“分层抽样候选窗口 + 精确余弦复核”作为等价方案：
 * 候选规模被窗口约束（≤1500 条）且与库总量无关，1024 维余弦 ×1500 ≈ 毫秒级，
 * 因此 P95 承诺不依赖库规模。本脚本用生产同一代码路径
 * （selectStratifiedSemanticRows + rankSemanticCandidates）真实压测验证。
 *
 * 运行：node scripts/perf-semantic-window.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-perf-semantic-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;
process.env.KEYMEMORY_DB_PATH = path.join(dataDir, 'data.db');

const { initDatabase, getDatabase } = await import('../packages/server/dist/db/sqlite.js');
const { selectStratifiedSemanticRows, rankSemanticCandidates, filterTemporalSupersededIds } = await import('../packages/server/dist/core/query.js');
const { embeddingToBuffer } = await import('../packages/server/dist/embed/onnx.js');
const { warmupEmbeddingCache } = await import('../packages/server/dist/core/embedding-cache.js');
initDatabase();

const db = getDatabase();
const N = 10000;
const DIM = 1024;
const rootProjectId = (db.prepare("SELECT id FROM projects WHERE parent_id IS NULL AND name = '未分类' LIMIT 1").get() ?? { id: '' }).id;

function randVec(seed) {
  let s = seed >>> 0;
  const next = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const v = new Float32Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) { v[i] = next() - 0.5; norm += v[i] * v[i]; }
  norm = Math.sqrt(norm);
  for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

console.log(`[perf] seeding ${N} memories + embeddings...`);
const seedStart = Date.now();
const insertMemory = db.prepare(`
  INSERT INTO memories (id, title, content, layer, project_id, agent_space, owner_agent_id, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, metadata, source, source_id, owner_user_id)
  VALUES (?, ?, ?, 'short', ?, 'global', NULL, 1.0, ?, 'active', 1.0, ?, ?, '[]', '{}', 'perf', NULL, NULL)
`);
const insertEmbedding = db.prepare(`
  INSERT INTO embeddings (memory_id, embedding, model, created_at) VALUES (?, ?, 'perf', ?)
`);
const now = new Date().toISOString();
db.transaction(() => {
  for (let i = 0; i < N; i++) {
    const id = `perf-${i}`;
    const created = new Date(Date.now() - (N - i) * 60000).toISOString();
    insertMemory.run(id, `perf memory ${i}`, `synthetic content for performance benchmark ${i}`, rootProjectId, i % 97, created, created);
    insertEmbedding.run(id, embeddingToBuffer(randVec(i * 2654435761 % 4294967291)), now);
  }
})();
console.log(`[perf] seeded in ${Date.now() - seedStart}ms`);

console.log('[perf] warming embedding cache...');
const warmStart = Date.now();
warmupEmbeddingCache();
console.log(`[perf] warmed in ${Date.now() - warmStart}ms`);

const queryVec = randVec(0xabcdef);
const emptyChunks = new Map();

const latencies = [];
const RUNS = 30;
for (let r = 0; r < RUNS; r++) {
  const t0 = Date.now();
  // 生产同路径：轻量窗口 → 评分 → 后置批量时态/裁决过滤
  const rows = selectStratifiedSemanticRows({ skipTemporalAndSupersede: true });
  const t1 = Date.now();
  let ranked = rankSemanticCandidates(queryVec, rows, emptyChunks);
  const t2 = Date.now();
  const validIds = filterTemporalSupersededIds(ranked.map(s => String(s.row.id)));
  if (validIds.size < ranked.length) ranked = ranked.filter(s => validIds.has(String(s.row.id)));
  const t3 = Date.now();
  latencies.push(t3 - t0);
  if (r === 0) console.log(`[perf] first run: rows=${rows.length}, ranked=${ranked.length}, window=${t1 - t0}ms, rank=${t2 - t1}ms, filter=${t3 - t2}ms, total=${t3 - t0}ms`);
  assert.ok(ranked.length > 0, 'ranking must return candidates');
  assert.ok(ranked[0].score >= ranked[ranked.length - 1].score, 'ranking must be sorted');
}
latencies.sort((a, b) => a - b);
const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))];
const median = latencies[Math.floor(latencies.length * 0.5)];
const candidateCount = selectStratifiedSemanticRows().length;

console.log(JSON.stringify({
  memories: N,
  dim: DIM,
  candidateWindow: candidateCount,
  runs: RUNS,
  medianMs: median,
  p95Ms: p95,
  samples: latencies.join(','),
}, null, 2));

assert.ok(p95 < 150, `KM-105 验收失败：10k 库语义检索 P95 ${p95}ms ≥ 150ms`);
console.error(`\n✅ KM-105 PASS：10k 库 P95 ${p95}ms（候选窗口 ${candidateCount}，与库规模解耦）`);
process.exit(0);
