import { v4 as uuid } from 'uuid';
import type {
  MailAttachment,
  MailAttachmentKind,
  MailMessage,
  MailMessageStatus,
  MailMessageType,
  MailSenderType,
  MailThread,
  MailThreadContext,
  MailThreadDetail,
  MailThreadFolder,
  MailThreadKind,
  MailThreadMemoryLink,
  MailThreadStatus,
  MailboxMigrationReport,
  Memory,
} from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { rowToMemory } from '../db/mapper.js';
import { createProject } from './project.js';
import { chatWithLLM, isLLMAvailable } from './llm-provider.js';

const SECRETARY_ID = 'memory-secretary@keymemory.local';
const DEFAULT_HUMAN_ID = 'human:local';
const DEFAULT_RECIPIENTS = [DEFAULT_HUMAN_ID, 'agent:*'];

type JsonObject = Record<string, unknown>;

export interface CreateMailThreadInput {
  subject: string;
  kind: MailThreadKind;
  body: string;
  senderType: MailSenderType;
  senderId?: string;
  recipientIds?: string[];
  agentSpace?: string;
  memoryIds?: string[];
  metadata?: JsonObject;
  messageType?: MailMessageType;
  attachments?: ReplyMailThreadInput['attachments'];
}

export interface ReplyMailThreadInput {
  body: string;
  senderType: MailSenderType;
  senderId?: string;
  recipientIds?: string[];
  messageType?: MailMessageType;
  status?: MailMessageStatus;
  parentMessageId?: string;
  attachments?: Array<{
    kind: MailAttachmentKind;
    title: string;
    content?: string;
    memoryId?: string;
    collapsed?: boolean;
    metadata?: JsonObject;
  }>;
  metadata?: JsonObject;
}

export interface ListMailThreadsOptions {
  folder?: MailThreadFolder | 'all' | 'starred' | 'snoozed' | 'sent' | 'drafts' | 'scheduled';
  query?: string;
  recipientId?: string;
  agentSpaces?: string[];
  limit?: number;
  offset?: number;
}

function parseObject(value: unknown): JsonObject | undefined {
  if (!value) return undefined;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : undefined;
  } catch {
    return undefined;
  }
}

function parseStrings(value: unknown): string[] {
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function normalizeSubject(subject: string): string {
  return subject
    .replace(/^\s*(?:(?:re|fw|fwd)\s*[:：]\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

function assertUsefulSubject(subject: string): void {
  const trimmed = subject.trim();
  if (trimmed.length < 5 || trimmed.length > 120) {
    throw new Error('邮件标题应当用一句清楚的话说明正在推进的事情，长度为 5 到 120 个字符');
  }
  const generic = /^(飞书|项目|任务|事件|工作|开发|测试|前端|后端|资料|笔记|未分类)$/u;
  if (generic.test(trimmed)) {
    throw new Error(`“${trimmed}”更像分类名称。请说明具体在推进什么，例如“飞书文档同步还需要解决权限问题”`);
  }
  if (/^[\w\u4e00-\u9fff-]{1,12}$/u.test(trimmed) && !/(完成|解决|确认|推进|改进|建立|迁移|上线|发布|接入|设计|更新|修复|整理|调查|准备|讨论|跟进|需要|正在|已经)/u.test(trimmed)) {
    throw new Error('邮件标题不能只有一个名词，请写成能够说明实际工作的标题');
  }
}

function cleanPlainText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trim();
}

function firstReadableSentence(content: string, max = 180): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = plain.split(/(?<=[。！？.!?])\s*/u)[0] || plain;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

function readableBodyIssues(body: string): string[] {
  const issues: string[] = [];
  const clean = body.trim();
  if (clean.length < 16) issues.push('正文过短，无法说明当前情况');
  if ((clean.match(/```/g) ?? []).length > 0) issues.push('正文包含代码块');
  if (/^\s*[{[]\s*["']?[\w-]+["']?\s*:/m.test(clean)) issues.push('正文看起来像原始数据');
  const technicalLines = clean.split('\n').filter(line => /(?:Error:|at\s+\S+\s*\(|SELECT\s+.+FROM|npm ERR!|0x[\da-f]+)/i.test(line));
  if (technicalLines.length >= 2) issues.push('正文包含大量技术日志');
  return issues;
}

function extractTechnicalAttachments(body: string): { body: string; attachments: NonNullable<ReplyMailThreadInput['attachments']> } {
  const attachments: NonNullable<ReplyMailThreadInput['attachments']> = [];
  let clean = body.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_match, language: string, content: string) => {
    attachments.push({
      kind: language && /log|text|console/i.test(language) ? 'log' : 'technical',
      title: language ? `${language} 技术内容` : '技术详情',
      content: content.trim(),
      collapsed: true,
    });
    return '\n相关技术内容已放在折叠附件中。\n';
  });

  const lines = clean.split('\n');
  const logLines = lines.filter(line => /(?:^\s*at\s+\S+\s*\(|^\s*(?:Error|TypeError|ReferenceError):|npm ERR!|^\s*SELECT\s.+FROM)/i.test(line));
  if (logLines.length >= 2) {
    attachments.push({ kind: 'log', title: '运行记录', content: logLines.join('\n'), collapsed: true });
    clean = lines.filter(line => !logLines.includes(line)).join('\n');
    clean += '\n\n详细运行记录已放在折叠附件中。';
  }
  return { body: cleanPlainText(clean), attachments };
}

function rowToThread(row: Record<string, unknown>, recipientId = DEFAULT_HUMAN_ID): MailThread {
  const db = getDatabase();
  const countRow = row.message_count === undefined
    ? db.prepare('SELECT COUNT(*) as count FROM mail_messages WHERE thread_id = ?').get(row.id) as { count: number } | undefined
    : undefined;
  const messageCount = Number(row.message_count ?? countRow?.count ?? 0);
  const participants = db.prepare(`
    SELECT sender_id, recipient_ids FROM mail_messages WHERE thread_id = ? ORDER BY created_at
  `).all(row.id) as Array<{ sender_id: string | null; recipient_ids: string }>;
  const participantIds = Array.from(new Set(participants.flatMap(item => [item.sender_id, ...parseStrings(item.recipient_ids)]).filter((item): item is string => Boolean(item))));
  const unread = db.prepare(`
    SELECT COUNT(*) as count
    FROM mail_messages m
    LEFT JOIN mail_receipts r ON r.message_id = m.id AND r.recipient_id = ?
    WHERE m.thread_id = ?
      AND m.status = 'sent'
      AND COALESCE(m.sender_id, '') != ?
      AND r.read_at IS NULL
  `).get(recipientId, row.id, recipientId) as { count: number };

  return {
    id: String(row.id),
    subject: String(row.subject),
    kind: String(row.kind) as MailThreadKind,
    status: String(row.status) as MailThreadStatus,
    folder: String(row.folder) as MailThreadFolder,
    agentSpace: String(row.agent_space ?? 'global'),
    projectScopeId: row.project_scope_id ? String(row.project_scope_id) : undefined,
    legacyProjectId: row.legacy_project_id ? String(row.legacy_project_id) : undefined,
    currentSummary: row.current_summary ? String(row.current_summary) : undefined,
    createdByType: String(row.created_by_type) as MailSenderType,
    createdById: row.created_by_id ? String(row.created_by_id) : undefined,
    starred: Boolean(row.starred),
    snoozedUntil: row.snoozed_until ? String(row.snoozed_until) : undefined,
    unreadCount: unread.count,
    messageCount,
    participantIds,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastMessageAt: row.last_message_at ? String(row.last_message_at) : undefined,
    metadata: parseObject(row.metadata),
  };
}

function rowToMessage(row: Record<string, unknown>): MailMessage {
  return {
    id: String(row.id),
    threadId: String(row.thread_id),
    parentMessageId: row.parent_message_id ? String(row.parent_message_id) : undefined,
    senderType: String(row.sender_type) as MailSenderType,
    senderId: row.sender_id ? String(row.sender_id) : undefined,
    recipientIds: parseStrings(row.recipient_ids),
    subject: String(row.subject),
    body: String(row.body),
    messageType: String(row.message_type) as MailMessageType,
    status: String(row.status) as MailMessageStatus,
    sentAt: row.sent_at ? String(row.sent_at) : undefined,
    createdAt: String(row.created_at),
    metadata: parseObject(row.metadata),
  };
}

function rowToAttachment(row: Record<string, unknown>): MailAttachment {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    kind: String(row.kind) as MailAttachmentKind,
    title: String(row.title),
    content: row.content ? String(row.content) : undefined,
    memoryId: row.memory_id ? String(row.memory_id) : undefined,
    collapsed: Boolean(row.collapsed),
    createdAt: String(row.created_at),
    metadata: parseObject(row.metadata),
  };
}

function visibleThread(thread: MailThread, agentSpaces?: string[]): boolean {
  if (!agentSpaces || agentSpaces.length === 0) return true;
  return agentSpaces.includes(thread.agentSpace);
}

function createAttachment(messageId: string, input: NonNullable<ReplyMailThreadInput['attachments']>[number]): MailAttachment {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuid();
  if (input.memoryId) {
    const memory = db.prepare('SELECT id FROM memories WHERE id = ?').get(input.memoryId);
    if (!memory) throw new Error(`找不到要附加的记忆：${input.memoryId}`);
  }
  db.prepare(`
    INSERT INTO mail_attachments (id, message_id, kind, title, content, memory_id, collapsed, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, messageId, input.kind, input.title.trim(), input.content ?? null, input.memoryId ?? null, input.collapsed === false ? 0 : 1, now, input.metadata ? JSON.stringify(input.metadata) : null);
  return { id, messageId, kind: input.kind, title: input.title.trim(), content: input.content, memoryId: input.memoryId, collapsed: input.collapsed !== false, createdAt: now, metadata: input.metadata };
}

function insertMessage(thread: MailThread, input: ReplyMailThreadInput): MailMessage {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = uuid();
  const senderId = input.senderId?.trim() || (input.senderType === 'secretary' ? SECRETARY_ID : input.senderType === 'human' ? DEFAULT_HUMAN_ID : 'agent:unknown');
  const recipients = input.recipientIds?.length ? Array.from(new Set(input.recipientIds.map(String))) : DEFAULT_RECIPIENTS;
  // 无论发件人是人类还是 Agent，代码块与连续日志都只能作为折叠附件出现。
  // 这样邮件正文始终是双方都能直接读懂的工作说明。
  const prepared = extractTechnicalAttachments(input.body);
  const body = prepared.body;
  if (!body) throw new Error('邮件正文不能为空');
  if (input.senderType !== 'human') {
    const issues = readableBodyIssues(body);
    if (issues.length > 0) throw new Error(`邮件未通过人类可读性检查：${issues.join('；')}`);
  }

  const status = input.status ?? 'sent';
  const message: MailMessage = {
    id,
    threadId: thread.id,
    parentMessageId: input.parentMessageId,
    senderType: input.senderType,
    senderId,
    recipientIds: recipients,
    subject: `Re: ${thread.subject}`,
    body,
    messageType: input.messageType ?? 'reply',
    status,
    sentAt: status === 'sent' ? now : undefined,
    createdAt: now,
    metadata: input.metadata,
  };

  db.prepare(`
    INSERT INTO mail_messages (
      id, thread_id, parent_message_id, sender_type, sender_id, recipient_ids,
      subject, body, message_type, status, sent_at, created_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    message.id,
    message.threadId,
    message.parentMessageId ?? null,
    message.senderType,
    message.senderId ?? null,
    JSON.stringify(message.recipientIds),
    message.subject,
    message.body,
    message.messageType,
    message.status,
    message.sentAt ?? null,
    message.createdAt,
    message.metadata ? JSON.stringify(message.metadata) : null,
  );

  for (const recipient of recipients.filter(item => item !== 'agent:*')) {
    db.prepare(`
      INSERT OR IGNORE INTO mail_receipts (message_id, recipient_id, delivered_at, read_at)
      VALUES (?, ?, ?, NULL)
    `).run(id, recipient, now);
  }

  const allAttachments = [...prepared.attachments, ...(input.attachments ?? [])];
  for (const attachment of allAttachments) createAttachment(id, attachment);

  db.prepare(`
    UPDATE mail_threads
    SET updated_at = ?, last_message_at = ?, folder = CASE WHEN folder = 'archive' THEN 'inbox' ELSE folder END
    WHERE id = ?
  `).run(now, now, thread.id);
  return message;
}

export function createMailThread(input: CreateMailThreadInput): MailThreadDetail {
  assertUsefulSubject(input.subject);
  if (!input.body.trim()) throw new Error('第一封邮件需要说明事情的背景、当前状态或目标');
  const db = getDatabase();
  const duplicate = db.prepare(`
    SELECT id FROM mail_threads
    WHERE normalized_subject = ? AND agent_space = ? AND folder != 'trash'
    LIMIT 1
  `).get(normalizeSubject(input.subject), input.agentSpace ?? 'global') as { id: string } | undefined;
  if (duplicate) {
    throw new Error(`这个主题已经存在，请打开原邮件继续回复（主题编号：${duplicate.id}）`);
  }
  const id = uuid();
  const now = new Date().toISOString();
  const senderId = input.senderId?.trim() || (input.senderType === 'secretary' ? SECRETARY_ID : input.senderType === 'human' ? DEFAULT_HUMAN_ID : 'agent:unknown');

  return db.transaction(() => {
    const scope = createProject({
      name: `mail-${id.slice(0, 8)}`,
      description: input.subject.trim(),
      metadata: { hidden: true, mailboxThreadId: id, mailboxSubject: input.subject.trim() },
    });
    db.prepare(`
      INSERT INTO mail_threads (
        id, subject, normalized_subject, kind, status, folder, agent_space,
        project_scope_id, current_summary, created_by_type, created_by_id,
        starred, created_at, updated_at, last_message_at, metadata
      ) VALUES (?, ?, ?, ?, 'open', 'inbox', ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
    `).run(
      id,
      input.subject.trim(),
      normalizeSubject(input.subject),
      input.kind,
      input.agentSpace ?? 'global',
      scope.id,
      firstReadableSentence(input.body, 300),
      input.senderType,
      senderId,
      now,
      now,
      now,
      input.metadata ? JSON.stringify(input.metadata) : null,
    );
    const thread = getMailThread(id, DEFAULT_HUMAN_ID)!;
    insertMessage(thread, {
      body: input.body,
      senderType: input.senderType,
      senderId,
      recipientIds: input.recipientIds,
      messageType: input.messageType ?? 'reply',
      attachments: input.attachments,
      metadata: { ...(input.metadata ?? {}), initialMessage: true },
    });
    for (const memoryId of input.memoryIds ?? []) linkMemoryToThread(id, memoryId, 'source');
    return getMailThreadDetail(id, DEFAULT_HUMAN_ID, undefined, false)!;
  })();
}

export function getMailThread(id: string, recipientId = DEFAULT_HUMAN_ID, agentSpaces?: string[]): MailThread | null {
  const row = getDatabase().prepare('SELECT * FROM mail_threads WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  const thread = rowToThread(row, recipientId);
  return visibleThread(thread, agentSpaces) ? thread : null;
}

export function listMailThreads(options: ListMailThreadsOptions = {}): MailThread[] {
  const db = getDatabase();
  const folder = options.folder ?? 'inbox';
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (folder === 'starred') clauses.push('t.starred = 1 AND t.folder != \'trash\'');
  else if (folder === 'snoozed') clauses.push('t.snoozed_until IS NOT NULL AND t.snoozed_until > @now AND t.folder != \'trash\'');
  else if (folder === 'sent') clauses.push(`EXISTS (SELECT 1 FROM mail_messages sm WHERE sm.thread_id = t.id AND sm.sender_id = @recipientId AND sm.status = 'sent')`);
  else if (folder === 'drafts') clauses.push(`EXISTS (SELECT 1 FROM mail_messages dm WHERE dm.thread_id = t.id AND dm.status = 'draft')`);
  else if (folder === 'scheduled') clauses.push(`EXISTS (SELECT 1 FROM mail_messages qm WHERE qm.thread_id = t.id AND qm.status = 'scheduled')`);
  else if (folder !== 'all') clauses.push('t.folder = @folder');
  if (folder === 'inbox') clauses.push('(t.snoozed_until IS NULL OR t.snoozed_until <= @now)');
  params.folder = folder;
  params.now = new Date().toISOString();
  params.recipientId = options.recipientId ?? DEFAULT_HUMAN_ID;
  if (options.query?.trim()) {
    clauses.push(`(t.subject LIKE @query OR t.current_summary LIKE @query OR EXISTS (
      SELECT 1 FROM mail_messages mm WHERE mm.thread_id = t.id AND mm.body LIKE @query
    ))`);
    params.query = `%${options.query.trim()}%`;
  }
  if (options.agentSpaces && options.agentSpaces.length > 0) {
    clauses.push(`t.agent_space IN (${options.agentSpaces.map((_, index) => `@space${index}`).join(', ')})`);
    options.agentSpaces.forEach((space, index) => { params[`space${index}`] = space; });
  }
  params.limit = Math.max(1, Math.min(options.limit ?? 100, 250));
  params.offset = Math.max(0, options.offset ?? 0);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM mail_messages m WHERE m.thread_id = t.id) as message_count
    FROM mail_threads t
    ${where}
    ORDER BY COALESCE(t.last_message_at, t.updated_at) DESC
    LIMIT @limit OFFSET @offset
  `).all(params) as Record<string, unknown>[];
  return rows.map(row => rowToThread(row, String(params.recipientId)));
}

export function replyToMailThread(threadId: string, input: ReplyMailThreadInput, agentSpaces?: string[]): MailMessage {
  const thread = getMailThread(threadId, input.senderId ?? DEFAULT_HUMAN_ID, agentSpaces);
  if (!thread) throw new Error('找不到邮件主题，或者当前 Agent 没有读取权限');
  return getDatabase().transaction(() => insertMessage(thread, input))();
}

export function markThreadRead(threadId: string, recipientId = DEFAULT_HUMAN_ID): number {
  const db = getDatabase();
  const now = new Date().toISOString();
  const messages = db.prepare(`
    SELECT id FROM mail_messages WHERE thread_id = ? AND status = 'sent' AND COALESCE(sender_id, '') != ?
  `).all(threadId, recipientId) as Array<{ id: string }>;
  const upsert = db.prepare(`
    INSERT INTO mail_receipts (message_id, recipient_id, delivered_at, read_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(message_id, recipient_id) DO UPDATE SET read_at = excluded.read_at
  `);
  for (const message of messages) upsert.run(message.id, recipientId, now, now);
  return messages.length;
}

export function getMailThreadDetail(
  threadId: string,
  recipientId = DEFAULT_HUMAN_ID,
  agentSpaces?: string[],
  markRead = true,
): MailThreadDetail | null {
  const db = getDatabase();
  const thread = getMailThread(threadId, recipientId, agentSpaces);
  if (!thread) return null;
  if (markRead) markThreadRead(threadId, recipientId);
  const rows = db.prepare('SELECT * FROM mail_messages WHERE thread_id = ? ORDER BY created_at ASC').all(threadId) as Record<string, unknown>[];
  const messages = rows.map(row => {
    const message = rowToMessage(row);
    const attachments = (db.prepare('SELECT * FROM mail_attachments WHERE message_id = ? ORDER BY created_at').all(message.id) as Record<string, unknown>[]).map(rowToAttachment);
    const receipt = db.prepare('SELECT read_at FROM mail_receipts WHERE message_id = ? AND recipient_id = ?').get(message.id, recipientId) as { read_at: string | null } | undefined;
    return { ...message, attachments, readAt: receipt?.read_at ?? undefined };
  });
  const memoryRows = db.prepare(`
    SELECT DISTINCT m.* FROM memories m
    JOIN mail_thread_memories tm ON tm.memory_id = m.id
    WHERE tm.thread_id = ? AND m.status = 'active'
    ORDER BY m.updated_at DESC
  `).all(threadId) as Record<string, unknown>[];
  return { thread: { ...thread, unreadCount: 0 }, messages, linkedMemories: memoryRows.map(rowToMemory) };
}

export function updateMailThread(threadId: string, updates: {
  subject?: string;
  status?: MailThreadStatus;
  folder?: MailThreadFolder;
  starred?: boolean;
  snoozedUntil?: string | null;
}): MailThread | null {
  const db = getDatabase();
  const existing = getMailThread(threadId);
  if (!existing) return null;
  const values: string[] = [];
  const params: Record<string, unknown> = { id: threadId, updatedAt: new Date().toISOString() };
  if (updates.subject !== undefined) {
    assertUsefulSubject(updates.subject);
    const duplicate = db.prepare(`
      SELECT id FROM mail_threads
      WHERE normalized_subject = ? AND agent_space = ? AND folder != 'trash' AND id != ?
      LIMIT 1
    `).get(normalizeSubject(updates.subject), existing.agentSpace, threadId) as { id: string } | undefined;
    if (duplicate) throw new Error('另一个邮件主题已经使用这个标题，请直接在原主题中继续回复');
    values.push('subject = @subject', 'normalized_subject = @normalizedSubject');
    params.subject = updates.subject.trim();
    params.normalizedSubject = normalizeSubject(updates.subject);
  }
  if (updates.status !== undefined) { values.push('status = @status'); params.status = updates.status; }
  if (updates.folder !== undefined) { values.push('folder = @folder'); params.folder = updates.folder; }
  if (updates.starred !== undefined) { values.push('starred = @starred'); params.starred = updates.starred ? 1 : 0; }
  if (updates.snoozedUntil !== undefined) { values.push('snoozed_until = @snoozedUntil'); params.snoozedUntil = updates.snoozedUntil; }
  if (values.length === 0) return existing;
  values.push('updated_at = @updatedAt');
  db.prepare(`UPDATE mail_threads SET ${values.join(', ')} WHERE id = @id`).run(params);
  return getMailThread(threadId);
}

export function linkMemoryToThread(
  threadId: string,
  memoryId: string,
  relationType: MailThreadMemoryLink['relationType'] = 'source',
  agentSpaces?: string[],
): MailThreadMemoryLink {
  const db = getDatabase();
  const thread = getMailThread(threadId, DEFAULT_HUMAN_ID, agentSpaces);
  if (!thread) throw new Error('找不到邮件主题，或者当前 Agent 没有读取权限');
  const row = db.prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`找不到记忆：${memoryId}`);
  const memory = rowToMemory(row);
  const canShare = memory.agentSpace === 'global' || memory.agentSpace === thread.agentSpace;
  if (!canShare) throw new Error('这条记忆属于其他 Agent 的私有空间，不能附加到当前邮件主题');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO mail_thread_memories (thread_id, memory_id, relation_type, created_at)
    VALUES (?, ?, ?, ?)
  `).run(threadId, memoryId, relationType, now);
  return { threadId, memoryId, relationType, createdAt: now };
}

export function unlinkMemoryFromThread(threadId: string, memoryId: string): boolean {
  return getDatabase().prepare('DELETE FROM mail_thread_memories WHERE thread_id = ? AND memory_id = ?').run(threadId, memoryId).changes > 0;
}

function extractOpenItems(messages: MailMessage[]): string[] {
  const items: string[] = [];
  for (const message of messages.slice(-8)) {
    for (const line of message.body.split('\n')) {
      const trimmed = line.trim().replace(/^[-*]\s*/, '');
      if (/^(?:下一步|仍需|还需要|待确认|尚未|需要处理|需要确认)[：:]?/u.test(trimmed) || /^\[ \]\s+/.test(trimmed)) {
        items.push(trimmed.replace(/^\[ \]\s+/, ''));
      }
    }
  }
  return Array.from(new Set(items)).slice(0, 8);
}

export function getMailThreadContext(
  threadId: string,
  recipientId: string,
  agentSpaces?: string[],
  maxMessages = 5,
  maxMemories = 8,
): MailThreadContext | null {
  const detail = getMailThreadDetail(threadId, recipientId, agentSpaces, true);
  if (!detail) return null;
  const recentMessages = detail.messages.filter(message => message.status === 'sent').slice(-Math.max(1, Math.min(maxMessages, 12)));
  const linkedMemories = detail.linkedMemories.slice(0, Math.max(1, Math.min(maxMemories, 20)));
  const openItems = extractOpenItems(detail.messages);
  const currentState = detail.thread.currentSummary
    || recentMessages.slice().reverse().find(message => message.senderType === 'secretary')?.body
    || recentMessages.at(-1)?.body
    || '这条邮件主题还没有形成当前状态说明。';
  const lines = [
    `# ${detail.thread.subject}`,
    '',
    '## 当前情况',
    currentState,
  ];
  if (openItems.length > 0) {
    lines.push('', '## 仍需处理', ...openItems.map(item => `- ${item}`));
  }
  if (recentMessages.length > 0) {
    lines.push('', '## 最近来信');
    for (const message of recentMessages) {
      const sender = message.senderType === 'secretary' ? '记忆秘书' : message.senderId || message.senderType;
      lines.push('', `### ${sender} · ${(message.sentAt ?? message.createdAt).slice(0, 16).replace('T', ' ')}`, message.body);
    }
  }
  if (linkedMemories.length > 0) {
    lines.push('', '## 相关记忆');
    for (const memory of linkedMemories) lines.push(`- [${memory.id}] ${memory.title}：${firstReadableSentence(memory.content, 160)}`);
  }
  return { thread: detail.thread, currentState, recentMessages, openItems, linkedMemories, markdown: lines.join('\n').trim() };
}

function fallbackSecretaryBody(thread: MailThread, memories: Memory[]): string {
  const developments = memories.slice(0, 6).map(memory => {
    const detail = firstReadableSentence(memory.content, 170);
    return detail && detail !== memory.title ? `- ${memory.title}。${detail}` : `- ${memory.title}`;
  });
  return [
    '这件事情有了新的信息，现将目前能够确认的内容整理如下。',
    '',
    '从上次邮件以后，新增了这些内容：',
    ...developments,
    '',
    '这些内容已经与本邮件主题关联。后续如有新的决定、进展或问题，请继续在此回复。',
  ].join('\n');
}

async function writeSecretaryBody(thread: MailThread, memories: Memory[]): Promise<string> {
  const fallback = fallbackSecretaryBody(thread, memories);
  if (!isLLMAvailable()) return fallback;
  try {
    const source = memories.map((memory, index) => `${index + 1}. ${memory.title}\n${firstReadableSentence(memory.content, 320)}`).join('\n\n');
    const result = await chatWithLLM({
      systemPrompt: `你是 KeyMemory 的“记忆秘书”。请把项目变化写成一封自然、克制、像真实同事写出的中文工作邮件。\n\n强制要求：\n- 只输出正文，不写标题，不使用 JSON。\n- 开头直接说明最重要的变化。\n- 使用通俗、完整的书面句子，避免“基于上下文”“综上所述”“值得注意的是”等模板话。\n- 说清楚已经确认的内容、当前状态、仍需处理的事情。\n- 不展示代码、日志、内部编号和系统术语。\n- 不把推断写成事实，不补充来源中没有的信息。\n- 正文控制在 180 到 500 个汉字。`,
      userMessage: `邮件主题：${thread.subject}\n\n本次新增资料：\n${source}`,
      temperature: 0.2,
      maxTokens: 900,
    });
    const body = cleanPlainText(result.content);
    return readableBodyIssues(body).length === 0 ? body : fallback;
  } catch (error) {
    console.error('[Mailbox] 记忆秘书写信失败，使用本地整理结果：', (error as Error).message);
    return fallback;
  }
}

export async function syncMailThread(threadId: string, agentSpaces?: string[]): Promise<MailMessage | null> {
  const db = getDatabase();
  const thread = getMailThread(threadId, SECRETARY_ID, agentSpaces);
  if (!thread) throw new Error('找不到邮件主题，或者当前 Agent 没有读取权限');
  const lastDigest = db.prepare(`
    SELECT metadata FROM mail_messages
    WHERE thread_id = ? AND sender_type = 'secretary' AND message_type = 'digest' AND status = 'sent'
    ORDER BY created_at DESC LIMIT 1
  `).get(threadId) as { metadata: string | null } | undefined;
  const lastCoverage = String(parseObject(lastDigest?.metadata)?.coverageThrough ?? '');
  const rows = db.prepare(`
    SELECT DISTINCT m.* FROM memories m
    JOIN mail_thread_memories tm ON tm.memory_id = m.id
    WHERE tm.thread_id = ? AND m.status = 'active' AND (? = '' OR m.updated_at > ?)
    ORDER BY m.updated_at DESC
  `).all(threadId, lastCoverage, lastCoverage) as Record<string, unknown>[];
  const memories = rows.map(rowToMemory);
  if (memories.length === 0) return null;
  const coverageThrough = memories.reduce((latest, memory) => memory.updatedAt > latest ? memory.updatedAt : latest, lastCoverage);
  const body = await writeSecretaryBody(thread, memories);
  return db.transaction(() => {
    const message = insertMessage(thread, {
      body,
      senderType: 'secretary',
      senderId: SECRETARY_ID,
      recipientIds: DEFAULT_RECIPIENTS,
      messageType: 'digest',
      attachments: memories.map(memory => ({
        kind: 'memory' as const,
        title: memory.title,
        content: firstReadableSentence(memory.content, 500),
        memoryId: memory.id,
        collapsed: true,
      })),
      metadata: { coverageThrough, sourceMemoryIds: memories.map(memory => memory.id) },
    });
    db.prepare('UPDATE mail_threads SET current_summary = ?, updated_at = ? WHERE id = ?').run(firstReadableSentence(body, 500), new Date().toISOString(), threadId);
    return message;
  })();
}

export interface MailboxSyncReport {
  checked: number;
  sent: number;
  messageIds: string[];
  createdThreads: number;
  linkedMemories: number;
  skipped: string[];
}

type SecretaryThreadPlan = {
  thread_id?: string;
  subject: string;
  kind: MailThreadKind;
  memory_ids: string[];
  confidence: number;
  body: string;
};

function initMailboxOrganizationLog(): void {
  getDatabase().exec(`
    CREATE TABLE IF NOT EXISTS mailbox_organization_log (
      memory_id TEXT PRIMARY KEY,
      decision TEXT NOT NULL,
      source_updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function parseSecretaryPlans(raw: string): SecretaryThreadPlan[] | null {
  let text = raw.trim();
  const block = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (block) text = block[1].trim();
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) text = text.slice(first, last + 1);
  try {
    const parsed = JSON.parse(text) as { threads?: unknown };
    if (!Array.isArray(parsed.threads)) return null;
    return parsed.threads.filter((item): item is SecretaryThreadPlan => {
      if (!item || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.subject === 'string'
        && ['project', 'task', 'event'].includes(String(value.kind))
        && Array.isArray(value.memory_ids)
        && typeof value.confidence === 'number'
        && typeof value.body === 'string';
    });
  } catch {
    return null;
  }
}

function unorganizedWorkMemories(agentSpaces?: string[]): Memory[] {
  initMailboxOrganizationLog();
  const db = getDatabase();
  const params: Record<string, unknown> = {};
  const scope = agentSpaces && agentSpaces.length > 0
    ? `AND m.agent_space IN (${agentSpaces.map((_, index) => `@space${index}`).join(', ')})`
    : '';
  agentSpaces?.forEach((space, index) => { params[`space${index}`] = space; });
  const rows = db.prepare(`
    SELECT m.* FROM memories m
    LEFT JOIN mailbox_organization_log ol ON ol.memory_id = m.id
    WHERE m.status = 'active'
      AND (ol.memory_id IS NULL OR ol.source_updated_at < m.updated_at)
      AND NOT EXISTS (SELECT 1 FROM mail_thread_memories tm WHERE tm.memory_id = m.id)
      AND COALESCE(m.source, '') NOT IN ('mailbox', 'memory-secretary', 'system')
      ${scope}
    ORDER BY m.updated_at DESC
    LIMIT 250
  `).all(params) as Record<string, unknown>[];
  return rows.map(rowToMemory).filter(memory => {
    const text = `${memory.title} ${memory.content}`;
    const kind = memory.tags?.some(tag => ['kind:task', 'kind:project_fact', 'kind:decision', 'kind:event', 'kind:project_journal'].includes(tag));
    const action = /(完成|推进|修复|发布|上线|迁移|验收|实现|开发|设计|调查|跟进|待确认|需要|正在|已经|计划|准备|问题|进展|决定)/u.test(text);
    return Boolean(kind || action);
  }).slice(0, 60);
}

async function organizeUnlinkedMemories(agentSpaces?: string[]): Promise<{ createdThreads: number; linkedMemories: number; skipped: string[] }> {
  const memories = unorganizedWorkMemories(agentSpaces);
  if (memories.length === 0) return { createdThreads: 0, linkedMemories: 0, skipped: [] };
  const db = getDatabase();
  const skipped: string[] = [];
  if (!isLLMAvailable()) {
    return { createdThreads: 0, linkedMemories: 0, skipped: ['尚有零散工作记忆，但 LLM 未启用，记忆秘书无法可靠判断邮件主题'] };
  }
  const bySpace = new Map<string, Memory[]>();
  for (const memory of memories) {
    const scoped = bySpace.get(memory.agentSpace) ?? [];
    // 单次只交给模型一批可读的材料；其余记忆留到下一轮继续整理。
    if (scoped.length < 24) bySpace.set(memory.agentSpace, [...scoped, memory]);
  }
  let createdThreads = 0;
  let linkedMemories = 0;

  const organizeSpace = async ([agentSpace, scopedMemories]: [string, Memory[]]): Promise<void> => {
    const existing = listMailThreads({ folder: 'all', agentSpaces: [agentSpace], limit: 100 });
    const source = scopedMemories.map(memory => `- ID: ${memory.id}\n  标题: ${memory.title}\n  内容: ${firstReadableSentence(memory.content, 260)}`).join('\n');
    let plans: SecretaryThreadPlan[] | null = null;
    try {
      const response = await chatWithLLM({
        systemPrompt: `你是 KeyMemory 的“记忆秘书”，正在执行工作主题整理：把零散记忆整理成真实、可持续回复的工作邮件主题。\n\n只整理具体项目、任务或事件；通用知识、偏好、规则、概念和仅有一个名词的分类不得建成邮件。优先归入已有主题，只有明确是一项独立工作时才新建。标题必须像工作邮件，清楚说明正在推进什么，不能只写“飞书”“项目”“开发”之类分类词。正文使用自然、通俗的中文书面语，不使用代码、日志、内部编号或 AI 套话。不要把推断写成事实。置信度不足时不要输出。\n\n严格输出 JSON：{"threads":[{"thread_id":"已有主题ID或省略","subject":"清楚的工作邮件标题","kind":"project|task|event","memory_ids":["来源记忆ID"],"confidence":0.0,"body":"第一封邮件正文"}]}`,
        userMessage: `已有邮件主题：\n${existing.length ? existing.map(thread => `- ${thread.id}: ${thread.subject}`).join('\n') : '（暂无）'}\n\n待整理记忆：\n${source}`,
        temperature: 0.1,
        maxTokens: 1800,
      });
      plans = parseSecretaryPlans(response.content);
    } catch (error) {
      skipped.push(`记忆秘书整理失败：${(error as Error).message}`);
      return;
    }
    if (plans === null) {
      skipped.push('记忆秘书返回的整理结果无法核验，本次没有改动记忆，稍后可以重试');
      return;
    }

    const allowed = new Map(scopedMemories.map(memory => [memory.id, memory]));
    const used = new Set<string>();
    for (const plan of plans.slice(0, 6)) {
      const ids = Array.from(new Set(plan.memory_ids.map(String))).filter(id => allowed.has(id) && !used.has(id));
      if (plan.confidence < 0.82 || ids.length === 0 || readableBodyIssues(plan.body).length > 0) continue;
      try {
        assertUsefulSubject(plan.subject);
        const targetThread = plan.thread_id
          ? existing.find(item => item.id === plan.thread_id)
          : existing.find(item => normalizeSubject(item.subject) === normalizeSubject(plan.subject));
        const selected = ids.map(id => allowed.get(id)!);
        const coverageThrough = selected.reduce((latest, memory) => memory.updatedAt > latest ? memory.updatedAt : latest, '');
        const body = cleanPlainText(plan.body);
        if (targetThread) {
          // 归类模型已经生成并通过了正文校验，直接作为已有主题的新回复；
          // 避免随后再次调用模型重写同一批资料，让一次点击最多等待一轮推理。
          db.transaction(() => {
            for (const id of ids) linkMemoryToThread(targetThread.id, id, 'source', [agentSpace]);
            insertMessage(targetThread, {
              body,
              senderType: 'secretary',
              senderId: SECRETARY_ID,
              recipientIds: DEFAULT_RECIPIENTS,
              messageType: 'digest',
              attachments: selected.map(memory => ({ kind: 'memory', title: memory.title, content: firstReadableSentence(memory.content, 500), memoryId: memory.id, collapsed: true })),
              metadata: { coverageThrough, sourceMemoryIds: ids, organizedBy: 'memory-secretary' },
            });
            db.prepare('UPDATE mail_threads SET current_summary = ?, updated_at = ? WHERE id = ?')
              .run(firstReadableSentence(body, 500), new Date().toISOString(), targetThread.id);
          })();
          linkedMemories += ids.length;
        } else {
          createMailThread({
            subject: plan.subject,
            kind: plan.kind,
            body,
            senderType: 'secretary',
            senderId: SECRETARY_ID,
            recipientIds: DEFAULT_RECIPIENTS,
            agentSpace,
            memoryIds: ids,
            messageType: 'digest',
            attachments: selected.map(memory => ({ kind: 'memory', title: memory.title, content: firstReadableSentence(memory.content, 500), memoryId: memory.id, collapsed: true })),
            metadata: { coverageThrough, sourceMemoryIds: ids, organizedBy: 'memory-secretary' },
          });
          createdThreads++;
          linkedMemories += ids.length;
        }
        ids.forEach(id => used.add(id));
      } catch (error) {
        skipped.push(`“${plan.subject}”未建立：${(error as Error).message}`);
      }
    }
    const writeLog = db.prepare('INSERT OR REPLACE INTO mailbox_organization_log (memory_id, decision, source_updated_at, created_at) VALUES (?, ?, ?, ?)');
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const memory of scopedMemories) writeLog.run(memory.id, used.has(memory.id) ? 'organized' : 'not_work_thread', memory.updatedAt, now);
    })();
  };

  // 不同 Agent 空间彼此独立，允许少量并行，避免多个模型超时被串行累加到一次点击上。
  const spaces = Array.from(bySpace.entries());
  let nextSpace = 0;
  const workers = Array.from({ length: Math.min(3, spaces.length) }, async () => {
    while (nextSpace < spaces.length) {
      const index = nextSpace++;
      await organizeSpace(spaces[index]);
    }
  });
  await Promise.all(workers);
  return { createdThreads, linkedMemories, skipped };
}

export async function syncMailbox(agentSpaces?: string[]): Promise<MailboxSyncReport> {
  const organized = await organizeUnlinkedMemories(agentSpaces);
  const threads = listMailThreads({ folder: 'all', agentSpaces, limit: 250 });
  const messageIds: string[] = [];
  for (const thread of threads) {
    const message = await syncMailThread(thread.id, agentSpaces);
    if (message) messageIds.push(message.id);
  }
  return {
    checked: threads.length,
    sent: messageIds.length,
    messageIds,
    createdThreads: organized.createdThreads,
    linkedMemories: organized.linkedMemories,
    skipped: organized.skipped,
  };
}

export function getMailboxMigrationReport(): MailboxMigrationReport {
  const db = getDatabase();
  const marker = db.prepare("SELECT value FROM scheduler_config WHERE key = 'mailbox_v1_legacy_projects_flattened'").get() as { value: string } | undefined;
  const data = parseObject(marker?.value) ?? {};
  const defaultProjectId = String(data.defaultProjectId ?? '');
  const projects = db.prepare(`
    SELECT p.id, p.path, COUNT(m.id) as memory_count
    FROM projects p LEFT JOIN memories m ON m.project_id = p.id
    WHERE p.id != ?
    GROUP BY p.id ORDER BY p.path
  `).all(defaultProjectId) as Array<{ id: string; path: string; memory_count: number }>;
  return {
    alreadyApplied: Boolean(marker),
    dryRun: false,
    defaultProjectId,
    movedMemories: Number(data.movedMemories ?? 0),
    retiredProjects: Number(data.retiredProjects ?? 0),
    removedSuggestions: Number(data.removedSuggestions ?? 0),
    backupPath: data.backupPath ? String(data.backupPath) : undefined,
    items: projects.map(project => ({
      projectId: project.id,
      projectPath: project.path,
      memoryCount: project.memory_count,
      disposition: project.memory_count > 0 ? 'return_to_memory_pool' : 'empty_legacy_folder',
      memoryIds: [],
    })),
  };
}

export function getMailboxStats(recipientId = DEFAULT_HUMAN_ID): {
  inbox: number;
  unread: number;
  starred: number;
  snoozed: number;
  drafts: number;
  sent: number;
  scheduled: number;
  archive: number;
  trash: number;
  all: number;
} {
  const inbox = listMailThreads({ folder: 'inbox', recipientId, limit: 250 });
  return {
    inbox: inbox.length,
    unread: inbox.reduce((sum, thread) => sum + thread.unreadCount, 0),
    starred: listMailThreads({ folder: 'starred', recipientId, limit: 250 }).length,
    snoozed: listMailThreads({ folder: 'snoozed', recipientId, limit: 250 }).length,
    drafts: listMailThreads({ folder: 'drafts', recipientId, limit: 250 }).length,
    sent: listMailThreads({ folder: 'sent', recipientId, limit: 250 }).length,
    scheduled: listMailThreads({ folder: 'scheduled', recipientId, limit: 250 }).length,
    archive: listMailThreads({ folder: 'archive', recipientId, limit: 250 }).length,
    trash: listMailThreads({ folder: 'trash', recipientId, limit: 250 }).length,
    all: listMailThreads({ folder: 'all', recipientId, limit: 250 }).length,
  };
}

export const MAILBOX_IDENTITIES = {
  secretary: { id: SECRETARY_ID, displayName: '记忆秘书' },
  human: { id: DEFAULT_HUMAN_ID, displayName: '我' },
};
