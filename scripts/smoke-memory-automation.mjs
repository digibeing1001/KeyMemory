import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-automation-smoke-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;

const [database, atom, llm, reasoner, mailbox, conflicts] = await Promise.all([
  import('../packages/server/dist/db/sqlite.js'),
  import('../packages/server/dist/core/atom.js'),
  import('../packages/server/dist/core/llm-provider.js'),
  import('../packages/server/dist/core/relation-reasoner.js'),
  import('../packages/server/dist/core/mailbox.js'),
  import('../packages/server/dist/core/conflict-detector.js'),
]);

database.initDatabase();
let relationCandidateId = '';
let mailboxMemoryIds = [];
let mailboxTargetThreadId = '';
let temperatureCompatibilityRetries = 0;
let successfulLlmCalls = 0;
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const system = payload.messages?.[0]?.content ?? '';
  if (request.url?.endsWith('/chat/completions') && payload.temperature !== 1) {
    temperatureCompatibilityRetries++;
    response.statusCode = 400;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: { message: 'invalid temperature: only 1 is allowed for this model', type: 'invalid_request_error' } }));
    return;
  }
  let content;
  if (system.includes('记忆关联推理')) {
    content = JSON.stringify({ judgments: [{
      target_id: relationCandidateId,
      relation: 'extends',
      strength: 0.91,
      reason: '新记忆明确记录了同一项工作的后续完成情况',
      evidence_quote: '计划完成 KeyMemory 记忆邮箱的可用性检查',
    }] });
  } else if (system.includes('工作主题整理')) {
    content = JSON.stringify({ threads: [{
      ...(mailboxTargetThreadId ? { thread_id: mailboxTargetThreadId } : {}),
      subject: 'KeyMemory 记忆邮箱进入发布前验收',
      kind: 'project',
      memory_ids: mailboxMemoryIds,
      confidence: 0.95,
      body: '记忆邮箱已进入发布前验收。目前需要确认整理按钮、主题归集与后续接力都能正常工作。',
    }] });
  } else {
    content = '记忆邮箱已进入发布前验收。目前新增信息已经整理到同一个工作主题中。';
  }
  successfulLlmCalls++;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ model: 'mock-model', choices: [{ message: { content } }] }));
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;

try {
  assert.equal(conflicts.findConflictMatch('Windows', [
    { id: 'a', title: '安装成功', content: 'Windows 安装成功，服务已经完成启动。' },
    { id: 'b', title: '测试失败', content: 'Windows 下另一个测试失败，原因仍待排查。' },
  ]), null, 'generic platform and success/failure words must not create a false conflict');
  assert.ok(conflicts.findConflictMatch('记忆邮箱', [
    { id: 'c', title: '启用整理', content: '记忆邮箱发布时支持启用自动整理功能。' },
    { id: 'd', title: '停用整理', content: '记忆邮箱发布时决定停用自动整理功能。' },
  ]), 'opposite decisions about the same subject should remain reviewable');

  llm.saveLLMConfig({ baseUrl: `http://127.0.0.1:${port}/v1`, model: 'mock-model', enabled: true }, 'test-secret');

  const oldMemory = atom.createMemory({
    title: 'KeyMemory 记忆邮箱可用性检查计划',
    content: '计划完成 KeyMemory 记忆邮箱的可用性检查，并验证整理按钮。',
    layer: 'short',
    source: 'automation-smoke',
  });
  relationCandidateId = oldMemory.id;
  const privateMemory = atom.createMemory({
    title: '另一位 Agent 的私有邮箱计划',
    content: '计划完成 KeyMemory 记忆邮箱的可用性检查。',
    layer: 'short',
    source: 'automation-smoke',
    agentSpace: 'agent:private-smoke',
  });
  const newMemory = atom.createMemory({
    title: 'KeyMemory 记忆邮箱可用性检查完成',
    content: 'KeyMemory 记忆邮箱的整理按钮已经完成检查，现在进入发布前验收。',
    layer: 'short',
    source: 'automation-smoke',
  });

  const relationResult = await reasoner.reasonRelationsForMemory(newMemory.id);
  assert.ok(relationResult, 'relation reasoning must work without a local embedding model');
  const links = database.getDatabase().prepare('SELECT target_memory_id FROM memory_relations WHERE source_memory_id = ?').all(newMemory.id);
  assert.ok(links.some(link => link.target_memory_id === oldMemory.id), 'validated relation must be persisted');
  assert.ok(!links.some(link => link.target_memory_id === privateMemory.id), 'relation reasoning must not cross agent_space boundaries');

  const mailA = atom.createMemory({
    title: '记忆邮箱整理按钮等待发布验收',
    content: 'KeyMemory 记忆邮箱已经完成主要开发，现在需要完成发布前验收。',
    layer: 'short',
    source: 'mailbox-bootstrap-smoke',
  });
  const mailB = atom.createMemory({
    title: '记忆邮箱主题归集需要确认',
    content: '发布前需要确认记忆秘书能够把同一项工作的零散记忆归入一个邮件主题。',
    layer: 'short',
    source: 'mailbox-bootstrap-smoke',
  });
  mailboxMemoryIds = [mailA.id, mailB.id];
  const sync = await mailbox.syncMailbox(['global']);
  assert.equal(sync.createdThreads, 1, 'empty mailbox must be able to bootstrap a concrete work thread');
  assert.ok(sync.linkedMemories >= 2, 'secretary must link the source memories to the new thread');
  assert.equal(mailbox.listMailThreads({ folder: 'all', agentSpaces: ['global'] }).length, 1);
  const secondSync = await mailbox.syncMailbox(['global']);
  assert.equal(secondSync.createdThreads, 0, 'unchanged memories must not duplicate a work thread');

  const existingThread = mailbox.listMailThreads({ folder: 'all', agentSpaces: ['global'] })[0];
  mailboxTargetThreadId = existingThread.id;
  const mailC = atom.createMemory({
    title: '记忆邮箱验收新增结果',
    content: '记忆邮箱验收已经补充完成，需要把这一进展回复到原有邮件主题。',
    layer: 'short',
    source: 'mailbox-bootstrap-smoke',
  });
  mailboxMemoryIds = [mailC.id];
  const messagesBefore = mailbox.getMailThreadDetail(existingThread.id, 'human:owner', ['global'], true).messages.length;
  const callsBefore = successfulLlmCalls;
  const updateSync = await mailbox.syncMailbox(['global']);
  const messagesAfter = mailbox.getMailThreadDetail(existingThread.id, 'human:owner', ['global'], true).messages.length;
  assert.equal(updateSync.linkedMemories, 1, 'new work memory must be linked into the existing thread');
  assert.equal(messagesAfter, messagesBefore + 1, 'secretary plan must become a reply in the existing thread');
  assert.equal(successfulLlmCalls - callsBefore, 1, 'existing-thread organization must reuse the validated secretary body without a second LLM call');
  assert.ok(temperatureCompatibilityRetries >= 2, 'provider must retry relation and secretary calls when a compatible model only accepts temperature=1');

  console.log('[smoke:automation] ok');
} finally {
  server.closeIdleConnections?.();
  server.closeAllConnections?.();
  await new Promise(resolve => server.close(resolve));
  database.closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
