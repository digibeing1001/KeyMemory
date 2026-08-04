/**
 * KM-410：记忆写入质量路由（auto-remember / selfcheck / quality audit，从 rest.ts 拆出）
 */
import type { FastifyInstance } from 'fastify';
import type { IsolationMode } from '@keymemory/shared';
import { autoRemember } from '../../core/auto.js';
import { evaluate } from '../../selfcheck/evaluator.js';
import { auditStoredMemories, markQualityFindings, cleanupLowValueMemories } from '../../core/content-quality.js';
import { getDatabase } from '../../db/sqlite.js';
import { getCaller } from './shared.js';

export function registerQualityRoutes(app: FastifyInstance): void {
  app.post('/api/selfcheck', async (request) => {
    const { content, currentProject, conversationRound, userEmphasis } = request.body as {
      content: string;
      currentProject?: string;
      conversationRound?: number;
      userEmphasis?: number;
    };
    if (!content) {
      return { error: 'content is required' };
    }
    return evaluate(content, { currentProject, conversationRound, userEmphasis });
  });

  app.post('/api/auto-remember', async (request) => {
    const { content, source, agentId, isolationMode, currentProject, conversationRound, sourceContext, awaitRefine } = request.body as {
      content: string;
      source?: string;
      agentId?: string;
      isolationMode?: IsolationMode;
      currentProject?: string;
      conversationRound?: number;
      /** 残缺内容补全的上下文依据（当轮前后对话/来源消息/关联记忆） */
      sourceContext?: string[];
      /** KM-201：true 时同步等待后台提炼完成再返回完整结果（默认异步落盘即返回） */
      awaitRefine?: boolean;
    };
    if (!content) return { error: 'content is required' };
    // 透传 caller userId:使 autoRemember 产生的记忆写入 user-scoped agent_space
    const caller = getCaller(request);
    return autoRemember({ content, source, agentId, isolationMode, currentProjectId: currentProject, conversationRound, userId: caller?.userId, sourceContext, awaitRefine: awaitRefine === true });
  });

  // ---- 内容质量审计（已入库记忆的补救路径）----
  // GET 只读盘点；POST mark=true 将结论写入 metadata.qualityFlags；
  // POST /api/quality/cleanup 软删除指定低价值记忆。
  app.get('/api/quality/audit', async (request) => {
    const query = request.query as Record<string, string>;
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    const findings = auditStoredMemories(Number.isFinite(limit) ? { limit } : undefined);
    const db = getDatabase();
    const scanned = (db.prepare(`SELECT COUNT(*) AS n FROM memories WHERE status = 'active'`).get() as { n: number }).n;
    return {
      scanned,
      findingsCount: findings.length,
      incomplete: findings.filter(f => f.kind === 'incomplete'),
      lowValue: findings.filter(f => f.kind === 'low-value'),
    };
  });

  app.post('/api/quality/audit', async (request) => {
    const body = request.body as { limit?: number; mark?: boolean };
    const findings = auditStoredMemories(Number.isFinite(body.limit) ? { limit: body.limit } : undefined);
    const marked = body.mark ? markQualityFindings(findings) : 0;
    return {
      findings,
      marked,
      incompleteCount: findings.filter(f => f.kind === 'incomplete').length,
      lowValueCount: findings.filter(f => f.kind === 'low-value').length,
    };
  });

  app.post('/api/quality/cleanup', async (request, reply) => {
    const body = request.body as { memoryIds?: string[] };
    if (!Array.isArray(body.memoryIds) || body.memoryIds.length === 0) {
      reply.code(400);
      return { error: 'memoryIds is required' };
    }
    // 软删除（status='deleted' + 移出全文索引），可通过回收站恢复
    return cleanupLowValueMemories(body.memoryIds.slice(0, 500));
  });
}
