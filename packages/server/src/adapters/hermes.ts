import type { MemoryAdapter } from './base.js';
import type { Memory, SearchResult, IsolationMode, CreateMemoryInput } from '@keymemory/shared';
import { createMemory, getMemory, listMemories, deleteMemory } from '../core/atom.js';
import { searchHybrid } from '../core/query.js';
import { routeMemory, createAgentContext } from './base.js';
import type { MemorySearchOptions } from './base.js';

interface HermesAdapterOptions {
  agentId: string;
  isolationMode?: IsolationMode;
  userId?: string;
}

export function createHermesAdapter(options: HermesAdapterOptions): MemoryAdapter {
  const ctx = createAgentContext(options.agentId, options.isolationMode ?? 'hybrid', options.userId);
  // 预计算可见空间集合，供 search/context-pack 等读取路径做 pre-filter
  const accessibleSpaces = ctx.isolationMode === 'isolated'
    ? [ctx.privateSpace]
    : ['global', ctx.privateSpace];

  return {
    name: 'hermes',

    async read(id: string): Promise<Memory | null> {
      const mem = getMemory(id);
      if (!mem) return null;

      const canRead = mem.agentSpace === 'global' || mem.agentSpace === ctx.privateSpace;
      if (!canRead) return null;

      return mem;
    },

    async write(data: CreateMemoryInput): Promise<Memory> {
      // layer 现在是可选字段；routeMemory 仍按 Layer 路由，未指定时按 short 走默认
      // 推断（normalizeMemoryInput 会保证最终落库时有合理 layer）。
      const decision = routeMemory(data.content, data.layer ?? 'short', ctx);

      const writeData = {
        ...data,
        agentSpace: decision.targetSpace,
        ownerAgentId: options.agentId,
      };

      const mem = createMemory(writeData);
      return mem;
    },

    async search(query: string, options?: MemorySearchOptions): Promise<SearchResult[]> {
      // 直接把 agentSpaces 传给 searchHybrid 做 SQL 级 pre-filter，
      // 避免"全量检索后再后置过滤"导致的漏结果（limit 截断后才过滤会丢掉本应可见的命中）。
      // 用 spread 透传所有过滤参数（tags/entity/source/confidence/time 等），
      // 确保 MemorySearchOptions 的任何新增字段都能自动传入 searchHybrid，无需每次扩展都改这里。
      const results = await searchHybrid(query, {
        ...options,
        agentSpaces: accessibleSpaces,
      });

      // 双保险：即使 searchHybrid 内部过滤失效，这里仍做一次后置校验
      const accessibleSet = new Set(accessibleSpaces);
      return results.filter(r => accessibleSet.has(r.memory.agentSpace));
    },

    async delete(id: string): Promise<boolean> {
      const mem = await getMemory(id);
      if (!mem) return false;

      const canDelete = mem.agentSpace === ctx.privateSpace || (mem.agentSpace === 'global' && mem.ownerAgentId === options.agentId);
      if (!canDelete) return false;

      return deleteMemory(id);
    },

    getAgentSpaces(): string[] {
      return accessibleSpaces;
    },
  };
}

export const hermesAdapter = createHermesAdapter({ agentId: 'hermes' });

export function buildHermesSystemPrompt(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const lines = memories.map(m => {
    const prefix = `[${m.layer}]`;
    return `- ${prefix} ${m.title}: ${m.content.slice(0, 200)}`;
  });

  return `## KeyMemory Context\n\nRelevant memories:\n${lines.join('\n')}`;
}
