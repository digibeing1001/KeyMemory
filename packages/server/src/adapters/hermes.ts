import type { MemoryAdapter } from './base.js';
import type { Memory, SearchResult, IsolationMode, CreateMemoryInput } from '@keymemory/shared';
import { createMemory, getMemory, listMemories, deleteMemory } from '../core/atom.js';
import { searchHybrid } from '../core/query.js';
import { routeMemory, createAgentContext } from './base.js';
import type { MemorySearchOptions } from './base.js';

interface HermesAdapterOptions {
  agentId: string;
  isolationMode?: IsolationMode;
}

export function createHermesAdapter(options: HermesAdapterOptions): MemoryAdapter {
  const ctx = createAgentContext(options.agentId, options.isolationMode ?? 'hybrid');

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
      const results = await searchHybrid(query, {
        layer: options?.layer,
        limit: options?.limit,
        projectId: options?.projectId,
        includeDescendants: options?.includeDescendants,
        includeSuperseded: options?.includeSuperseded,
        memoryKind: options?.memoryKind,
      });

      const accessibleResults = results.filter(r => {
        return r.memory.agentSpace === 'global' || r.memory.agentSpace === ctx.privateSpace;
      });

      return accessibleResults;
    },

    async delete(id: string): Promise<boolean> {
      const mem = await getMemory(id);
      if (!mem) return false;

      const canDelete = mem.agentSpace === ctx.privateSpace || (mem.agentSpace === 'global' && mem.ownerAgentId === options.agentId);
      if (!canDelete) return false;

      return deleteMemory(id);
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
