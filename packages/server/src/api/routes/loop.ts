/**
 * KM-410：Loop Harness 路由（从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import type { LoopCheckpointRequest, LoopContextRequest, LoopFinishRequest, LoopRunStartRequest } from '@keymemory/shared';
import { checkpointLoopRun, finishLoopRun, getLoopContext, loopErrorObservation, startLoopRun } from '../../core/loop-harness.js';
import { getDatabase } from '../../db/sqlite.js';
import { rowToLoopRunSummary } from '../../db/mapper.js';
import { filterRawRowsByOwner, getCaller, loopHttpStatus } from './shared.js';

export function registerLoopRoutes(app: FastifyInstance): void {
  // 列表端点：让 UI 能直接看到"系统作为 loop 上下文记忆库被使用"的实际情况。
  // 没有这个端点时，healthReport.loopRuns 只是一个数字，用户看不到具体跑了什么。
  // 这是把 KeyMemory 真正作为 loop 工程上下文集库的核心视图入口。
  app.get('/api/loop/runs', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Math.min(parseInt(query.limit, 10) || 20, 100) : 20;
    const caller = getCaller(request);
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id, objective, project_id, project_path, agent_id, status,
             checkpoint_version, last_event_sequence, trace_id,
             lease_owner, lease_expires_at, metadata,
             created_at, updated_at, completed_at, owner_user_id
      FROM loop_runs
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
    return filterRawRowsByOwner(rows, caller).map(rowToLoopRunSummary);
  });

  app.post('/api/loop/runs', async (request, reply) => {
    try {
      const observation = await startLoopRun(request.body as LoopRunStartRequest);
      reply.code(observation.status === 'warning' ? 200 : 201);
      return observation;
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/context', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await getLoopContext({ ...(request.body as Omit<LoopContextRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/checkpoints', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await checkpointLoopRun({ ...(request.body as Omit<LoopCheckpointRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });

  app.post('/api/loop/runs/:runId/finish', async (request, reply) => {
    try {
      const { runId } = request.params as { runId: string };
      return await finishLoopRun({ ...(request.body as Omit<LoopFinishRequest, 'runId'>), runId });
    } catch (error) {
      const observation = loopErrorObservation(error);
      reply.code(loopHttpStatus(observation.error?.code));
      return observation;
    }
  });
}
