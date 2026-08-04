/**
 * smoke-content-quality.mjs — 记忆写入质量门禁验收脚本（Q1）
 *
 * 覆盖两条链路，全部真实执行（隔离数据库，无模拟）：
 *  A. 内容完整性：残缺检测 → 基于上下文的证据式补全（附补全依据）；
 *     无上下文证据时保留原文并标记"信息不完整"。
 *  B. 内容价值：套话/寒暄/模板内容在准入评估与写入前处理环节被拒绝；
 *     已入库低价值/残缺记忆可被质量审计识别、标记与清理。
 *
 * 运行：node scripts/smoke-content-quality.mjs
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-quality-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;
process.env.KEYMEMORY_DB_PATH = path.join(dataDir, 'data.db');

const { initDatabase, getDatabase } = await import('../packages/server/dist/db/sqlite.js');
initDatabase();
const db = getDatabase();

const { assessCompleteness, assessValue, tryCompleteFromContext, auditStoredMemories, markQualityFindings, cleanupLowValueMemories, ContentQualityError } =
  await import('../packages/server/dist/core/content-quality.js');
const { createMemory, getMemory } = await import('../packages/server/dist/core/atom.js');
const { autoRemember } = await import('../packages/server/dist/core/auto.js');

let pass = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  pass++;
  console.log(`  ✓ ${label}`);
}

console.log('\n== 1. 纯函数层：完整性检测与价值评估 ==');

const fragment = '我们决定把 Web UI 默认端口改为 3210，因为';
const a1 = assessCompleteness(fragment);
ok(!a1.complete, `残缺输入被检出（issues=${a1.issues.map(i => i.type).join(',')})`);
ok(assessCompleteness('我们决定把 Web UI 默认端口改为 3210，因为旧端口与内部工具冲突。').complete, '完整句子不误报');

const sourceMessage = '会议纪要：经过讨论，我们决定把 Web UI 默认端口改为 3210，因为旧端口与内部工具冲突。后续由前端组更新文档。';
const completion = tryCompleteFromContext(fragment, [{ label: 'source-mail', text: sourceMessage }]);
ok(completion !== null, '有上下文证据时补全成功');
ok(completion.completed === '我们决定把 Web UI 默认端口改为 3210，因为旧端口与内部工具冲突', '补全结果逐字来自上下文');
ok(completion.basis.strategy === 'extend-tail' && completion.basis.segmentLabel === 'source-mail', `补全依据可追溯（strategy=${completion.basis.strategy}, source=${completion.basis.segmentLabel}）`);

ok(tryCompleteFromContext(fragment, [{ label: 'irrelevant', text: '今天天气不错，适合出门散步。' }]) === null, '上下文无证据时拒绝补全（不猜测、不幻觉）');

const headCut = '因为旧端口与内部工具冲突';
const headCompletion = tryCompleteFromContext(headCut, [{ label: 'source-mail', text: sourceMessage }]);
ok(headCompletion !== null && headCompletion.basis.strategy === 'restore-head', '头部截断也能从上下文恢复');

const boilerplate = '我会继续跟进这个问题，有进展及时同步。';
ok(assessValue('好的，收到，谢谢！').verdict === 'reject', '纯寒暄被价值评估拒绝');
ok(assessValue(boilerplate).verdict === 'reject', '模板套话（无信息信号）被拒绝');
ok(assessValue('决定把构建产物目录从 dist 改为 build，因为 CI 缓存命中率从 40% 提升到 90%').verdict === 'accept', '含决策与数据的事实内容被接受');

console.log('\n== 2. 前后对比示例 ==');
console.log(`  [残缺输入] ${fragment}`);
console.log(`  [补全后]   ${completion.completed}`);
console.log(`  [补全依据] 来源「${completion.basis.segmentLabel}」：${completion.basis.excerpt}`);
console.log(`  [套话输入] ${boilerplate}`);
console.log(`  [处理结果] 拒绝写入，依据：${assessValue(boilerplate).reasons.join('；')}`);

console.log('\n== 3. 写入链路：createMemory 写入前处理门禁 ==');

let rejected = null;
try {
  createMemory({ title: '跟进反馈', content: boilerplate, layer: 'flash' });
} catch (err) {
  rejected = err;
}
ok(rejected instanceof ContentQualityError, `低价值内容在 createMemory 被拒绝（code=${rejected?.code}）`);

const bypassed = createMemory({ title: '跟进反馈', content: boilerplate, layer: 'flash', bypassQualityGate: true });
ok(Boolean(bypassed.id), '显式 bypass（人工/迁移路径）可跳过门禁');

const fragmentMem = createMemory({
  title: '端口决策',
  content: fragment,
  layer: 'short',
  agentSpace: 'agent:probe',
  source: 'smoke-quality',
});
const fragMeta = fragmentMem.metadata ?? {};
ok(fragMeta.completeness?.status === 'incomplete', '无上下文时保留原文并标记 metadata.completeness=incomplete');
ok(fragmentMem.agentSpace === 'agent:probe' && fragmentMem.source === 'smoke-quality', 'agent_space 与来源记录不受门禁影响');

console.log('\n== 4. 写入链路：autoRemember 准入评估 + 证据式补全 ==');

const autoRejected = await autoRemember({ content: '收到收到，谢谢，辛苦了！', agentId: 'probe', awaitRefine: true });
ok(!autoRejected.recorded && autoRejected.reason.includes('准入过滤'), `autoRemember 拒绝套话：${autoRejected.reason}`);

const autoCompleted = await autoRemember({
  content: fragment,
  agentId: 'probe',
  sourceContext: [sourceMessage],
  awaitRefine: true,
});
ok(autoCompleted.quality?.completeness?.status === 'completed', 'autoRemember 基于上下文补全残缺内容');
ok(autoCompleted.quality?.completeness?.basis?.excerpt?.includes('旧端口与内部工具冲突'), '补全依据写入结果可审计');
if (autoCompleted.recorded) {
  ok(autoCompleted.memory.content === completion.completed, '入库内容为补全后的完整句子');
  const storedMeta = autoCompleted.memory.metadata ?? {};
  ok(storedMeta.completeness?.status === 'completed' && Boolean(storedMeta.completeness?.basis), '入库 metadata 记录补全来源');
} else {
  console.log(`  · 注：SelfCheck 未自动记录（${autoCompleted.reason}），补全依据仍已在 quality 字段验证`);
}

const autoNoContext = await autoRemember({ content: '我们决定把缓存策略改为 LRU，因为', agentId: 'probe', awaitRefine: true });
ok(
  !autoNoContext.recorded || autoNoContext.quality?.completeness?.status === 'incomplete',
  '无上下文证据时不编造补全（拒绝或标记 incomplete）'
);

console.log('\n== 5. 存量数据补救：质量审计 + 标记 + 清理 ==');

const findings = auditStoredMemories({ limit: 200 });
ok(findings.some(f => f.memoryId === fragmentMem.id && f.kind === 'incomplete'), '审计识别出已入库残缺记忆（含判断依据）');
ok(findings.some(f => f.memoryId === bypassed.id && f.kind === 'low-value'), '审计识别出已入库低价值记忆');
const sample = findings.find(f => f.memoryId === fragmentMem.id);
ok(sample.reasons.length > 0, `审计附带判断依据：${sample.reasons[0]}`);

const marked = markQualityFindings(findings);
ok(marked > 0, `审计结论已写入 metadata（marked=${marked}）`);
const afterMark = JSON.parse(db.prepare('SELECT metadata FROM memories WHERE id = ?').get(fragmentMem.id).metadata);
ok(Array.isArray(afterMark.qualityFlags) && afterMark.qualityFlags.includes('incomplete'), 'qualityFlags 标记生效');

const cleanup = cleanupLowValueMemories([bypassed.id]);
ok(cleanup.cleaned === 1, '低价值记忆清理（软删除）成功');
ok(getMemory(bypassed.id)?.status === 'deleted', '清理为软删除，可经回收站恢复');

console.log(`\n✅ content-quality 验收通过（${pass} 项断言，隔离数据目录：${dataDir}）`);
process.exit(0);
