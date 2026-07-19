import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-mailbox-smoke-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;

const [database, atom, mailbox, mcpTools, mcpExecutor, hermes] = await Promise.all([
  import('../packages/server/dist/db/sqlite.js'),
  import('../packages/server/dist/core/atom.js'),
  import('../packages/server/dist/core/mailbox.js'),
  import('../packages/server/dist/core/mcp-tools.js'),
  import('../packages/server/dist/core/mcp-executor.js'),
  import('../packages/server/dist/adapters/hermes.js'),
]);

database.initDatabase();

const migration = mailbox.getMailboxMigrationReport();
assert.equal(migration.alreadyApplied, true, 'fresh database must install the mailbox migration marker');

const reusableMemory = atom.createMemory({
  title: '验收时需要检查邮件正文可读性',
  content: '所有人类与 Agent 共读的邮件正文都应使用自然的书面语言；代码和日志只能放在折叠附件中。',
  layer: 'long',
  tags: ['kind:constraint'],
  source: 'mailbox-smoke',
});

const first = mailbox.createMailThread({
  subject: 'KeyMemory 邮箱功能进入可用性验收',
  kind: 'project',
  body: '记忆邮箱的核心流程已经进入验收阶段。接下来需要确认人类、Agent 与记忆能在同一项目中持续补充信息。\n\n```log\nserver started\nstatus=ok\n```',
  senderType: 'human',
  memoryIds: [reusableMemory.id],
});
assert.equal(first.messages.length, 1);
assert.equal(first.messages[0].attachments.length, 1, 'human technical blocks must become collapsed attachments');
assert.equal(first.messages[0].attachments[0].collapsed, true);
assert.doesNotMatch(first.messages[0].body, /server started/, 'technical log must not remain in readable body');

assert.throws(() => mailbox.createMailThread({
  subject: first.thread.subject,
  kind: 'project',
  body: '这封邮件不应建立，因为同一项工作已经有一个主题。',
  senderType: 'human',
}), /已经存在/, 'one body of work must not create duplicate subjects');

const secretaryMessage = await mailbox.syncMailThread(first.thread.id);
assert.equal(secretaryMessage?.senderType, 'secretary');
assert.equal(secretaryMessage?.messageType, 'digest');
assert.equal(await mailbox.syncMailThread(first.thread.id), null, 'unchanged memories must not generate duplicate secretary mail');

mailbox.replyToMailThread(first.thread.id, {
  senderType: 'agent',
  senderId: 'agent:smoke-agent',
  messageType: 'progress',
  body: '我已经完成邮件读取与回复链路检查。目前上下文能够按主题接续。\n\n```text\nSELECT * FROM mail_threads\n2 rows\n```\n\n仍需处理：完成发布前的整体检查。',
});
const agentDetail = mailbox.getMailThreadDetail(first.thread.id, 'agent:next-agent', ['global'], false);
assert.ok(agentDetail);
assert.equal(agentDetail.messages.at(-1)?.senderType, 'agent');
assert.equal(agentDetail.messages.at(-1)?.attachments.length, 1, 'Agent technical content must be collapsed');

const context = mailbox.getMailThreadContext(first.thread.id, 'agent:next-agent', ['global']);
assert.ok(context?.markdown.includes('仍需处理'));
assert.ok(context?.linkedMemories.some((memory) => memory.id === reusableMemory.id));

const second = mailbox.createMailThread({
  subject: 'Agent 邮箱接入说明准备发布',
  kind: 'task',
  body: '需要确认每个新接入的 Agent 都会收到统一的读信、回信和写信说明。',
  senderType: 'human',
  memoryIds: [reusableMemory.id],
});
const linkCount = database.getDatabase().prepare('SELECT COUNT(DISTINCT thread_id) AS count FROM mail_thread_memories WHERE memory_id = ?').get(reusableMemory.id).count;
assert.equal(linkCount, 2, 'one reusable memory may support multiple mail threads');

mailbox.updateMailThread(second.thread.id, { folder: 'archive', status: 'completed' });
assert.ok(mailbox.listMailThreads({ folder: 'archive' }).some((thread) => thread.id === second.thread.id));

for (const toolName of ['memory_inbox_list', 'memory_thread_create', 'memory_thread_read', 'memory_thread_context', 'memory_thread_reply', 'memory_thread_link_memory', 'memory_mailbox_sync']) {
  assert.ok(mcpTools.MCP_TOOLS.some((tool) => tool.name === toolName), `${toolName} must be advertised to every Agent`);
}
const contextTool = mcpTools.MCP_TOOLS.find((tool) => tool.name === 'memory_thread_context');
assert.match(contextTool.description, /可读|书面|上下文|接力/, 'Agent tool description must teach the mailbox handoff contract');

const adapter = hermes.createHermesAdapter({ agentId: 'mailbox-smoke-agent', isolationMode: 'hybrid' });
const result = await mcpExecutor.executeMcpTool('memory_inbox_list', { folder: 'inbox' }, adapter, { responseStyle: 'json' });
assert.equal(Boolean(result.isError), false, 'Agent must be able to read the inbox through MCP');

database.closeDatabase();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log('[smoke:mailbox] ok');
