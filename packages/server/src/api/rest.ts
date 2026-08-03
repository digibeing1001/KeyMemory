import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createMemory, getMemory, listMemories, updateMemory, deleteMemory, recordHit, listVersions, getVersion, revertToVersion, batchCreateMemories, batchUpdateMemories, batchDeleteMemories, exportMemoriesAsJson, importMemories, listRecycleBin, restoreFromRecycleBin, permanentlyDeleteMemory } from '../core/atom.js';
import { moveLayer, getLayerStats } from '../core/layer.js';
import { createProject, getProject, listProjects, updateProject, deleteProject, moveProject, getProjectPath, getProjectDescendants, getProjectMemories, listProjectSuggestions, acceptProjectSuggestion, rejectProjectSuggestion } from '../core/project.js';
import { searchHybrid, ensureEmbedding, findDuplicateMemories } from '../core/query.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { runDailyInspection, getPendingTasks, resolveTask } from '../core/evolution.js';
import { listEntities, getEntityGraph, extractEntities, ensureEntity, linkMemoryEntity, findRelatedMemories, createMemoryRelation, MEMORY_RELATION_TYPES } from '../graph/entity.js';
import { getVersions, diffVersions, rollbackToVersion } from '../core/provenance.js';
import { forgetMemory, restoreMemory, getDecayingMemories, applyDecay as runDecay } from '../core/forgetting.js';
import { compressProjectMemories, compressEntityMemories, listCompressibleProjects } from '../core/compression.js';
import { getHealthReport, injectContext, listOrphanIssues, markOrphanIndependent } from '../core/health.js';
import { cleanTag, isMeaningfulTag } from '../core/memory-schema.js';
import { buildAgentContextPack } from '../core/context-pack.js';
import { planConsolidation, executeConsolidation, rollbackConsolidation, getConsolidationPlan, listConsolidationPlans, getConsolidationSnapshots, runAutoConsolidation } from '../core/consolidation.js';
import { runDreamCycleAsync, getDreamReport, listDreamReports, getDreamSignalsForReport, rollbackDream, deleteDreamReport, getPendingTodosForContext, resolveConflict } from '../core/dreaming.js';
import { getLLMConfig, saveLLMConfig, verifyLLMConnection, saveLLMVerifyResult, clearLLMConfig, isLLMAvailable } from '../core/llm-provider.js';
import { runRelationReasonerBatch, getScanStats, resetScanStatus, resetAllScanStatus } from '../core/relation-reasoner.js';
import { scanProjectJournalInjections, listInjections, getInjectionStats, resetInjection } from '../core/project-journal.js';
import { getSchedulerConfig, updateSchedulerConfig, restartScheduler } from '../core/scheduler.js';
import { discoverMigrationSources, migrateMemoriesFromPath, migrateMigrationSources } from '../core/migration.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile } from '../core/backup.js';
import type { BackupSummary } from '../core/backup.js';
import { routeMemory, createAgentContext, visibleSpacesFor } from '../adapters/base.js';
import { syncToClaudeMd, syncFromClaudeMd } from '../adapters/claude-code.js';
import { getDatabase } from '../db/sqlite.js';
import { rowToMemory, rowToLoopRunSummary } from '../db/mapper.js';
import { autoRemember } from '../core/auto.js';
import { extractTags } from '../core/auto.js';
import { isApiRequestAuthorized, shouldAuthenticateHttpPath, isPublicPath, resolveCaller, extractRequestToken } from '../core/security.js';
import {
  authenticateUser,
  createSession,
  createUser,
  revokeSession,
  listAllUsers,
  updateUserRole,
  hasAnyUser,
  getUserById,
  type CallerContext,
  type UserRole,
} from '../core/auth.js';
import { checkpointLoopRun, finishLoopRun, getLoopContext, loopErrorObservation, startLoopRun } from '../core/loop-harness.js';
import path from 'path';
import type { AgentContextPackRequest, CreateMemoryInput, UpdateMemoryInput, Layer, LoopCheckpointRequest, LoopContextRequest, LoopFinishRequest, LoopRunStartRequest, MemoryStatus, SearchQuery, ForgetMethod, IsolationMode } from '@keymemory/shared';
import { supersedeMemory } from '../core/supersession.js';

/**
 * 校验导入路径安全性，防止 null byte 注入和明显的路径攻击
 */
function assertSafeImportPath(filePath: string): void {
  // Null byte 注入防护：文件路径中不允许包含 null 字节
  if (filePath.includes('\0')) {
    throw new Error('Invalid file path: null bytes are not allowed');
  }
  // 解析为绝对路径并规范化，消除 .. 等潜在问题
  const resolved = path.resolve(filePath);
  if (resolved.length > 4096) {
    throw new Error('File path too long (max 4096 characters)');
  }
}

function safeParseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isPlaceholderProjectName(name: string | null): boolean {
  if (!name) return true;
  return /^(未分类|未归类|默认|公共记忆|uncategorized|unclassified|default|inbox)$/i.test(name.trim());
}

function createMigrationBackup(shouldCreate: boolean | undefined, dryRun: boolean | undefined): BackupSummary | undefined {
  if (!shouldCreate || dryRun) return undefined;
  return createBackupFile();
}

function loopHttpStatus(code: string | undefined): number {
  if (code === 'RUN_NOT_FOUND' || code === 'CHECKPOINT_NOT_FOUND' || code === 'PROJECT_NOT_FOUND' || code === 'MEMORY_NOT_FOUND') return 404;
  if (code === 'INVALID_INPUT') return 400;
  if (code === 'LIMIT_EXCEEDED') return 413;
  if (code === 'INTERNAL_ERROR') return 500;
  return 409;
}

/**
 * 从 request 上读取 caller 上下文(preHandler 已写入)。
 * 返回 undefined 表示当前请求是匿名(单用户/旧 API key 兼容模式)。
 */
function getCaller(request: FastifyRequest): CallerContext | undefined {
  return (request as any).user as CallerContext | undefined;
}

/**
 * 判断 caller 是否可看全部数据(boss/admin),或仅看自己 owner_user_id 的数据。
 * caller 为 undefined 时(匿名/旧模式)返回 true,保持旧行为(不过滤)。
 */
function callerIsAdminOrAnonymous(caller: CallerContext | undefined): boolean {
  if (!caller) return true;
  return caller.role === 'boss' || caller.role === 'admin';
}

/**
 * 在 list 路由层对已映射的 Memory[] 做 owner_user_id 过滤:
 * - boss/admin/匿名 看全部(不过滤)
 * - member/exec/pm 只看 owner_user_id = 自己 id 的数据,以及 owner_user_id 为 NULL 的旧数据(向后兼容)
 *
 * 由于 Memory 类型不带 ownerUserId,这里批量查询一次 DB 拿到 id→owner_user_id 映射。
 */
function filterMemoriesByOwner<T extends { id: string }>(items: T[], caller: CallerContext | undefined, table: 'memories' | 'projects' | 'loop_runs' = 'memories'): T[] {
  if (callerIsAdminOrAnonymous(caller)) return items;
  if (items.length === 0) return items;
  const db = getDatabase();
  const ids = items.map(m => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, owner_user_id FROM ${table} WHERE id IN (${placeholders})`).all(...ids) as { id: string; owner_user_id: string | null }[];
  const ownerMap = new Map<string, string | null>();
  for (const r of rows) ownerMap.set(r.id, r.owner_user_id);
  const uid = caller!.userId;
  return items.filter(m => {
    const owner = ownerMap.get(m.id);
    return !owner || owner === uid;
  });
}

/**
 * 在 list 路由层对原始 DB 行(尚未映射)做 owner_user_id 过滤。
 * 用于 recent-hits / recent-created / loop-runs 等直接 SQL 查询的端点。
 */
function filterRawRowsByOwner(rows: Record<string, unknown>[], caller: CallerContext | undefined): Record<string, unknown>[] {
  if (callerIsAdminOrAnonymous(caller)) return rows;
  const uid = caller!.userId;
  return rows.filter(r => {
    const owner = r.owner_user_id as string | null | undefined;
    return !owner || owner === uid;
  });
}

const ADMIN_ROLES: UserRole[] = ['boss', 'admin'];

function requireAdmin(reply: any, caller: CallerContext | undefined): boolean {
  if (caller && ADMIN_ROLES.includes(caller.role)) return true;
  reply.code(403);
  reply.send({ error: 'Forbidden: admin or boss role required' });
  return false;
}

export function registerRoutes(app: FastifyInstance): void {
  const apiKey = process.env.KEYMEMORY_API_KEY;

  // 鉴权 preHandler:
  // 1. 公开路径(/api/auth/login, /api/auth/register, /api/health)直接放行
  // 2. 先尝试 per-user token 鉴权,成功则写入 request.user
  // 3. 失败则 fallback 到旧 API key 模式:若 KEYMEMORY_API_KEY 配置且校验失败,返回 401
  //    若未配置 KEYMEMORY_API_KEY,放行(单用户匿名模式,向后兼容)
  app.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const path = request.url.split('?')[0];

    // 公开路径直接放行(但仍尝试解析 caller,以便 /api/auth/register 判断首个用户)
    const caller = resolveCaller(request.headers as Record<string, string | string[] | undefined>);
    if (caller) {
      (request as any).user = caller;
    }

    if (isPublicPath(path)) return;

    if (!shouldAuthenticateHttpPath(path)) return;

    // 已通过 token 鉴权
    if (caller) return;

    // fallback 旧 API key 模式
    if (apiKey) {
      if (!isApiRequestAuthorized(request.headers as Record<string, string | string[] | undefined>)) {
        return reply.code(401).send({ error: 'Unauthorized: invalid token or API key' });
      }
      return;
    }

    // 未配置 apiKey 也未带 token:单用户匿名模式,放行(向后兼容)
  });

  app.get('/api/health', async () => {
    const stats = getLayerStats();
    return { status: 'ok', timestamp: new Date().toISOString(), stats };
  });

  // ===== Auth Routes =====

  // 注册:
  // - 系统尚无任何用户时,首个注册者自动成为 boss(主账户),无需鉴权
  // - 已有用户时,需 boss/admin token 才能注册新成员
  app.post('/api/auth/register', async (request, reply) => {
    const body = request.body as { name?: string; email?: string; password?: string; role?: UserRole };
    if (!body.name || !body.email || !body.password) {
      reply.code(400);
      return { error: 'name, email, and password are required' };
    }
    const noUserYet = !hasAnyUser();
    const caller = getCaller(request);
    if (!noUserYet) {
      // 已有用户:必须有 boss/admin 权限
      if (!requireAdmin(reply, caller)) return;
    }
    const role: UserRole = noUserYet ? 'boss' : (body.role ?? 'member');
    try {
      const user = createUser({
        name: body.name,
        email: body.email,
        password: body.password,
        role,
        isMainAccount: noUserYet,
      });
      const session = createSession(user.id);
      reply.code(201);
      return { token: session.token, expiresAt: session.expiresAt, user };
    } catch (err) {
      reply.code(409);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      reply.code(400);
      return { error: 'email and password are required' };
    }
    const user = authenticateUser(body.email, body.password);
    if (!user) {
      reply.code(401);
      return { error: 'Invalid email or password' };
    }
    const session = createSession(user.id);
    return { token: session.token, expiresAt: session.expiresAt, user };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = extractRequestToken(request.headers as Record<string, string | string[] | undefined>);
    if (!token) {
      reply.code(400);
      return { error: 'No token provided' };
    }
    revokeSession(token);
    return { success: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const caller = getCaller(request);
    if (!caller) {
      reply.code(401);
      return { error: 'Not authenticated' };
    }
    const user = getUserById(caller.userId);
    if (!user) {
      reply.code(404);
      return { error: 'User not found' };
    }
    return { user };
  });

  // 列出用户(仅 boss/admin)
  app.get('/api/users', async (request, reply) => {
    const caller = getCaller(request);
    if (!requireAdmin(reply, caller)) return;
    return { users: listAllUsers() };
  });

  // 更新用户角色(仅 boss/admin)
  app.patch('/api/users/:id', async (request, reply) => {
    const caller = getCaller(request);
    if (!requireAdmin(reply, caller)) return;
    const { id } = request.params as { id: string };
    const body = request.body as { role?: UserRole };
    if (!body.role) {
      reply.code(400);
      return { error: 'role is required' };
    }
    const validRoles: UserRole[] = ['boss', 'exec', 'pm', 'member', 'admin'];
    if (!validRoles.includes(body.role)) {
      reply.code(400);
      return { error: `role must be one of: ${validRoles.join(', ')}` };
    }
    const updated = updateUserRole(id, body.role);
    if (!updated) {
      reply.code(404);
      return { error: 'User not found' };
    }
    return { user: updated };
  });

  app.post('/api/memories', async (request, reply) => {
    const input = request.body as CreateMemoryInput;
    if (!input.title || !input.content || !input.layer) {
      reply.code(400);
      return { error: 'title, content, and layer are required' };
    }
    // 如果未提供标签，自动生成
    if (!input.tags || input.tags.length === 0) {
      input.tags = extractTags(input.content);
    }
    // 透传 caller userId 到 createMemory,使记忆写入 owner_user_id
    const caller = getCaller(request);
    const mem = createMemory({ ...input, ...(caller?.userId ? { ownerUserId: caller.userId } : {}) } as CreateMemoryInput & { ownerUserId?: string });
    // 后处理（实体链接 + embedding + autoAssociate）已内聚到 createMemory 内部
    reply.code(201);
    return mem;
  });

  app.get('/api/memories/search', async (request) => {
    const query = request.query as Record<string, string>;
    const q = query.q;
    if (!q) return [];
    return searchHybrid(q, {
      layer: query.layer as Layer | undefined,
      projectId: query.projectId,
      projectPath: query.projectPath,
      includeDescendants: query.includeDescendants !== 'false',
      includeSuperseded: query.includeSuperseded === 'true',
      asOf: query.asOf,
      includeExpired: query.includeExpired === 'true',
      explain: query.explain === 'true',
      memoryKind: query.memoryKind as SearchQuery['memoryKind'],
      status: query.status as MemoryStatus | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : 20,
    });
  });

  app.get('/api/memories', async (request) => {
    const query = request.query as Record<string, string>;
    const caller = getCaller(request);
    const memories = listMemories({
      layer: query.layer as Layer | undefined,
      projectId: query.projectId,
      includeDescendants: query.includeDescendants === 'true',
      status: query.status as MemoryStatus | undefined,
      asOf: query.asOf,
      includeExpired: query.includeExpired === undefined ? undefined : query.includeExpired === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
    return filterMemoriesByOwner(memories, caller);
  });

  // 近期命中：按 last_hit_at 倒序返回近期被命中的记忆，让 UI 能直接展示系统的实际使用情况
  // 用户可以直观看到哪些记忆被实际用到了、哪些从未被命中，作为记忆库使用情况的核心入口视图
  app.get('/api/memories/recent-hits', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const caller = getCaller(request);
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE status = 'active' AND last_hit_at IS NOT NULL
      ORDER BY last_hit_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return filterRawRowsByOwner(rows, caller).map(rowToMemory);
  });

  // 近期创建工作集：按 created_at 倒序返回最近写入的记忆，让用户能看到"系统在产出"
  app.get('/api/memories/recent-created', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const caller = getCaller(request);
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM memories
      WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return filterRawRowsByOwner(rows, caller).map(rowToMemory);
  });

  // ===== Shared mailbox for humans and Agents =====

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
      const thread = updateMailThread(id, body);
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

  app.get('/api/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const mem = getMemory(id);
    if (!mem) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    return mem;
  });

  app.put('/api/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = request.body as UpdateMemoryInput;
    // 如果内容更新且未提供标签，重新生成
    if (input.content !== undefined && (!input.tags || input.tags.length === 0)) {
      input.tags = extractTags(input.content);
    }
    const mem = updateMemory(id, input);
    if (!mem) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    // 后处理（嵌入刷新 + 实体链接 + 关联重建）已内聚到 updateMemory 内部
    return mem;
  });

  app.delete('/api/memories/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const permanent = query.permanent === 'true';
    const ok = deleteMemory(id, permanent);
    if (!ok) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    return { success: true };
  });

  app.patch('/api/memories/:id/layer', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { layer, reason } = request.body as { layer: Layer; reason?: string };
    if (!layer) {
      reply.code(400);
      return { error: 'layer is required' };
    }
    const ok = moveLayer(id, layer, reason);
    if (!ok) {
      reply.code(400);
      return { error: 'Invalid layer move' };
    }
    return getMemory(id);
  });

  app.post('/api/memories/:id/hit', async (request) => {
    const { id } = request.params as { id: string };
    recordHit(id);
    return { success: true };
  });

  app.get('/api/layers/stats', async () => {
    return getLayerStats();
  });

  app.post('/api/layers/decay', async () => {
    return runDecay();
  });

  app.post('/api/embeddings/rebuild-all', async () => {
    const db = getDatabase();
    const memories = db.prepare(`
      SELECT id, title, content, tags, metadata FROM memories WHERE status = 'active'
    `).all() as { id: string; title: string; content: string; tags: string | null; metadata: string | null }[];

    let success = 0;
    let failed = 0;

    for (const mem of memories) {
      try {
        const tags = mem.tags ? JSON.parse(mem.tags) : undefined;
        const metadata = mem.metadata ? JSON.parse(mem.metadata) : undefined;
        await ensureEmbedding(mem.id, mem.title, mem.content, tags, metadata, true);
        success++;
      } catch {
        failed++;
      }
    }

    return { total: memories.length, success, failed };
  });

  app.post('/api/entities/rebuild-all', async () => {
    const db = getDatabase();
    const memories = db.prepare(`
      SELECT id, content FROM memories WHERE status = 'active'
    `).all() as { id: string; content: string }[];

    let processed = 0;

    for (const mem of memories) {
      const entities = extractEntities(mem.content);
      for (const ext of entities) {
        const entity = ensureEntity(ext.name, ext.type);
        linkMemoryEntity(mem.id, entity.id);
      }
      processed++;
    }

    return { total: memories.length, processed };
  });

  app.get('/api/versions/:memoryId', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    return getVersions(memoryId);
  });

  app.get('/api/versions/:memoryId/diff', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    const query = request.query as { from: string; to: string };
    return diffVersions(memoryId, parseInt(query.from), parseInt(query.to));
  });

  app.post('/api/versions/:memoryId/rollback', async (request) => {
    const { memoryId } = request.params as { memoryId: string };
    const { targetVersion, reason } = request.body as { targetVersion: number; reason?: string };
    const ok = rollbackToVersion(memoryId, targetVersion, reason);
    return { success: ok };
  });

  app.post('/api/memories/:id/forget', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { method } = request.body as { method: ForgetMethod };
    const validMethods: ForgetMethod[] = ['archive', 'decay', 'delete'];
    if (!method || !validMethods.includes(method)) {
      reply.code(400);
      return { error: `method is required and must be one of: ${validMethods.join('|')}` };
    }
    return { success: forgetMemory(id, method) };
  });

  app.post('/api/memories/:id/restore', async (request) => {
    const { id } = request.params as { id: string };
    return { success: restoreMemory(id) };
  });

  app.get('/api/memories/decaying', async () => {
    return getDecayingMemories();
  });

  app.post('/api/compress/project', async (request) => {
    const { project } = request.body as { project: string };
    return await compressProjectMemories(project);
  });

  app.post('/api/compress/entity', async (request) => {
    const { entityId } = request.body as { entityId: string };
    return await compressEntityMemories(entityId);
  });

  app.get('/api/compress/candidates', async () => {
    return listCompressibleProjects();
  });

  app.get('/api/health/report', async () => {
    return getHealthReport();
  });

  app.get('/api/health/issues', async (request) => {
    const query = request.query as { type?: string; limit?: string };
    if (query.type && query.type !== 'orphan') return [];
    return listOrphanIssues(query.limit ? Number.parseInt(query.limit, 10) : 100);
  });

  app.post('/api/health/orphans/:id/independent', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = markOrphanIndependent(id);
    if (!success) reply.code(404);
    return { success };
  });

  app.post('/api/context/inject', async (request) => {
    const { project, query, limit, includeSuperseded } = request.body as {
      project?: string;
      query?: string;
      limit?: number;
      includeSuperseded?: boolean;
    };
    return injectContext({ project, query, limit, includeSuperseded: includeSuperseded === true });
  });

  app.post('/api/context/pack', async (request) => {
    const body = request.body as AgentContextPackRequest;
    // REST 端点也做 agent_space 隔离：从 header 推导可见空间。
    // 若 body 显式传了 agentSpaces 则优先 body（允许调用方覆盖），否则用 header 推导的默认值。
    if (!body.agentSpaces) {
      const agentId = (request.headers['x-agent-id'] as string) || 'hermes';
      const isolationMode = (request.headers['x-isolation-mode'] as IsolationMode) || 'hybrid';
      const caller = getCaller(request);
      body.agentSpaces = visibleSpacesFor(agentId, isolationMode, caller?.userId);
    }
    return buildAgentContextPack(body);
  });

  // 列表端点：让 UI 能直接看到"系统作为 loop 上下文记忆库被使用"的实际情况。
  // 没有这个端点时，healthReport.loopRuns 只是一个数字，用户看不到具体跑了什么。
  // 这是把 KeyMemory 真正作为 loop 工程上下文集库的核心视图入口。
  app.get('/api/loop/runs', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const caller = getCaller(request);
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, objective, project_id, project_path, agent_id, status,
             checkpoint_version, last_event_sequence, trace_id,
             lease_owner, lease_expires_at, metadata,
             created_at, updated_at, completed_at, owner_user_id
      FROM loop_runs
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return filterRawRowsByOwner(rows, caller).map(rowToLoopRunSummary);
  });

  app.post('/api/loop/runs', async (request, reply) => {
    try {
      const observation = await startLoopRun(request.body as LoopRunStartRequest);
      reply.code(observation.status === 'warning' ? 200 : 201);
      return observation;
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/context', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await getLoopContext({ ...(request.body as Omit<LoopContextRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/checkpoints', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await checkpointLoopRun({ ...(request.body as Omit<LoopCheckpointRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/finish', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await finishLoopRun({ ...(request.body as Omit<LoopFinishRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/agent/route', async (request) => {
    const { content, layer, agentId, isolationMode, customRules } = request.body as {
      content: string;
      layer: Layer;
      agentId: string;
      isolationMode?: IsolationMode;
      customRules?: { pattern: string; targetSpace: string; priority: number }[];
    };
    const caller = getCaller(request);
    const ctx = createAgentContext(agentId, isolationMode, caller?.userId);
    return routeMemory(content, layer, ctx, customRules);
  });

  app.post('/api/sync/claude-md', async () => {
    await syncToClaudeMd();
    return { success: true };
  });

  app.get('/api/sync/claude-md', async () => {
    const content = await syncFromClaudeMd();
    return { content };
  });

  app.post('/api/selfcheck', async (request) => {
    const { content, currentProject, conversationRound, userEmphasis } = request.body as {
      content: string;
      currentProject?: string;
      conversationRound?: number;
      userEmphasis?: number;
    };
    if (!content) {
      return { error: 'content is required' };
    }
    return evaluate(content, { currentProject, conversationRound, userEmphasis });
  });

  app.post('/api/evolution/inspect', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    return runDailyInspection();
  });

  app.get('/api/evolution/tasks', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    return getPendingTasks();
  });

  app.post('/api/evolution/tasks/:id/resolve', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { id } = request.params as { id: string };
    const { action } = request.body as { action: 'accepted' | 'rejected' };
    if (!action || !['accepted', 'rejected'].includes(action)) {
      return { error: 'action must be accepted or rejected' };
    }
    return resolveTask(id, action);
  });

  app.get('/api/entities', async (request) => {
    const query = request.query as Record<string, string>;
    return listEntities(query.type as import('@keymemory/shared').EntityType | undefined);
  });

  app.get('/api/entities/:id/graph', async (request) => {
    const { id } = request.params as { id: string };
    try {
      return getEntityGraph(id);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.post('/api/auto-remember', async (request) => {
    const { content, source, agentId, isolationMode, currentProject, conversationRound } = request.body as {
      content: string;
      source?: string;
      agentId?: string;
      isolationMode?: IsolationMode;
      currentProject?: string;
      conversationRound?: number;
    };
    if (!content) return { error: 'content is required' };
    // 透传 caller userId:使 autoRemember 产生的记忆写入 user-scoped agent_space
    const caller = getCaller(request);
    return autoRemember({ content, source, agentId, isolationMode, currentProjectId: currentProject, conversationRound, userId: caller?.userId });
  });

  app.post('/api/migration/import-file', async (request, reply) => {
    const body = request.body as {
      filePath?: string;
      format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
      source?: string;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      assertSafeImportPath(body.filePath);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
    try {
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMemoriesFromPath(body.filePath, {
        format: body.format,
        source: body.source,
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/migration/sources', async (request) => {
    const query = request.query as Record<string, string>;
    const roots = query.root
      ? query.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
      : undefined;
    return discoverMigrationSources({
      roots,
      includeHome: query.includeHome !== 'false',
      includeMissing: query.includeMissing === 'true',
      maxFilesPerDirectory: query.maxFiles ? parseInt(query.maxFiles, 10) : undefined,
    });
  });

  app.post('/api/migration/import-path', async (request, reply) => {
    const body = request.body as {
      path?: string;
      format?: 'auto' | 'json' | 'jsonl' | 'markdown' | 'text';
      source?: string;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      recursive?: boolean;
      maxFiles?: number;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    if (!body.path) {
      reply.code(400);
      return { error: 'path is required' };
    }
    try {
      assertSafeImportPath(body.path);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
    try {
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMemoriesFromPath(body.path, {
        format: body.format,
        source: body.source,
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        recursive: body.recursive,
        maxFiles: body.maxFiles,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/migration/import-discovered', async (request, reply) => {
    const body = request.body as {
      root?: string;
      includeHome?: boolean;
      minConfidence?: number;
      defaultLayer?: Layer;
      defaultProjectPath?: string;
      maxFiles?: number;
      runDream?: boolean;
      dryRun?: boolean;
      createBackupBeforeImport?: boolean;
    };
    try {
      const roots = body.root
        ? body.root.split(/[;,]/g).map(root => root.trim()).filter(Boolean)
        : undefined;
      const minConfidence = body.minConfidence ?? 0.7;
      const sources = discoverMigrationSources({ roots, includeHome: body.includeHome !== false })
        .filter(source => source.confidence >= minConfidence);
      const backup = createMigrationBackup(body.createBackupBeforeImport, body.dryRun);
      const result = await migrateMigrationSources(sources, {
        defaultLayer: body.defaultLayer,
        defaultProjectPath: body.defaultProjectPath,
        maxFiles: body.maxFiles,
        runDream: body.runDream,
        dryRun: body.dryRun,
      });
      return { ...result, backup, sources };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/agents', async (request) => {
    const db = getDatabase();
    const caller = getCaller(request);
    // member/exec/pm 只看自己的 agent_space + owner_user_id 为 NULL 的旧数据
    const ownerCondition = callerIsAdminOrAnonymous(caller)
      ? ''
      : 'AND (owner_user_id = @ownerUserId OR owner_user_id IS NULL)';
    const params: Record<string, unknown> = {};
    if (!callerIsAdminOrAnonymous(caller) && caller) {
      params.ownerUserId = caller.userId;
    }
    const agents = db.prepare(`
      SELECT DISTINCT owner_agent_id as agentId, agent_space as agentSpace, COUNT(*) as memoryCount
      FROM memories
      WHERE owner_agent_id IS NOT NULL ${ownerCondition}
      GROUP BY owner_agent_id, agent_space
    `).all(params);
    return agents;
  });

  app.get('/api/integrations/discover', async () => {
    return discoverAgentIntegrations();
  });

  app.post('/api/integrations/:agentId/connect', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { confirm, mode } = (request.body ?? {}) as { confirm?: boolean; mode?: 'auto' | 'mcp' | 'cli' | 'skill' };
    if (confirm !== true) {
      reply.code(400);
      return { error: 'confirm=true is required before changing an Agent configuration.' };
    }

    const before = discoverAgentIntegrations();
    const agent = before.agents.find(item => item.id === agentId);
    if (!agent) {
      reply.code(404);
      return { error: `Unsupported Agent integration: ${agentId}` };
    }
    try {
      const result = connectAgentIntegration(agent.id, { projectRoot: before.projectRoot, mode });
      return { result, report: discoverAgentIntegrations() };
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });

  app.post('/api/backup', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const db = getDatabase();
    const data = db.prepare(`SELECT * FROM memories`).all();
    const fts = db.prepare(`SELECT * FROM memories_fts`).all();
    const entities = db.prepare(`SELECT * FROM entities`).all();
    const versions = db.prepare(`SELECT * FROM versions`).all();
    return {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      memories: data,
      fts,
      entities,
      versions,
    };
  });

  app.post('/api/backup/create-file', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as {
      filePath?: string;
      includeEmbeddings?: boolean;
      includeOperationalLogs?: boolean;
    };
    try {
      return createBackupFile(body.filePath, {
        includeEmbeddings: body.includeEmbeddings,
        includeOperationalLogs: body.includeOperationalLogs,
      });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/backup/inspect-file', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as { filePath?: string };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      return inspectBackupFile(body.filePath);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/backup/restore', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as { filePath?: string; dryRun?: boolean; replace?: boolean; preRestoreBackupPath?: string };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      return restoreBackupFile(body.filePath, {
        dryRun: body.dryRun === true,
        replace: body.replace === true,
        preRestoreBackupPath: body.preRestoreBackupPath,
      });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/graph/memory-connections', async (request) => {
    const db = getDatabase();
    const caller = getCaller(request);
    // member/exec/pm 只看自己的记忆 + owner_user_id 为 NULL 的旧数据;
    // boss/admin/匿名 看全部(不加 owner 条件)
    const ownerCondition = callerIsAdminOrAnonymous(caller)
      ? ''
      : 'AND (m.owner_user_id = @ownerUserId OR m.owner_user_id IS NULL)';
    const params: Record<string, unknown> = {};
    if (!callerIsAdminOrAnonymous(caller) && caller) {
      params.ownerUserId = caller.userId;
    }

    const rows = db.prepare(`
      SELECT m.id, m.title, m.content, m.layer, m.tags, m.updated_at, p.name as project_name,
        (SELECT mt.id
         FROM mail_thread_memories mtm
         JOIN mail_threads mt ON mt.id = mtm.thread_id
         WHERE mtm.memory_id = m.id
         ORDER BY mt.updated_at DESC LIMIT 1) as mail_thread_id,
        (SELECT mt.subject
         FROM mail_thread_memories mtm
         JOIN mail_threads mt ON mt.id = mtm.thread_id
         WHERE mtm.memory_id = m.id
         ORDER BY mt.updated_at DESC LIMIT 1) as mail_subject
      FROM memories m
      LEFT JOIN projects p ON m.project_id = p.id
      WHERE m.status = 'active' ${ownerCondition}
    `).all(params) as { id: string; title: string; layer: string; tags: string | null; project_name: string | null }[];

    const entityRows = db.prepare(`
      SELECT me.memory_id, me.entity_id, e.name as entity_name
      FROM memory_entities me
      JOIN entities e ON e.id = me.entity_id
      JOIN memories m ON m.id = me.memory_id
      WHERE m.status = 'active' ${ownerCondition}
    `).all(params) as { memory_id: string; entity_id: string; entity_name: string }[];

    // 构建关系映射：每个记忆的直属关联记忆 ID 列表
    const relationsMap = new Map<string, string[]>();
    for (const rel of explicitRows) {
      if (!relationsMap.has(rel.source_memory_id)) relationsMap.set(rel.source_memory_id, []);
      if (!relationsMap.has(rel.target_memory_id)) relationsMap.set(rel.target_memory_id, []);
      relationsMap.get(rel.source_memory_id)!.push(rel.target_memory_id);
      relationsMap.get(rel.target_memory_id)!.push(rel.source_memory_id);
    }

    const usableTags = (raw: string | null) => safeParseTags(raw)
      .filter((tag): tag is string => typeof tag === 'string')
      .map(tag => cleanTag(tag.normalize('NFKC')))
      .filter(tag => isMeaningfulTag(tag) && !/^sensitivity:/i.test(tag));

    const nodes = rows.map(r => {
      const tags = usableTags(r.tags);
      const project = r.project_name?.trim() || undefined;
      return {
        id: r.id,
        title: r.title,
        summary: r.content.slice(0, 180),
        layer: r.layer,
        tags,
        project,
        valley: r.mail_subject || project || tags[0] || '独立记忆',
        updatedAt: r.updated_at,
        mailThreadId: r.mail_thread_id ?? undefined,
        relations: [...new Set(relationsMap.get(r.id) ?? [])],
      };
    });

    // 按节点对分组边，合并同一对节点间的多条关系
    const edgeMap = new Map<string, {
      source: string;
      target: string;
      relations: Array<{ type: string; strength: number; reason: string | null; direction: 'outgoing' | 'incoming' }>;
    }>();

    for (const rel of explicitRows) {
      const source = rel.source_memory_id;
      const target = rel.target_memory_id;
      // 用字典序键去重，确保同一对节点合并为一条边
      const [a, b] = source < target ? [source, target] : [target, source];
      const key = `${a}::${b}`;
      // direction: source_memory_id 是发起方 = outgoing
      const direction: 'outgoing' | 'incoming' = source === a ? 'outgoing' : 'incoming';
      const existing = edgeMap.get(key);
      if (existing) {
        existing.relations.push({ type: rel.relation_type, strength: rel.strength, reason: rel.reason, direction });
      } else {
        edgeMap.set(key, {
          source: a,
          target: b,
          relations: [{ type: rel.relation_type, strength: rel.strength, reason: rel.reason, direction }],
        });
      }
    }

    // 计算每条边的聚合字段
    const edges = Array.from(edgeMap.values()).map(e => {
      const typeCounts = new Map<string, number>();
      let totalStrength = 0;
      for (const r of e.relations) {
        typeCounts.set(r.type, (typeCounts.get(r.type) ?? 0) + 1);
        totalStrength += r.strength;
      }
      let mostCommonType = e.relations[0].type;
      let maxCount = 0;
      for (const [type, count] of typeCounts) {
        if (count > maxCount) { mostCommonType = type; maxCount = count; }
      }
      return {
        source: e.source,
        target: e.target,
        type: mostCommonType,
        weight: e.relations.length,
        label: mostCommonType,
        strength: totalStrength / e.relations.length,
        direction: e.relations[0].direction,
        relations: e.relations,
      };
    });

    return { nodes, edges, nodesCount: nodes.length };
  });

  app.get('/api/graph/tag-cloud', async (request) => {
    const db = getDatabase();
    const caller = getCaller(request);
    const ownerCondition = callerIsAdminOrAnonymous(caller)
      ? ''
      : 'AND (m.owner_user_id = @ownerUserId OR m.owner_user_id IS NULL)';
    const params: Record<string, unknown> = {};
    if (!callerIsAdminOrAnonymous(caller) && caller) {
      params.ownerUserId = caller.userId;
    }

    const rows = db.prepare(`
      SELECT m.tags, m.layer, m.updated_at, p.name as project_name
      FROM memories m
      LEFT JOIN projects p ON m.project_id = p.id
      WHERE m.status = 'active' ${ownerCondition}
    `).all(params) as { tags: string | null; layer: string; project_name: string | null }[];

    const totalMemories = rows.length;

    const tagData = new Map<string, { name: string; count: number; layers: Record<string, number>; lastUsedAt: string; aliases: Set<string> }>();
    const suspectData = new Map<string, { name: string; count: number; reason: string }>();
    for (const r of rows) {
      const tags: string[] = safeParseTags(r.tags);
      for (const rawTag of tags) {
        if (typeof rawTag !== 'string') continue;
        const tag = cleanTag(rawTag.normalize('NFKC')).replace(/\s+/g, ' ');
        const looksCorrupted = /[�]|锟斤拷|ï¿½|Ã.|Â./i.test(tag);
        const isSystemTag = /^sensitivity:/i.test(tag);
        if (!tag || looksCorrupted || isSystemTag || !isMeaningfulTag(tag)) {
          const reason = looksCorrupted
            ? '疑似乱码'
            : isSystemTag
              ? '系统内部标签'
              : '不符合标签规则';
          const key = tag.toLocaleLowerCase() || rawTag;
          const suspect = suspectData.get(key);
          if (suspect) suspect.count += 1;
          else suspectData.set(key, { name: tag || rawTag, count: 1, reason });
          continue;
        }

        const key = tag.toLocaleLowerCase();
        const existing = tagData.get(key);
        if (existing) {
          existing.count += 1;
          existing.layers[r.layer] = (existing.layers[r.layer] || 0) + 1;
          existing.aliases.add(tag);
        } else {
          tagData.set(key, { name: tag, count: 1, layers: { [r.layer]: 1 }, lastUsedAt: r.updated_at, aliases: new Set([tag]) });
        }
      }
    }

    const tags = Array.from(tagData.values())
      .map(data => ({ name: data.name, count: data.count, layers: data.layers, lastUsedAt: data.lastUsedAt, aliases: [...data.aliases] }))
      .sort((a, b) => b.count - a.count);

    const suspectTags = Array.from(suspectData.values()).sort((a, b) => b.count - a.count);

    const projectData = new Map<string, number>();
    for (const r of rows) {
      if (r.project_name && !isPlaceholderProjectName(r.project_name)) {
        projectData.set(r.project_name, (projectData.get(r.project_name) || 0) + 1);
      }
    }

    const projects = Array.from(projectData.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return { tags, suspectTags, projects, totalMemories };
  });

  app.get('/api/memories/:id/versions', async (request) => {
    const { id } = request.params as { id: string };
    return listVersions(id);
  });

  app.get('/api/memories/:id/versions/:version', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const result = getVersion(id, parseInt(version));
    if (!result) {
      return { error: 'Version not found' };
    }
    return result;
  });

  app.post('/api/memories/:id/versions/:version/revert', async (request) => {
    const { id, version } = request.params as { id: string; version: string };
    const { reason } = request.body as { reason?: string };
    const result = revertToVersion(id, parseInt(version), reason);
    if (!result) {
      return { error: 'Failed to revert' };
    }
    return result;
  });

  app.post('/api/memories/batch/create', async (request) => {
    const inputs = request.body as CreateMemoryInput[];
    return batchCreateMemories(inputs);
  });

  app.post('/api/memories/batch/update', async (request) => {
    const updates = request.body as { id: string; input: UpdateMemoryInput }[];
    return batchUpdateMemories(updates);
  });

  app.post('/api/memories/batch/delete', async (request) => {
    const { ids, permanent } = request.body as { ids: string[]; permanent?: boolean };
    return batchDeleteMemories(ids, permanent);
  });

  app.get('/api/memories/export', async (request, reply) => {
    // 导出全库属于敏感操作,限 admin。非 admin 调用直接 403。
    if (!requireAdmin(reply, getCaller(request))) return;
    const query = request.query as Record<string, string>;
    const layer = query.layer as Layer | undefined;
    const status = query.status as MemoryStatus | undefined;
    return exportMemoriesAsJson({ layer, status });
  });

  app.post('/api/memories/import', async (request, reply) => {
    // 导入属于敏感操作,限 admin
    if (!requireAdmin(reply, getCaller(request))) return;
    const { data } = request.body as { data: string };
    return importMemories(data);
  });

  app.get('/api/memories/duplicates', async (request) => {
    const query = request.query as Record<string, string>;
    const threshold = parseFloat(query.threshold) || 0.9;
    const limit = parseInt(query.limit) || 20;
    return findDuplicateMemories(threshold, limit);
  });

  app.get('/api/memories/:id/entities', async (request) => {
    const { id } = request.params as { id: string };
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT e.* FROM entities e
      JOIN memory_entities me ON e.id = me.entity_id
      WHERE me.memory_id = ?
      ORDER BY e.name
    `).all(id) as Record<string, unknown>[];
    
    return rows.map(r => ({
      id: r.id as string,
      name: r.name as string,
      type: r.type as string,
      properties: r.properties ? JSON.parse(r.properties as string) : undefined,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  });

  app.post('/api/consolidation/plan', async () => {
    return planConsolidation();
  });

  app.post('/api/consolidation/execute', async (request) => {
    const { planId } = request.body as { planId: string };
    if (!planId) return { error: 'planId is required' };
    try {
      return executeConsolidation(planId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.post('/api/consolidation/auto', async () => {
    return runAutoConsolidation();
  });

  app.post('/api/consolidation/rollback', async (request) => {
    const { planId, actionIds } = request.body as { planId: string; actionIds?: string[] };
    if (!planId) return { error: 'planId is required' };
    try {
      return rollbackConsolidation(planId, actionIds);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.get('/api/consolidation/plans', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    return listConsolidationPlans(limit);
  });

  app.get('/api/consolidation/plans/:planId', async (request) => {
    const { planId } = request.params as { planId: string };
    const plan = getConsolidationPlan(planId);
    if (!plan) return { error: 'Plan not found' };
    return plan;
  });

  app.get('/api/consolidation/plans/:planId/snapshots', async (request) => {
    const { planId } = request.params as { planId: string };
    return getConsolidationSnapshots(planId);
  });

  app.post('/api/dream/run', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    try {
      const report = await runDreamCycleAsync();
      if (report.status === 'failed') {
        reply.code(500);
      } else {
        updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
      }
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/dream/reports', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    return listDreamReports(limit);
  });

  app.get('/api/dream/reports/:reportId', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    const report = getDreamReport(reportId);
    if (!report) return { error: 'Report not found' };
    return report;
  });

  app.get('/api/dream/reports/:reportId/signals', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    return getDreamSignalsForReport(reportId);
  });

  app.post('/api/dream/rollback/:reportId', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    try {
      return rollbackDream(reportId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.delete('/api/dream/reports/:reportId', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    const result = deleteDreamReport(reportId);
    if (!result.success) {
      reply.code(404);
      return { error: 'Report not found' };
    }
    return { success: true };
  });

  app.get('/api/dream/todos', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return { todos: getPendingTodosForContext(limit) };
  });

  // 解决冲突 todo 项
  app.post('/api/dream/conflicts/resolve', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as {
      memoryId: string;
      targetId: string;
      action: 'keep_memory' | 'keep_target' | 'merge_into_memory' | 'merge_into_target' | 'delete_memory' | 'delete_target';
      title?: string;
      content?: string;
      tags?: string[];
    };
    if (!body.memoryId || !body.targetId || !body.action) {
      reply.code(400);
      return { success: false, message: '缺少 memoryId / targetId / action' };
    }
    const result = resolveConflict(body.memoryId, body.targetId, body.action, {
      title: body.title,
      content: body.content,
      tags: body.tags,
    });
    if (!result.success) reply.code(400);
    return result;
  });

  // Project Suggestion routes
  app.get('/api/project-suggestions', async (request) => {
    const query = request.query as Record<string, string>;
    const suggestions = listProjectSuggestions(query.status as 'pending' | 'accepted' | 'rejected' | undefined);
    const caller = getCaller(request);
    if (callerIsAdminOrAnonymous(caller)) return suggestions;
    // member/exec/pm:只看涉及自己拥有项目(或 owner 为 NULL 的旧项目)的建议
    const db = getDatabase();
    const uid = caller!.userId;
    return suggestions.filter((s) => {
      if (!s.projectIds || s.projectIds.length === 0) return true;
      const placeholders = s.projectIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT owner_user_id FROM projects WHERE id IN (${placeholders})`).all(...s.projectIds) as { owner_user_id: string | null }[];
      // 至少一个项目是该 caller 拥有或 owner 为 NULL(旧数据)时保留
      return rows.some(r => !r.owner_user_id || r.owner_user_id === uid);
    });
  });

  app.post('/api/project-suggestions/:id/accept', async (request, reply) => {
    // 项目结构调整,限 admin
    if (!requireAdmin(reply, getCaller(request))) return;
    const { id } = request.params as { id: string };
    const body = request.body as { customName?: string };
    const result = acceptProjectSuggestion(id, body?.customName);
    if (!result.success) {
      reply.code(400);
      return { error: result.error };
    }
    return result;
  });

  app.post('/api/project-suggestions/:id/reject', async (request, reply) => {
    // 项目结构调整,限 admin
    if (!requireAdmin(reply, getCaller(request))) return;
    const { id } = request.params as { id: string };
    const ok = rejectProjectSuggestion(id);
    if (!ok) {
      reply.code(400);
      return { error: 'Suggestion not found or already processed' };
    }
    return { success: true };
  });

  app.get('/api/recycle-bin', async (request) => {
    const query = request.query as Record<string, string>;
    return listRecycleBin({
      layer: query.layer as Layer | undefined,
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  });

  app.post('/api/recycle-bin/:id/restore', async (request, reply) => {
    const { id } = request.params as { id: string };
    const mem = restoreFromRecycleBin(id);
    if (!mem) {
      reply.code(404);
      return { error: 'Memory not found or already active' };
    }
    return mem;
  });

  app.delete('/api/recycle-bin/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const ok = permanentlyDeleteMemory(id);
    if (!ok) {
      reply.code(404);
      return { error: 'Memory not found' };
    }
    return { success: true };
  });

  app.post('/api/memories/:id/relate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { targetId, relationType, strength, reason } = request.body as { targetId: string; relationType: string; strength?: number; reason?: string };
    if (!targetId || !relationType) {
      reply.code(400);
      return { error: 'targetId and relationType are required' };
    }
    if (!MEMORY_RELATION_TYPES.includes(relationType as typeof MEMORY_RELATION_TYPES[number])) {
      reply.code(400);
      return { error: `relationType must be one of: ${MEMORY_RELATION_TYPES.join(', ')}` };
    }
    try {
      if (!getVisibleMemoryForRequest(request, id)) {
        reply.code(404);
        return { error: `Memory not found or not accessible: ${id}` };
      }
      if (!getVisibleMemoryForRequest(request, targetId)) {
        reply.code(404);
        return { error: `Memory not found or not accessible: ${targetId}` };
      }
      const relation = createMemoryRelation(id, targetId, relationType, strength ?? 1.0, reason);
      return relation;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/memories/:id/related', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    if (!getVisibleMemoryForRequest(request, id)) {
      reply.code(404);
      return { error: `Memory not found or not accessible: ${id}` };
    }
    return findRelatedMemories(id, query.type)
      .filter(related => Boolean(getVisibleMemoryForRequest(request, related.memoryId)));
  });

  app.post('/api/memories/:id/supersede', async (request, reply) => {
    const { id: targetId } = request.params as { id: string };
    const { sourceId, effectiveAt, reason } = request.body as { sourceId?: string; effectiveAt?: string; reason?: string };
    if (!sourceId || !reason?.trim()) {
      reply.code(400);
      return { error: 'sourceId and reason are required' };
    }
    if (!getVisibleMemoryForRequest(request, sourceId) || !getVisibleMemoryForRequest(request, targetId)) {
      reply.code(404);
      return { error: 'Memory not found or not accessible' };
    }
    try {
      return supersedeMemory(sourceId, targetId, { effectiveAt, reason });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/tags/namespaces', async () => {
    const db = getDatabase();
    const rows = db.prepare(`SELECT tags FROM memories WHERE status = 'active' AND tags IS NOT NULL`).all() as { tags: string }[];
    const namespaces = new Map<string, Set<string>>();
    for (const row of rows) {
      const tags: string[] = safeParseTags(row.tags);
      for (const tag of tags) {
        if (tag.includes(':')) {
          const [ns, value] = tag.split(':', 2);
          if (!namespaces.has(ns)) namespaces.set(ns, new Set());
          namespaces.get(ns)!.add(value);
        }
      }
    }
    return Object.fromEntries(
      Array.from(namespaces.entries()).map(([k, v]) => [k, Array.from(v).sort()])
    );
  });

  // ===== LLM Provider 配置 API =====
  // 用户在 Web UI 填写 baseUrl + apiKey → 点检测 → 拉模型 → 下拉选 → 保存
  // 注意：apiKey 可选（本地 Ollama 模型不需要 key）

  app.get('/api/llm/config', async () => {
    return getLLMConfig();
  });

  app.post('/api/llm/config', async (request, reply) => {
    const body = request.body as { baseUrl: string; apiKey?: string; model: string; enabled: boolean; availableModels?: string[] };
    if (!body.baseUrl) {
      reply.code(400);
      return { error: 'baseUrl is required' };
    }
    return saveLLMConfig({
      baseUrl: body.baseUrl,
      model: body.model || '',
      enabled: body.enabled ?? true,
    }, body.apiKey, body.availableModels);
  });

  app.post('/api/llm/verify', async (request) => {
    const body = request.body as { baseUrl?: string; apiKey?: string };
    const result = await verifyLLMConnection(body.baseUrl, body.apiKey);
    if (result.ok) {
      saveLLMVerifyResult(result);
    }
    return result;
  });

  app.get('/api/llm/models', async (request) => {
    const query = request.query as Record<string, string>;
    const baseUrl = query.baseUrl;
    // API Key 不允许出现在 URL 查询参数中，避免被访问日志、历史记录或代理层保留。
    // 此兼容读接口只能使用与 baseUrl 匹配的已保存密钥；新界面使用 POST /api/llm/verify。
    const result = await verifyLLMConnection(baseUrl);
    return { ok: result.ok, models: result.models, error: result.error };
  });

  app.delete('/api/llm/config', async () => {
    const ok = clearLLMConfig();
    return { success: ok };
  });

  app.get('/api/llm/status', async () => {
    return {
      available: isLLMAvailable(),
      config: getLLMConfig(),
    };
  });

  // ===== Relation reasoning & project handoff API =====

  app.post('/api/relation-reasoning/run', async (request, reply) => {
    try {
      const report = await runRelationReasonerBatch();
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/relation-reasoning/stats', async () => {
    return getScanStats();
  });

  app.post('/api/relation-reasoning/reset', async (request) => {
    const body = request.body as { memoryId?: string; all?: boolean };
    if (body.all) {
      const count = resetAllScanStatus();
      return { success: true, reset: count };
    }
    if (body.memoryId) {
      const ok = resetScanStatus(body.memoryId);
      return { success: ok };
    }
    return { success: false, error: 'Provide memoryId or all=true' };
  });

  app.post('/api/project-handoff/run', async (request, reply) => {
    try {
      const report = scanProjectJournalInjections();
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/project-handoff/injections', async (request) => {
    const query = request.query as Record<string, string>;
    const status = query.status as 'pending' | 'injected' | 'logged' | undefined;
    return listInjections(status);
  });

  app.get('/api/project-handoff/stats', async () => {
    return getInjectionStats();
  });

  app.post('/api/project-handoff/reset/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const ok = resetInjection(projectId);
    return { success: ok };
  });

  // Project routes
  app.get('/api/projects', async (request) => {
    const caller = getCaller(request);
    const projects = listProjects();
    return filterMemoriesByOwner(projects, caller, 'projects');
  });

  app.post('/api/projects', async (request, reply) => {
    const input = request.body as { name: string; parentId?: string | null; description?: string };
    if (!input.name) {
      reply.code(400);
      return { error: 'Project name is required' };
    }
    // 透传 caller userId 到 createProject,使项目写入 owner_user_id
    const caller = getCaller(request);
    const project = createProject({ ...input, ...(caller?.userId ? { ownerUserId: caller.userId } : {}) });
    reply.code(201);
    return project;
  });

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = getProject(id);
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return project;
  });

  app.put('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = request.body as { name?: string; description?: string };
    const project = updateProject(id, input);
    if (!project) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return project;
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    const strategy = query.strategy === 'promote' ? 'promote' : 'cascade';
    const ok = deleteProject(id, strategy);
    if (!ok) {
      reply.code(404);
      return { error: 'Project not found' };
    }
    return { success: true };
  });

  app.post('/api/projects/:id/move', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { parentId } = request.body as { parentId?: string | null };
    const project = moveProject(id, parentId ?? null);
    if (!project) {
      reply.code(400);
      return { error: 'Invalid move' };
    }
    return project;
  });

  app.get('/api/projects/:id/children', async (request, reply) => {
    const { id } = request.params as { id: string };
    const caller = getCaller(request);
    return filterMemoriesByOwner(listProjects(id), caller, 'projects');
  });

  app.get('/api/projects/:id/descendants', async (request, reply) => {
    const { id } = request.params as { id: string };
    return getProjectDescendants(id);
  });

  app.get('/api/projects/:id/path', async (request, reply) => {
    const { id } = request.params as { id: string };
    return getProjectPath(id);
  });

  app.get('/api/projects/:id/memories', async (request) => {
    const { id } = request.params as { id: string };
    const query = request.query as Record<string, string>;
    return getProjectMemories(id, {
      layer: query.layer,
      includeDescendants: query.includeDescendants === 'true',
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      offset: query.offset ? parseInt(query.offset, 10) : undefined,
    });
  });

  app.get('/api/scheduler/config', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    return getSchedulerConfig();
  });

  app.post('/api/scheduler/config', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const updates = request.body as Record<string, unknown>;
    try {
      const result = updateSchedulerConfig(updates);
      restartScheduler();
      return result;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}
