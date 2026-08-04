/**
 * KM-410：系统域路由（health/compress/llm/scheduler/relation-reasoning/project-handoff，从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import { getLayerStats } from '../../core/layer.js';
import { getHealthReport, listOrphanIssues, markOrphanIndependent } from '../../core/health.js';
import { compressProjectMemories, compressEntityMemories, listCompressibleProjects } from '../../core/compression.js';
import { getLLMConfig, saveLLMConfig, verifyLLMConnection, saveLLMVerifyResult, clearLLMConfig, isLLMAvailable } from '../../core/llm-provider.js';
import { getSchedulerConfig, updateSchedulerConfig, restartScheduler } from '../../core/scheduler.js';
import { runRelationReasonerBatch, getScanStats, resetScanStatus, resetAllScanStatus } from '../../core/relation-reasoner.js';
import { scanProjectJournalInjections, listInjections, getInjectionStats, resetInjection } from '../../core/project-journal.js';
import { getCaller, requireAdmin } from './shared.js';

export function registerSystemRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => {
    const stats = getLayerStats();
    return { status: 'ok', timestamp: new Date().toISOString(), stats };
  });

  app.get('/api/health/report', async () => {
    return getHealthReport();
  });

  app.get('/api/health/issues', async (request) => {
    const query = request.query as { type?: string; limit?: string };
    if (query.type && query.type !== 'orphan') return [];
    return listOrphanIssues(query.limit ? Number.parseInt(query.limit, 10) : 100);
  });

  app.post('/api/health/orphans/:id/independent', async (request, reply) => {
    const { id } = request.params as { id: string };
    const success = markOrphanIndependent(id);
    if (!success) reply.code(404);
    return { success };
  });

  app.post('/api/compress/project', async (request) => {
    const { project } = request.body as { project: string };
    return await compressProjectMemories(project);
  });

  app.post('/api/compress/entity', async (request) => {
    const { entityId } = request.body as { entityId: string };
    return await compressEntityMemories(entityId);
  });

  app.get('/api/compress/candidates', async () => {
    return listCompressibleProjects();
  });

  // ===== LLM Provider 配置 API =====
  // 用户在 Web UI 填写 baseUrl + apiKey → 点检测 → 拉模型 → 下拉选 → 保存
  // 注意：apiKey 可选（本地 Ollama 模型不需要 key）

  app.get('/api/llm/config', async () => {
    return getLLMConfig();
  });

  app.post('/api/llm/config', async (request, reply) => {
    const body = request.body as { baseUrl: string; apiKey?: string; model: string; enabled: boolean; availableModels?: string[] };
    if (!body.baseUrl) {
      reply.code(400);
      return { error: 'baseUrl is required' };
    }
    return saveLLMConfig({
      baseUrl: body.baseUrl,
      model: body.model || '',
      enabled: body.enabled ?? true,
    }, body.apiKey, body.availableModels);
  });

  app.post('/api/llm/verify', async (request) => {
    const body = request.body as { baseUrl?: string; apiKey?: string };
    const result = await verifyLLMConnection(body.baseUrl, body.apiKey);
    if (result.ok) {
      saveLLMVerifyResult(result);
    }
    return result;
  });

  app.get('/api/llm/models', async (request) => {
    const query = request.query as Record<string, string>;
    const baseUrl = query.baseUrl;
    // API Key 不允许出现在 URL 查询参数中，避免被访问日志、历史记录或代理层保留。
    // 此兼容读接口只能使用与 baseUrl 匹配的已保存密钥；新界面使用 POST /api/llm/verify。
    const result = await verifyLLMConnection(baseUrl);
    return { ok: result.ok, models: result.models, error: result.error };
  });

  app.delete('/api/llm/config', async () => {
    const ok = clearLLMConfig();
    return { success: ok };
  });

  app.get('/api/llm/status', async () => {
    return {
      available: isLLMAvailable(),
      config: getLLMConfig(),
    };
  });

  // ===== Relation reasoning & project handoff API =====

  app.post('/api/relation-reasoning/run', async (request, reply) => {
    try {
      const report = await runRelationReasonerBatch();
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/relation-reasoning/stats', async () => {
    return getScanStats();
  });

  app.post('/api/relation-reasoning/reset', async (request) => {
    const body = request.body as { memoryId?: string; all?: boolean };
    if (body.all) {
      const count = resetAllScanStatus();
      return { success: true, reset: count };
    }
    if (body.memoryId) {
      const ok = resetScanStatus(body.memoryId);
      return { success: ok };
    }
    return { success: false, error: 'Provide memoryId or all=true' };
  });

  app.post('/api/project-handoff/run', async (request, reply) => {
    try {
      const report = scanProjectJournalInjections();
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/project-handoff/injections', async (request) => {
    const query = request.query as Record<string, string>;
    const status = query.status as 'pending' | 'injected' | 'logged' | undefined;
    return listInjections(status);
  });

  app.get('/api/project-handoff/stats', async () => {
    return getInjectionStats();
  });

  app.post('/api/project-handoff/reset/:projectId', async (request) => {
    const { projectId } = request.params as { projectId: string };
    const ok = resetInjection(projectId);
    return { success: ok };
  });

  app.get('/api/scheduler/config', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    return getSchedulerConfig();
  });

  app.post('/api/scheduler/config', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const updates = request.body as Record<string, unknown>;
    try {
      const result = updateSchedulerConfig(updates);
      restartScheduler();
      return result;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });
}
