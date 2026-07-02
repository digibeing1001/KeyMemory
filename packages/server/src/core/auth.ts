import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/sqlite.js';

export type UserRole = 'boss' | 'exec' | 'pm' | 'member' | 'admin';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  isMainAccount: boolean;
  userStatus: string;
  companyId: string | null;
}

export interface CallerContext {
  userId: string;
  role: UserRole;
  name: string;
  isMainAccount: boolean;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: string;
  is_main_account: number;
  user_status: string;
  company_id: string | null;
  created_at: string;
  updated_at: string;
}

interface SessionRow {
  id: string;
  user_id: string;
  token: string;
  created_at: string;
  expires_at: string;
  last_used_at: string | null;
}

const SESSION_TTL_DAYS = 30;
const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function nowIso(): string {
  return new Date().toISOString();
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function rowToUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as UserRole,
    isMainAccount: row.is_main_account === 1,
    userStatus: row.user_status,
    companyId: row.company_id,
  };
}

/**
 * 使用 scryptSync 对密码进行哈希。返回格式: `saltHex:hashHex`。
 */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * 校验密码。使用 timingSafeEqual 防止时序攻击。
 */
export function verifyPassword(plain: string, stored: string): boolean {
  if (!stored) return false;
  const sep = stored.indexOf(':');
  if (sep <= 0) return false;
  const saltHex = stored.slice(0, sep);
  const hashHex = stored.slice(sep + 1);
  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = crypto.scryptSync(plain, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

/**
 * 生成 256 位随机 token（hex 编码）。
 */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role?: UserRole;
  isMainAccount?: boolean;
  companyId?: string | null;
}

/**
 * 创建用户并写入 users 表。email 唯一，重复时抛错。
 */
export function createUser(input: CreateUserInput): AuthUser {
  const db = getDatabase();
  const id = uuidv4();
  const now = nowIso();
  const role: UserRole = input.role ?? 'member';
  const isMain = input.isMainAccount ? 1 : 0;
  const passwordHash = hashPassword(input.password);
  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, is_main_account, user_status, company_id, created_at, updated_at)
    VALUES (@id, @name, @email, @passwordHash, @role, @isMain, 'active', @companyId, @createdAt, @updatedAt)
  `).run({
    id,
    name: input.name,
    email: input.email,
    passwordHash,
    role,
    isMain,
    companyId: input.companyId ?? null,
    createdAt: now,
    updatedAt: now,
  });
  return {
    id,
    name: input.name,
    email: input.email,
    role,
    isMainAccount: isMain === 1,
    userStatus: 'active',
    companyId: input.companyId ?? null,
  };
}

/**
 * 校验邮箱+密码。返回用户或 null。
 */
export function authenticateUser(email: string, password: string): AuthUser | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE email = ? LIMIT 1').get(email) as UserRow | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return rowToUser(row);
}

export interface CreatedSession {
  token: string;
  expiresAt: string;
}

/**
 * 创建 session,有效期 30 天。返回 token 与过期时间。
 */
export function createSession(userId: string): CreatedSession {
  const db = getDatabase();
  const id = uuidv4();
  const token = generateToken();
  const now = nowIso();
  const expiresAt = isoPlusDays(SESSION_TTL_DAYS);
  db.prepare(`
    INSERT INTO sessions (id, user_id, token, created_at, expires_at, last_used_at)
    VALUES (@id, @userId, @token, @createdAt, @expiresAt, NULL)
  `).run({ id, userId, token, createdAt: now, expiresAt });
  return { token, expiresAt };
}

/**
 * 校验 token。检查过期,更新 last_used_at。返回 caller 上下文或 null。
 */
export function verifyToken(token: string): CallerContext | null {
  if (!token) return null;
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM sessions WHERE token = ? LIMIT 1').get(token) as SessionRow | undefined;
  if (!row) return null;
  const now = Date.now();
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now) {
    // 过期:清理掉这条 session
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
    } catch {
      // ignore
    }
    return null;
  }
  const userRow = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(row.user_id) as UserRow | undefined;
  if (!userRow) return null;
  if (userRow.user_status !== 'active') return null;

  // 更新 last_used_at(失败不影响鉴权结果)
  try {
    db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(nowIso(), row.id);
  } catch {
    // ignore
  }

  return {
    userId: userRow.id,
    role: userRow.role as UserRole,
    name: userRow.name,
    isMainAccount: userRow.is_main_account === 1,
  };
}

/**
 * 注销单个 session(删除 token)。
 */
export function revokeSession(token: string): void {
  const db = getDatabase();
  try {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  } catch {
    // ignore
  }
}

/**
 * 注销某用户的所有 session。
 */
export function revokeAllUserSessions(userId: string): void {
  const db = getDatabase();
  try {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  } catch {
    // ignore
  }
}

/**
 * 查 is_main_account=1 的用户。
 */
export function getMainAccount(): AuthUser | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE is_main_account = 1 LIMIT 1').get() as UserRow | undefined;
  if (!row) return null;
  return rowToUser(row);
}

/**
 * 查 users 表是否已有用户。
 */
export function hasAnyUser(): boolean {
  const db = getDatabase();
  const row = db.prepare('SELECT 1 FROM users LIMIT 1').get() as { 1: number } | undefined;
  return !!row;
}

export function getUserById(id: string): AuthUser | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE id = ? LIMIT 1').get(id) as UserRow | undefined;
  if (!row) return null;
  return rowToUser(row);
}

export interface ListedUser extends AuthUser {
  createdAt: string;
  updatedAt: string;
}

/**
 * 列出全部用户(给 admin/boss 用)。
 */
export function listAllUsers(): ListedUser[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as UserRow[];
  return rows.map(r => ({ ...rowToUser(r), createdAt: r.created_at, updatedAt: r.updated_at }));
}

/**
 * 更新用户角色。返回更新后的用户。
 */
export function updateUserRole(id: string, role: UserRole): AuthUser | null {
  const db = getDatabase();
  const existing = getUserById(id);
  if (!existing) return null;
  db.prepare('UPDATE users SET role = ?, updated_at = ? WHERE id = ?').run(role, nowIso(), id);
  return { ...existing, role };
}

/**
 * 启动时如果 users 表为空,根据 env KEYMEMORY_BOSS_EMAIL/KEYMEMORY_BOSS_PASSWORD 创建主账户。
 * 如果没有这些 env 则跳过(不强制)。
 */
export function ensureBootstrapMainAccount(): void {
  if (hasAnyUser()) return;
  const email = process.env.KEYMEMORY_BOSS_EMAIL;
  const password = process.env.KEYMEMORY_BOSS_PASSWORD;
  if (!email || !password) return;
  try {
    const name = process.env.KEYMEMORY_BOSS_NAME || '主账户';
    createUser({
      name,
      email,
      password,
      role: 'boss',
      isMainAccount: true,
    });
    console.error(`[KeyMemory] Bootstrap main account created: ${email}`);
  } catch (err) {
    console.error('[KeyMemory] Bootstrap main account failed:', (err as Error).message);
  }
}
