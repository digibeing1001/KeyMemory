/**
 * 项目接龙注入机制（Dream Phase 7）
 *
 * 设计原则（来自用户原话，与原"定时 LLM 生成日志"完全不同）：
 * - "项目测试的触发频率应该是当用户接近了这个相关记忆的时候，就已经接入了这个记忆库"
 * - "它在开始用各种 coding agent 或者 AI agent 来进行工作的时候，给它反向注一条命令"
 * - "要求 AI agent 或 coding agent 往我们的知识库写入相关的日志"
 * - "而且这个日志是一定要与用户的工作进程相关的"
 * - "它的目的是作为项目接龙去使用"
 * - "也就是用户在一个聊天窗口中所进行的工作，只要他打开了一个新的窗口，依然能够从这个记忆库里面找到相关的上下文，并且接力继续去工作"
 *
 * 核心机制：
 * 1. Dream 扫描：哪些项目近 N 天有记忆活动但缺少 project_journal？→ 标记 pending
 * 2. context-pack 注入：agent 检索命中这些项目的记忆时，注入"请写日志"指令
 * 3. agent 写入：agent 按指令写入 project_journal 类型记忆（kind:project_journal tag）
 * 4. 下次新窗口检索命中 project_journal → 恢复上下文 → 接力工作
 *
 * 注意：本模块不做 LLM 自动生成日志，只做"检测 + 标记 + 提供注入指令模板"。
 * 日志由 agent 自己写，保证与用户工作进程强相关。
 */

import { v4 as uuid } from 'uuid';
import { PROJECT_JOURNAL_CONFIG } from '@keymemory/shared';
import type { ProjectJournalInjection } from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';

/** Phase 7 扫描报告 */
export interface ProjectJournalScanReport {
  /** 本次新标记为 pending 的项目数 */
  marked: number;
  /** 明细 */
  details: { projectId: string; projectName: string; lastActivityAt: string; memoryCount: number }[];
  /** 总耗时 ms */
  durationMs: number;
}

/**
 * 初始化 project_journal_injections 表（幂等）。
 *
 * 字段：
 * - project_id: 项目 ID
 * - status: pending(待注入) / injected(已注入指令) / logged(agent 已写入日志)
 * - last_activity_at: 上次检测到项目有记忆活动的时间
 * - injected_at: 注入指令发送时间
 * - journal_memory_id: agent 写入的 project_journal 记忆 ID
 *
 * 唯一约束：project_id（每个项目只有一条状态记录，状态会更新）
 */
export function initProjectJournalInjectionsTable(): void {
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_journal_injections (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      last_activity_at TEXT NOT NULL,
      injected_at TEXT,
      journal_memory_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_pji_status ON project_journal_injections(status)`);
}

/**
 * Dream Phase 7 入口：扫描需要接龙注入的项目。
 *
 * 判定逻辑：
 * - 项目近 staleDays 天有记忆活动（有记忆被创建/更新/命中）
 * - 且该项目没有 project_journal 类型的记忆（tags 包含 'kind:project_journal'）
 * - 且该项目当前没有 pending/injected 状态的注入记录（避免重复标记）
 *
 * @returns 扫描报告
 */
export function scanProjectJournalInjections(): ProjectJournalScanReport {
  initProjectJournalInjectionsTable();

  const db = getDatabase();
  const start = Date.now();
  const now = new Date().toISOString();
  const staleDate = new Date(Date.now() - PROJECT_JOURNAL_CONFIG.staleDays * 24 * 60 * 60 * 1000).toISOString();

  // 找出近 N 天有活动但无 project_journal 的项目
  // 活动定义：近 N 天内有记忆被创建或更新
  const candidates = db.prepare(`
    SELECT
      p.id as project_id,
      p.name as project_name,
      MAX(m.updated_at) as last_activity,
      COUNT(m.id) as memory_count
    FROM projects p
    INNER JOIN memories m ON m.project_id = p.id AND m.status = 'active'
    WHERE m.updated_at >= ?
      AND NOT EXISTS (
        SELECT 1 FROM memories j
        WHERE j.project_id = p.id
          AND j.status = 'active'
          AND j.tags LIKE '%kind:project_journal%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM project_journal_injections i
        WHERE i.project_id = p.id
          AND i.status IN ('pending', 'injected')
      )
    GROUP BY p.id, p.name
    ORDER BY last_activity DESC
    LIMIT ?
  `).all(staleDate, PROJECT_JOURNAL_CONFIG.maxPendingPerCycle) as { project_id: string; project_name: string; last_activity: string; memory_count: number }[];

  const details: { projectId: string; projectName: string; lastActivityAt: string; memoryCount: number }[] = [];

  for (const c of candidates) {
    const id = uuid();
    db.prepare(`
      INSERT INTO project_journal_injections (id, project_id, status, last_activity_at, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, ?, ?)
    `).run(id, c.project_id, c.last_activity, now, now);

    details.push({
      projectId: c.project_id,
      projectName: c.project_name,
      lastActivityAt: c.last_activity,
      memoryCount: c.memory_count,
    });
  }

  return {
    marked: details.length,
    details,
    durationMs: Date.now() - start,
  };
}

/**
 * 获取待注入的项目（供 context-pack 调用）。
 *
 * 当 agent 检索命中某项目的记忆时，调用此方法获取该项目的接龙注入指令。
 * 同时将状态从 pending → injected（避免重复注入）。
 *
 * @param projectId 项目 ID
 * @returns 注入指令（如果该项目需要接龙）；null 表示不需要注入
 */
export function getPendingInjectionForProject(projectId: string): { injection: ProjectJournalInjection; instruction: string } | null {
  initProjectJournalInjectionsTable();

  const db = getDatabase();
  const row = db.prepare(`
    SELECT * FROM project_journal_injections
    WHERE project_id = ? AND status = 'pending'
  `).get(projectId) as { id: string; project_id: string; status: string; last_activity_at: string; injected_at: string | null; journal_memory_id: string | null; created_at: string; updated_at: string } | undefined;

  if (!row) return null;

  // 检查冷却时间（避免对同一项目重复注入）
  if (row.injected_at) {
    const injectedTime = new Date(row.injected_at).getTime();
    const cooldownMs = PROJECT_JOURNAL_CONFIG.injectionCooldownHours * 60 * 60 * 1000;
    if (Date.now() - injectedTime < cooldownMs) {
      return null; // 还在冷却期
    }
  }

  // 标记为 injected
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE project_journal_injections
    SET status = 'injected', injected_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, row.id);

  const injection: ProjectJournalInjection = {
    id: row.id,
    projectId: row.project_id,
    status: 'injected',
    lastActivityAt: row.last_activity_at,
    injectedAt: now,
    createdAt: row.created_at,
    updatedAt: now,
  };

  // 获取项目信息用于构造指令
  const project = db.prepare('SELECT name, path FROM projects WHERE id = ?').get(projectId) as { name: string; path: string } | undefined;
  const projectName = project?.name ?? projectId;
  const projectPath = project?.path ?? '';

  // 读取项目近期的记忆标题，供 agent 了解上下文
  const recentMemories = db.prepare(`
    SELECT title, kind FROM (
      SELECT title, tags,
        CASE WHEN tags LIKE '%kind:decision%' THEN 'decision'
             WHEN tags LIKE '%kind:task%' THEN 'task'
             WHEN tags LIKE '%kind:preference%' THEN 'preference'
             ELSE 'other' END as kind
      FROM memories
      WHERE project_id = ? AND status = 'active'
      ORDER BY updated_at DESC LIMIT 10
    )
  `).all(projectId) as { title: string; kind: string }[];

  const contextSummary = recentMemories.map(m => `- [${m.kind}] ${m.title}`).join('\n');

  const instruction = `## 项目接龙指令

你正在参与项目 **${projectName}** (${projectPath})。

该项目的记忆库已检测到近期有工作活动，但缺少项目工作日志（project_journal）。为了保证跨会话的工作连续性，请你**在本次工作过程中或结束时**，向记忆库写入一条 project_journal 类型的记忆。

### 写入要求

1. **记忆标题**：[项目日志] ${projectName} - ${new Date().toISOString().slice(0, 10)} 或具体描述本次工作主题
2. **记忆内容**必须包含：
   - **本次工作目标**：你这次会话中要解决什么问题
   - **已完成的工作**：具体做了哪些操作（文件修改、决策、发现等）
   - **当前状态**：工作进行到哪一步了
   - **下一步计划**：还有什么待办、阻塞点、需要接力的事
   - **关键决策与教训**：如果有，记录为什么这么做、踩了什么坑
3. **tags** 必须包含 kind:project_journal
4. **projectId** 设为当前项目 ID：${projectId}
5. **layer** 设为 short（项目日志是近期工作记忆，会随 Dream 自动整理到 long 层）

### 项目近期上下文

${contextSummary || '（暂无近期记忆）'}

### 接力场景

当用户在新的聊天窗口打开时，系统会自动检索到这条 project_journal 记忆，注入到新会话的上下文中，让新的 agent 能快速理解之前的工作进展并接力继续。

**请确保日志内容与本次工作进程强相关，不要写空泛的总结。**`;

  return { injection, instruction };
}

/**
 * 当 agent 写入 project_journal 记忆后，调用此方法更新注入状态。
 *
 * @param projectId 项目 ID
 * @param journalMemoryId agent 写入的 project_journal 记忆 ID
 */
export function markJournalLogged(projectId: string, journalMemoryId: string): boolean {
  initProjectJournalInjectionsTable();

  const db = getDatabase();
  const now = new Date().toISOString();
  const result = db.prepare(`
    UPDATE project_journal_injections
    SET status = 'logged', journal_memory_id = ?, updated_at = ?
    WHERE project_id = ? AND status = 'injected'
  `).run(journalMemoryId, now, projectId);

  return result.changes > 0;
}

/**
 * 获取所有注入状态（供 UI 展示）。
 */
export function listInjections(status?: 'pending' | 'injected' | 'logged'): ProjectJournalInjection[] {
  initProjectJournalInjectionsTable();

  const db = getDatabase();
  const rows = (status
    ? db.prepare('SELECT * FROM project_journal_injections WHERE status = ? ORDER BY updated_at DESC').all(status)
    : db.prepare('SELECT * FROM project_journal_injections ORDER BY updated_at DESC').all()) as Record<string, unknown>[];

  return rows.map(r => ({
    id: String(r.id),
    projectId: String(r.project_id),
    status: String(r.status) as 'pending' | 'injected' | 'logged',
    lastActivityAt: String(r.last_activity_at),
    injectedAt: r.injected_at ? String(r.injected_at) : undefined,
    journalMemoryId: r.journal_memory_id ? String(r.journal_memory_id) : undefined,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

/**
 * 获取某项目的最近一条 project_journal 记忆（用于跨会话接力）。
 *
 * 供 context-pack 调用：当 agent 检索命中某项目时，把最近的 project_journal 也注入上下文。
 */
export function getLatestProjectJournal(projectId: string): { id: string; title: string; content: string; createdAt: string } | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, title, content, created_at
    FROM memories
    WHERE project_id = ? AND status = 'active' AND tags LIKE '%kind:project_journal%'
    ORDER BY created_at DESC LIMIT 1
  `).get(projectId) as { id: string; title: string; content: string; created_at: string } | undefined;

  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    createdAt: row.created_at,
  };
}

/**
 * 获取注入统计（供 UI 展示）。
 */
export function getInjectionStats(): { pending: number; injected: number; logged: number; total: number } {
  initProjectJournalInjectionsTable();

  const db = getDatabase();
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'injected' THEN 1 ELSE 0 END) as injected,
      SUM(CASE WHEN status = 'logged' THEN 1 ELSE 0 END) as logged,
      COUNT(*) as total
    FROM project_journal_injections
  `).get() as { pending: number | null; injected: number | null; logged: number | null; total: number | null };

  return {
    pending: row.pending ?? 0,
    injected: row.injected ?? 0,
    logged: row.logged ?? 0,
    total: row.total ?? 0,
  };
}

/**
 * 重置某项目的注入状态（用户在 UI 上手动触发重新注入）。
 */
export function resetInjection(projectId: string): boolean {
  initProjectJournalInjectionsTable();

  const db = getDatabase();
  const result = db.prepare('DELETE FROM project_journal_injections WHERE project_id = ?').run(projectId);
  return result.changes > 0;
}
