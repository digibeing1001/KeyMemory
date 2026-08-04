/**
 * KM-410：REST 路由共享辅助函数。
 * rest.ts 按资源域拆分为 routes/*.ts，本模块承载跨域复用的
 * 鉴权/隔离/安全辅助，避免每个路由文件重复实现。
 */
import type { FastifyRequest } from 'fastify';
import path from 'path';
import type { IsolationMode } from '@keymemory/shared';
import type { UserRole, CallerContext } from '../../core/auth.js';
import { getDatabase } from '../../db/sqlite.js';
import { getMemory } from '../../core/atom.js';
import { visibleSpacesFor } from '../../adapters/base.js';
import { DEFAULT_HUMAN_ID } from '../../core/mailbox.js';
import { createBackupFile } from '../../core/backup.js';
import type { BackupSummary } from '../../core/backup.js';

/**
 * 校验导入路径安全性，防止 null byte 注入和明显的路径攻击
 */
export function assertSafeImportPath(filePath: string): void {
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

export function safeParseTags(tags: string | null): string[] {
  if (!tags) return [];
  try {
    const parsed = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function isPlaceholderProjectName(name: string | null): boolean {
  if (!name) return true;
  return /^(未分类|未归类|默认|公共记忆|uncategorized|unclassified|default|inbox)$/i.test(name.trim());
}

export function createMigrationBackup(shouldCreate: boolean | undefined, dryRun: boolean | undefined): BackupSummary | undefined {
  if (!shouldCreate || dryRun) return undefined;
  return createBackupFile();
}

export function loopHttpStatus(code: string | undefined): number {
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
export function getCaller(request: FastifyRequest): CallerContext | undefined {
  return (request as any).user as CallerContext | undefined;
}

/**
 * 判断 caller 是否可看全部数据(boss/admin),或仅看自己 owner_user_id 的数据。
 * caller 为 undefined 时(匿名/旧模式)返回 true,保持旧行为(不过滤)。
 */
export function callerIsAdminOrAnonymous(caller: CallerContext | undefined): boolean {
  if (!caller) return true;
  return caller.role === 'boss' || caller.role === 'admin';
}

/**
 * 在 list 路由层对已映射的 Memory[] 做 owner_user_id 过滤:
 * - boss/admin/匿名 看全部(不过滤)
 * - member/exec/pm 只看 owner_user_id = 自己 id 的数据,以及 owner_user_id 为 NULL 的旧数据(向后兼容)
 */
export function filterMemoriesByOwner<T extends { id: string }>(items: T[], caller: CallerContext | undefined, table: 'memories' | 'projects' | 'loop_runs' = 'memories'): T[] {
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
export function filterRawRowsByOwner(rows: Record<string, unknown>[], caller: CallerContext | undefined): Record<string, unknown>[] {
  if (callerIsAdminOrAnonymous(caller)) return rows;
  const uid = caller!.userId;
  return rows.filter(r => {
    const owner = r.owner_user_id as string | null | undefined;
    return !owner || owner === uid;
  });
}

/**
 * 推导当前请求的邮箱身份：
 * - 携带 x-agent-id 头时视为 Agent 调用方，recipientId = agent:<id>，
 *   并按隔离模式限定可见 agent_spaces（复用 visibleSpacesFor，与 MCP 路径一致）；
 * - 否则视为人类调用方（Web UI / CLI），使用默认人类身份，不做空间限制。
 */
export function mailboxIdentityForRequest(request: FastifyRequest): { recipientId: string; agentSpaces?: string[] } {
  const agentId = (request.headers['x-agent-id'] as string | undefined)?.trim();
  if (agentId) {
    const isolationMode = (request.headers['x-isolation-mode'] as IsolationMode | undefined) ?? 'hybrid';
    const caller = getCaller(request);
    return {
      recipientId: `agent:${agentId}`,
      agentSpaces: visibleSpacesFor(agentId, isolationMode, caller?.userId),
    };
  }
  return { recipientId: DEFAULT_HUMAN_ID };
}

/**
 * 按当前请求身份读取一条记忆，并对 Agent 调用方强制 agent_space 可见性：
 * - 人类/匿名调用方：存在即返回；
 * - Agent 调用方（带 x-agent-id）：仅当记忆位于其可见空间集合内才返回，否则返回 null。
 * 路由据此判 404，避免跨空间探测他人私有记忆。
 */
export function getVisibleMemoryForRequest(request: FastifyRequest, memoryId: string): ReturnType<typeof getMemory> {
  const memory = getMemory(memoryId);
  if (!memory) return null;
  const agentId = (request.headers['x-agent-id'] as string | undefined)?.trim();
  if (!agentId) return memory;
  const isolationMode = (request.headers['x-isolation-mode'] as IsolationMode | undefined) ?? 'hybrid';
  const caller = getCaller(request);
  const spaces = visibleSpacesFor(agentId, isolationMode, caller?.userId);
  return spaces.includes(memory.agentSpace) ? memory : null;
}

export const ADMIN_ROLES: UserRole[] = ['boss', 'admin'];

export function requireAdmin(reply: any, caller: CallerContext | undefined): boolean {
  if (caller && ADMIN_ROLES.includes(caller.role)) return true;
  reply.code(403);
  reply.send({ error: 'Forbidden: admin or boss role required' });
  return false;
}
