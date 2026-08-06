/**
 * KM-410：邮箱（mailbox）路由（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import type { MailThreadFolder, MailThreadKind, MailSenderType, MailThreadStatus } from '@keymemory/shared';
import {
  createMailThread,
  listMailThreads,
  getMailThreadDetail,
  getMailThreadContext,
  replyToMailThread,
  linkMemoryToThread,
  unlinkMemoryFromThread,
  syncMailThread,
  syncMailbox,
  updateMailThread,
  getMailboxStats,
  getMailboxMigrationReport,
} from '../../core/mailbox.js';
import { mailboxIdentityForRequest } from './shared.js';

export function registerMailboxRoutes(app: FastifyInstance): void {
  app.get('/api/mailbox/threads', async (request) => {
    const query = request.query as Record<string, string>;
    const identity = mailboxIdentityForRequest(request);
    return listMailThreads({
      folder: (query.folder as MailThreadFolder | 'all' | 'starred' | 'snoozed' | 'sent' | 'drafts' | 'scheduled') ?? 'inbox',
      query: query.q,
      recipientId: query.recipientId || identity.recipientId,
      agentSpaces: identity.agentSpaces,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
  });

  app.get('/api/mailbox/stats', async (request) => {
    const identity = mailboxIdentityForRequest(request);
    return getMailboxStats(identity.recipientId);
  });

  app.get('/api/mailbox/migration', async () => getMailboxMigrationReport());

  app.post('/api/mailbox/threads', async (request, reply) => {
    const body = request.body as {
      subject?: string;
      kind?: MailThreadKind;
      body?: string;
      senderType?: MailSenderType;
      senderId?: string;
      recipientIds?: string[];
      agentSpace?: string;
      memoryIds?: string[];
      metadata?: Record<string, unknown>;
    };
    if (!body.subject || !body.body || !body.kind) {
      reply.code(400);
      return { error: 'subject, kind, and body are required', code: 'MISSING_REQUIRED_FIELDS' };
    }
    try {
      const created = createMailThread({
        subject: body.subject,
        kind: body.kind,
        body: body.body,
        senderType: body.senderType ?? 'human',
        senderId: body.senderId,
        recipientIds: body.recipientIds,
        agentSpace: body.agentSpace,
        memoryIds: body.memoryIds,
        metadata: body.metadata,
      });
      reply.code(201);
      return created;
    } catch (error) {
      const err = error as Error;
      const code = err.message.includes('标题') ? 'INVALID_SUBJECT'
        : err.message.includes('已经存在') ? 'DUPLICATE_THREAD'
        : err.message.includes('正文') ? 'INVALID_BODY'
        : 'THREAD_CREATE_FAILED';
      reply.code(400);
      return { error: err.message, code };
    }
  });

  app.get('/api/mailbox/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const identity = mailboxIdentityForRequest(request);
    const detail = getMailThreadDetail(id, identity.recipientId, identity.agentSpaces, true);
    if (!detail) {
      reply.code(404);
      return { error: 'Mail thread not found' };
    }
    return detail;
  });

  app.get('/api/mailbox/threads/:id/context', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const identity = mailboxIdentityForRequest(request);
    const context = getMailThreadContext(
      id,
      identity.recipientId,
      identity.agentSpaces,
      query.maxMessages ? Number(query.maxMessages) : undefined,
      query.maxMemories ? Number(query.maxMemories) : undefined,
    );
    if (!context) {
      reply.code(404);
      return { error: 'Mail thread not found' };
    }
    return context;
  });

  app.patch('/api/mailbox/threads/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      subject?: string;
      status?: MailThreadStatus;
      folder?: MailThreadFolder;
      starred?: boolean;
      snoozedUntil?: string | null;
    };
    try {
      const thread = await updateMailThread(id, body);
      if (!thread) {
        reply.code(404);
        return { error: 'Mail thread not found', code: 'THREAD_NOT_FOUND' };
      }
      return thread;
    } catch (error) {
      const err = error as Error;
      const code = err.message.includes('标题') ? 'INVALID_SUBJECT'
        : err.message.includes('已经使用') ? 'DUPLICATE_THREAD'
        : 'THREAD_UPDATE_FAILED';
      reply.code(400);
      return { error: err.message, code };
    }
  });

  app.post('/api/mailbox/threads/:id/reply', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as Parameters<typeof replyToMailThread>[1];
    const identity = mailboxIdentityForRequest(request);
    if (!body?.body || !body.senderType) {
      reply.code(400);
      return { error: 'body and senderType are required', code: 'MISSING_REQUIRED_FIELDS' };
    }
    try {
      return replyToMailThread(id, { ...body, senderId: body.senderId ?? identity.recipientId }, identity.agentSpaces);
    } catch (error) {
      const err = error as Error;
      const code = err.message.includes('可读性') ? 'BODY_READABILITY_FAILED'
        : err.message.includes('找不到') ? 'THREAD_NOT_FOUND'
        : 'REPLY_FAILED';
      reply.code(400);
      return { error: err.message, code };
    }
  });

  app.post('/api/mailbox/threads/:id/memories', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { memoryId?: string; relationType?: Parameters<typeof linkMemoryToThread>[2] };
    const identity = mailboxIdentityForRequest(request);
    if (!body.memoryId) {
      reply.code(400);
      return { error: 'memoryId is required', code: 'MISSING_REQUIRED_FIELDS' };
    }
    try {
      return linkMemoryToThread(id, body.memoryId, body.relationType, identity.agentSpaces);
    } catch (error) {
      const err = error as Error;
      const code = err.message.includes('找不到') ? 'MEMORY_NOT_FOUND'
        : err.message.includes('私有空间') ? 'ACCESS_DENIED'
        : 'LINK_FAILED';
      reply.code(400);
      return { error: err.message, code };
    }
  });

  app.delete('/api/mailbox/threads/:id/memories/:memoryId', async (request) => {
    const { id, memoryId } = request.params as { id: string; memoryId: string };
    return { success: unlinkMemoryFromThread(id, memoryId) };
  });

  app.post('/api/mailbox/threads/:id/sync', async (request, reply) => {
    const { id } = request.params as { id: string };
    const identity = mailboxIdentityForRequest(request);
    try {
      const message = await syncMailThread(id, identity.agentSpaces);
      return { sent: Boolean(message), message };
    } catch (error) {
      const err = error as Error;
      const code = err.message.includes('找不到') ? 'THREAD_NOT_FOUND' : 'SYNC_FAILED';
      reply.code(400);
      return { error: err.message, code };
    }
  });

  app.post('/api/mailbox/sync', async (request) => {
    const identity = mailboxIdentityForRequest(request);
    return syncMailbox(identity.agentSpaces);
  });
}
