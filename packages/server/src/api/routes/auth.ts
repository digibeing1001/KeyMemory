/**
 * KM-410：鉴权与用户路由（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import type { UserRole } from '../../core/auth.js';
import {
  authenticateUser,
  createSession,
  createUser,
  revokeSession,
  listAllUsers,
  updateUserRole,
  hasAnyUser,
  getUserById,
} from '../../core/auth.js';
import { extractRequestToken } from '../../core/security.js';
import { getCaller, requireAdmin } from './shared.js';

export function registerAuthRoutes(app: FastifyInstance): void {
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
}
