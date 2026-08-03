import type { Memory, Layer, MemoryKind, SearchResult, CreateMemoryInput, EntityType } from '@keymemory/shared';
import type { IsolationMode } from '@keymemory/shared';
import { getRulesForAgent } from '../core/isolation-rules.js';

export interface MemorySearchOptions {
  layer?: Layer;
  limit?: number;
  projectId?: string;
  /** Filter by the remembered source path without creating or relying on folders. */
  projectPath?: string;
  includeDescendants?: boolean;
  includeSuperseded?: boolean;
  /** Retrieve facts valid at this ISO 8601 instant. Defaults to now. */
  asOf?: string;
  /** Include facts outside their validity windows for audits. */
  includeExpired?: boolean;
  /** Return a hybrid ranking score breakdown. */
  explain?: boolean;
  memoryKind?: MemoryKind;
  /**
   * 按标签过滤。tags 列以 JSON 数组存储，过滤使用 json_each 精确匹配。
   * tagsMatch='any' 时记忆命中任一标签即入选（OR 语义，默认）；
   * tagsMatch='all' 时记忆必须包含全部标签（AND 语义）。
   */
  tags?: string[];
  tagsMatch?: 'any' | 'all';
  /**
   * 按实体过滤。entityId / entityName / entityType 可单传或组合：
   * - 单传 entityId：精确到该实体
   * - 单传 entityName：精确匹配实体名（不考虑别名，别名匹配属于 P1-4 范畴）
   * - 单传 entityType：列出关联了该类型任意实体的记忆
   * - entityName + entityType：精确到该类型下该名字的实体
   * 组合间为 AND 语义。
   */
  entityId?: string;
  entityName?: string;
  entityType?: EntityType;
  /** 按来源标签过滤，如 hermes / openclaw / conversation / manual */
  source?: string;
  /** 仅返回 confidence >= 该值的记忆，取值 0~1 */
  minConfidence?: number;
  /** 创建/更新/最后命中时间范围过滤，ISO 8601 字符串。SQLite 文本比较天然按时间序。 */
  createdAfter?: string;
  createdBefore?: string;
  updatedAfter?: string;
  updatedBefore?: string;
  lastHitAfter?: string;
  lastHitBefore?: string;
}

export interface MemoryAdapter {
  name: string;
  read(id: string): Promise<Memory | null>;
  write(data: CreateMemoryInput): Promise<Memory>;
  search(query: string, options?: MemorySearchOptions): Promise<SearchResult[]>;
  delete(id: string): Promise<boolean>;
  /**
   * 返回当前 adapter 绑定的 agent 可见的 agent_space 集合。
   * 典型值：['global', 'agent:foo']。
   * 未实现/返回 undefined 时表示不做 agent_space 过滤（如 openclaw 等遗留 adapter）。
   */
  getAgentSpaces?(): string[] | undefined;
}

export interface AgentContext {
  agentId: string;
  isolationMode: IsolationMode;
  privateSpace: string;
  /**
   * 绑定到该上下文的用户 id。存在时表示 agent_space 已升级为 user-scoped
   * (privateSpace 形如 `user:<userId>:agent:<agentId>`)。
   * 缺省时保持旧行为(`agent:<agentId>`),向后兼容单用户模式。
   */
  userId?: string;
}

export interface RoutingDecision {
  targetSpace: string;
  confidence: number;
  needsConfirmation: boolean;
  reason: string;
}

const SENSITIVE_PATTERNS = [
  /password/i, /secret/i, /api[_-]?key/i, /token/i, /credential/i,
  /密码/, /密钥/, /令牌/, /凭证/,
];

const GLOBAL_KEYWORDS = [
  /偏好/, /配置/, /方法论/, /原则/, /规则/,
  /preference/, /config/, /methodology/, /principle/, /rule/,
];

export function routeMemory(
  content: string,
  layer: Layer,
  agentContext: AgentContext,
  customRules?: { pattern: string; targetSpace: string; priority: number }[]
): RoutingDecision {
  if (agentContext.isolationMode === 'isolated') {
    return { targetSpace: agentContext.privateSpace, confidence: 1.0, needsConfirmation: false, reason: 'isolated mode' };
  }

  if (agentContext.isolationMode === 'shared') {
    return { targetSpace: 'global', confidence: 1.0, needsConfirmation: false, reason: 'shared mode' };
  }

  // 合并调用方传入的 customRules 与 isolation_rules 表中的 DB 规则。
  // DB 规则通过 getRulesForAgent 读取（带 60s 缓存），覆盖全局规则（agent_id IS NULL）和当前 agent 专属规则。
  // 两者按 priority 降序合并后依次匹配，第一个命中的规则决定目标空间。
  // customRules 是编程式传入的规则，DB 规则是用户通过 MCP 工具配置的持久化规则。
  const dbRules = getRulesForAgent(agentContext.agentId).map(r => ({
    pattern: r.pattern,
    targetSpace: r.targetSpace,
    priority: r.priority,
    ruleType: r.ruleType,
  }));
  const allRules = [
    ...(customRules ?? []).map(r => ({ ...r, ruleType: 'regex' as const })),
    ...dbRules,
  ].sort((a, b) => b.priority - a.priority);

  for (const rule of allRules) {
    try {
      // keyword 类型：转义后做包含匹配，对非技术用户友好（不需要写正则）。
      // regex 类型：直接作为正则。
      const regex = rule.ruleType === 'keyword'
        ? new RegExp(escapeRegex(rule.pattern), 'i')
        : new RegExp(rule.pattern, 'i');
      if (regex.test(content)) {
        // 'private' 是别名，解析为当前 agent 的私有空间。
        // 这样用户配置规则时不需要知道具体 agentId。
        const resolvedSpace = rule.targetSpace === 'private' ? agentContext.privateSpace : rule.targetSpace;
        return { targetSpace: resolvedSpace, confidence: 1.0, needsConfirmation: false, reason: `isolation rule: ${rule.pattern}` };
      }
    } catch (err) { console.error('[routeMemory] invalid pattern:', (err as Error).message); }
  }

  for (const p of SENSITIVE_PATTERNS) {
    if (p.test(content)) {
      return { targetSpace: agentContext.privateSpace, confidence: 1.0, needsConfirmation: false, reason: 'sensitive content detected' };
    }
  }

  if (layer === 'long' || layer === 'entity') {
    return { targetSpace: 'global', confidence: 0.9, needsConfirmation: false, reason: `${layer} layer defaults to global` };
  }

  for (const p of GLOBAL_KEYWORDS) {
    if (p.test(content)) {
      return { targetSpace: 'global', confidence: 0.85, needsConfirmation: false, reason: 'global keyword detected' };
    }
  }

  const projectMatch = content.match(/\[\[([^\]]+)\]\]/);
  if (projectMatch) {
    return { targetSpace: `project:${projectMatch[1]}`, confidence: 0.9, needsConfirmation: false, reason: 'project reference detected' };
  }

  if (agentContext.isolationMode === 'hybrid') {
    return { targetSpace: agentContext.privateSpace, confidence: 0.7, needsConfirmation: true, reason: 'hybrid mode: default private, consider sharing' };
  }

  if (agentContext.isolationMode === 'project') {
    return { targetSpace: agentContext.privateSpace, confidence: 0.7, needsConfirmation: true, reason: 'project mode: default to agent space' };
  }

  return { targetSpace: agentContext.privateSpace, confidence: 0.5, needsConfirmation: true, reason: 'default: private' };
}

export function createAgentContext(agentId: string, isolationMode: IsolationMode = 'hybrid', userId?: string): AgentContext {
  const privateSpace = userId ? `user:${userId}:agent:${agentId}` : `agent:${agentId}`;
  return {
    agentId,
    isolationMode,
    privateSpace,
    userId,
  };
}

/**
 * 推导一个 agent 可见的 agent_space 集合。
 * 默认所有隔离模式下 agent 都能读到 global 与自身私有空间；
 * isolated 模式下严格只读自身私有空间（不读 global，避免全局记忆污染独立 agent）。
 * 该集合用于 context-pack / loop-harness / search 等读取路径的隔离过滤。
 *
 * 传入 userId 时,agent_space 升级为 user-scoped(`user:<userId>:agent:<agentId>`),
 * 否则保持旧 `agent:<agentId>` 行为(向后兼容)。
 */
export function visibleSpacesFor(agentId: string, isolationMode?: IsolationMode, userId?: string): string[] {
  const privateSpace = userId ? `user:${userId}:agent:${agentId}` : `agent:${agentId}`;
  if (isolationMode === 'isolated') return [privateSpace];
  return ['global', privateSpace];
}

/**
 * 转义正则元字符，用于 keyword 类型规则的包含匹配。
 * 这样用户配置 keyword 规则时不需要关心正则转义问题。
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
