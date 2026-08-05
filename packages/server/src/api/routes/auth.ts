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
  isValidEmail,
  MIN_PASSWORD_LENGTH,
} from '../../core/auth.js';
import { extractRequestToken } from '../../core/security.js';
import { getCaller, requireAdmin } from './shared.js';

const VALID_USER_ROLES: UserRole[] = ['boss', 'exec', 'pm', 'member', 'admin'];

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get('/api/auth/status', async () => ({ hasUsers: hasAnyUser() }));

  // 注册:
  // - 系统尚无任何用户时,首个注册者自动成为 boss(主账户),无需鉴权
  // - 已有用户时,需 boss/admin token 才能注册新成员
  app.post('/api/auth/register', async (request, reply) => {
    const body = request.body as { name?: string; email?: string; password?: string; role?: UserRole };
    const name = body.name?.trim() ?? '';
    const email = body.email?.trim() ?? '';
    const password = body.password ?? '';
    if (!name || !email || !password) {
      reply.code(400);
      return { error: 'Name, email, and password are required', code: 'AUTH_REQUIRED_FIELDS' };
    }
    if (!isValidEmail(email)) {
      reply.code(400);
      return { error: 'Enter a valid email address', code: 'AUTH_INVALID_EMAIL' };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      reply.code(400);
      return {
        error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        code: 'AUTH_PASSWORD_TOO_SHORT',
      };
    }
    const noUserYet = !hasAnyUser();
    const caller = getCaller(request);
    if (!noUserYet) {
      // 已有用户:必须有 boss/admin 权限
      if (!requireAdmin(reply, caller)) return;
      if (body.role && !VALID_USER_ROLES.includes(body.role)) {
        reply.code(400);
        return { error: `Role must be one of: ${VALID_USER_ROLES.join(', ')}`, code: 'AUTH_INVALID_ROLE' };
      }
    }
    const role: UserRole = noUserYet ? 'boss' : (body.role ?? 'member');
    try {
      const user = createUser({
        name,
        email,
        password,
        role,
        isMainAccount: noUserYet,
      });
      const session = createSession(user.id);
      reply.code(201);
      return { token: session.token, expiresAt: session.expiresAt, user };
    } catch (err) {
      reply.code(409);
      const message = (err as Error).message;
      const duplicate = message.includes('UNIQUE constraint failed: users.email');
      return {
        error: duplicate ? 'An account with this email already exists' : 'Unable to create account',
        code: duplicate ? 'AUTH_EMAIL_EXISTS' : 'AUTH_REGISTRATION_FAILED',
      };
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { email?: string; password?: string };
    const email = body.email?.trim() ?? '';
    const password = body.password ?? '';
    if (!email || !password) {
      reply.code(400);
      return { error: 'Email and password are required', code: 'AUTH_REQUIRED_FIELDS' };
    }
    if (!isValidEmail(email)) {
      reply.code(400);
      return { error: 'Enter a valid email address', code: 'AUTH_INVALID_EMAIL' };
    }
    const user = authenticateUser(email, password);
    if (!user) {
      reply.code(401);
      return { error: 'Invalid email or password', code: 'AUTH_INVALID_CREDENTIALS' };
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
    if (!VALID_USER_ROLES.includes(body.role)) {
      reply.code(400);
      return { error: `role must be one of: ${VALID_USER_ROLES.join(', ')}` };
    }
    const updated = updateUserRole(id, body.role);
    if (!updated) {
      reply.code(404);
      return { error: 'User not found' };
    }
    return { user: updated };
  });
}
