import { v4 as uuid } from 'uuid';
import type { DreamPhase, DreamCandidate, DreamSignals, DreamSession, DreamReport, DreamReportDetails, ConsolidationAction, DreamTodoItem } from '@keymemory/shared';
import { DREAM_SIGNAL_WEIGHTS, DREAM_THRESHOLDS, CONSOLIDATION_CONFIG, DREAM_CONFIG } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { cosineSimilarity, bufferToEmbedding } from '../embed/onnx.js';
import { getMemory, updateMemory } from './atom.js';
import { forgetMemory, restoreMemory } from './forgetting.js';
import { moveLayer } from './layer.js';

export function runDreamCycle(): DreamReport {
  const startTime = Date.now();
  const reportId = uuid();
  const now = new Date().toISOString();
  const sessions: DreamSession[] = [];

  const db = getDatabase();
  db.prepare(`
    INSERT INTO dream_reports (id, status, total_candidates, promoted, archived, merged, sessions, todo_items, created_at)
    VALUES (?, 'running', 0, 0, 0, 0, '[]', '[]', ?)
  `).run(reportId, now);

  let promoted = 0;
  let archived = 0;
  let merged = 0;
  let totalCandidates = 0;
  let todoItems: DreamTodoItem[] = [];
  const details: DreamReportDetails = { promoted: [], archived: [], merged: [] };

  const savepointName = `sp_${reportId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  if (!/^sp_[a-zA-Z0-9_]+$/.test(savepointName)) {
    throw new Error('Invalid savepoint name');
  }

  try {
    db.exec(`SAVEPOINT ${savepointName}`);

    // Phase 1: Light - 扫描并去重近期记忆
    const lightResult = runLightPhase(reportId, details);
    sessions.push(lightResult.session);
    merged += lightResult.mergedCount;
    totalCandidates += lightResult.session.candidatesProcessed;

    // Phase 2: REM - 主题分析与标签优化
    const remResult = runRemPhase(reportId);
    sessions.push(remResult.session);
    totalCandidates += remResult.session.candidatesProcessed;

    // Phase 3: Deep - 评分升级、智能合并、归档清理
    const deepResult = runDeepPhase(reportId, lightResult.session, remResult.session, details);
    sessions.push(deepResult.deepSession);
    promoted += deepResult.promoted;
    archived += deepResult.archived;
    merged += deepResult.merged;
    todoItems = deepResult.todoItems;
    totalCandidates += deepResult.deepSession.candidatesProcessed;

    // Phase 4: Semantic - 基于语义相似度的关联合并
    const semanticResult = runSemanticMergePhase(reportId, details);
    sessions.push(semanticResult.session);
    merged += semanticResult.mergedCount;
    totalCandidates += semanticResult.session.candidatesProcessed;

    // Phase 5: Project Clustering - 项目聚类建议
    const clusteringResult = runProjectClusteringPhase(reportId);
    sessions.push(clusteringResult.session);
    totalCandidates += clusteringResult.session.candidatesProcessed;

    db.exec(`RELEASE SAVEPOINT ${savepointName}`);

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : '';
    console.error('[Dream] Cycle failed:', errorMessage);
    if (errorStack) console.error('[Dream] Stack:', errorStack);

    try {
      db.exec(`ROLLBACK TO SAVEPOINT ${savepointName}`);
    } catch (rollbackErr) {
      console.error('[Dream] Savepoint rollback failed:', (rollbackErr as Error).message);
    }

    const failedAt = new Date().toISOString();
    db.prepare(`
      UPDATE dream_reports
      SET status = 'failed', sessions = ?, completed_at = ?, details = ?
      WHERE id = ?
    `).run(JSON.stringify(sessions), failedAt, JSON.stringify(details), reportId);

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
      todoItems,
      details,
      durationMs: Date.now() - startTime,
    };
  }

  const completedAt = new Date().toISOString();
  db.prepare(`
    UPDATE dream_reports
    SET status = 'completed', total_candidates = ?, promoted = ?, archived = ?, merged = ?, sessions = ?, todo_items = ?, completed_at = ?, details = ?
    WHERE id = ?
  `).run(totalCandidates, promoted, archived, merged, JSON.stringify(sessions), JSON.stringify(todoItems), completedAt, JSON.stringify(details), reportId);

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
    todoItems,
    details,
    durationMs: Date.now() - startTime,
  };
}

// ========== Light Phase: 去重与初步清理 ==========

function runLightPhase(reportId: string, details: DreamReportDetails): { session: DreamSession; mergedCount: number } {
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

  let mergedCount = 0;
  const processedIds = new Set<string>();
  const mergeGroups: { keeper: string; duplicates: string[] }[] = [];

  // 检测重复组
  for (let i = 0; i < recentMemories.length; i++) {
    if (processedIds.has(recentMemories[i].id)) continue;
    
    const duplicates: string[] = [];
    const tagsA = recentMemories[i].tags ? JSON.parse(recentMemories[i].tags as string) as string[] : [];
    
    for (let j = i + 1; j < recentMemories.length; j++) {
      if (processedIds.has(recentMemories[j].id)) continue;

      const tagsB = recentMemories[j].tags ? JSON.parse(recentMemories[j].tags as string) as string[] : [];
      const jaccard = computeJaccard(tagsA, tagsB);

      if (jaccard > DREAM_THRESHOLDS.lightJaccardThreshold) {
        const textSim = computeTextSimilarity(recentMemories[i].content, recentMemories[j].content);
        if (textSim > 0.75) {
          duplicates.push(recentMemories[j].id);
          processedIds.add(recentMemories[j].id);
        }
      }
    }

    if (duplicates.length > 0) {
      mergeGroups.push({ keeper: recentMemories[i].id, duplicates });
      processedIds.add(recentMemories[i].id);
    }
  }

  // 执行智能合并
  for (const group of mergeGroups) {
    try {
      const keeper = getMemory(group.keeper);
      if (!keeper) continue;

      const allContents: string[] = [keeper.content];
      const allTags = new Set(keeper.tags || []);
      let totalHits = keeper.hitCount;

      for (const dupId of group.duplicates) {
        const dup = getMemory(dupId);
        if (!dup) continue;
        
        allContents.push(dup.content);
        (dup.tags || []).forEach(t => allTags.add(t));
        totalHits += dup.hitCount;
        
        // 归档重复项
        forgetMemory(dupId, 'archive');
        details.merged.push({ memoryId: dupId, title: dup.title, intoId: group.keeper, intoTitle: keeper.title });
        details.archived.push({ memoryId: dupId, title: dup.title, reason: '重复合并' });
      }

      // 智能合并内容
      const mergedContent = smartMergeContents(allContents);
      const mergedTags = Array.from(allTags);

      updateMemory(group.keeper, {
        content: mergedContent,
        tags: mergedTags,
      }, `整理合并：合并 ${group.duplicates.length} 条重复记忆`);

      // 更新命中次数
      db.prepare(`UPDATE memories SET hit_count = ? WHERE id = ?`).run(totalHits, group.keeper);

      mergedCount += group.duplicates.length;
    } catch (err) {
      console.error(`[Light Phase] Failed to merge group ${group.keeper}:`, err);
    }
  }

  const candidatesProcessed = recentMemories.length;

  const signals: Record<string, number> = { 
    scanned: candidatesProcessed,
    groupsFound: mergeGroups.length,
    merged: mergedCount 
  };

  const session: DreamSession = {
    id: sessionId,
    phase: 'light',
    candidatesProcessed,
    candidatesPromoted: mergeGroups.length,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `初步整理：扫描${candidatesProcessed}条记忆，发现${mergeGroups.length}组重复，合并${mergedCount}条`,
  };

  return { session, mergedCount };
}

// ========== REM Phase: 主题分析与标签优化 ==========

function runRemPhase(reportId: string): { session: DreamSession } {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();
  const lookback = DREAM_THRESHOLDS.lookbackDays;

  const shortTermMemories = db.prepare(`
    SELECT m.id, m.title, m.content, m.tags, m.hit_count, m.project_id
    FROM memories m
    WHERE m.status = 'active'
      AND m.layer = 'short'
      AND m.created_at >= datetime('now', ? || ' days')
  `).all(`-${lookback}`) as { id: string; title: string; content: string; tags: string | null; hit_count: number; project_id: string }[];

  // 分析标签频率
  const tagFrequency = new Map<string, number>();
  const memoryTagMap = new Map<string, string[]>();

  for (const mem of shortTermMemories) {
    const tags: string[] = mem.tags ? JSON.parse(mem.tags) : [];
    memoryTagMap.set(mem.id, tags);
    for (const tag of tags) {
      tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
    }
  }

  // 发现热门主题（出现2次以上的标签）
  const hotThemes = Array.from(tagFrequency.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  // 为缺少热门主题标签的记忆补充标签
  let tagsAdded = 0;
  for (const mem of shortTermMemories) {
    const currentTags = memoryTagMap.get(mem.id) || [];
    const currentTagSet = new Set(currentTags.map(t => t.toLowerCase()));
    const missingTags: string[] = [];

    for (const [theme] of hotThemes) {
      if (!currentTagSet.has(theme.toLowerCase())) {
        // 检查记忆内容是否包含该主题关键词
        if (mem.content.toLowerCase().includes(theme.toLowerCase()) || 
            mem.title.toLowerCase().includes(theme.toLowerCase())) {
          missingTags.push(theme);
        }
      }
    }

    if (missingTags.length > 0) {
      try {
        updateMemory(mem.id, {
          tags: [...currentTags, ...missingTags.slice(0, 3)], // 最多补充3个
        }, `整理优化：补充关联标签`);
        tagsAdded += missingTags.length;
      } catch (err) {
        console.error(`[REM Phase] Failed to update tags for ${mem.id}:`, err);
      }
    }
  }

  const candidatesProcessed = shortTermMemories.length;

  const signals: Record<string, number> = {
    themesFound: hotThemes.length,
    tagTypes: tagFrequency.size,
    tagsAdded,
  };

  const session: DreamSession = {
    id: sessionId,
    phase: 'rem',
    candidatesProcessed,
    candidatesPromoted: tagsAdded,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `关联分析：分析${candidatesProcessed}条记忆，发现${hotThemes.length}个热门主题，补充${tagsAdded}个标签`,
  };

  return { session };
}

// ========== Deep Phase: 评分升级与清理 ==========

function runDeepPhase(reportId: string, lightSession: DreamSession, remSession: DreamSession, details: DreamReportDetails): {
  deepSession: DreamSession;
  promoted: number;
  archived: number;
  merged: number;
  todoItems: DreamTodoItem[];
} {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();

  // 检测需要清理的动作
  const actions = detectCleanupActions(db);
  const allAffectedIds = new Set<string>();
  for (const a of actions) {
    for (const id of a.sourceIds) allAffectedIds.add(id);
    if (a.targetId) allAffectedIds.add(a.targetId);
  }

  // 创建快照以便回滚
  createSnapshots(db, reportId, Array.from(allAffectedIds));

  let promoted = 0;
  let archived = 0;
  let merged = 0;

  // 评分并升级高质量记忆
  const candidates = scoreCandidates(db);
  for (const candidate of candidates) {
    const isPromoted =
      candidate.score >= DREAM_THRESHOLDS.minScore &&
      candidate.hitCount >= DREAM_THRESHOLDS.minRecallCount &&
      candidate.uniqueQueryCount >= DREAM_THRESHOLDS.minUniqueQueries &&
      candidate.layer === 'short';

    if (isPromoted) {
      moveLayer(candidate.memoryId, 'long', `整理升级：评分${candidate.score.toFixed(2)}`);
      promoted++;
      details.promoted.push({ memoryId: candidate.memoryId, title: candidate.title, score: candidate.score });
    }

    db.prepare(`
      INSERT INTO dream_signals (id, report_id, memory_id, relevance, frequency, query_diversity, recency, consolidation, conceptual_richness, total_score, phase, promoted, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'deep', ?, ?)
    `).run(
      uuid(), reportId, candidate.memoryId,
      candidate.signals.relevance, candidate.signals.frequency,
      candidate.signals.queryDiversity, candidate.signals.recency,
      candidate.signals.consolidation, candidate.signals.conceptualRichness,
      candidate.score, isPromoted ? 1 : 0, now,
    );
  }

  // 执行清理动作
  for (const action of actions) {
    try {
      const result = executeAction(db, action, details);
      promoted += result.promoted;
      archived += result.archived;
      merged += result.merged;
      action.status = 'executed';
    } catch {
      action.status = 'skipped';
    }
  }

  const candidatesProcessed = candidates.length + actions.length;

  // 检测问题记忆
  const orphans = detectOrphanMemories(db);
  const conflicts = detectConflictMemories(db);
  const todoItems: DreamTodoItem[] = [...orphans, ...conflicts];

  const signals: Record<string, number> = {
    avgScore: candidates.length > 0 ? candidates.reduce((s, c) => s + c.score, 0) / candidates.length : 0,
    lightBoost: lightSession.signals.merged || 0,
    remBoost: remSession.signals.tagsAdded || 0,
    orphansFound: orphans.length,
    conflictsFound: conflicts.length,
  };

  const deepSession: DreamSession = {
    id: sessionId,
    phase: 'deep',
    candidatesProcessed,
    candidatesPromoted: promoted,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `深度整理：评分${candidates.length}条候选，升级${promoted}条，清理${archived + merged}条${todoItems.length > 0 ? `，发现${todoItems.length}条待处理` : ''}`,
  };

  return { deepSession, promoted, archived, merged, todoItems };
}

// ========== Semantic Merge Phase: 语义关联合并 ==========

function runSemanticMergePhase(reportId: string, details: DreamReportDetails): { session: DreamSession; mergedCount: number } {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();
  let mergedCount = 0;

  // 获取所有活跃的、有嵌入向量的短期记忆
  let memories: { id: string; title: string; embedding: Buffer }[];
  try {
    memories = db.prepare(`
      SELECT m.id, m.title, e.embedding
      FROM memories m
      JOIN embeddings e ON e.memory_id = m.id
      WHERE m.status = 'active'
        AND m.layer IN ('short', 'flash')
      ORDER BY m.created_at DESC
      LIMIT 150
    `).all() as { id: string; title: string; embedding: Buffer }[];
  } catch (err) {
    const msg = (err as Error).message || '';
    // 仅对无表/无数据错误跳过，其他数据库错误应抛出
    if (msg.includes('no such table') || msg.includes('SQLITE_ERROR')) {
      const session: DreamSession = {
        id: sessionId,
        phase: 'deep',
        candidatesProcessed: 0,
        candidatesPromoted: 0,
        signals: { skipped: 1 },
        startedAt: now,
        completedAt: new Date().toISOString(),
        summary: '语义合并：跳过（无嵌入数据）',
      };
      return { session, mergedCount: 0 };
    }
    throw err;
  }

  if (memories.length < 2) {
    const session: DreamSession = {
      id: sessionId,
      phase: 'deep',
      candidatesProcessed: 0,
      candidatesPromoted: 0,
      signals: { skipped: 1 },
      startedAt: now,
      completedAt: new Date().toISOString(),
      summary: '语义合并：记忆数量不足，跳过',
    };
    return { session, mergedCount: 0 };
  }

  const mergeGroups: { keeper: string; related: string[]; similarity: number }[] = [];
  const processedIds = new Set<string>();

  // 基于语义相似度找到关联组
  for (let i = 0; i < memories.length; i++) {
    if (processedIds.has(memories[i].id)) continue;

    const related: string[] = [];
    const vecA = bufferToEmbedding(memories[i].embedding);

    for (let j = i + 1; j < memories.length; j++) {
      if (processedIds.has(memories[j].id)) continue;

      const vecB = bufferToEmbedding(memories[j].embedding);
      const sim = cosineSimilarity(vecA, vecB);

      // 使用配置的相似度阈值来找到"相关但不完全相同"的记忆
      if (sim > DREAM_CONFIG.semanticMergeThreshold && sim < CONSOLIDATION_CONFIG.duplicateSimilarity) {
        related.push(memories[j].id);
        processedIds.add(memories[j].id);
      }
    }

    if (related.length > 0) {
      mergeGroups.push({ keeper: memories[i].id, related, similarity: 0 });
      processedIds.add(memories[i].id);
    }
  }

  // 执行语义合并
  for (const group of mergeGroups) {
    try {
      const keeper = getMemory(group.keeper);
      if (!keeper) continue;

      const allContents: string[] = [keeper.content];
      const allTags = new Set(keeper.tags || []);
      let totalHits = keeper.hitCount;
      const relatedTitles: string[] = [];

      for (const relatedId of group.related) {
        const related = getMemory(relatedId);
        if (!related) continue;

        allContents.push(related.content);
        (related.tags || []).forEach(t => allTags.add(t));
        totalHits += related.hitCount;
        relatedTitles.push(related.title);

        // 归档被合并的记忆
        forgetMemory(relatedId, 'archive');
        details.merged.push({ memoryId: relatedId, title: related.title, intoId: group.keeper, intoTitle: keeper.title });
        details.archived.push({ memoryId: relatedId, title: related.title, reason: '语义合并' });
      }

      // 智能合并
      const mergedContent = smartMergeContents(allContents);
      const mergedTags = Array.from(allTags);

      // 更新标题以反映合并（如果原始标题太简单）
      let newTitle = keeper.title;
      if (keeper.title.length < 15 && relatedTitles.length > 0) {
        newTitle = `${keeper.title}（及相关${relatedTitles.length}条记录）`;
      }

      updateMemory(group.keeper, {
        title: newTitle,
        content: mergedContent,
        tags: mergedTags,
      }, `语义合并：整合 ${group.related.length} 条关联记忆`);

      // 更新命中次数
      db.prepare(`UPDATE memories SET hit_count = ? WHERE id = ?`).run(totalHits, group.keeper);

      mergedCount += group.related.length;
    } catch (err) {
      console.error(`[Semantic Phase] Failed to merge group ${group.keeper}:`, err);
    }
  }

  const candidatesProcessed = memories.length;

  const signals: Record<string, number> = {
    scanned: candidatesProcessed,
    groupsFound: mergeGroups.length,
    merged: mergedCount,
  };

  const session: DreamSession = {
    id: sessionId,
    phase: 'deep',
    candidatesProcessed,
    candidatesPromoted: mergeGroups.length,
    signals,
    startedAt: now,
    completedAt: new Date().toISOString(),
    summary: `语义合并：分析${candidatesProcessed}条记忆，发现${mergeGroups.length}组关联，整合${mergedCount}条`,
  };

  return { session, mergedCount };
}

// ========== 智能内容合并 ==========

function smartMergeContents(contents: string[]): string {
  if (contents.length === 0) return '';
  if (contents.length === 1) return contents[0];

  // 步骤1：提取所有段落
  const allParagraphs: string[] = [];
  for (const content of contents) {
    const paragraphs = content.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    allParagraphs.push(...paragraphs);
  }

  // 步骤2：去重相似段落
  const uniqueParagraphs: string[] = [];
  for (const para of allParagraphs) {
    let isDuplicate = false;
    for (const existing of uniqueParagraphs) {
      if (computeTextSimilarity(para, existing) > 0.7) {
        // 保留更长的段落
        if (para.length > existing.length) {
          const idx = uniqueParagraphs.indexOf(existing);
          uniqueParagraphs[idx] = para;
        }
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      uniqueParagraphs.push(para);
    }
  }

  // 步骤3：按原始顺序重组（基于第一个内容中的顺序）
  const firstContent = contents[0];
  const firstParagraphs = firstContent.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
  
  const orderedParagraphs: string[] = [];
  const used = new Set<string>();

  // 先按第一个内容的顺序排列
  for (const para of firstParagraphs) {
    const match = uniqueParagraphs.find(p => computeTextSimilarity(p, para) > 0.6 && !used.has(p));
    if (match) {
      orderedParagraphs.push(match);
      used.add(match);
    }
  }

  // 再添加剩余的唯一段落
  for (const para of uniqueParagraphs) {
    if (!used.has(para)) {
      orderedParagraphs.push(para);
    }
  }

  return orderedParagraphs.join('\n\n');
}

// ========== 清理动作检测 ==========

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

function detectOrphanMemories(db: ReturnType<typeof getDatabase>): DreamTodoItem[] {
  const rows = db.prepare(`
    SELECT m.id, m.title, m.layer FROM memories m
    WHERE m.status = 'active'
      AND m.id NOT IN (SELECT memory_id FROM memory_entities)
    LIMIT 20
  `).all() as { id: string; title: string; layer: string }[];

  return rows.map(r => ({
    type: 'orphan' as const,
    memoryId: r.id,
    title: r.title,
    reason: r.layer === 'flash'
      ? '该闪念未关联任何实体、未归属项目，易被遗忘'
      : '该记忆未关联任何实体、未归属项目，无法被有效检索',
  }));
}

function detectConflictMemories(db: ReturnType<typeof getDatabase>): DreamTodoItem[] {
  // 更精确的冲突模式：检测成对的对立表述
  const conflictPairs: [string[], string[]][] = [
    [['喜欢', '喜爱', '爱'], ['讨厌', '厌恶', '恨', '不喜欢']],
    [['支持', '赞成', '同意'], ['反对', '否定', '拒绝']],
    [['成功', '完成', '达成'], ['失败', '落空', '未达成']],
    [['是', '属于', '为'], ['不是', '非', '不属于', '不为']],
    [['有', '拥有', '具备'], ['没有', '无', '缺乏', '不具备']],
    [['正确', '准确', '无误'], ['错误', '有误', '不正确']],
    [['开启', '打开', '启用'], ['关闭', '停用', '禁用']],
    [['增加', '上升', '提升'], ['减少', '下降', '降低']],
  ];
  const items: DreamTodoItem[] = [];

  const entities = db.prepare(`
    SELECT e.id, e.name FROM entities e
    JOIN memory_entities me ON me.entity_id = e.id
    JOIN memories m ON m.id = me.memory_id AND m.status = 'active'
    GROUP BY e.id
    HAVING COUNT(me.memory_id) >= 2
    LIMIT 50
  `).all() as { id: string; name: string }[];

  for (const entity of entities) {
    const mems = db.prepare(`
      SELECT m.id, m.title, m.content FROM memories m
      JOIN memory_entities me ON me.memory_id = m.id
      WHERE me.entity_id = ? AND m.status = 'active'
    `).all(entity.id) as { id: string; title: string; content: string }[];

    if (mems.length < 2) continue;

    // 检查是否同一实体下存在成对冲突
    for (const [posSet, negSet] of conflictPairs) {
      const posMem = mems.find(m => posSet.some(p => m.content.includes(p)));
      const negMem = mems.find(m => negSet.some(n => m.content.includes(n)));
      if (posMem && negMem && posMem.id !== negMem.id) {
        items.push({
          type: 'conflict' as const,
          memoryId: negMem.id,
          title: negMem.title,
          reason: `实体「${entity.name}」存在矛盾表述：「${posMem.title}」称「${posSet.find(p => posMem.content.includes(p))}」，而此记忆称「${negSet.find(n => negMem.content.includes(n))}」`,
        });
        break; // 每个实体只报一个冲突
      }
    }
  }

  return items.slice(0, 20);
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
      mem.projectId,
      mem.agentSpace,
      mem.confidence,
      mem.decayFactor,
      now,
    );
  }
}

function executeAction(db: ReturnType<typeof getDatabase>, action: ConsolidationAction, details: DreamReportDetails): { promoted: number; archived: number; merged: number } {
  switch (action.type) {
    case 'deduplicate': {
      const [keeperId, removedId] = action.sourceIds;
      const keeper = getMemory(keeperId);
      const removed = getMemory(removedId);
      if (!keeper || !removed) throw new Error('Memory not found');

      const mergedTags = [...new Set([...(keeper.tags || []), ...(removed.tags || [])])];
      const mergedContent = smartMergeContents([keeper.content, removed.content]);

      updateMemory(keeperId, {
        content: mergedContent,
        tags: mergedTags,
      }, `整理合并：与「${removed.title}」合并`);

      // 合并命中次数
      const totalHits = keeper.hitCount + removed.hitCount;
      db.prepare(`UPDATE memories SET hit_count = ? WHERE id = ?`).run(totalHits, keeperId);

      forgetMemory(removedId, 'archive');
      details.merged.push({ memoryId: removedId, title: removed.title, intoId: keeperId, intoTitle: keeper.title });
      details.archived.push({ memoryId: removedId, title: removed.title, reason: '重复合并' });
      return { promoted: 0, archived: 0, merged: 1 };
    }

    case 'archive_stale':
    case 'archive_flash': {
      for (const id of action.sourceIds) {
        const mem = getMemory(id);
        forgetMemory(id, 'archive');
        if (mem) {
          details.archived.push({ memoryId: id, title: mem.title, reason: action.type === 'archive_stale' ? '过期归档' : '闪念清理' });
        }
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
           m.confidence, m.decay_factor, m.project_id
    FROM memories m
    WHERE m.status = 'active'
      AND m.layer IN ('short', 'long')
      AND m.created_at >= datetime('now', ? || ' days')
  `).all(`-${lookback}`) as { id: string; title: string; content: string; layer: string; tags: string | null; hit_count: number; created_at: string; confidence: number; decay_factor: number; project_id: string }[];

  // 批量查询各记忆的唯一查询数
  const uniqueQueryMap = new Map<string, number>();
  if (memories.length > 0) {
    try {
      const queryRows = db.prepare(`
        SELECT memory_id, COUNT(DISTINCT query) as unique_count
        FROM query_logs
        WHERE memory_id IN (${memories.map(() => '?').join(',')})
        GROUP BY memory_id
      `).all(...memories.map(m => m.id)) as { memory_id: string; unique_count: number }[];
      for (const row of queryRows) {
        uniqueQueryMap.set(row.memory_id, row.unique_count);
      }
    } catch {
      // query_logs 表可能不存在，忽略
    }
  }

  const candidates: DreamCandidate[] = [];

  for (const mem of memories) {
    const daysSinceCreation = Math.max(1, (Date.now() - new Date(mem.created_at).getTime()) / (1000 * 60 * 60 * 24));
    const tags: string[] = mem.tags ? JSON.parse(mem.tags) : [];

    // 优先使用 query_logs 统计的真实唯一查询数，否则以 hit_count 为下限估计
    const uniqueQueryCount = uniqueQueryMap.get(mem.id) ?? Math.max(1, Math.round(mem.hit_count * 0.6));

    const signals: DreamSignals = {
      relevance: Math.min(1.0, mem.confidence),
      frequency: Math.min(1.0, mem.hit_count / 20),
      queryDiversity: Math.min(1.0, uniqueQueryCount / 10),
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
      uniqueQueryCount,
      daysSinceCreation: Math.round(daysSinceCreation),
      score,
      signals,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function computeJaccard(setA: string[], setB: string[]): number {
  if (setA.length === 0 || setB.length === 0) return 0.0;
  const a = new Set(setA.map(s => s.toLowerCase()));
  const b = new Set(setB.map(s => s.toLowerCase()));
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function computeTextSimilarity(textA: string, textB: string): number {
  const tokensA = tokenize(textA);
  const tokensB = tokenize(textB);
  const intersection = new Set([...tokensA].filter(x => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  if (union.size === 0) return 1.0;
  return intersection.size / union.size;
}

function tokenize(text: string): Set<string> {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return new Set();

  // 检测是否以中文字符为主
  const cjkCount = (normalized.match(/[一-鿿]/g) || []).length;
  const totalCount = normalized.length;

  if (cjkCount / totalCount > 0.3) {
    // 中文/CJK 文本：按字符分词，同时保留长度>=2的连续英文/数字词
    const tokens = new Set<string>();
    for (let i = 0; i < normalized.length; i++) {
      const ch = normalized[i];
      if (/[一-鿿]/.test(ch)) {
        tokens.add(ch);
      }
    }
    const words = normalized.match(/[a-z0-9]{2,}/g);
    if (words) {
      for (const w of words) tokens.add(w);
    }
    return tokens;
  }

  // 英文/西文文本：按空白分词
  return new Set(normalized.split(/\s+/).filter(Boolean));
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
        INSERT INTO memories (id, title, content, layer, project_id, agent_space, owner_agent_id, confidence, hit_count, status, decay_factor, created_at, updated_at, tags, metadata, source, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memId,
        snap.title as string,
        snap.content as string,
        snap.layer as string,
        snap.project_id as string,
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
      }, `回滚整理 ${reportId}`);
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
    todoItems: row.todo_items ? JSON.parse(row.todo_items as string) as DreamTodoItem[] : [],
    details: row.details ? JSON.parse(row.details as string) as DreamReportDetails : undefined,
  };
}

export function listDreamReports(limit = 20): DreamReport[] {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM dream_reports ORDER BY created_at DESC LIMIT ?`).all(limit) as Record<string, unknown>[];
  const ids = rows.map(r => r.id as string);
  console.log('[Dream] listDreamReports returned IDs:', ids);

  return rows.map(row => ({
    id: row.id as string,
    sessions: JSON.parse(row.sessions as string),
    totalCandidates: row.total_candidates as number,
    promoted: row.promoted as number,
    archived: row.archived as number,
    merged: row.merged as number,
    status: row.status as DreamReport['status'],
    todoItems: row.todo_items ? JSON.parse(row.todo_items as string) as DreamTodoItem[] : [],
    createdAt: row.created_at as string,
    completedAt: row.completed_at as string | undefined,
    details: row.details ? JSON.parse(row.details as string) as DreamReportDetails : undefined,
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

export function deleteDreamReport(reportId: string): { success: boolean } {
  const db = getDatabase();
  console.log('[Dream] Deleting report:', reportId);

  // 先检查报告是否存在
  const existing = db.prepare(`SELECT id FROM dream_reports WHERE id = ?`).get(reportId) as { id: string } | undefined;
  console.log('[Dream] Report exists check:', existing ? existing.id : 'NOT FOUND');

  if (!existing) {
    console.log('[Dream] Report not found, returning 404');
    return { success: false };
  }

  try {
    // 先删除关联的 dream_signals
    const signalsResult = db.prepare(`DELETE FROM dream_signals WHERE report_id = ?`).run(reportId);
    console.log('[Dream] Deleted dream_signals:', signalsResult.changes);

    // 删除关联的 consolidation_snapshots
    const snapshotsResult = db.prepare(`DELETE FROM consolidation_snapshots WHERE plan_id = ?`).run(reportId);
    console.log('[Dream] Deleted consolidation_snapshots:', snapshotsResult.changes);

    // 删除报告本身
    const result = db.prepare(`DELETE FROM dream_reports WHERE id = ?`).run(reportId);
    console.log('[Dream] Deleted dream_reports:', result.changes);

    return { success: result.changes > 0 };
  } catch (err) {
    console.error('[Dream] Delete failed:', (err as Error).message);
    throw err;
  }
}

function runProjectClusteringPhase(reportId: string): { session: DreamSession; suggestionsCreated: number } {
  const db = getDatabase();
  const sessionId = uuid();
  const now = new Date().toISOString();
  let suggestionsCreated = 0;

  try {
    // 获取所有活跃项目（排除根级"未分类"）
    const projects = db.prepare(`
      SELECT id, name, path FROM projects
      WHERE (parent_id IS NOT NULL OR name != '未分类') AND depth <= 2
    `).all() as { id: string; name: string; path: string }[];

    if (projects.length < 2) {
      return {
        session: {
          id: sessionId,
          phase: 'deep',
          candidatesProcessed: 0,
          candidatesPromoted: 0,
          signals: { skipped: 1 },
          startedAt: now,
          completedAt: new Date().toISOString(),
          summary: '项目聚类：项目数量不足，跳过',
        },
        suggestionsCreated: 0,
      };
    }

    // 1. 计算项目间的共享实体
    const projectEntityMap = new Map<string, Set<string>>();
    for (const project of projects) {
      const entities = db.prepare(`
        SELECT DISTINCT entity_id FROM memory_entities
        WHERE project_id = ?
      `).all(project.id) as { entity_id: string }[];
      projectEntityMap.set(project.id, new Set(entities.map(e => e.entity_id)));
    }

    // 2. 计算项目间的 Jaccard 相似度
    const projectPairs: { projectA: string; projectB: string; sharedEntities: number; jaccard: number }[] = [];
    for (let i = 0; i < projects.length; i++) {
      const entitiesA = projectEntityMap.get(projects[i].id) ?? new Set();
      if (entitiesA.size === 0) continue;

      for (let j = i + 1; j < projects.length; j++) {
        const entitiesB = projectEntityMap.get(projects[j].id) ?? new Set();
        if (entitiesB.size === 0) continue;

        const intersection = new Set([...entitiesA].filter(x => entitiesB.has(x)));
        const union = new Set([...entitiesA, ...entitiesB]);

        if (intersection.size >= 1) {
          projectPairs.push({
            projectA: projects[i].id,
            projectB: projects[j].id,
            sharedEntities: intersection.size,
            jaccard: intersection.size / union.size,
          });
        }
      }
    }

    // 3. 对高相似度的项目对生成建议
    const existingSuggestions = db.prepare(`
      SELECT project_ids FROM project_suggestions WHERE status = 'pending'
    `).all() as { project_ids: string }[];

    const existingPairs = new Set<string>();
    for (const s of existingSuggestions) {
      const ids = JSON.parse(s.project_ids) as string[];
      if (ids.length >= 2) {
        existingPairs.add(ids.sort().join(','));
      }
    }

    for (const pair of projectPairs) {
      if (pair.jaccard < 0.15 && pair.sharedEntities < 2) continue;

      const pairKey = [pair.projectA, pair.projectB].sort().join(',');
      if (existingPairs.has(pairKey)) continue;

      const projectA = projects.find(p => p.id === pair.projectA)!;
      const projectB = projects.find(p => p.id === pair.projectB)!;

      // 生成建议的父项目名称
      const suggestedName = suggestParentName(projectA.name, projectB.name);

      db.prepare(`
        INSERT INTO project_suggestions (id, project_ids, suggested_parent_name, reason, confidence, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?)
      `).run(
        uuid(),
        JSON.stringify([pair.projectA, pair.projectB]),
        suggestedName,
        `项目「${projectA.name}」与「${projectB.name}」共享 ${pair.sharedEntities} 个实体，语义关联度 ${(pair.jaccard * 100).toFixed(0)}%，建议归入同一父项目`,
        Math.min(0.95, pair.jaccard + 0.3),
        now,
      );

      suggestionsCreated++;
    }

    const session: DreamSession = {
      id: sessionId,
      phase: 'deep',
      candidatesProcessed: projects.length,
      candidatesPromoted: suggestionsCreated,
      signals: {
        projectsScanned: projects.length,
        pairsFound: projectPairs.length,
        suggestionsCreated,
      },
      startedAt: now,
      completedAt: new Date().toISOString(),
      summary: `项目聚类：扫描${projects.length}个项目，发现${projectPairs.length}对关联，生成${suggestionsCreated}条建议`,
    };

    return { session, suggestionsCreated };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('[Dream] Project clustering failed:', errorMessage);

    return {
      session: {
        id: sessionId,
        phase: 'deep',
        candidatesProcessed: 0,
        candidatesPromoted: 0,
        signals: { error: 1 },
        startedAt: now,
        completedAt: new Date().toISOString(),
        summary: `项目聚类失败：${errorMessage}`,
      },
      suggestionsCreated: 0,
    };
  }
}

function suggestParentName(nameA: string, nameB: string): string {
  // 简单的名称生成：找共同前缀，或使用通用名称
  const commonPrefix = findCommonPrefix(nameA, nameB);
  if (commonPrefix.length >= 2) {
    return commonPrefix + '相关';
  }
  // 如果两个名称有包含关系
  if (nameA.includes(nameB) || nameB.includes(nameA)) {
    return nameA.length > nameB.length ? nameA : nameB;
  }
  return `${nameA}/${nameB}`;
}

function findCommonPrefix(a: string, b: string): string {
  let prefix = '';
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) {
      prefix += a[i];
    } else {
      break;
    }
  }
  return prefix;
}

export function formatDreamReport(report: DreamReport): string {
  const lines: string[] = [];
  lines.push(`整理报告 #${report.id.slice(0, 8)}`);
  lines.push(`状态: ${report.status}`);
  lines.push(`时间: ${report.completedAt || report.createdAt}`);
  lines.push('');

  for (const session of report.sessions) {
    const phaseLabel = session.phase === 'light' ? '初步整理' : session.phase === 'rem' ? '关联分析' : session.phase === 'deep' && session.summary?.includes('项目聚类') ? '项目聚类' : '深度整理/语义合并';
    lines.push(`${phaseLabel}: ${session.summary || `${session.candidatesProcessed}条处理，${session.candidatesPromoted}条提升`}`);
  }

  lines.push('');
  lines.push(`总计: ${report.totalCandidates}条候选，${report.promoted}条升级，${report.archived}条归档，${report.merged}条合并`);
  lines.push(`如需回滚: keymemory dream --rollback ${report.id}`);

  return lines.join('\n');
}
