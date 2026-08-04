/**
 * KM-410：Dream 整理/固化/演化路由（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import { runDreamCycleAsync, getDreamReport, listDreamReports, getDreamSignalsForReport, rollbackDream, deleteDreamReport, getPendingTodosForContext, resolveConflict } from '../../core/dreaming.js';
import { planConsolidation, executeConsolidation, rollbackConsolidation, getConsolidationPlan, listConsolidationPlans, getConsolidationSnapshots, runAutoConsolidation } from '../../core/consolidation.js';
import { runDailyInspection, getPendingTasks, resolveTask } from '../../core/evolution.js';
import { updateSchedulerConfig } from '../../core/scheduler.js';
import { getCaller, requireAdmin } from './shared.js';

export function registerDreamRoutes(app: FastifyInstance): void {
  app.post('/api/dream/run', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    try {
      const report = await runDreamCycleAsync();
      if (report.status === 'failed') {
        reply.code(500);
      } else {
        updateSchedulerConfig({ lastDreamRun: report.completedAt || report.createdAt });
      }
      return report;
    } catch (err) {
      reply.code(500);
      return { error: (err as Error).message };
    }
  });

  app.get('/api/dream/reports', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    return listDreamReports(limit);
  });

  app.get('/api/dream/reports/:reportId', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    const report = getDreamReport(reportId);
    if (!report) return { error: 'Report not found' };
    return report;
  });

  app.get('/api/dream/reports/:reportId/signals', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    return getDreamSignalsForReport(reportId);
  });

  app.post('/api/dream/rollback/:reportId', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    try {
      return rollbackDream(reportId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.delete('/api/dream/reports/:reportId', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { reportId } = request.params as { reportId: string };
    const result = deleteDreamReport(reportId);
    if (!result.success) {
      reply.code(404);
      return { error: 'Report not found' };
    }
    return { success: true };
  });

  app.get('/api/dream/todos', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return { todos: getPendingTodosForContext(limit) };
  });

  // 解决冲突 todo 项
  app.post('/api/dream/conflicts/resolve', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const body = request.body as {
      memoryId: string;
      targetId: string;
      action: 'keep_memory' | 'keep_target' | 'merge_into_memory' | 'merge_into_target' | 'delete_memory' | 'delete_target';
      title?: string;
      content?: string;
      tags?: string[];
    };
    if (!body.memoryId || !body.targetId || !body.action) {
      reply.code(400);
      return { success: false, message: '缺少 memoryId / targetId / action' };
    }
    const result = resolveConflict(body.memoryId, body.targetId, body.action, {
      title: body.title,
      content: body.content,
      tags: body.tags,
    });
    if (!result.success) reply.code(400);
    return result;
  });

  app.post('/api/consolidation/plan', async () => {
    return planConsolidation();
  });

  app.post('/api/consolidation/execute', async (request) => {
    const { planId } = request.body as { planId: string };
    if (!planId) return { error: 'planId is required' };
    try {
      return executeConsolidation(planId);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.post('/api/consolidation/auto', async () => {
    return runAutoConsolidation();
  });

  app.post('/api/consolidation/rollback', async (request) => {
    const { planId, actionIds } = request.body as { planId: string; actionIds?: string[] };
    if (!planId) return { error: 'planId is required' };
    try {
      return rollbackConsolidation(planId, actionIds);
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  app.get('/api/consolidation/plans', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? parseInt(query.limit, 10) : 20;
    return listConsolidationPlans(limit);
  });

  app.get('/api/consolidation/plans/:planId', async (request) => {
    const { planId } = request.params as { planId: string };
    const plan = getConsolidationPlan(planId);
    if (!plan) return { error: 'Plan not found' };
    return plan;
  });

  app.get('/api/consolidation/plans/:planId/snapshots', async (request) => {
    const { planId } = request.params as { planId: string };
    return getConsolidationSnapshots(planId);
  });

  app.post('/api/evolution/inspect', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    return runDailyInspection();
  });

  app.get('/api/evolution/tasks', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    return getPendingTasks();
  });

  app.post('/api/evolution/tasks/:id/resolve', async (request, reply) => {
    if (!requireAdmin(reply, getCaller(request))) return;
    const { id } = request.params as { id: string };
    const { action } = request.body as { action: 'accepted' | 'rejected' };
    if (!action || !['accepted', 'rejected'].includes(action)) {
      return { error: 'action must be accepted or rejected' };
    }
    return resolveTask(id, action);
  });
}
