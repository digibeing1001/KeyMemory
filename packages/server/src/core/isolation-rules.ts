import { getDatabase } from '../db/sqlite.js';
import { v4 as uuid } from 'uuid';

/**
 * isolation_rules 表的运行时映射。
 *
 * 设计要点：
 * - agentId = null 表示全局规则，对所有 agent 生效；非 null 表示 agent 专属规则。
 * - ruleType: 'regex'（正则匹配）或 'keyword'（关键词包含匹配，对非技术用户友好）。
 * - targetSpace: 'global' / 'agent:xxx' / 'project:xxx' / 'private'。
 *   'private' 是别名，routeMemory 会解析为 agent:${agentId}，
 *   这样用户配置规则时不需要知道具体 agentId。
 * - 进程内缓存（TTL 60s），规则变更时通过 invalidateCache 失效。
 *   better-sqlite3 虽然同步查询很快，但每次写入都查表仍然不优雅，
 *   缓存可以把开销摊薄到每分钟一次。
 */

export type IsolationRuleType = 'regex' | 'keyword';

export interface IsolationRule {
  id: string;
  agentId: string | null;
  ruleType: IsolationRuleType;
  pattern: string;
  targetSpace: string;
  priority: number;
  enabled: boolean;
  createdAt: string;
}

interface CachedEntry {
  rules: IsolationRule[];
  expiresAt: number;
}

const cache = new Map<string, CachedEntry>();
const CACHE_TTL_MS = 60_000;

/**
 * 读取对指定 agent 有效的规则（全局规则 + 该 agent 的专属规则），按 priority 降序排列。
 * 使用进程内缓存，TTL 60 秒。写入侧通过 invalidateCache 主动失效。
 */
export function getRulesForAgent(agentId: string): IsolationRule[] {
  const now = Date.now();
  const cached = cache.get(agentId);
  if (cached && cached.expiresAt > now) return cached.rules;

  const db = getDatabase();
  const rows = db.prepare(`
    SELECT * FROM isolation_rules
    WHERE enabled = 1 AND (agent_id IS NULL OR agent_id = ?)
    ORDER BY priority DESC, created_at ASC
  `).all(agentId) as Record<string, unknown>[];

  const rules = rows.map(rowToRule);
  cache.set(agentId, { rules, expiresAt: now + CACHE_TTL_MS });
  return rules;
}

export function invalidateCache(): void {
  cache.clear();
}

export function listAllRules(agentId?: string): IsolationRule[] {
  const db = getDatabase();
  const rows = agentId
    ? db.prepare(`SELECT * FROM isolation_rules WHERE agent_id = ? OR agent_id IS NULL ORDER BY priority DESC, created_at ASC`).all(agentId) as Record<string, unknown>[]
    : db.prepare(`SELECT * FROM isolation_rules ORDER BY priority DESC, created_at ASC`).all() as Record<string, unknown>[];
  return rows.map(rowToRule);
}

export function getRule(id: string): IsolationRule | null {
  const db = getDatabase();
  const row = db.prepare(`SELECT * FROM isolation_rules WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return row ? rowToRule(row) : null;
}

export interface CreateRuleInput {
  agentId?: string;
  ruleType: IsolationRuleType;
  pattern: string;
  targetSpace: string;
  priority?: number;
  enabled?: boolean;
}

export function createRule(input: CreateRuleInput): IsolationRule {
  const db = getDatabase();
  const id = uuid();
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO isolation_rules (id, agent_id, rule_type, pattern, target_space, priority, enabled, created_at)
    VALUES (@id, @agentId, @ruleType, @pattern, @targetSpace, @priority, @enabled, @createdAt)
  `).run({
    id,
    agentId: input.agentId ?? null,
    ruleType: input.ruleType,
    pattern: input.pattern,
    targetSpace: input.targetSpace,
    priority: input.priority ?? 0,
    enabled: input.enabled === false ? 0 : 1,
    createdAt: now,
  });
  invalidateCache();
  return getRule(id)!;
}

export interface UpdateRuleInput {
  ruleType?: IsolationRuleType;
  pattern?: string;
  targetSpace?: string;
  priority?: number;
  enabled?: boolean;
}

export function updateRule(id: string, input: UpdateRuleInput): IsolationRule | null {
  const db = getDatabase();
  const updates: string[] = [];
  const params: Record<string, unknown> = { id };
  if (input.ruleType !== undefined) { updates.push('rule_type = @ruleType'); params.ruleType = input.ruleType; }
  if (input.pattern !== undefined) { updates.push('pattern = @pattern'); params.pattern = input.pattern; }
  if (input.targetSpace !== undefined) { updates.push('target_space = @targetSpace'); params.targetSpace = input.targetSpace; }
  if (input.priority !== undefined) { updates.push('priority = @priority'); params.priority = input.priority; }
  if (input.enabled !== undefined) { updates.push('enabled = @enabled'); params.enabled = input.enabled ? 1 : 0; }
  if (updates.length === 0) return getRule(id);
  db.prepare(`UPDATE isolation_rules SET ${updates.join(', ')} WHERE id = @id`).run(params);
  invalidateCache();
  return getRule(id);
}

export function deleteRule(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare(`DELETE FROM isolation_rules WHERE id = ?`).run(id);
  if (result.changes > 0) invalidateCache();
  return result.changes > 0;
}

function rowToRule(row: Record<string, unknown>): IsolationRule {
  return {
    id: row.id as string,
    agentId: (row.agent_id as string) ?? null,
    ruleType: row.rule_type as IsolationRuleType,
    pattern: row.pattern as string,
    targetSpace: row.target_space as string,
    priority: row.priority as number,
    enabled: (row.enabled as number) === 1,
    createdAt: row.created_at as string,
  };
}
