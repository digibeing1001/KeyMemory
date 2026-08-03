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
import { ensureBootstrapMainAccount } from './core/auth.js';

async function main() {
  initDatabase();

  // 多用户鉴权 bootstrap:users 表为空且配置了 KEYMEMORY_BOSS_EMAIL/KEYMEMORY_BOSS_PASSWORD
  // 时创建主账户(boss 角色)。未配置 env 则跳过(退化为单用户匿名模式)。
  try {
    ensureBootstrapMainAccount();
  } catch (err) {
    console.error('[KeyMemory] Bootstrap main account failed:', (err as Error).message);
  }

  try {
    await initEmbedding();
  } catch (err) {
    console.warn('Embedding initialization failed (semantic search unavailable):', (err as Error).message);
  }

  const app = Fastify({
    logger: true,
    // 限制请求体最大 10MB，防止超大 payload 导致 DoS
    bodyLimit: 10 * 1024 * 1024,
  });

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

  startScheduler().catch(err => console.error('Scheduler startup failed:', (err as Error).message));

  const shutdown = async () => {
    clearInterval(dailyTimer);
    stopScheduler();
    try {
      // 优雅关闭 HTTP 服务器，等待活跃连接完成
      await app.close();
    } catch (err) {
      console.error('Error closing HTTP server:', (err as Error).message);
    }
    closeDatabase();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
