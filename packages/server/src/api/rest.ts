/**
 * KM-410：REST 入口壳。
 * 原 82KB 单文件按资源域拆分为 routes/*.ts（每个 ≤15KB，可并行开发与单测）：
 *   auth         鉴权与用户
 *   memories     记忆 CRUD/搜索/版本/关系/回收站/上下文注入
 *   mailbox      人机共享邮箱
 *   loop         Loop Harness
 *   quality      自动记忆与内容质量审计
 *   migration    本地记忆迁移
 *   integrations Agent 发现/接入/三层验证 + 备份
 *   graph        记忆连接图/标签云/实体
 *   dream        Dream 整理/固化/演化
 *   projects     项目与项目建议
 *   system       健康/压缩/LLM/调度/关联推理/项目交接
 * 本文件只保留鉴权 preHandler 与路由装配。
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { isApiRequestAuthorized, shouldAuthenticateHttpPath, isPublicPath, resolveCaller } from '../core/security.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerMemoryRoutes } from './routes/memories.js';
import { registerMemoryOpsRoutes } from './routes/memory-ops.js';
import { registerMailboxRoutes } from './routes/mailbox.js';
import { registerLoopRoutes } from './routes/loop.js';
import { registerQualityRoutes } from './routes/quality.js';
import { registerMigrationRoutes } from './routes/migration.js';
import { registerIntegrationRoutes, registerBackupRoutes } from './routes/integrations.js';
import { registerGraphRoutes } from './routes/graph.js';
import { registerDreamRoutes } from './routes/dream.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerSystemRoutes } from './routes/system.js';

export function registerRoutes(app: FastifyInstance): void {
  const apiKey = process.env.KEYMEMORY_API_KEY;

  // 鉴权 preHandler:
  // 1. 公开路径(/api/auth/login, /api/auth/register, /api/health)直接放行
  // 2. 先尝试 per-user token 鉴权,成功则写入 request.user
  // 3. 失败则 fallback 到旧 API key 模式:若 KEYMEMORY_API_KEY 配置且校验失败,返回 401
  //    若未配置 KEYMEMORY_API_KEY,放行(单用户匿名模式,向后兼容)
  app.addHook('preHandler', async (request: FastifyRequest, reply) => {
    const path = request.url.split('?')[0];

    // 公开路径直接放行(但仍尝试解析 caller,以便 /api/auth/register 判断首个用户)
    const caller = resolveCaller(request.headers as Record<string, string | string[] | undefined>);
    if (caller) {
      (request as any).user = caller;
    }

    if (isPublicPath(path)) return;

    if (!shouldAuthenticateHttpPath(path)) return;

    // 已通过 token 鉴权
    if (caller) return;

    // fallback 旧 API key 模式
    if (apiKey) {
      if (!isApiRequestAuthorized(request.headers as Record<string, string | string[] | undefined>)) {
        return reply.code(401).send({ error: 'Unauthorized: invalid token or API key' });
      }
      return;
    }

    // 未配置 apiKey 也未带 token:单用户匿名模式,放行(向后兼容)
  });

  registerAuthRoutes(app);
  registerSystemRoutes(app);
  registerMemoryRoutes(app);
  registerMemoryOpsRoutes(app);
  registerMailboxRoutes(app);
  registerLoopRoutes(app);
  registerQualityRoutes(app);
  registerMigrationRoutes(app);
  registerIntegrationRoutes(app);
  registerBackupRoutes(app);
  registerGraphRoutes(app);
  registerDreamRoutes(app);
  registerProjectRoutes(app);
}
