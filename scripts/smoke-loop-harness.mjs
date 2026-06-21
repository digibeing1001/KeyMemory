import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-loop-smoke-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;

const [{ closeDatabase, getDatabase, initDatabase }, { createMemory }, { createBackupSnapshot }, { executeMcpTool }, { MCP_TOOLS }, { createHermesAdapter }] = await Promise.all([
  import('../packages/server/dist/db/sqlite.js'),
  import('../packages/server/dist/core/atom.js'),
  import('../packages/server/dist/core/backup.js'),
  import('../packages/server/dist/core/mcp-executor.js'),
  import('../packages/server/dist/core/mcp-tools.js'),
  import('../packages/server/dist/adapters/hermes.js'),
]);

const adapter = createHermesAdapter({ agentId: 'loop-agent', isolationMode: 'hybrid' });
initDatabase();

function parse(result) {
  assert.ok(result.content?.[0]?.text, 'MCP result must contain text');
  return JSON.parse(result.content[0].text);
}

async function call(name, args, expectError = false) {
  const result = await executeMcpTool(name, args, adapter, { responseStyle: 'json' });
  assert.equal(Boolean(result.isError), expectError, `${name} error status`);
  return parse(result);
}

for (const name of ['memory_loop_start', 'memory_loop_context', 'memory_loop_checkpoint', 'memory_loop_finish']) {
  assert.ok(MCP_TOOLS.some(tool => tool.name === name), `${name} must be advertised by MCP`);
}
assert.equal(MCP_TOOLS.find(tool => tool.name === 'memory_loop_context').annotations.readOnlyHint, false);

const durableMemory = createMemory({
  title: 'Loop release constraint',
  content: 'Constraint: verify every checkpoint before a production release.',
  layer: 'long',
  projectPath: 'LoopEval/Product',
  tags: ['kind:constraint'],
  source: 'loop-smoke',
});
const otherProjectMemory = createMemory({
  title: 'Other project private review',
  content: 'This review item belongs only to an unrelated project.',
  layer: 'short',
  projectPath: 'OtherProject/Private',
  tags: ['kind:task'],
  source: 'loop-smoke',
});
getDatabase().prepare(`
  INSERT INTO dream_reports (
    id, status, total_candidates, promoted, archived, merged, sessions, todo_items, created_at, completed_at
  ) VALUES (?, 'completed', 0, 0, 0, 0, '[]', ?, ?, ?)
`).run(
  'loop-smoke-dream-report',
  JSON.stringify([
    { type: 'conflict', memoryId: durableMemory.id, title: 'In-scope release review', reason: 'Verify release state', status: 'pending' },
    { type: 'conflict', memoryId: otherProjectMemory.id, title: 'Cross-project private review', reason: 'Must stay isolated', status: 'pending' },
  ]),
  new Date().toISOString(),
  new Date().toISOString(),
);

const startArgs = {
  objective: 'Prepare a production release with durable recovery',
  project: 'LoopEval/Product',
  agentId: 'loop-agent',
  idempotencyKey: 'start-release-001',
  leaseOwner: 'worker-a',
  leaseTtlSeconds: 120,
  maxItems: 8,
  maxChars: 4000,
};
const started = await call('memory_loop_start', startArgs);
assert.equal(started.schemaVersion, 'keymemory.loop-observation.v1');
assert.equal(started.status, 'success');
assert.equal(started.cursor.checkpointVersion, 0);
assert.equal(started.cursor.eventSequence, 1);
assert.match(started.data.contextPack.markdown, /verify every checkpoint/);
assert.match(started.data.contextPack.markdown, /In-scope release review/);
assert.doesNotMatch(started.data.contextPack.markdown, /Cross-project private review/);
assert.equal(started.data.contextFingerprint.length, 64);
const runId = started.data.run.id;

const startReplay = await call('memory_loop_start', startArgs);
assert.equal(startReplay.status, 'warning');
assert.equal(startReplay.data.run.id, runId);
assert.equal(getDatabase().prepare('SELECT COUNT(*) as count FROM loop_runs').get().count, 1);

const startReplayFromNewWorker = await call('memory_loop_start', {
  ...startArgs,
  leaseOwner: 'worker-after-restart',
  maxChars: 2000,
});
assert.equal(startReplayFromNewWorker.status, 'warning');
assert.equal(startReplayFromNewWorker.data.run.id, runId);

const startConflict = await call('memory_loop_start', {
  ...startArgs,
  objective: 'A different objective must not reuse the original run.',
}, true);
assert.equal(startConflict.error.code, 'IDEMPOTENCY_CONFLICT');

const checkpointArgs = {
  runId,
  expectedVersion: 0,
  idempotencyKey: 'checkpoint-release-001',
  leaseOwner: 'worker-a',
  phase: 'verify',
  summary: 'Build is ready for verification.',
  state: { build: 'ready', apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456' },
  nextActions: ['Run release checks'],
  artifacts: ['dist/server.js'],
  memoryRefs: [durableMemory.id],
  eventName: 'loop.release.verification-ready',
  severity: 'info',
};
const checkpoint = await call('memory_loop_checkpoint', checkpointArgs);
assert.equal(checkpoint.cursor.checkpointVersion, 1);
assert.equal(checkpoint.cursor.eventSequence, 2);
assert.match(checkpoint.data.checkpoint.state.apiKey, /REDACTED/);
assert.deepEqual(checkpoint.nextActions, ['Run release checks']);
assert.deepEqual(checkpoint.data.checkpoint.memoryRefs, [durableMemory.id]);

const checkpointReplay = await call('memory_loop_checkpoint', checkpointArgs);
assert.equal(checkpointReplay.status, 'warning');
assert.equal(checkpointReplay.cursor.checkpointVersion, 1);
assert.equal(getDatabase().prepare('SELECT COUNT(*) as count FROM loop_checkpoints').get().count, 2);

const idempotencyConflict = await call('memory_loop_checkpoint', {
  ...checkpointArgs,
  summary: 'Different payload with a reused key.',
}, true);
assert.equal(idempotencyConflict.error.code, 'IDEMPOTENCY_CONFLICT');
assert.equal(idempotencyConflict.error.retryable, false);

const versionConflict = await call('memory_loop_checkpoint', {
  ...checkpointArgs,
  idempotencyKey: 'checkpoint-release-stale',
  summary: 'Stale writer payload.',
}, true);
assert.equal(versionConflict.error.code, 'VERSION_CONFLICT');
assert.equal(versionConflict.error.actualVersion, 1);
assert.ok(versionConflict.nextActions[0].includes('memory_loop_context'));

const leaseConflict = await call('memory_loop_context', {
  runId,
  leaseOwner: 'worker-b',
}, true);
assert.equal(leaseConflict.error.code, 'LEASE_CONFLICT');

getDatabase().prepare(`UPDATE loop_runs SET lease_expires_at = ? WHERE id = ?`)
  .run(new Date(Date.now() - 1000).toISOString(), runId);
const leaseTakeover = await call('memory_loop_context', {
  runId,
  leaseOwner: 'worker-b',
});
assert.equal(leaseTakeover.data.run.leaseOwner, 'worker-b');

const resumed = await call('memory_loop_context', {
  runId,
  leaseOwner: 'worker-b',
  afterSequence: 1,
  maxEvents: 10,
});
assert.equal(resumed.data.events.length, 1);
assert.equal(resumed.data.events[0].sequence, 2);
assert.equal(resumed.data.events[0].eventName, 'loop.release.verification-ready');

await call('memory_loop_context', {
  runId,
  leaseOwner: 'worker-b',
  query: 'release verification sk-abcdefghijklmnopqrstuvwxyz123456',
});
const queryRows = getDatabase().prepare('SELECT query FROM query_logs').all();
assert.ok(queryRows.length > 0);
assert.ok(queryRows.every(row => !row.query.includes('sk-abcdefghijklmnopqrstuvwxyz123456')));
assert.ok(queryRows.some(row => row.query.includes('[REDACTED]')));

const missingMemoryRef = await call('memory_loop_checkpoint', {
  ...checkpointArgs,
  expectedVersion: 1,
  idempotencyKey: 'checkpoint-missing-memory-ref',
  leaseOwner: 'worker-b',
  memoryRefs: ['missing-memory-id'],
}, true);
assert.equal(missingMemoryRef.error.code, 'MEMORY_NOT_FOUND');
assert.equal(getDatabase().prepare('SELECT COUNT(*) as count FROM loop_checkpoints WHERE run_id = ?').get(runId).count, 2);

const finished = await call('memory_loop_finish', {
  runId,
  expectedVersion: 1,
  idempotencyKey: 'finish-release-001',
  leaseOwner: 'worker-b',
  status: 'completed',
  summary: 'Release verification completed.',
  state: { releaseReady: true },
  artifacts: ['dist/server.js'],
});
assert.equal(finished.data.run.status, 'completed');
assert.equal(finished.cursor.checkpointVersion, 2);
assert.equal(finished.cursor.eventSequence, 3);

const oldCheckpointReplay = await call('memory_loop_checkpoint', checkpointArgs);
assert.equal(oldCheckpointReplay.status, 'warning');
assert.equal(oldCheckpointReplay.data.run.status, 'completed');
assert.equal(oldCheckpointReplay.data.checkpoint.version, 2);
assert.equal(oldCheckpointReplay.cursor.checkpointVersion, 2);

const terminalWrite = await call('memory_loop_checkpoint', {
  ...checkpointArgs,
  expectedVersion: 2,
  idempotencyKey: 'checkpoint-after-finish',
}, true);
assert.equal(terminalWrite.error.code, 'RUN_TERMINAL');
assert.equal(getDatabase().prepare('SELECT COUNT(*) as count FROM loop_events WHERE run_id = ?').get(runId).count, 3);

const serverRequire = createRequire(new URL('../packages/server/package.json', import.meta.url));
const Fastify = serverRequire('fastify');
const { registerRoutes } = await import('../packages/server/dist/api/rest.js');
const app = Fastify({ logger: false });
registerRoutes(app);
await app.ready();

const invalidRestStart = await app.inject({
  method: 'POST',
  url: '/api/loop/runs',
  payload: { objective: 'Missing project', agentId: 'rest-loop-agent', idempotencyKey: 'invalid-rest-start', leaseOwner: 'rest-worker' },
});
assert.equal(invalidRestStart.statusCode, 400);
assert.equal(invalidRestStart.json().error.code, 'INVALID_INPUT');

const oversizedRestStart = await app.inject({
  method: 'POST',
  url: '/api/loop/runs',
  payload: {
    objective: 'x'.repeat(8001),
    project: 'LoopEval/Oversized',
    agentId: 'rest-loop-agent',
    idempotencyKey: 'oversized-rest-start',
    leaseOwner: 'rest-worker',
  },
});
assert.equal(oversizedRestStart.statusCode, 413);
assert.equal(oversizedRestStart.json().error.code, 'LIMIT_EXCEEDED');

const restStart = await app.inject({
  method: 'POST',
  url: '/api/loop/runs',
  payload: {
    objective: 'Exercise the public REST Loop contract',
    project: 'LoopEval/Rest',
    agentId: 'rest-loop-agent',
    idempotencyKey: 'rest-start-001',
    leaseOwner: 'rest-worker',
  },
});
assert.equal(restStart.statusCode, 201);
const restRun = restStart.json();
assert.equal(restRun.status, 'success');

const restStartReplay = await app.inject({
  method: 'POST',
  url: '/api/loop/runs',
  payload: {
    leaseOwner: 'rest-worker-after-restart',
    idempotencyKey: 'rest-start-001',
    agentId: 'rest-loop-agent',
    project: 'LoopEval/Rest',
    objective: 'Exercise the public REST Loop contract',
  },
});
assert.equal(restStartReplay.statusCode, 200);
assert.equal(restStartReplay.json().status, 'warning');
assert.equal(restStartReplay.json().data.run.id, restRun.data.run.id);

const restCheckpoint = await app.inject({
  method: 'POST',
  url: `/api/loop/runs/${restRun.data.run.id}/checkpoints`,
  payload: {
    expectedVersion: 0,
    idempotencyKey: 'rest-checkpoint-001',
    leaseOwner: 'rest-worker',
    phase: 'execute',
    summary: 'REST checkpoint persisted.',
  },
});
assert.equal(restCheckpoint.statusCode, 200);
assert.equal(restCheckpoint.json().cursor.checkpointVersion, 1);

const restContext = await app.inject({
  method: 'POST',
  url: `/api/loop/runs/${restRun.data.run.id}/context`,
  payload: { leaseOwner: 'rest-worker', afterSequence: 1 },
});
assert.equal(restContext.statusCode, 200);
assert.equal(restContext.json().data.events.length, 1);

const restFinish = await app.inject({
  method: 'POST',
  url: `/api/loop/runs/${restRun.data.run.id}/finish`,
  payload: {
    expectedVersion: 1,
    idempotencyKey: 'rest-finish-001',
    leaseOwner: 'rest-worker',
    status: 'completed',
    summary: 'REST contract complete.',
  },
});
assert.equal(restFinish.statusCode, 200);
assert.equal(restFinish.json().data.run.status, 'completed');

const backup = createBackupSnapshot();
assert.equal(backup.counts.loop_runs, 2);
assert.equal(backup.counts.loop_checkpoints, 6);
assert.equal(backup.counts.loop_events, 6);
assert.ok(backup.tables.loop_runs);
assert.ok(backup.tables.loop_checkpoints);
assert.ok(backup.tables.loop_events);

await app.close();

closeDatabase();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(JSON.stringify({ ok: true, runId, checkpoints: 3, events: 3 }, null, 2));
