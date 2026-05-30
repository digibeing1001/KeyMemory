import type { Memory, Layer, MemoryKind, SearchResult } from '@keymemory/shared';
import type { IsolationMode } from '@keymemory/shared';

export interface MemorySearchOptions {
  layer?: Layer;
  limit?: number;
  projectId?: string;
  includeDescendants?: boolean;
  includeSuperseded?: boolean;
  memoryKind?: MemoryKind;
}

export interface MemoryAdapter {
  name: string;
  read(id: string): Promise<Memory | null>;
  write(data: { title: string; content: string; layer: Layer; project?: string }): Promise<Memory>;
  search(query: string, options?: MemorySearchOptions): Promise<SearchResult[]>;
  delete(id: string): Promise<boolean>;
}

export interface AgentContext {
  agentId: string;
  isolationMode: IsolationMode;
  privateSpace: string;
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

  if (customRules) {
    const sorted = [...customRules].sort((a, b) => b.priority - a.priority);
    for (const rule of sorted) {
      try {
        if (new RegExp(rule.pattern, 'i').test(content)) {
          return { targetSpace: rule.targetSpace, confidence: 1.0, needsConfirmation: false, reason: `custom rule: ${rule.pattern}` };
        }
      } catch {}
    }
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

export function createAgentContext(agentId: string, isolationMode: IsolationMode = 'hybrid'): AgentContext {
  return {
    agentId,
    isolationMode,
    privateSpace: `agent:${agentId}`,
  };
}
