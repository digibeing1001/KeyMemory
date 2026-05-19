import type { FastifyInstance } from 'fastify';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
};

const CACHE_MAX_AGE = 3600;
const IMMUTABLE_MAX_AGE = 31536000;

function getWebDistDir(): string {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(__dirname, '../../web/dist');
}

export function registerWebUI(app: FastifyInstance): boolean {
  const webDistDir = getWebDistDir();
  const webDistExists = fs.existsSync(webDistDir) && fs.existsSync(path.join(webDistDir, 'index.html'));

  if (!webDistExists) {
    console.log('Web UI not found (build packages/web first for Web UI support)');
    app.setNotFoundHandler((request, reply) => {
      reply.code(404).send({ error: 'Not found' });
    });
    return false;
  }

  const fileCache = new Map<string, { content: Buffer; contentType: string; cacheControl: string; mtime: number }>();

  app.setNotFoundHandler((request, reply) => {
    const urlPath = request.url.split('?')[0];

    if (urlPath.startsWith('/api')) {
      reply.code(404).send({ error: 'Not found' });
      return;
    }

    const filePath = path.join(webDistDir, urlPath === '/' ? 'index.html' : urlPath);
    const safePath = path.normalize(filePath);

    if (!safePath.startsWith(webDistDir)) {
      reply.code(403).send('Forbidden');
      return;
    }

    try {
      const stat = fs.statSync(safePath);
      if (!stat.isFile()) {
        throw new Error('not a file');
      }

      const ext = path.extname(safePath);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';

      const isImmutableAsset = /\.[\w]{8}\.(js|css|mjs|woff2?|ttf|webp|png|jpe?g|svg|ico)$/.test(urlPath);
      const cacheControl = isImmutableAsset
        ? `public, max-age=${IMMUTABLE_MAX_AGE}, immutable`
        : `public, max-age=${CACHE_MAX_AGE}`;

      const cached = fileCache.get(safePath);
      if (cached && cached.mtime === stat.mtimeMs) {
        reply
          .type(cached.contentType)
          .header('Cache-Control', cached.cacheControl)
          .send(cached.content);
        return;
      }

      const content = fs.readFileSync(safePath);
      fileCache.set(safePath, { content, contentType, cacheControl, mtime: stat.mtimeMs });

      if (fileCache.size > 200) {
        const firstKey = fileCache.keys().next().value;
        if (firstKey) fileCache.delete(firstKey);
      }

      reply
        .type(contentType)
        .header('Cache-Control', cacheControl)
        .send(content);
    } catch {
      const indexPath = path.join(webDistDir, 'index.html');
      const indexContent = fs.readFileSync(indexPath);
      reply
        .type('text/html; charset=utf-8')
        .header('Cache-Control', 'public, max-age=0, must-revalidate')
        .send(indexContent);
    }
  });

  console.log(`Web UI served from ${webDistDir}`);
  return true;
}
