/**
 * KM-410：Agent 接入（integrations）与备份（backup）路由（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../../db/sqlite.js';
import { discoverAgentIntegrations, connectAgentIntegration } from '../../core/agent-discovery.js';
import { verifyAgentIntegrationAsync, resolveProbePlan, describeProbePlan } from '../../core/connection-verify.js';
import { createBackupFile, inspectBackupFile, restoreBackupFile } from '../../core/backup.js';
import { callerIsAdminOrAnonymous, getCaller, requireAdmin } from './shared.js';

export function registerIntegrationRoutes(app: FastifyInstance): void {
  app.get('/api/agents', async (request) => {
    const db = getDatabase();
    const caller = getCaller(request);
    // member/exec/pm 只看自己的 agent_space + owner_user_id 为 NULL 的旧数据
    const ownerCondition = callerIsAdminOrAnonymous(caller)
      ? ''
      : 'AND (owner_user_id = @ownerUserId OR owner_user_id IS NULL)';
    const params: Record<string, unknown> = {};
    if (!callerIsAdminOrAnonymous(caller) && caller) {
      params.ownerUserId = caller.userId;
    }
    const agents = db.prepare(`
      SELECT DISTINCT owner_agent_id as agentId, agent_space as agentSpace, COUNT(*) as memoryCount
      FROM memories
      WHERE owner_agent_id IS NOT NULL ${ownerCondition}
      GROUP BY owner_agent_id, agent_space
    `).all(params);
    return agents;
  });

  app.get('/api/integrations/discover', async () => {
    return discoverAgentIntegrations();
  });

  /** 预览某个 Agent 的验证探针将要执行的动作（只读，不执行）。 */
  app.get('/api/integrations/:agentId/verify/plan', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const report = discoverAgentIntegrations();
    const agent = report.agents.find(item => item.id === agentId);
    if (!agent) {
      reply.code(404);
      return { error: `Unsupported Agent integration: ${agentId}` };
    }
    const plan = resolveProbePlan(agent, report.projectRoot);
    return { agentId, plan, actions: describeProbePlan(plan) };
  });

  /**
   * 三层连接验证：配置检测 → 读取验证 → 写入验证。
   * 全部探针真实执行；allowWriteProbe=true 才会真实写入并清理一条探针记忆。
   * overall=connected 才代表真正连通，configured-only 仅表示配置存在。
   * 统一返回 200 + 完整报告：未连通也是合法验证结果，UI 需要展示逐项探针结论。
   */
  app.post('/api/integrations/:agentId/verify', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { allowWriteProbe, timeoutMs } = (request.body ?? {}) as { allowWriteProbe?: boolean; timeoutMs?: number };
    try {
      return await verifyAgentIntegrationAsync(agentId, { allowWriteProbe: allowWriteProbe === true, timeoutMs });
    } catch (error) {
      reply.code(500);
      return { error: (error as Error).message };
    }
  });

  app.post('/api/integrations/:agentId/connect', async (request, reply) => {
    const { agentId } = request.params as { agentId: string };
    const { confirm, mode } = (request.body ?? {}) as { confirm?: boolean; mode?: 'auto' | 'mcp' | 'cli' | 'skill' };
    if (confirm !== true) {
      reply.code(400);
      return { error: 'confirm=true is required before changing an Agent configuration.' };
    }

    const before = discoverAgentIntegrations();
    const agent = before.agents.find(item => item.id === agentId);
    if (!agent) {
      reply.code(404);
      return { error: `Unsupported Agent integration: ${agentId}` };
    }
    try {
      const result = connectAgentIntegration(agent.id, { projectRoot: before.projectRoot, mode });
      return { result, report: discoverAgentIntegrations() };
    } catch (error) {
      reply.code(400);
      return { error: (error as Error).message };
    }
  });
}

export function registerBackupRoutes(app: FastifyInstance): void {
  app.post('/api/backup', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const db = getDatabase();
    const data = db.prepare(`SELECT * FROM memories`).all();
    const fts = db.prepare(`SELECT * FROM memories_fts`).all();
    const entities = db.prepare(`SELECT * FROM entities`).all();
    const versions = db.prepare(`SELECT * FROM versions`).all();
    return {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      memories: data,
      fts,
      entities,
      versions,
    };
  });

  app.post('/api/backup/create-file', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as {
      filePath?: string;
      includeEmbeddings?: boolean;
      includeOperationalLogs?: boolean;
    };
    try {
      return createBackupFile(body.filePath, {
        includeEmbeddings: body.includeEmbeddings,
        includeOperationalLogs: body.includeOperationalLogs,
      });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/backup/inspect-file', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as { filePath?: string };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      return inspectBackupFile(body.filePath);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post('/api/backup/restore', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as { filePath?: string; dryRun?: boolean; replace?: boolean; preRestoreBackupPath?: string };
    if (!body.filePath) {
      reply.code(400);
      return { error: 'filePath is required' };
    }
    try {
      return restoreBackupFile(body.filePath, {
        dryRun: body.dryRun === true,
        replace: body.replace === true,
        preRestoreBackupPath: body.preRestoreBackupPath,
      });
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}
