import { v4 as uuid } from 'uuid';
import type { DreamPhase, DreamCandidate, DreamSignals, DreamSession, DreamReport, ConsolidationAction } from '@keymemory/shared';
import { DREAM_SIGNAL_WEIGHTS, DREAM_THRESHOLDS, CONSOLIDATION_CONFIG } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, bufferToEmbedding } from '../embed/onnx.js';
import { getMemory, updateMemory } from './atom.js';
import { forgetMemory, restoreMemory } from './forgetting.js';
import { moveLayer } from './layer.js';

export function runDreamCycle(): DreamReport {
  const reportId = uuid();
  const now = new Date().toISOString();
  const sessions: DreamSession[] = [];

  const db = getDatabase();
  db.prepare(`
    INSERT INTO dream_reports (id, status, total_candidates, promoted, archived, merged, sessions, created_at)
    VALUES (?, 'running', 0, 0, 0, 0, '[]', ?)
  `).run(reportId, now);

  let promoted = 0;
  let archived = 0;
  let merged = 0;
  let totalCandidates = 0;

  try {
    const lightSession = runLightPhase(reportId);
    sessions.push(lightSession);

    const remSession = runRemPhase(reportId);
    sessions.push(remSession);

    const deepResult = runDeepPhase(reportId, lightSession, remSession);
    sessions.push(deepResult.deepSession);
    promoted = deepResult.promoted;
    archived = deepResult.archived;
    merged = deepResult.merged;

    totalCandidates = lightSession.candidatesProcessed + remSession.candidatesProcessed + deepResult.deepSession.candidatesProcessed;
  } catch (err) {
    const failedAt = new Date().toISOString();
    db.prepare(`
      UPDATE dream_reports
      SET status = 'failed', sessions = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(sessions), failedAt, reportId);

    return {
      id: reportId,
      sessions,
      totalCandidates,
      promoted,
      archived,
      merged,
      status: 'failed',
      createdAt: now,
      completedAt: failedAt,
    };
  }

  const completedAt = new Date().toISOString();
  db.prepare(`
    UPDATE dream_reports
    SET status = 'completed', total_candidates = ?, promoted = ?, archived = ?, merged = ?, sessions = ?, completed_at = ?
    WHERE id = ?
  `).run(totalCandidates, promoted, archived, merged, JSON.stringify(sessions), completedAt, reportId);

  return {
    id: reportId,
    sessions,
    totalCandidates,
    promoted,
    archived,
    merged,
    status: 'completed',
    createdAt: now,
    completedAt,
  };
}

function runLightPhase(reportId: string): DreamSession {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();
  const lookback = DREAM_THRESHOLDS.lookbackDays;

  const recentMemories = db.prepare(`
    SELECT m.id, m.title, m.content, m.layer, m.tags, m.hit_count, m.created_at, m.updated_at
    FROM memories m
    WHERE m.status = 'active'
      AND m.layer IN ('flash', 'short')
      AND m.created_at >= datetime('now', ? || ' days')
    ORDER BY m.created_at DESC
  `).all(`-${lookback}`) as { id: string; title: string; content: string; layer: string; tags: string | null; hit_count: number; created_at: string; updated_at: string }[];

  const deduplicated = new Set<string>();
  let dedupCount = 0;

  for (let i = 0; i < recentMemories.length; i++) {
    if (deduplicated.has(recentMemories[i].id)) continue;
    for (let j = i + 1; j < recentMemories.length; j++) {
      if (deduplicated.has(recentMemories[j].id)) continue;

      const tagsA = recentMemories[i].tags ? JSON.parse(recentMemories[i].tags as string) as string[] : [];
      const tagsB = recentMemories[j].tags ? JSON.parse(recentMemories[j].tags as string) as string[] : [];
      const jaccard = computeJaccard(tagsA, tagsB);

      if (jaccard > DREAM_THRESHOLDS.lightJaccardThreshold) {
        const sim = computeTextSimilarity(recentMemories[i].content, recentMemories[j].content);
        if (sim > 0.8) {
          deduplicated.add(recentMemories[j].id);
          dedupCount++;
        }
      }
    }
  }

  const candidatesProcessed = recentMemories.length;
  const candidatesPromoted = candidatesProcessed - dedupCount;

  const signals: Record<string, number> = { deduplicated: dedupCount, scanned: candidatesProcessed };

  return {
    id: sessionId,
    phase: 'light',
    candidatesProcessed,
    candidatesPromoted,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `浅睡阶段：扫描${candidatesProcessed}条近期记忆，标记${dedupCount}条重复`,
  };
}

function runRemPhase(reportId: string): DreamSession {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();
  const lookback = DREAM_THRESHOLDS.lookbackDays;

  const shortTermMemories = db.prepare(`
    SELECT m.id, m.title, m.content, m.tags, m.hit_count, m.project
    FROM memories m
    WHERE m.status = 'active'
      AND m.layer = 'short'
      AND m.created_at >= datetime('now', ? || ' days')
  `).all(`-${lookback}`) as { id: string; title: string; content: string; tags: string | null; hit_count: number; project: string | null }[];

  const tagFrequency = new Map<string, number>();
  const conceptCooccurrence = new Map<string, Set<string>>();

  for (const mem of shortTermMemories) {
    const tags: string[] = mem.tags ? JSON.parse(mem.tags) : [];
    for (const tag of tags) {
      tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
    }
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join('::');
        if (!conceptCooccurrence.has(key)) conceptCooccurrence.set(key, new Set());
        conceptCooccurrence.get(key)!.add(mem.id);
      }
    }
  }

  const themes = Array.from(tagFrequency.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const candidatesProcessed = shortTermMemories.length;
  const candidatesPromoted = themes.length;

  const signals: Record<string, number> = {
    themesFound: themes.length,
    tagTypes: tagFrequency.size,
    cooccurrences: conceptCooccurrence.size,
  };

  return {
    id: sessionId,
    phase: 'rem',
    candidatesProcessed,
    candidatesPromoted,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `REM阶段：分析${candidatesProcessed}条短期记忆，发现${themes.length}个主题（${themes.slice(0, 3).map(t => t[0]).join(', ')}）`,
  };
}

function runDeepPhase(reportId: string, lightSession: DreamSession, remSession: DreamSession): {
  deepSession: DreamSession;
  promoted: number;
  archived: number;
  merged: number;
} {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();

  const actions = detectCleanupActions(db);
  const allAffectedIds = new Set<string>();
  for (const a of actions) {
    for (const id of a.sourceIds) allAffectedIds.add(id);
    if (a.targetId) allAffectedIds.add(a.targetId);
  }

  createSnapshots(db, reportId, Array.from(allAffectedIds));

  let promoted = 0;
  let archived = 0;
  let merged = 0;

  const candidates = scoreCandidates(db);
  for (const candidate of candidates) {
    if (
      candidate.score >= DREAM_THRESHOLDS.minScore &&
      candidate.hitCount >= DREAM_THRESHOLDS.minRecallCount &&
      candidate.uniqueQueryCount >= DREAM_THRESHOLDS.minUniqueQueries
    ) {
      if (candidate.layer === 'short') {
        moveLayer(candidate.memoryId, 'long', `梦境升级：评分${candidate.score.toFixed(2)}`);
        promoted++;
      }

      db.prepare(`
        INSERT INTO dream_signals (id, report_id, memory_id, relevance, frequency, query_diversity, recency, consolidation, conceptual_richness, total_score, phase, promoted, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deep', 1, ?)
      `).run(
        uuid(), reportId, candidate.memoryId,
        candidate.signals.relevance, candidate.signals.frequency,
        candidate.signals.queryDiversity, candidate.signals.recency,
        candidate.signals.consolidation, candidate.signals.conceptualRichness,
        candidate.score, now,
      );
    }
  }

  for (const action of actions) {
    try {
      const result = executeAction(db, action);
      promoted += result.promoted;
      archived += result.archived;
      merged += result.merged;
      action.status = 'executed';
    } catch {
      action.status = 'skipped';
    }
  }

  const candidatesProcessed = candidates.length + actions.length;

  const signals: Record<string, number> = {
    avgScore: candidates.length > 0 ? candidates.reduce((s, c) => s + c.score, 0) / candidates.length : 0,
    lightBoost: lightSession.signals.deduplicated || 0,
    remBoost: remSession.signals.themesFound || 0,
  };

  const deepSession: DreamSession = {
    id: sessionId,
    phase: 'deep',
    candidatesProcessed,
    candidatesPromoted: promoted,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `深睡阶段：评分${candidates.length}条候选升级${promoted}条，清理${archived + merged}条`,
  };

  return { deepSession, promoted, archived, merged };
}

function detectCleanupActions(db: ReturnType<typeof getDatabase>): ConsolidationAction[] {
  const actions: ConsolidationAction[] = [];
  const affectedIds = new Set<string>();

  const dupActions = detectDuplicateActions(db, affectedIds);
  actions.push(...dupActions);

  const staleActions = detectStaleActions(db, affectedIds);
  actions.push(...staleActions);

  const flashActions = detectOldFlashActions(db, affectedIds);
  actions.push(...flashActions);

  return actions.slice(0, CONSOLIDATION_CONFIG.maxActionsPerPlan);
}

function detectDuplicateActions(db: ReturnType<typeof getDatabase>, affectedIds: Set<string>): ConsolidationAction[] {
  const threshold = CONSOLIDATION_CONFIG.duplicateSimilarity;
  const actions: ConsolidationAction[] = [];

  let memories: { id: string; title: string; embedding: Buffer }[];
  try {
    memories = db.prepare(`
      SELECT m.id, m.title, e.embedding
      FROM memories m
      JOIN embeddings e ON e.memory_id = m.id
      WHERE m.status = 'active'
      ORDER BY m.created_at ASC
      LIMIT 200
    `).all() as { id: string; title: string; embedding: Buffer }[];
  } catch {
    return actions;
  }

  if (memories.length < 2) return actions;

  const mergedSet = new Set<string>();

  for (let i = 0; i < memories.length; i++) {
    if (mergedSet.has(memories[i].id)) continue;
    for (let j = i + 1; j < memories.length; j++) {
      if (mergedSet.has(memories[j].id)) continue;

      const vecA = bufferToEmbedding(memories[i].embedding);
      const vecB = bufferToEmbedding(memories[j].embedding);
      const sim = cosineSimilarity(vecA, vecB);

      if (sim > threshold) {
        const keeper = memories[i].id;
        const removed = memories[j].id;

        if (!affectedIds.has(keeper) && !affectedIds.has(removed)) {
          actions.push({
            id: uuid(),
            type: 'deduplicate',
            sourceIds: [keeper, removed],
            targetId: keeper,
            description: `「${memories[i].title}」与「${memories[j].title}」相似度${sim.toFixed(2)}，保留前者`,
            status: 'pending',
          });
          affectedIds.add(removed);
          mergedSet.add(removed);
        }
      }
    }
  }

  return actions;
}

function detectStaleActions(db: ReturnType<typeof getDatabase>, affectedIds: Set<string>): ConsolidationAction[] {
  const staleDays = CONSOLIDATION_CONFIG.staleDays;
  const actions: ConsolidationAction[] = [];
  const exclude = buildExcludeClause(affectedIds);

  const stale = db.prepare(`
    SELECT id, title, layer FROM memories
    WHERE status = 'active'
      AND layer IN ('short', 'long')
      AND decay_factor < 0.3
      AND last_hit_at IS NOT NULL
      AND last_hit_at <= datetime('now', ? || ' days')
      ${exclude.clause}
  `).all(`-${staleDays}`, ...exclude.params) as { id: string; title: string; layer: string }[];

  for (const m of stale) {
    if (!affectedIds.has(m.id)) {
      actions.push({
        id: uuid(),
        type: 'archive_stale',
        sourceIds: [m.id],
        description: `「${m.title}」(${m.layer}层)已${staleDays}天未访问且衰变因子<0.3，归档`,
        status: 'pending',
      });
      affectedIds.add(m.id);
    }
  }

  return actions;
}

function detectOldFlashActions(db: ReturnType<typeof getDatabase>, affectedIds: Set<string>): ConsolidationAction[] {
  const maxDays = CONSOLIDATION_CONFIG.flashMaxDays;
  const actions: ConsolidationAction[] = [];
  const exclude = buildExcludeClause(affectedIds);

  const oldFlash = db.prepare(`
    SELECT id, title FROM memories
    WHERE status = 'active'
      AND layer = 'flash'
      AND created_at <= datetime('now', ? || ' days')
      ${exclude.clause}
  `).all(`-${maxDays}`, ...exclude.params) as { id: string; title: string }[];

  for (const m of oldFlash) {
    if (!affectedIds.has(m.id)) {
      actions.push({
        id: uuid(),
        type: 'archive_flash',
        sourceIds: [m.id],
        description: `闪念「${m.title}」已超过${maxDays}天，归档`,
        status: 'pending',
      });
      affectedIds.add(m.id);
    }
  }

  return actions;
}

function buildExcludeClause(ids: Set<string>): { clause: string; params: string[] } {
  if (ids.size === 0) return { clause: '', params: [] };
  const params = Array.from(ids);
  const clause = `AND id NOT IN (${params.map(() => '?').join(',')})`;
  return { clause, params };
}

function createSnapshots(db: ReturnType<typeof getDatabase>, reportId: string, memoryIds: string[]): void {
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO consolidation_snapshots (id, plan_id, memory_id, title, content, layer, status, tags, metadata, project, agent_space, confidence, decay_factor, captured_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const mid of memoryIds) {
    const mem = getMemory(mid);
    if (!mem) continue;

    stmt.run(
      uuid(),
      reportId,
      mem.id,
      mem.title,
      mem.content,
      mem.layer,
      mem.status,
      mem.tags ? JSON.stringify(mem.tags) : null,
      mem.metadata ? JSON.stringify(mem.metadata) : null,
      mem.project ?? null,
      mem.agentSpace,
      mem.confidence,
      mem.decayFactor,
      now,
    );
  }
}

function executeAction(db: ReturnType<typeof getDatabase>, action: ConsolidationAction): { promoted: number; archived: number; merged: number } {
  switch (action.type) {
    case 'deduplicate': {
      const [keeperId, removedId] = action.sourceIds;
      const keeper = getMemory(keeperId);
      const removed = getMemory(removedId);
      if (!keeper || !removed) throw new Error('Memory not found');

      const mergedTags = [...new Set([...(keeper.tags || []), ...(removed.tags || [])])];
      const mergedContent = keeper.content + '\n\n---\n' + removed.content;

      updateMemory(keeperId, {
        content: mergedContent,
        tags: mergedTags,
      }, `梦境合并：与「${removed.title}」合并`);

      forgetMemory(removedId, 'archive');
      return { promoted: 0, archived: 0, merged: 1 };
    }

    case 'archive_stale':
    case 'archive_flash': {
      for (const id of action.sourceIds) {
        forgetMemory(id, 'archive');
      }
      return { promoted: 0, archived: action.sourceIds.length, merged: 0 };
    }

    default:
      return { promoted: 0, archived: 0, merged: 0 };
  }
}

function scoreCandidates(db: ReturnType<typeof getDatabase>): DreamCandidate[] {
  const lookback = DREAM_THRESHOLDS.lookbackDays;

  const memories = db.prepare(`
    SELECT m.id, m.title, m.content, m.layer, m.tags, m.hit_count, m.created_at,
           m.confidence, m.decay_factor, m.project
    FROM memories m
    WHERE m.status = 'active'
      AND m.layer IN ('short', 'long')
      AND m.created_at >= datetime('now', ? || ' days')
  `).all(`-${lookback}`) as { id: string; title: string; content: string; layer: string; tags: string | null; hit_count: number; created_at: string; confidence: number; decay_factor: number; project: string | null }[];

  const candidates: DreamCandidate[] = [];

  for (const mem of memories) {
    const daysSinceCreation = Math.max(1, (Date.now() - new Date(mem.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const tags: string[] = mem.tags ? JSON.parse(mem.tags) : [];

    const signals: DreamSignals = {
      relevance: Math.min(1.0, mem.confidence),
      frequency: Math.min(1.0, mem.hit_count / 20),
      queryDiversity: Math.min(1.0, mem.hit_count / 10),
      recency: Math.exp(-daysSinceCreation / DREAM_THRESHOLDS.recencyHalfLifeDays),
      consolidation: Math.min(1.0, mem.hit_count > 0 ? 1 - mem.decay_factor + 0.5 : 0),
      conceptualRichness: Math.min(1.0, tags.length / 5),
    };

    const score =
      DREAM_SIGNAL_WEIGHTS.relevance * signals.relevance +
      DREAM_SIGNAL_WEIGHTS.frequency * signals.frequency +
      DREAM_SIGNAL_WEIGHTS.queryDiversity * signals.queryDiversity +
      DREAM_SIGNAL_WEIGHTS.recency * signals.recency +
      DREAM_SIGNAL_WEIGHTS.consolidation * signals.consolidation +
      DREAM_SIGNAL_WEIGHTS.conceptualRichness * signals.conceptualRichness;

    candidates.push({
      memoryId: mem.id,
      title: mem.title,
      content: mem.content,
      layer: mem.layer as DreamCandidate['layer'],
      tags,
      hitCount: mem.hit_count,
      uniqueQueryCount: mem.hit_count,
      daysSinceCreation: Math.round(daysSinceCreation),
      score,
      signals,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function computeJaccard(setA: string[], setB: string[]): number {
  if (setA.length === 0 && setB.length === 0) return 1.0;
  const a = new Set(setA.map(s => s.toLowerCase()));
  const b = new Set(setB.map(s => s.toLowerCase()));
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function computeTextSimilarity(textA: string, textB: string): number {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
  const union = new Set([...wordsA, ...wordsB]);
  if (union.size === 0) return 1.0;
  return intersection.size / union.size;
}

export function rollbackDream(reportId: string): DreamReport {
  const db = getDatabase();
  const report = getDreamReport(reportId);
  if (!report) throw new Error(`Report not found: ${reportId}`);
  if (report.status !== 'completed') throw new Error(`Report status is '${report.status}', can only rollback 'completed' reports`);

  const snapshots = db.prepare(`
    SELECT * FROM consolidation_snapshots WHERE plan_id = ?
  `).all(reportId) as Record<string, unknown>[];

  for (const snap of snapshots) {
    const memId = snap.memory_id as string;
    const existing = getMemory(memId);

    if (!existing) {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT INTO memories (id, title, content, layer, project, agent_space, owner_agent_id, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, metadata, source, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memId,
        snap.title as string,
        snap.content as string,
        snap.layer as string,
        snap.project as string | null,
        snap.agent_space as string,
        null,
        snap.confidence as number,
        snap.decay_factor as number,
        snap.captured_at as string,
        now,
        snap.tags ? snap.tags as string : null,
        snap.metadata ? snap.metadata as string : null,
        null,
        null,
      );
      continue;
    }

    if (existing.status === 'archived' || existing.status === 'decayed') {
      restoreMemory(memId);
    }

    if (existing.status === 'active') {
      updateMemory(memId, {
        title: snap.title as string,
        content: snap.content as string,
        tags: snap.tags ? JSON.parse(snap.tags as string) : undefined,
        metadata: snap.metadata ? JSON.parse(snap.metadata as string) : undefined,
      }, `回滚梦境 ${reportId}`);
    }
  }

  db.prepare(`UPDATE dream_reports SET status = 'rolled_back' WHERE id = ?`).run(reportId);

  return { ...report, status: 'rolled_back' };
}

export function getDreamReport(reportId: string): DreamReport | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM dream_reports WHERE id = ?`).get(reportId) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    sessions: JSON.parse(row.sessions as string),
    totalCandidates: row.total_candidates as number,
    promoted: row.promoted as number,
    archived: row.archived as number,
    merged: row.merged as number,
    status: row.status as DreamReport['status'],
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string | undefined,
  };
}

export function listDreamReports(limit = 20): DreamReport[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM dream_reports ORDER BY created_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[];

  return rows.map(row => ({
    id: row.id as string,
    sessions: JSON.parse(row.sessions as string),
    totalCandidates: row.total_candidates as number,
    promoted: row.promoted as number,
    archived: row.archived as number,
    merged: row.merged as number,
    status: row.status as DreamReport['status'],
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string | undefined,
  }));
}

export function getDreamSignalsForReport(reportId: string): { memoryId: string; title: string; score: number; promoted: boolean; signals: DreamSignals }[] {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT ds.memory_id, m.title, ds.total_score, ds.promoted,
           ds.relevance, ds.frequency, ds.query_diversity, ds.recency, ds.consolidation, ds.conceptual_richness
    FROM dream_signals ds
    LEFT JOIN memories m ON m.id = ds.memory_id
    WHERE ds.report_id = ?
    ORDER BY ds.total_score DESC
  `).all(reportId) as { memory_id: string; title: string | null; total_score: number; promoted: number; relevance: number; frequency: number; query_diversity: number; recency: number; consolidation: number; conceptual_richness: number }[];

  return rows.map(r => ({
    memoryId: r.memory_id,
    title: r.title || '(unknown)',
    score: r.total_score,
    promoted: r.promoted === 1,
    signals: {
      relevance: r.relevance,
      frequency: r.frequency,
      queryDiversity: r.query_diversity,
      recency: r.recency,
      consolidation: r.consolidation,
      conceptualRichness: r.conceptual_richness,
    },
  }));
}

export function formatDreamReport(report: DreamReport): string {
  const lines: string[] = [];
  lines.push(`🌙 梦境报告 #${report.id.slice(0, 8)}`);
  lines.push(`状态: ${report.status}`);
  lines.push(`时间: ${report.completedAt || report.createdAt}`);
  lines.push('');

  for (const session of report.sessions) {
    const phaseIcon = session.phase === 'light' ? '☀️ 浅睡' : session.phase === 'rem' ? '👁️ REM' : '🌑 深睡';
    lines.push(`${phaseIcon}: ${session.summary || `${session.candidatesProcessed}条处理，${session.candidatesPromoted}条提升`}`);
  }

  lines.push('');
  lines.push(`📊 总计: ${report.totalCandidates}条候选，${report.promoted}条升级，${report.archived}条归档，${report.merged}条合并`);
  lines.push(`💡 如需回滚: keymemory dream --rollback ${report.id}`);

  return lines.join('\n');
}
