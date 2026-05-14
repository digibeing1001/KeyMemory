import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { registerRoutes } from './api/rest.js';
import { registerMCPRoutes } from './api/mcp.js';
import { initDatabase } from './db/sqlite.js';
import { initEmbedding } from './embed/onnx.js';
import { DEFAULT_PORT, DEFAULT_HOST } from '@keymemory/shared';
import { runDailyInspection } from './core/evolution.js';
import { applyDecay } from './core/forgetting.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
  if (fs.existsSync(webDistDir)) {
    await app.register(fastifyStatic, {
      root: webDistDir,
      prefix: '/',
      wildcard: false,
    });

    app.setNotFoundHandler((request, reply) => {
      if (!request.url.startsWith('/api')) {
        reply.type('text/html').send(fs.readFileSync(path.join(webDistDir, 'index.html')));
      } else {
        reply.code(404).send({ error: 'Not found' });
      }
    });

    console.log(`Web UI served from ${webDistDir}`);
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
}

main();
