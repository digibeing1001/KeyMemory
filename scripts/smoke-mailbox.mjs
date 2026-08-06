import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-mailbox-smoke-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;

const [database, atom, mailbox, mcpTools, mcpExecutor, hermes, agentConfig] = await Promise.all([
  import('../packages/server/dist/db/sqlite.js'),
  import('../packages/server/dist/core/atom.js'),
  import('../packages/server/dist/core/mailbox.js'),
  import('../packages/server/dist/core/mcp-tools.js'),
  import('../packages/server/dist/core/mcp-executor.js'),
  import('../packages/server/dist/adapters/hermes.js'),
  import('../packages/server/dist/core/agent-config.js'),
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
assert.ok(context?.readers.some((reader) => reader.recipientId === 'agent:next-agent' && reader.readAt), 'Agent read must create an exact-identity receipt');

const humanDetail = mailbox.getMailThreadDetail(first.thread.id, 'human:local', ['global'], true);
assert.ok(humanDetail?.readers.some((reader) => reader.recipientId === 'agent:next-agent' && reader.readAt), 'human UI must see which Agent read the thread');
const contextAfterHumanRead = mailbox.getMailThreadContext(first.thread.id, 'agent:next-agent', ['global']);
assert.ok(contextAfterHumanRead?.readers.some((reader) => reader.recipientId === 'human:local' && reader.readAt), 'Agent context must know that the human read the thread');
assert.match(contextAfterHumanRead?.markdown ?? '', /已读状态[\s\S]*用户：最近读取于/, 'Agent handoff must explain human read state');

const second = mailbox.createMailThread({
  subject: 'Agent 邮箱接入说明准备发布',
  kind: 'task',
  body: '需要确认每个新接入的 Agent 都会收到统一的读信、回信和写信说明。',
  senderType: 'human',
  memoryIds: [reusableMemory.id],
});
const linkCount = database.getDatabase().prepare('SELECT COUNT(DISTINCT thread_id) AS count FROM mail_thread_memories WHERE memory_id = ?').get(reusableMemory.id).count;
assert.equal(linkCount, 2, 'one reusable memory may support multiple mail threads');

await mailbox.updateMailThread(second.thread.id, { folder: 'archive', status: 'completed' });
assert.ok(mailbox.listMailThreads({ folder: 'archive' }).some((thread) => thread.id === second.thread.id));
const firstArchiveReports = database.getDatabase().prepare("SELECT * FROM memories WHERE source = 'mailbox-archive' AND source_id = ?").all(second.thread.id);
assert.equal(firstArchiveReports.length, 1, 'archiving a thread must create exactly one durable project report');
assert.match(firstArchiveReports[0].content, /起因与背景[\s\S]*根本目标与约束[\s\S]*因果与推进链[\s\S]*总结与反思/, 'archive report must preserve the complete first-principles structure');
assert.doesNotMatch(firstArchiveReports[0].content, /第一性原理/, 'archive report must apply the method without displaying its slogan');
assert.deepEqual(JSON.parse(firstArchiveReports[0].tags), ['项目归档', '邮箱归档报告'], 'archive report tags must survive normalization without triggering the legacy project-journal workflow');
assert.deepEqual(
  { humanReadable: JSON.parse(firstArchiveReports[0].metadata).humanReadable, agentReadable: JSON.parse(firstArchiveReports[0].metadata).agentReadable },
  { humanReadable: true, agentReadable: true },
  'archive report must explicitly support both human reading and Agent extraction',
);
assert.equal(database.getDatabase().prepare('SELECT COUNT(*) AS count FROM mail_thread_memories WHERE thread_id = ? AND memory_id = ?').get(second.thread.id, firstArchiveReports[0].id).count, 1, 'archive report must stay linked to its source thread');

for (const toolName of ['memory_inbox_list', 'memory_thread_create', 'memory_thread_read', 'memory_thread_context', 'memory_thread_reply', 'memory_thread_link_memory', 'memory_mailbox_sync']) {
  assert.ok(mcpTools.MCP_TOOLS.some((tool) => tool.name === toolName), `${toolName} must be advertised to every Agent`);
}
const contextTool = mcpTools.MCP_TOOLS.find((tool) => tool.name === 'memory_thread_context');
assert.match(contextTool.description, /可读|书面|上下文|接力/, 'Agent tool description must teach the mailbox handoff contract');

const adapter = hermes.createHermesAdapter({ agentId: 'mailbox-smoke-agent', isolationMode: 'hybrid' });
assert.equal(adapter.name, 'mailbox-smoke-agent', 'adapter identity must preserve the concrete Agent name');
const result = await mcpExecutor.executeMcpTool('memory_inbox_list', { folder: 'inbox' }, adapter, { responseStyle: 'json' });
assert.equal(Boolean(result.isError), false, 'Agent must be able to read the inbox through MCP');
const mcpReply = await mcpExecutor.executeMcpTool('memory_thread_reply', {
  threadId: second.thread.id,
  body: 'Qoder、Codex 和其他 Agent 现在会使用各自身份发送邮件并记录读取状态。',
  messageType: 'progress',
}, adapter, { responseStyle: 'json' });
assert.equal(Boolean(mcpReply.isError), false, 'Agent must be able to reply through MCP');
const repliedDetail = mailbox.getMailThreadDetail(second.thread.id, 'human:local', ['global'], false);
assert.equal(repliedDetail?.messages.at(-1)?.senderId, 'agent:mailbox-smoke-agent', 'mail must show the exact sending Agent');
await mailbox.updateMailThread(second.thread.id, { folder: 'archive' });
const refreshedArchiveReports = database.getDatabase().prepare("SELECT * FROM memories WHERE source = 'mailbox-archive' AND source_id = ?").all(second.thread.id);
assert.equal(refreshedArchiveReports.length, 1, 're-archiving must update the existing report instead of creating a duplicate');
assert.match(refreshedArchiveReports[0].content, /Qoder、Codex/, 're-archiving must incorporate new replies into the durable report');

for (const target of ['codex', 'workbuddy', 'trae', 'qoder']) {
  const mode = target === 'codex' ? 'mcp' : undefined;
  const snippet = agentConfig.buildAgentConfigSnippet(target, mode);
  assert.match(snippet.snippet, new RegExp(`KEYMEMORY_AGENT_ID[^\\n]*${target}`), `${target} config must preserve mailbox identity`);
}

database.closeDatabase();
fs.rmSync(dataDir, { recursive: true, force: true });
console.log('[smoke:mailbox] ok');
