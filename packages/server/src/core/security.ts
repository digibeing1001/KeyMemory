function cleanHost(host: string): string {
  return host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
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

export function isApiRequestAuthorized(headers: Record<string, HeaderValue>): boolean {
  const configuredKey = process.env.KEYMEMORY_API_KEY;
  if (!configuredKey) return true;
  return extractRequestApiKey(headers) === configuredKey;
}

export function shouldAuthenticateHttpPath(path: string): boolean {
  return path === '/mcp' || path === '/api' || path.startsWith('/api/');
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
