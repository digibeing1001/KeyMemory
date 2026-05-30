import Fastify from 'fastify';
import cors from '@fastify/cors';
import { registerRoutes } from './api/rest.js';
import { registerMCPRoutes } from './api/mcp.js';
import { initDatabase, closeDatabase } from './db/sqlite.js';
import { initEmbedding } from './embed/onnx.js';
import { DEFAULT_PORT, DEFAULT_HOST } from '@keymemory/shared';
import { runDailyInspection } from './core/evolution.js';
import { applyDecay } from './core/forgetting.js';
import { startScheduler, stopScheduler } from './core/scheduler.js';
import { registerWebUI } from './web-ui.js';
import { assertSafeServerBinding, createCorsOriginPolicy } from './core/security.js';

async function main() {
  initDatabase();

  try {
    await initEmbedding();
  } catch (err) {
    console.warn('Embedding initialization failed (semantic search unavailable):', (err as Error).message);
  }

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: createCorsOriginPolicy() });

  registerRoutes(app);
  registerMCPRoutes(app);
  registerWebUI(app);

  try {
    assertSafeServerBinding(DEFAULT_HOST);
    await app.listen({ port: DEFAULT_PORT, host: DEFAULT_HOST });
    console.log(`KeyMemory server running at http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const dailyTimer = setInterval(async () => {
    try {
      await runDailyInspection();
      applyDecay();
    } catch (err) {
      console.error('Daily maintenance failed:', (err as Error).message);
    }
  }, 86400000);

  startScheduler();

  const shutdown = () => {
    clearInterval(dailyTimer);
    stopScheduler();
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
