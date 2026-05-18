import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './api/rest.js';
import { registerMCPRoutes } from './api/mcp.js';
import { initDatabase } from './db/sqlite.js';
import { initEmbedding } from './embed/onnx.js';
import { DEFAULT_PORT, DEFAULT_HOST } from '@keymemory/shared';
import { runDailyInspection } from './core/evolution.js';
import { applyDecay } from './core/forgetting.js';
import { startScheduler } from './core/scheduler.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

async function main() {
  initDatabase();

  try {
    await initEmbedding();
  } catch (err) {
    console.warn('Embedding initialization failed (semantic search unavailable):', (err as Error).message);
  }

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  registerRoutes(app);
  registerMCPRoutes(app);

  const webDistDir = path.resolve(__dirname, '../../web/dist');
  const webDistExists = fs.existsSync(webDistDir) && fs.existsSync(path.join(webDistDir, 'index.html'));

  if (webDistExists) {
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

      if (fs.existsSync(safePath) && fs.statSync(safePath).isFile()) {
        const ext = path.extname(safePath);
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        reply.type(contentType).send(fs.readFileSync(safePath));
        return;
      }

      reply.type('text/html; charset=utf-8').send(fs.readFileSync(path.join(webDistDir, 'index.html')));
    });

    console.log(`Web UI served from ${webDistDir}`);
  } else {
    console.log('Web UI not found (build packages/web first for Web UI support)');
    app.setNotFoundHandler((request, reply) => {
      reply.code(404).send({ error: 'Not found' });
    });
  }

  try {
    await app.listen({ port: DEFAULT_PORT, host: DEFAULT_HOST });
    console.log(`KeyMemory server running at http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  setInterval(async () => {
    try {
      await runDailyInspection();
      applyDecay();
    } catch {}
  }, 86400000);

  startScheduler();
}

main();
