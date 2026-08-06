import { v4 as uuid } from 'uuid';
import { createHash } from 'node:crypto';
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
  MailThreadReader,
  MailThreadStatus,
  MailboxMigrationReport,
  Memory,
} from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { rowToMemory } from '../db/mapper.js';
import { createMemory, updateMemory } from './atom.js';
import { createProject } from './project.js';
import { chatWithLLM, isLLMAvailable } from './llm-provider.js';
import { searchHybrid } from './query.js';

const SECRETARY_ID = 'memory-secretary@keymemory.local';
export const DEFAULT_HUMAN_ID = 'human:local';
const DEFAULT_RECIPIENTS = [DEFAULT_HUMAN_ID, 'agent:*'];

/**
 * Digest 抑制窗口（小时）：仅作为旧数据兜底——上封 digest 没有内容指纹可比对时，
 * 距上封不足该时长且本次候选记忆是上封来源子集，才跳过发信；指纹已变化（真实内容更新）不受窗口拦截。
 */
const DIGEST_SUPPRESS_WINDOW_HOURS = 6;

/**
 * 邮箱 digest 去重灰度开关（scheduler_config 中的 mailboxDigestDedup，默认 true）。
 * 为 false 时完全回退旧行为（无指纹守卫、无空水位修复、无抑制窗口）。
 * 直接读取 scheduler_config 表，避免 mailbox ↔ scheduler 循环依赖。
 */
function isMailboxDigestDedupEnabled(): boolean {
  try {
    const row = getDatabase().prepare("SELECT value FROM scheduler_config WHERE key = 'mailboxDigestDedup'").get() as { value: string } | undefined;
    return row ? row.value !== 'false' : true;
  } catch {
    return true;
  }
}

/**
 * 候选记忆内容指纹：按 id 排序后逐行拼接 "id|title|content" 再做 sha256。
 * 不含 updated_at，因此检索命中、每日衰减等“无内容变化”的 updated_at 刷新不会改变指纹。
 */
function computeMemoryFingerprint(memories: Memory[]): string {
  const payload = [...memories]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(memory => `${memory.id}|${memory.title}|${memory.content}`)
    .join('\n');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

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
    .replace(/^\s*(?:(?:re|fw|fwd|回复|转发)\s*[:：]\s*)+/i, '')
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

function readableBodyIssues(body: string, sourceMemories?: Array<{content: string}>): string[] {
  const issues: string[] = [];
  const clean = body.trim();
  if (clean.length < 16) issues.push('正文过短，无法说明当前情况');
  if ((clean.match(/```/g) ?? []).length > 0) issues.push('正文包含代码块');
  if (/^\s*[{[]\s*["']?[\w-]+["']?\s*:/m.test(clean)) issues.push('正文看起来像原始数据');
  const technicalLines = clean.split('\n').filter(line => /(?:Error:|at\s+\S+\s*\(|SELECT\s+.+FROM|npm ERR!|0x[\da-f]+)/i.test(line));
  if (technicalLines.length >= 2) issues.push('正文包含大量技术日志');

  // 来源验证：检查正文中的数字是否能在来源记忆中找到
  if (sourceMemories && sourceMemories.length > 0) {
    const allSourceText = sourceMemories.map(m => m.content).join(' ');
    const numbers = clean.match(/\d{3,}/g) || [];
    for (const num of numbers) {
      if (!allSourceText.includes(num)) {
        issues.push(`邮件中包含来源未提及的数据「${num}」，请核实`);
        break;
      }
    }
  }

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

  const result = db.transaction(() => {
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

  // 异步搜索并关联与新线程主题相关的历史记忆（非阻塞，不影响创建流程）
  if (result.thread && isLLMAvailable()) {
    linkRelevantHistoricalMemories(result.thread.id, result.thread.subject).catch(err => {
      console.error(`[Mailbox] Auto-link historical memories failed for thread ${result.thread.id}:`, (err as Error).message);
    });
  }

  return result;
}

/**
 * 异步搜索与线程主题相关的 top-5 历史记忆并自动关联到新线程。
 * 用于线程创建后帮助 Agent 获取历史经验。
 */
async function linkRelevantHistoricalMemories(threadId: string, subject: string): Promise<void> {
  if (!subject || subject.trim().length < 5) return;

  try {
    const results = await searchHybrid(subject, {
      projectId: undefined,
      includeDescendants: false,
      limit: 10,
    });

    // 排除已关联到该线程的记忆
    const db = getDatabase();
    const linkedRows = db.prepare(
      'SELECT memory_id FROM mail_thread_memories WHERE thread_id = ?'
    ).all(threadId) as Array<{ memory_id: string }>;
    const alreadyLinked = new Set(linkedRows.map(r => r.memory_id));

    const candidates = results.filter(r => !alreadyLinked.has(r.memory.id));
    const top5 = candidates.slice(0, 5);

    for (const result of top5) {
      try {
        linkMemoryToThread(threadId, result.memory.id, 'reference');
      } catch {
        // 可能已关联或记忆不存在，忽略
      }
    }
  } catch (err) {
    console.error(`[Mailbox] linkRelevantHistoricalMemories failed for thread ${threadId}:`, (err as Error).message);
  }
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
  const threads = rows.map(row => rowToThread(row, String(params.recipientId)));

  // 已读 Agent 聚合：对当前页 threadIds 用单条批量 SQL（GROUP BY thread_id）一次取回，
  // 避免逐主题 N+1 查询；只保留 recipientId 以 agent: 开头且 read_at 非空的回执。
  if (threads.length > 0) {
    const threadParams: Record<string, unknown> = {};
    const placeholders = threads.map((item, index) => {
      threadParams[`readerThread${index}`] = item.id;
      return `@readerThread${index}`;
    }).join(', ');
    const readerRows = db.prepare(`
      SELECT m.thread_id AS thread_id, r.recipient_id AS recipient_id, MAX(r.read_at) AS read_at
      FROM mail_receipts r
      JOIN mail_messages m ON m.id = r.message_id
      WHERE m.thread_id IN (${placeholders})
        AND r.recipient_id LIKE 'agent:%'
        AND r.read_at IS NOT NULL
      GROUP BY m.thread_id, r.recipient_id
      ORDER BY read_at DESC
    `).all(threadParams) as Array<{ thread_id: string; recipient_id: string; read_at: string }>;
    const readersByThread = new Map<string, Array<{ recipientId: string; readAt: string }>>();
    for (const readerRow of readerRows) {
      const readers = readersByThread.get(readerRow.thread_id) ?? [];
      readers.push({ recipientId: readerRow.recipient_id, readAt: readerRow.read_at });
      readersByThread.set(readerRow.thread_id, readers);
    }
    for (const thread of threads) {
      thread.agentReaders = readersByThread.get(thread.id) ?? [];
    }
  }

  // 检查 snooze 是否到期，自动清除过期的 snoozed_until
  for (const thread of threads) {
    if (thread.snoozedUntil && new Date(thread.snoozedUntil) < new Date()) {
      db.prepare('UPDATE mail_threads SET snoozed_until = NULL WHERE id = ?').run(thread.id);
      thread.snoozedUntil = undefined;
    }
  }

  return threads;
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

function getThreadReaders(threadId: string): MailThreadReader[] {
  const db = getDatabase();
  const messageRows = db.prepare(`
    SELECT sender_id, recipient_ids FROM mail_messages WHERE thread_id = ?
  `).all(threadId) as Array<{ sender_id: string | null; recipient_ids: string }>;
  const receiptRows = db.prepare(`
    SELECT DISTINCT r.recipient_id
    FROM mail_receipts r
    JOIN mail_messages m ON m.id = r.message_id
    WHERE m.thread_id = ?
  `).all(threadId) as Array<{ recipient_id: string }>;
  const participantIds = Array.from(new Set([
    ...messageRows.flatMap(row => [row.sender_id, ...parseStrings(row.recipient_ids)]),
    ...receiptRows.map(row => row.recipient_id),
  ].filter((id): id is string => Boolean(id) && id !== 'agent:*' && id !== SECRETARY_ID)));

  return participantIds.map((recipientId): MailThreadReader => {
    const receipt = db.prepare(`
      SELECT MAX(r.read_at) AS read_at
      FROM mail_receipts r
      JOIN mail_messages m ON m.id = r.message_id
      WHERE m.thread_id = ? AND r.recipient_id = ? AND r.read_at IS NOT NULL
    `).get(threadId, recipientId) as { read_at: string | null } | undefined;
    const unread = db.prepare(`
      SELECT COUNT(*) AS count
      FROM mail_messages m
      LEFT JOIN mail_receipts r ON r.message_id = m.id AND r.recipient_id = ?
      WHERE m.thread_id = ?
        AND m.status = 'sent'
        AND COALESCE(m.sender_id, '') != ?
        AND r.read_at IS NULL
    `).get(recipientId, threadId, recipientId) as { count: number };
    const readerType = recipientId.startsWith('human:') ? 'human' : 'agent';
    const rawName = recipientId.replace(/^(?:agent|human):/, '');
    return {
      recipientId,
      readerType,
      displayName: readerType === 'human' && rawName === 'local' ? '用户' : rawName,
      readAt: receipt?.read_at ?? undefined,
      unreadCount: unread.count,
    };
  }).sort((a, b) => {
    if (a.readerType !== b.readerType) return a.readerType === 'human' ? -1 : 1;
    return a.displayName.localeCompare(b.displayName);
  });
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
  return {
    thread: { ...thread, unreadCount: 0 },
    messages,
    linkedMemories: memoryRows.map(rowToMemory),
    readers: getThreadReaders(threadId),
  };
}

function archiveSenderLabel(message: MailMessage): string {
  if (message.senderType === 'secretary') return '记忆秘书';
  if (message.senderType === 'human') return '用户';
  return `Agent ${message.senderId?.replace(/^agent:/, '') || '未知'}`;
}

function archiveExcerpt(value: string, max = 900): string {
  const clean = cleanPlainText(value);
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function buildArchiveEvidence(detail: MailThreadDetail): string {
  const messageBlocks = detail.messages.map((message, index) => {
    const attachments = message.attachments
      .filter(attachment => attachment.content)
      .map(attachment => `  附件《${attachment.title}》：${archiveExcerpt(attachment.content!, 1200)}`)
      .join('\n');
    return [
      `### ${index + 1}. ${archiveSenderLabel(message)} · ${(message.sentAt ?? message.createdAt).slice(0, 16).replace('T', ' ')} · ${message.messageType}`,
      archiveExcerpt(message.body, 4000),
      attachments,
    ].filter(Boolean).join('\n');
  });
  const memories = detail.linkedMemories
    .filter(memory => memory.source !== 'mailbox-archive')
    .map(memory => `- ${memory.title}：${archiveExcerpt(memory.content, 1800)}`);
  return [
    '## 邮件全过程',
    ...messageBlocks,
    '',
    '## 已关联的记忆资料',
    ...(memories.length ? memories : ['- 没有额外关联资料。']),
  ].join('\n').slice(0, 60000);
}

function fallbackArchiveReport(detail: MailThreadDetail): string {
  const messages = detail.messages.filter(message => message.status === 'sent');
  const first = messages[0];
  const last = messages.at(-1);
  const openItems = extractOpenItems(messages);
  const decisions = messages.filter(message => message.messageType === 'decision' || message.messageType === 'correction');
  const timeline = messages.map((message, index) => {
    const when = (message.sentAt ?? message.createdAt).slice(0, 10);
    return `${index + 1}. **${when} · ${archiveSenderLabel(message)}**：${archiveExcerpt(message.body, 1100)}`;
  });
  const attachmentNotes = detail.messages.flatMap(message => message.attachments)
    .filter(attachment => attachment.content)
    .map(attachment => `- **${attachment.title}**：${archiveExcerpt(attachment.content!, 700)}`);
  const linkedNotes = detail.linkedMemories
    .filter(memory => memory.source !== 'mailbox-archive')
    .map(memory => `- **${memory.title}**：${archiveExcerpt(memory.content, 900)}`);
  const causalSteps = messages.map((message, index) => {
    const prefix = index === 0 ? '起点' : index === messages.length - 1 ? '结果' : '推进';
    return `- **${prefix}**：${firstReadableSentence(message.body, 260)}`;
  });
  return cleanPlainText(`# ${detail.thread.subject}｜项目归档报告

## 一、起因与背景

${first ? archiveExcerpt(first.body, 1600) : '邮件中没有留下明确的起因说明。'}

## 二、根本目标与约束

这项工作的根本目标，是解决“${detail.thread.subject}”所描述的具体问题，并让人类与 Agent 能够依据同一份连续上下文协作。以下内容只依据邮件和已关联资料整理，不把没有证据的推测写成事实。

${linkedNotes.length ? linkedNotes.join('\n') : '- 当前没有额外关联记忆，主要证据来自邮件往来。'}

## 三、过程与关键节点

${timeline.length ? timeline.join('\n\n') : '没有可整理的过程记录。'}

## 四、整个项目的因果与推进链

${causalSteps.length ? causalSteps.join('\n') : '- 邮件内容不足，暂时无法确认推进链。'}

上述链条表示邮件中能够确认的先后与推进关系；只有正文明确说明原因时，才把它视为因果关系。

## 五、结果与交付

${last ? archiveExcerpt(last.body, 1600) : '邮件中没有留下明确的最终结果。'}

${attachmentNotes.length ? `### 关键附件与证据\n\n${attachmentNotes.join('\n')}` : '邮件没有附带需要单独说明的附件。'}

## 六、未完成事项与风险

${openItems.length ? openItems.map(item => `- ${item}`).join('\n') : '- 归档时没有识别到明确的未完成事项。'}

## 七、总结与反思

${decisions.length
    ? decisions.map(message => `- ${archiveSenderLabel(message)}记录的${message.messageType === 'correction' ? '更正' : '决定'}：${firstReadableSentence(message.body, 420)}`).join('\n')
    : '- 邮件中没有单独标记的决定或更正；复用本报告时应优先核对结果、证据和仍未完成的事项。'}

## 八、可复用原则

- 先从根本目标、已知事实和真实约束出发，再选择方案，不用工具名或惯例代替问题本身。
- 关键决定必须说明它解决了什么问题、依赖什么证据、带来什么结果。
- 技术日志保留为证据，面向人类的正文应解释这些证据意味着什么。
- 新信息如果改变旧结论，应在原主题中明确更正，避免后续 Agent 继续使用过期上下文。
`);
}

async function writeArchiveReport(detail: MailThreadDetail): Promise<string> {
  const fallback = fallbackArchiveReport(detail);
  if (!isLLMAvailable()) return fallback;
  try {
    const result = await chatWithLLM({
      systemPrompt: `你是 KeyMemory 的项目归档编辑。请依据完整邮件线程和关联资料，撰写一份细节充分、可长期复用的中文项目报告。

底层原则是第一性原理：先还原根本目标、已知事实、真实约束和不可省略的条件，再解释方案与结果；不要用惯例、工具名或空泛口号代替原因。因果关系必须有邮件证据，无法确认时明确写“尚不能确认”，不得编造。

必须使用以下章节：一、起因与背景；二、根本目标与约束；三、过程与关键节点；四、整个项目的因果链；五、结果与交付；六、未完成事项与风险；七、总结与反思；八、可复用原则。

保留关键参与者、日期、决定、更正、失败尝试、原因、交付物和验证结果。区分“已确认事实”“合理推断”和“尚未确认”。正文使用自然、通俗、完整的人类书面语，先讲清事实再解释意义；同时使用稳定的标题、时间顺序、项目符号和明确的状态描述，让后续 Agent 能可靠提取目标、约束、证据、决定、结果与待办。不要在报告中出现“第一性原理”这个词，避免 AI 套话、内部字段、JSON 和原始日志。只输出 Markdown 报告正文。`,
      userMessage: `邮件主题：${detail.thread.subject}\n类型：${detail.thread.kind}\n创建时间：${detail.thread.createdAt}\n归档时间：${new Date().toISOString()}\n\n${buildArchiveEvidence(detail)}`,
      temperature: 0.15,
      maxTokens: 3500,
      timeoutMs: 60000,
    });
    const report = cleanPlainText(result.content);
    const required = ['起因', '根本目标', '过程', '因果', '结果', '总结', '反思'];
    return report.length >= 600 && !report.includes('第一性原理') && required.every(section => report.includes(section)) ? report : fallback;
  } catch (error) {
    console.error('[Mailbox] 归档报告生成失败，使用本地结构化报告：', (error as Error).message);
    return fallback;
  }
}

export async function consolidateMailThreadForArchive(threadId: string): Promise<Memory> {
  const db = getDatabase();
  const detail = getMailThreadDetail(threadId, DEFAULT_HUMAN_ID, undefined, false);
  if (!detail) throw new Error('找不到要归档的邮件主题');
  const report = await writeArchiveReport(detail);
  const now = new Date().toISOString();
  const title = `${detail.thread.subject}｜项目归档报告`;
  const tags = ['项目归档', '邮箱归档报告'];
  const metadata = {
    mailboxArchiveReport: true,
    archiveThreadId: threadId,
    threadKind: detail.thread.kind,
    messageCount: detail.messages.length,
    participantIds: detail.thread.participantIds,
    generatedAt: now,
    humanReadable: true,
    agentReadable: true,
    completeness: { status: 'completed', checkedAt: now },
  };
  const existingRow = db.prepare(`
    SELECT * FROM memories
    WHERE source = 'mailbox-archive' AND source_id = ? AND status = 'active'
    ORDER BY updated_at DESC LIMIT 1
  `).get(threadId) as Record<string, unknown> | undefined;
  const memory = existingRow
    ? updateMemory(String(existingRow.id), { title, content: report, layer: 'long', tags, source: 'mailbox-archive', metadata }, '邮件主题再次归档，刷新完整项目报告')
    : createMemory({
      title,
      content: report,
      layer: 'long',
      agentSpace: detail.thread.agentSpace,
      confidence: 1,
      tags,
      source: 'mailbox-archive',
      sourceId: threadId,
      metadata,
      bypassQualityGate: true,
    } as Parameters<typeof createMemory>[0] & { bypassQualityGate: boolean });
  if (!memory) throw new Error('归档报告写入记忆库失败');
  linkMemoryToThread(threadId, memory.id, 'reference');
  return memory;
}

export async function updateMailThread(threadId: string, updates: {
  subject?: string;
  status?: MailThreadStatus;
  folder?: MailThreadFolder;
  starred?: boolean;
  snoozedUntil?: string | null;
}): Promise<MailThread | null> {
  const db = getDatabase();
  const existing = getMailThread(threadId);
  if (!existing) return null;
  const shouldArchive = updates.folder === 'archive' && existing.folder !== 'archive';
  if (shouldArchive) await consolidateMailThreadForArchive(threadId);
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
  else if (shouldArchive) { values.push('status = @status'); params.status = 'completed'; }
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
  if (detail.readers.length > 0) {
    lines.push('', '## 已读状态');
    for (const reader of detail.readers) {
      const name = reader.readerType === 'human' ? reader.displayName : `Agent ${reader.displayName}`;
      const state = reader.readAt
        ? `最近读取于 ${reader.readAt.slice(0, 16).replace('T', ' ')}`
        : '尚未读取';
      const unread = reader.unreadCount > 0 ? `，还有 ${reader.unreadCount} 封未读` : '';
      lines.push(`- ${name}：${state}${unread}`);
    }
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
  return {
    thread: detail.thread,
    currentState,
    recentMessages,
    openItems,
    linkedMemories,
    readers: detail.readers,
    markdown: lines.join('\n').trim(),
  };
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
    return readableBodyIssues(body, memories.map(m => ({ content: m.content }))).length === 0 ? body : fallback;
  } catch (error) {
    console.error('[Mailbox] 记忆秘书写信失败，使用本地整理结果：', (error as Error).message);
    return fallback;
  }
}

export async function syncMailThread(threadId: string, agentSpaces?: string[], skipped?: string[]): Promise<MailMessage | null> {
  const db = getDatabase();
  const thread = getMailThread(threadId, SECRETARY_ID, agentSpaces);
  if (!thread) throw new Error('找不到邮件主题，或者当前 Agent 没有读取权限');
  const dedupEnabled = isMailboxDigestDedupEnabled();
  const lastDigest = db.prepare(`
    SELECT created_at, metadata FROM mail_messages
    WHERE thread_id = ? AND sender_type = 'secretary' AND message_type = 'digest' AND status = 'sent'
    ORDER BY created_at DESC LIMIT 1
  `).get(threadId) as { created_at: string; metadata: string | null } | undefined;
  const lastMetadata = parseObject(lastDigest?.metadata);
  const lastCoverage = String(lastMetadata?.coverageThrough ?? '');
  // 空水位修复：主题尚无 digest 时，以最近来信时间（其次创建时间）作为初始水位，
  // 不再让旧逻辑的 `? = ''` 把所有关联记忆永远视为新内容。
  const watermark = dedupEnabled && !lastCoverage ? (thread.lastMessageAt ?? thread.createdAt) : lastCoverage;
  const rows = db.prepare(`
    SELECT DISTINCT m.* FROM memories m
    JOIN mail_thread_memories tm ON tm.memory_id = m.id
    WHERE tm.thread_id = ? AND m.status = 'active'
      AND COALESCE(m.source, '') != 'mailbox-archive'
      AND (? = '' OR m.updated_at > ?)
    ORDER BY m.updated_at DESC
  `).all(threadId, watermark, watermark) as Record<string, unknown>[];
  const memories = rows.map(rowToMemory);
  if (memories.length === 0) return null;
  // 内容指纹（不含 updated_at）：发信时写入 digest metadata，供下次同步比对。
  const fingerprint = dedupEnabled ? computeMemoryFingerprint(memories) : undefined;
  if (dedupEnabled && lastDigest) {
    const lastFingerprint = String(lastMetadata?.contentFingerprint ?? '');
    // 指纹守卫：候选内容与上封 digest 完全一致时，updated_at 越过水位只是命中/衰减造成的假信号，
    // 直接不发信、不调 LLM。指纹相同的无实质变化重复在这里就已被拦截。
    if (fingerprint && lastFingerprint === fingerprint) return null;
    // 抑制兜底：只在上封 digest 没有 contentFingerprint（旧数据无指纹可比对）时启用——
    // 距上封不足抑制窗口且本次候选是上封来源记忆的子集，才跳过发信。
    // 上封已有指纹且与本次不同，说明是真实内容更新，必须尽快发信，不能被窗口拦截。
    const lastSentAt = Date.parse(lastDigest.created_at);
    const previousIds = new Set(parseStrings(lastMetadata?.sourceMemoryIds));
    const withinWindow = Number.isFinite(lastSentAt) && Date.now() - lastSentAt < DIGEST_SUPPRESS_WINDOW_HOURS * 60 * 60 * 1000;
    if (!lastFingerprint && withinWindow && previousIds.size > 0 && memories.every(memory => previousIds.has(memory.id))) {
      skipped?.push(`“${thread.subject}”距上封 digest 不足 ${DIGEST_SUPPRESS_WINDOW_HOURS} 小时且上封无内容指纹可比对、候选记忆未超出上封范围，跳过本次发信（主题编号：${threadId}）`);
      return null;
    }
  }
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
      metadata: {
        coverageThrough,
        sourceMemoryIds: memories.map(memory => memory.id),
        ...(fingerprint ? { contentFingerprint: fingerprint } : {}),
      },
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
      AND COALESCE(m.source, '') NOT IN ('mailbox', 'mailbox-archive', 'memory-secretary', 'system')
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
    if (scoped.length < 12) bySpace.set(memory.agentSpace, [...scoped, memory]);
  }
  let createdThreads = 0;
  let linkedMemories = 0;

  const organizeSpace = async ([agentSpace, scopedMemories]: [string, Memory[]]): Promise<void> => {
    const existing = listMailThreads({ folder: 'all', agentSpaces: [agentSpace], limit: 100 });
    const source = scopedMemories.map(memory => {
      const tags = memory.tags ?? [];
      const kindTag = tags.find(t => t.startsWith('kind:'));
      const kind = kindTag ? kindTag.slice(5) : '';
      const userTags = tags.filter(t => !t.startsWith('kind:') && !t.startsWith('scope:') && !t.startsWith('sensitivity:')).join(',');
      const parts = [
        `- ID: ${memory.id}`,
        `  标题: ${memory.title}`,
        `  layer: ${memory.layer}`,
        kind ? `  kind: ${kind}` : '',
        userTags ? `  tags: ${userTags}` : '',
        `  内容: ${firstReadableSentence(memory.content, 500)}`,
      ].filter(Boolean);
      return parts.join('\n');
    }).join('\n');
    let plans: SecretaryThreadPlan[] | null = null;
    try {
      const response = await chatWithLLM({
        systemPrompt: `你是 KeyMemory 的“记忆秘书”，正在执行工作主题整理：把零散记忆整理成真实、可持续回复的工作邮件主题。\n\n只整理具体项目、任务或事件；通用知识、偏好、规则、概念和仅有一个名词的分类不得建成邮件。优先归入已有主题，只有明确是一项独立工作时才新建。标题必须像工作邮件，清楚说明正在推进什么，不能只写“飞书”“项目”“开发”之类分类词。正文使用自然、通俗的中文书面语，不使用代码、日志、内部编号或 AI 套话。不要把推断写成事实。置信度不足时不要输出。\n\n严格输出 JSON：{"threads":[{"thread_id":"已有主题ID或省略","subject":"清楚的工作邮件标题","kind":"project|task|event","memory_ids":["来源记忆ID"],"confidence":0.0,"body":"第一封邮件正文"}]}`,
        userMessage: `已有邮件主题：\n${existing.length ? existing.map(thread => {
          const parts: Record<string, string> = { id: thread.id, subject: thread.subject };
          if (thread.currentSummary) parts.currentSummary = thread.currentSummary;
          return `- ${JSON.stringify(parts)}`;
        }).join('\n') : '（暂无）'}\n\n待整理记忆：\n${source}`,
        temperature: 0.1,
        maxTokens: 1800,
        timeoutMs: 45000,
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
      if (plan.confidence < 0.82 || ids.length === 0 || readableBodyIssues(plan.body, scopedMemories.map(m => ({ content: m.content }))).length > 0) continue;
      try {
        assertUsefulSubject(plan.subject);
        const targetThread = plan.thread_id
          ? existing.find(item => item.id === plan.thread_id)
          : existing.find(item => normalizeSubject(item.subject) === normalizeSubject(plan.subject));
        const selected = ids.map(id => allowed.get(id)!);
        const coverageThrough = selected.reduce((latest, memory) => memory.updatedAt > latest ? memory.updatedAt : latest, '');
        // 内容指纹与 syncMailThread 保持一致，供后续同步去重比对。
        const contentFingerprint = computeMemoryFingerprint(selected);
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
              metadata: { coverageThrough, sourceMemoryIds: ids, contentFingerprint, organizedBy: 'memory-secretary' },
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
            metadata: { coverageThrough, sourceMemoryIds: ids, contentFingerprint, organizedBy: 'memory-secretary' },
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
  const skipped = [...organized.skipped];
  for (const thread of threads) {
    const message = await syncMailThread(thread.id, agentSpaces, skipped);
    if (message) messageIds.push(message.id);
  }
  return {
    checked: threads.length,
    sent: messageIds.length,
    messageIds,
    createdThreads: organized.createdThreads,
    linkedMemories: organized.linkedMemories,
    skipped,
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
  const db = getDatabase();
  const now = new Date().toISOString();

  // 单条 SQL 获取所有文件夹统计，避免 N+1 查询
  const folderStats = db.prepare(`
    SELECT
      folder,
      COUNT(*) as count,
      SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) as starred_count,
      SUM(CASE WHEN snoozed_until IS NOT NULL AND snoozed_until > @now THEN 1 ELSE 0 END) as snoozed_active
    FROM mail_threads
    WHERE folder != 'trash'
    GROUP BY folder
  `).all({ now }) as Array<{ folder: string; count: number; starred_count: number; snoozed_active: number }>;

  const folderMap = new Map(folderStats.map(r => [r.folder, r]));

  // 计算 unread（需要跨表查询）
  const unreadRow = db.prepare(`
    SELECT COUNT(*) as count
    FROM mail_messages m
    JOIN mail_threads t ON t.id = m.thread_id
    LEFT JOIN mail_receipts r ON r.message_id = m.id AND r.recipient_id = @recipientId
    WHERE t.folder = 'inbox'
      AND (t.snoozed_until IS NULL OR t.snoozed_until <= @now)
      AND m.status = 'sent'
      AND COALESCE(m.sender_id, '') != @recipientId
      AND r.read_at IS NULL
  `).get({ recipientId, now }) as { count: number };

  // sent: 包含当前用户发送的消息的线程数
  const sentCount = db.prepare(`
    SELECT COUNT(DISTINCT t.id) as count
    FROM mail_threads t
    WHERE EXISTS (SELECT 1 FROM mail_messages sm WHERE sm.thread_id = t.id AND sm.sender_id = @recipientId AND sm.status = 'sent')
  `).get({ recipientId }) as { count: number };

  // drafts
  const draftsCount = db.prepare(`
    SELECT COUNT(DISTINCT t.id) as count
    FROM mail_threads t
    WHERE EXISTS (SELECT 1 FROM mail_messages dm WHERE dm.thread_id = t.id AND dm.status = 'draft')
  `).get({ recipientId }) as { count: number };

  // scheduled
  const scheduledCount = db.prepare(`
    SELECT COUNT(DISTINCT t.id) as count
    FROM mail_threads t
    WHERE EXISTS (SELECT 1 FROM mail_messages qm WHERE qm.thread_id = t.id AND qm.status = 'scheduled')
  `).get({ recipientId }) as { count: number };

  // starred (所有非 trash 的加星标线程)
  const starredRow = db.prepare(`
    SELECT COUNT(*) as count FROM mail_threads WHERE starred = 1 AND folder != 'trash'
  `).get() as { count: number };

  // snoozed (未过期的)
  const snoozedRow = db.prepare(`
    SELECT COUNT(*) as count FROM mail_threads WHERE snoozed_until IS NOT NULL AND snoozed_until > @now AND folder != 'trash'
  `).get({ now }) as { count: number };

  // trash
  const trashRow = db.prepare(`SELECT COUNT(*) as count FROM mail_threads WHERE folder = 'trash'`).get() as { count: number };

  const inboxRow = folderMap.get('inbox');
  const archiveRow = folderMap.get('archive');
  const inboxCount = inboxRow?.count ?? 0;
  const archiveCount = archiveRow?.count ?? 0;
  const allNonTrash = folderStats.reduce((sum, r) => sum + r.count, 0) + trashRow.count;

  return {
    inbox: inboxCount,
    unread: unreadRow.count,
    starred: starredRow.count,
    snoozed: snoozedRow.count,
    drafts: draftsCount.count,
    sent: sentCount.count,
    scheduled: scheduledCount.count,
    archive: archiveCount,
    trash: trashRow.count,
    all: allNonTrash,
  };
}

export const MAILBOX_IDENTITIES = {
  secretary: { id: SECRETARY_ID, displayName: '记忆秘书' },
  human: { id: DEFAULT_HUMAN_ID, displayName: '我' },
};
