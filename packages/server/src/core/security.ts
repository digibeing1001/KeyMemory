import { verifyToken } from './auth.js';
import type { CallerContext } from './auth.js';

function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
}

import { timingSafeEqual } from 'crypto';

/**
 * 时序安全的字符串比较，防止基于响应时间差异的侧信道攻击。
 * 当两个字符串长度不同时，先比较长度（不泄漏内容信息），
 * 然后用 timingSafeEqual 比较内容部分。
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

export function isLoopbackHost(host: string): boolean {
  const normalized = cleanHost(host);
  return normalized === 'localhost'
    || normalized === '::1'
    || normalized.startsWith('127.');
}

export function assertSafeServerBinding(host: string): void {
  if (isLoopbackHost(host)) return;
  if (process.env.KEYMEMORY_API_KEY) return;

  throw new Error(
    `Refusing to bind KeyMemory to non-loopback host "${host}" without KEYMEMORY_API_KEY. ` +
    'Use 127.0.0.1 for local-only access or set KEYMEMORY_API_KEY before exposing the server.',
  );
}

type HeaderValue = string | string[] | undefined;

function firstHeaderValue(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function extractRequestApiKey(headers: Record<string, HeaderValue>): string | undefined {
  const explicitKey = firstHeaderValue(headers['x-api-key'])?.trim();
  if (explicitKey) return explicitKey;

  const authorization = firstHeaderValue(headers.authorization)?.trim();
  if (!authorization) return undefined;

  const bearerPrefix = 'Bearer ';
  if (authorization.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length).trim();
  }
  return undefined;
}

/**
 * 从 `Authorization: Bearer <token>` 或 `x-user-token` header 提取 user token。
 * 与 extractRequestApiKey 区分:后者用于旧的全局 API key,前者用于 per-user token。
 */
export function extractRequestToken(headers: Record<string, HeaderValue>): string | undefined {
  const userToken = firstHeaderValue(headers['x-user-token'])?.trim();
  if (userToken) return userToken;

  const authorization = firstHeaderValue(headers.authorization)?.trim();
  if (!authorization) return undefined;

  const bearerPrefix = 'Bearer ';
  if (authorization.startsWith(bearerPrefix)) {
    return authorization.slice(bearerPrefix.length).trim();
  }
  return undefined;
}

export function isApiRequestAuthorized(headers: Record<string, HeaderValue>): boolean {
  const configuredKey = process.env.KEYMEMORY_API_KEY;
  if (!configuredKey) return true;
  const requestKey = extractRequestApiKey(headers);
  if (!requestKey) return false;
  return timingSafeStringEqual(requestKey, configuredKey);
}

export function shouldAuthenticateHttpPath(path: string): boolean {
  return path === '/mcp' || path === '/api' || path.startsWith('/api/');
}

/**
 * 不需要鉴权的路径白名单。这些路径在 preHandler 中跳过 caller 解析与 401 拦截。
 */
const PUBLIC_PATHS = new Set<string>([
  '/api/auth/login',
  '/api/auth/register',
  '/api/health',
]);

export function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

/**
 * 解析调用者上下文。先尝试 per-user token 鉴权,失败则返回 null。
 * 上层(preHandler)决定 null 时是否放行:公开路径放行,其他路径 fallback 到旧 API key 模式或返回 401。
 *
 * 注意:此函数不处理旧 API key 的放行逻辑(那是 isApiRequestAuthorized 的职责)。
 * 它只负责"如果带了 user token,解析出 caller"。
 */
export function resolveCaller(headers: Record<string, HeaderValue>): CallerContext | null {
  const token = extractRequestToken(headers);
  if (!token) return null;
  return verifyToken(token);
}

function configuredOrigins(): string[] {
  return (process.env.KEYMEMORY_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function isCorsOriginAllowed(origin?: string): boolean {
  if (!origin) return true;

  const explicit = configuredOrigins();
  if (explicit.includes('*')) return true;
  if (explicit.includes(origin)) return true;

  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

export function createCorsOriginPolicy(): (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => void {
  return (origin, callback) => {
    callback(null, isCorsOriginAllowed(origin));
  };
}
