import type Database from 'better-sqlite3';
import { v4 as uuid } from 'uuid';
import type { ConsolidationPlan, ConsolidationAction, ConsolidationActionType, ConsolidationSnapshot, ConsolidationSummary } from '@keymemory/shared';
import { CONSOLIDATION_CONFIG } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { getMemory, updateMemory } from './atom.js';
import { forgetMemory, restoreMemory } from './forgetting.js';
import { moveLayer } from './layer.js';
import { detectDuplicateActions, detectStaleActions, detectOldFlashActions, detectSolidifyActions } from './consolidation-detectors.js';
import { smartMergeContents } from './dreaming.js';

export function planConsolidation(): ConsolidationPlan {
  const db = getDatabase();
  const actions: ConsolidationAction[] = [];
  const affectedIds = new Set<string>();

  const dupActions = detectDuplicateActions(db, affectedIds);
  actions.push(...dupActions);

  const staleActions = detectStaleActions(db, affectedIds);
  actions.push(...staleActions);

  const flashActions = detectOldFlashActions(db, affectedIds);
  actions.push(...flashActions);

  const solidifyActions = detectSolidifyActions(db, affectedIds);
  actions.push(...solidifyActions);

  const limited = actions.slice(0, CONSOLIDATION_CONFIG.maxActionsPerPlan);

  const planId = uuid();
  const now = new Date().toISOString();
  const plan: ConsolidationPlan = {
    id: planId,
    actions: limited,
    status: 'planned',
    snapshotCount: 0,
    createdAt: now,
  };

  db.prepare(`
    INSERT INTO consolidation_plans (id, status, actions, snapshot_count, created_at)
    VALUES (?, ?, ?, 0, ?)
  `).run(planId, 'planned', JSON.stringify(limited), now);

  return plan;
}

// 重复检测/归档/固化逻辑已抽取到 ./consolidation-detectors.ts（与 dreaming.ts 共享单一实现）
// 原在此处的 buildExcludeClause / detectDuplicateActions / detectStaleActions /
// detectOldFlashActions / detectSolidifyActions 已删除，避免两处维护导致 bug 修复遗漏。

export function executeConsolidation(planId: string): ConsolidationPlan {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM consolidation_plans WHERE id = ?`).get(planId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Plan not found: ${planId}`);

  const currentStatus = row.status as string;
  if (currentStatus !== 'planned') throw new Error(`Plan status is '${currentStatus}', expected 'planned'`);

  const actions = JSON.parse(row.actions as string) as ConsolidationAction[];
  const now = new Date().toISOString();

  // 事务保护：状态流转 + 快照创建 + action 执行 + 最终状态更新必须原子性
  // 之前无事务，中途崩溃会导致计划永久卡在 'executing'，快照可能只写一半，无法干净回滚
  return db.transaction(() => {
    db.prepare(`UPDATE consolidation_plans SET status = 'executing' WHERE id = ?`).run(planId);

    const memoriesBefore = (db.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE status = 'active'`).get() as { cnt: number }).cnt;

    const allAffectedIds = new Set<string>();
    for (const action of actions) {
      for (const id of action.sourceIds) {
        allAffectedIds.add(id);
      }
      if (action.targetId) allAffectedIds.add(action.targetId);
    }

    createSnapshots(db, planId, Array.from(allAffectedIds));

    for (const action of actions) {
      try {
        executeAction(action);
        action.status = 'executed';
      } catch (err) {
        action.status = 'skipped';
        console.error(`[Consolidation] Action ${action.id} (${action.type}) skipped:`, (err as Error).message);
      }
    }

    const summary = buildSummary(db, actions, memoriesBefore);

    db.prepare(`
      UPDATE consolidation_plans
      SET status = 'completed', actions = ?, snapshot_count = ?, summary = ?, executed_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(actions),
      allAffectedIds.size,
      JSON.stringify(summary),
      now,
      planId,
    );

    return {
      id: planId,
      actions,
      status: 'completed' as const,
      snapshotCount: allAffectedIds.size,
      createdAt: row.created_at as string,
      executedAt: now,
      summary,
    };
  })();
}

function createSnapshots(db: Database.Database, planId: string, memoryIds: string[]): void {
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO consolidation_snapshots (id, plan_id, memory_id, title, content, layer, status, tags, metadata, project, project_id, agent_space, confidence, decay_factor, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const mid of memoryIds) {
    const mem = getMemory(mid);
    if (!mem) continue;

    stmt.run(
      uuid(),
      planId,
      mem.id,
      mem.title,
      mem.content,
      mem.layer,
      mem.status,
      mem.tags ? JSON.stringify(mem.tags) : null,
      mem.metadata ? JSON.stringify(mem.metadata) : null,
      mem.projectId,
      mem.projectId,
      mem.agentSpace,
      mem.confidence,
      mem.decayFactor,
      now,
    );
  }
}

function executeAction(action: ConsolidationAction): void {
  const db = getDatabase();
  switch (action.type) {
    case 'deduplicate': {
      const [keeperId, removedId] = action.sourceIds;
      const keeper = getMemory(keeperId);
      const removed = getMemory(removedId);
      if (!keeper || !removed) throw new Error('Memory not found');

      const mergedTags = [...new Set([...(keeper.tags || []), ...(removed.tags || [])])];
      const mergedContent = smartMergeContents([keeper.content, removed.content]);

      db.transaction(() => {
        updateMemory(keeperId, {
          content: mergedContent,
          tags: mergedTags,
        }, `合并自去重：与「${removed.title}」合并`);

        forgetMemory(removedId, 'archive');
      })();
      break;
    }

    case 'merge': {
      const [targetId, ...sourceIds] = action.sourceIds;
      const target = getMemory(targetId);
      if (!target) throw new Error('Target memory not found');

      const allContent = [target.content];
      const allTags = [...(target.tags || [])];

      for (const sid of sourceIds) {
        const src = getMemory(sid);
        if (src) {
          allContent.push(src.content);
          allTags.push(...(src.tags || []));
        }
      }

      db.transaction(() => {
        updateMemory(targetId, {
          content: smartMergeContents(allContent),
          tags: [...new Set(allTags)],
        }, `合并${sourceIds.length}条记忆`);

        for (const sid of sourceIds) {
          forgetMemory(sid, 'archive');
        }
      })();
      break;
    }

    case 'archive_stale':
    case 'archive_flash': {
      for (const id of action.sourceIds) {
        forgetMemory(id, 'archive');
      }
      break;
    }

    case 'solidify': {
      for (const id of action.sourceIds) {
        moveLayer(id, 'long', '自动整理：短期记忆固化');
      }
      break;
    }
  }
}

function buildSummary(db: Database.Database, actions: ConsolidationAction[], memoriesBefore: number): ConsolidationSummary {
  const memoriesAfter = (db.prepare(`SELECT COUNT(*) as cnt FROM memories WHERE status = 'active'`).get() as { cnt: number }).cnt;

  const counts = { merged: 0, deduplicated: 0, archivedStale: 0, archivedFlash: 0, solidified: 0, skipped: 0 };

  for (const a of actions) {
    if (a.status === 'skipped') { counts.skipped++; continue; }
    switch (a.type) {
      case 'merge': counts.merged++; break;
      case 'deduplicate': counts.deduplicated++; break;
      case 'archive_stale': counts.archivedStale++; break;
      case 'archive_flash': counts.archivedFlash++; break;
      case 'solidify': counts.solidified++; break;
    }
  }

  return {
    totalActions: actions.length,
    memoriesBefore,
    memoriesAfter,
    ...counts,
  };
}

export function rollbackConsolidation(planId: string, actionIds?: string[]): ConsolidationPlan {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM consolidation_plans WHERE id = ?`).get(planId) as Record<string, unknown> | undefined;
  if (!row) throw new Error(`Plan not found: ${planId}`);

  const currentStatus = row.status as string;
  if (currentStatus !== 'completed') throw new Error(`Plan status is '${currentStatus}', can only rollback 'completed' plans`);

  const actions = JSON.parse(row.actions as string) as ConsolidationAction[];
  const targetActions = actionIds
    ? actions.filter(a => actionIds.includes(a.id))
    : actions;

  const snapshots = db.prepare(`
    SELECT * FROM consolidation_snapshots WHERE plan_id = ?
  `).all(planId) as Record<string, unknown>[];

  const affectedActionIds = new Set(targetActions.map(a => a.id));
  const affectedSourceIds = new Set<string>();
  for (const a of targetActions) {
    for (const id of a.sourceIds) affectedSourceIds.add(id);
    if (a.targetId) affectedSourceIds.add(a.targetId);
  }

  const relevantSnapshots = snapshots.filter(s => affectedSourceIds.has(s.memory_id as string));

  // 事务保护：记忆恢复/还原 + action 状态更新 + 计划状态更新必须原子性
  // 之前无事务，部分回滚会导致记忆图不一致，且计划状态可能仍是 'completed' 导致重复回滚
  return db.transaction(() => {
    for (const snap of relevantSnapshots) {
      const memId = snap.memory_id as string;
      const existing = getMemory(memId);

      if (existing && existing.status === 'archived') {
        restoreMemory(memId);
      }

      if (!existing || existing.status === 'active') {
        let tags: string[] | undefined;
        let metadata: Record<string, unknown> | undefined;
        try {
          tags = snap.tags ? JSON.parse(snap.tags as string) : undefined;
        } catch { /* tags corrupted, skip */ }
        try {
          metadata = snap.metadata ? JSON.parse(snap.metadata as string) : undefined;
        } catch { /* metadata corrupted, skip */ }

        updateMemory(memId, {
          title: snap.title as string,
          content: snap.content as string,
          tags,
          metadata,
        }, `回滚整理计划 ${planId}`);
      }
    }

    for (const action of actions) {
      if (affectedActionIds.has(action.id)) {
        action.status = 'rolled_back';
      }
    }

    const isFullRollback = !actionIds;
    const newStatus: ConsolidationPlan['status'] = isFullRollback ? 'rolled_back' : 'partial_rollback';

    db.prepare(`
      UPDATE consolidation_plans SET status = ?, actions = ? WHERE id = ?
    `).run(newStatus, JSON.stringify(actions), planId);

    return {
      id: planId,
      actions,
      status: newStatus,
      snapshotCount: row.snapshot_count as number,
      createdAt: row.created_at as string,
      executedAt: row.executed_at as string | undefined,
    };
  })();
}

export function getConsolidationPlan(planId: string): ConsolidationPlan | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM consolidation_plans WHERE id = ?`).get(planId) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    actions: JSON.parse(row.actions as string),
    status: row.status as ConsolidationPlan['status'],
    snapshotCount: row.snapshot_count as number,
    createdAt: row.created_at as string,
    executedAt: row.executed_at as string | undefined,
    summary: row.summary ? JSON.parse(row.summary as string) : undefined,
  };
}

export function listConsolidationPlans(limit = 20): ConsolidationPlan[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM consolidation_plans ORDER BY created_at DESC LIMIT ?
  `).all(limit) as Record<string, unknown>[];

  return rows.map(row => ({
    id: row.id as string,
    actions: JSON.parse(row.actions as string),
    status: row.status as ConsolidationPlan['status'],
    snapshotCount: row.snapshot_count as number,
    createdAt: row.created_at as string,
    executedAt: row.executed_at as string | undefined,
    summary: row.summary ? JSON.parse(row.summary as string) : undefined,
  }));
}

export function getConsolidationSnapshots(planId: string): ConsolidationSnapshot[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM consolidation_snapshots WHERE plan_id = ? ORDER BY captured_at ASC
  `).all(planId) as Record<string, unknown>[];

  return rows.map(r => ({
    id: r.id as string,
    planId: r.plan_id as string,
    memoryId: r.memory_id as string,
    title: r.title as string,
    content: r.content as string,
    layer: r.layer as ConsolidationSnapshot['layer'],
    status: r.status as ConsolidationSnapshot['status'],
    tags: r.tags ? JSON.parse(r.tags as string) : undefined,
    metadata: r.metadata ? JSON.parse(r.metadata as string) : undefined,
    projectId: r.project_id as string,
    agentSpace: r.agent_space as string,
    confidence: r.confidence as number,
    decayFactor: r.decay_factor as number,
    capturedAt: r.captured_at as string,
  }));
}

export function runAutoConsolidation(): ConsolidationPlan {
  const plan = planConsolidation();

  if (plan.actions.length === 0) {
    return plan;
  }

  return executeConsolidation(plan.id);
}

export function formatConsolidationReport(plan: ConsolidationPlan): string {
  const lines: string[] = [];

  lines.push(`📋 记忆整理报告 #${plan.id.slice(0, 8)}`);
  lines.push(`状态: ${plan.status}`);
  lines.push(`时间: ${plan.executedAt || plan.createdAt}`);
  lines.push('');

  if (plan.summary) {
    const s = plan.summary;
    lines.push('📊 整理统计:');
    lines.push(`  - 记忆数量: ${s.memoriesBefore} → ${s.memoriesAfter} (减少 ${s.memoriesBefore - s.memoriesAfter})`);
    lines.push(`  - 去重合并: ${s.deduplicated} 项`);
    lines.push(`  - 归档过期: ${s.archivedStale} 项`);
    lines.push(`  - 归档闪念: ${s.archivedFlash} 项`);
    lines.push(`  - 固化长期: ${s.solidified} 项`);
    if (s.skipped > 0) lines.push(`  - 跳过: ${s.skipped} 项`);
    lines.push('');
  }

  if (plan.actions.length > 0) {
    lines.push('📝 操作详情:');
    for (const a of plan.actions) {
      const icon = a.status === 'executed' ? '✅' : a.status === 'skipped' ? '⏭️' : a.status === 'rolled_back' ? '↩️' : '⏳';
      lines.push(`  ${icon} [${a.type}] ${a.description}`);
    }
    lines.push('');
  }

  lines.push(`💡 如需回滚，使用: keymemory consolidate --rollback ${plan.id}`);
  lines.push(`💡 部分回滚: keymemory consolidate --rollback ${plan.id} --action-ids <id1,id2>`);

  return lines.join('\n');
}
