import { v4 as uuid } from 'uuid';
import type { DreamPhase, DreamCandidate, DreamSignals, DreamSession, DreamReport } from '@keymemory/shared';
import { DREAM_SIGNAL_WEIGHTS, DREAM_THRESHOLDS } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, bufferToEmbedding } from '../embed/onnx.js';
import { getMemory, updateMemory } from './atom.js';
import { forgetMemory } from './forgetting.js';
import { moveLayer } from './layer.js';
import { planConsolidation, executeConsolidation, rollbackConsolidation } from './consolidation.js';

export function runDreamCycle(): DreamReport {
  const reportId = uuid();
  const now = new Date().toISOString();
  const sessions: DreamSession[] = [];

  const db = getDatabase();
  db.prepare(`
    INSERT INTO dream_reports (id, status, total_candidates, promoted, archived, merged, sessions, created_at)
    VALUES (?, 'running', 0, 0, 0, 0, '[]', ?)
  `).run(reportId, now);

  const lightSession = runLightPhase(reportId);
  sessions.push(lightSession);

  const remSession = runRemPhase(reportId, lightSession);
  sessions.push(remSession);

  const deepSession = runDeepPhase(reportId, lightSession, remSession);
  sessions.push(deepSession);

  const totalCandidates = lightSession.candidatesProcessed + remSession.candidatesProcessed + deepSession.candidatesProcessed;
  const promoted = deepSession.candidatesPromoted;

  const completedAt = new Date().toISOString();
  db.prepare(`
    UPDATE dream_reports
    SET status = 'completed', total_candidates = ?, promoted = ?, sessions = ?, completed_at = ?
    WHERE id = ?
  `).run(totalCandidates, promoted, JSON.stringify(sessions), completedAt, reportId);

  return {
    id: reportId,
    sessions,
    totalCandidates,
    promoted,
    archived: 0,
    merged: 0,
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

  const session: DreamSession = {
    id: sessionId,
    phase: 'light',
    candidatesProcessed,
    candidatesPromoted,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `浅睡阶段：扫描${candidatesProcessed}条近期记忆，标记${dedupCount}条重复`,
  };

  return session;
}

function runRemPhase(reportId: string, lightSession: DreamSession): DreamSession {
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

  const session: DreamSession = {
    id: sessionId,
    phase: 'rem',
    candidatesProcessed,
    candidatesPromoted,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `REM阶段：分析${candidatesProcessed}条短期记忆，发现${themes.length}个主题（${themes.slice(0, 3).map(t => t[0]).join(', ')}）`,
  };

  return session;
}

function runDeepPhase(reportId: string, lightSession: DreamSession, remSession: DreamSession): DreamSession {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();

  const candidates = scoreCandidates(db);

  const promoted: DreamCandidate[] = [];
  const notPromoted: DreamCandidate[] = [];

  for (const candidate of candidates) {
    if (
      candidate.score >= DREAM_THRESHOLDS.minScore &&
      candidate.hitCount >= DREAM_THRESHOLDS.minRecallCount &&
      candidate.uniqueQueryCount >= DREAM_THRESHOLDS.minUniqueQueries
    ) {
      promoted.push(candidate);
    } else {
      notPromoted.push(candidate);
    }
  }

  for (const candidate of promoted) {
    if (candidate.layer === 'short') {
      moveLayer(candidate.memoryId, 'long', `梦境升级：评分${candidate.score.toFixed(2)}`);
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

  const candidatesProcessed = candidates.length;
  const candidatesPromoted = promoted.length;

  const signals: Record<string, number> = {
    avgScore: candidates.length > 0 ? candidates.reduce((s, c) => s + c.score, 0) / candidates.length : 0,
    lightBoost: lightSession.signals.deduplicated || 0,
    remBoost: remSession.signals.themesFound || 0,
  };

  const session: DreamSession = {
    id: sessionId,
    phase: 'deep',
    candidatesProcessed,
    candidatesPromoted,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `深睡阶段：评分${candidatesProcessed}条候选，升级${candidatesPromoted}条为长期记忆`,
  };

  return session;
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
  lines.push(`📊 总计: ${report.totalCandidates}条候选，${report.promoted}条升级为长期记忆`);

  return lines.join('\n');
}
