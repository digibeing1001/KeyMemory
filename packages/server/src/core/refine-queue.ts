/**
 * KM-201/202/203（D9）：写入异步提炼队列
 *
 * 设计（对齐腾讯「毫秒落盘 + 异步提炼」实践）：
 * - 同步段（autoRemember）：assessValue 纯规则过滤 + createMemory 落盘，立即返回 memory.id；
 * - 异步段（本队列）：完整性检测 → 证据式补全 → SelfCheck 定层/定置信度 → 更新元数据。
 *   ensureEmbedding 与实体处理由 createMemory 内部异步完成。
 *
 * 触发条件：每 5 次入队自动 drain / 停顿 10 分钟 drain / 手动 flushRefineQueue()。
 * 恢复性：队列任务随落盘记忆的 metadata.refinePending 持久化，进程重启后
 * recoverPendingRefine() 可从库中重新入队（由服务启动时调用）。
 *
 * 硬约束（KM-203）：异步段任何环节失败都不得回滚已落盘的记忆——
 * 失败只写 metadata.refineFailed 并保持 active，UI/审计可见，可手动重试。
 */
import { getDatabase } from '../db/sqlite.js';
import { getMemory, updateMemory } from './atom.js';
import { evaluate } from '../selfcheck/evaluator.js';
import { confidenceFromSelfCheck, extractTags } from './auto.js';
import { inferMemoryLayer, extractProjectPathFromContent } from './memory-schema.js';
import { extractProjects } from '../graph/entity.js';
import { isLLMAvailable } from './llm-provider.js';
import { reasonRelationsForMemory } from './relation-reasoner.js';
import {
  assessCompleteness,
  tryCompleteFromContext,
  type ContextSegment,
} from './content-quality.js';

export interface RefineTask {
  memoryId: string;
  agentId?: string;
  currentProjectId?: string;
  conversationRound?: number;
  sourceContext?: string[];
}

const REFINE_BATCH_SIZE = 5;       // 每 5 轮入队触发一次提炼（对齐腾讯实践）
const REFINE_IDLE_MS = 10 * 60 * 1000; // 停顿 10 分钟触发一次提炼

const queue: RefineTask[] = [];
let sinceLastDrain = 0;
let drainPromise: Promise<void> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function getRefineBacklog(): number {
  return queue.length;
}

function armIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    startDrain();
  }, REFINE_IDLE_MS);
  idleTimer.unref?.();
}

/** 启动后台 drain（已有在跑则复用）。 */
function startDrain(): void {
  if (drainPromise) return;
  drainPromise = (async () => {
    try {
      while (queue.length > 0) {
        const task = queue.shift()!;
        await refineOne(task);
        // 任务间让出事件循环：避免提炼 CPU 工作与 Agent 写入突发争抢，
        // 保证同步段延迟不被后台提炼抬高。
        await new Promise(resolve => setImmediate(resolve));
      }
    } finally {
      drainPromise = null;
      sinceLastDrain = 0;
    }
  })();
  void drainPromise.catch(() => { /* refineOne 已逐项捕获，此处仅兜底 */ });
}

let batchDrainTimer: ReturnType<typeof setTimeout> | null = null;

export function enqueueRefine(task: RefineTask): void {
  queue.push(task);
  sinceLastDrain += 1;
  armIdleTimer();
  if (sinceLastDrain >= REFINE_BATCH_SIZE) {
    sinceLastDrain = 0;
    // 延迟 100ms 启动：让写入突发先完成，提炼不与同步段争抢事件循环。
    if (batchDrainTimer) clearTimeout(batchDrainTimer);
    batchDrainTimer = setTimeout(() => {
      batchDrainTimer = null;
      startDrain();
    }, 100);
    batchDrainTimer.unref?.();
  }
}

/** 单条提炼：失败不回滚，写 metadata.refineFailed（KM-203）。 */
async function refineOne(task: RefineTask): Promise<void> {
  const mem = getMemory(task.memoryId);
  if (!mem || mem.status !== 'active') return; // 已被删除/归档，跳过

  try {
    // 1. 完整性检测 + 证据式补全（严格子串匹配，无证据保留原文并标记 incomplete）
    let finalContent = mem.content;
    let completenessMeta: Record<string, unknown> | undefined;
    const completeness = assessCompleteness(finalContent);
    if (!completeness.complete) {
      const segments: ContextSegment[] = (task.sourceContext ?? [])
        .filter(t => typeof t === 'string' && t.trim().length > 0)
        .map((text, i) => ({ label: `context-${i + 1}`, text }));
      const completion = segments.length > 0 ? tryCompleteFromContext(finalContent, segments) : null;
      if (completion) {
        finalContent = completion.completed;
        completenessMeta = { status: 'completed', issues: completeness.issues, basis: completion.basis, at: new Date().toISOString() };
      } else {
        completenessMeta = { status: 'incomplete', issues: completeness.issues, at: new Date().toISOString() };
      }
    }

    // 2. SelfCheck 定层 / 定置信度
    const evaluation = await evaluate(finalContent, {
      currentProject: task.currentProjectId,
      conversationRound: task.conversationRound,
    });

    if (evaluation.action === 'ignore') {
      // KM-203：落盘后的 SelfCheck=ignore 绝不删除已写入内容（评分低不等于低价值，
      // 价值判定属于同步段 assessValue 的职责）。保留记忆并标记准入结论与完整性结论，
      // 交给质量审计与用户可见处置，不静默丢弃。
      const metadata: Record<string, unknown> = { ...(mem.metadata ?? {}) };
      metadata.refinePending = null; // updateMemory 合并语义：null = 删除该键
      metadata.admission = { method: 'selfcheck', score: evaluation.total, action: evaluation.action };
      if (completenessMeta) metadata.completeness = completenessMeta;
      updateMemory(task.memoryId, { metadata });
      return;
    }

    const layer = inferMemoryLayer(mem.title, finalContent, undefined, evaluation);
    const confidence = confidenceFromSelfCheck(evaluation.total);
    const metadata: Record<string, unknown> = { ...(mem.metadata ?? {}) };
    metadata.refinePending = null; // updateMemory 合并语义：null = 删除该键
    metadata.admission = { method: 'selfcheck', score: evaluation.total, action: evaluation.action };
    metadata.importance = layer === 'long' ? 'high' : layer === 'short' ? 'medium' : 'low';
    if (completenessMeta) metadata.completeness = completenessMeta;

    const projects = extractProjects(finalContent);
    const inferredProjectPath = extractProjectPathFromContent(finalContent);
    const projectPath = projects[0] || inferredProjectPath;
    if (projectPath) metadata.projectPath = projectPath;
    if (task.currentProjectId) metadata.projectId = task.currentProjectId;

    updateMemory(task.memoryId, {
      content: finalContent !== mem.content ? finalContent : undefined,
      layer,
      confidence,
      tags: extractTags(finalContent),
      metadata,
    });

    // 3. 关联推理（仅 LLM 可用时，失败不影响提炼结果）
    if (isLLMAvailable()) {
      reasonRelationsForMemory(task.memoryId).catch(err => {
        console.error(`[Refine] Relation reasoning failed for ${task.memoryId}:`, (err as Error).message);
      });
    }
  } catch (err) {
    // KM-203：绝不回滚已落盘记忆。标记失败原因，保持 active，可后续重试。
    console.error(`[Refine] Failed for ${task.memoryId}:`, (err as Error).message);
    try {
      const metadata: Record<string, unknown> = { ...(mem.metadata ?? {}) };
      metadata.refinePending = null; // 合并语义：null = 删除该键
      metadata.refineFailed = { reason: (err as Error).message, at: new Date().toISOString() };
      updateMemory(task.memoryId, { metadata });
    } catch {
      // 标记失败也不再上抛：记忆本身已安全落盘
    }
  }
}

/** 等待队列排空：已有 drain 在跑时等待其完成并继续消费新入队任务（不丢失）。 */
export async function drainRefineQueue(): Promise<void> {
  for (;;) {
    if (!drainPromise && queue.length === 0) return;
    startDrain();
    await drainPromise;
  }
}

/** 手动触发：等待全部待提炼任务完成（测试与“手动提炼”入口共用）。 */
export async function flushRefineQueue(): Promise<void> {
  await drainRefineQueue();
}

/**
 * 进程重启恢复：扫描 metadata.refinePending 的 active 记忆重新入队。
 * 由服务启动时调用；队列状态因此是"可恢复"的，不依赖内存。
 */
export function recoverPendingRefine(limit = 200): number {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT id FROM memories
      WHERE status = 'active'
        AND metadata IS NOT NULL AND json_valid(metadata)
        AND json_extract(metadata, '$.refinePending') IN (1, 'true')
      ORDER BY created_at ASC
      LIMIT ?
    `).all(limit) as { id: string }[];
    for (const row of rows) {
      queue.push({ memoryId: row.id });
    }
    if (queue.length > 0) {
      startDrain();
    }
    return rows.length;
  } catch {
    return 0;
  }
}
