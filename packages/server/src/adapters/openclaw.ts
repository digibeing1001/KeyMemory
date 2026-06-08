import type { MemoryAdapter } from './base.js';
import type { Memory, SearchResult, CreateMemoryInput } from '@keymemory/shared';
import { createMemory, getMemory, deleteMemory } from '../core/atom.js';
import { searchHybrid } from '../core/query.js';
import type { MemorySearchOptions } from './base.js';

export const openClawAdapter: MemoryAdapter = {
  name: 'openclaw',

  async read(id: string): Promise<Memory | null> {
    return getMemory(id);
  },

  async write(data: CreateMemoryInput): Promise<Memory> {
    return createMemory(data);
  },

  async search(query: string, options?: MemorySearchOptions): Promise<SearchResult[]> {
    return searchHybrid(query, {
      layer: options?.layer,
      limit: options?.limit,
      projectId: options?.projectId,
      includeDescendants: options?.includeDescendants,
      includeSuperseded: options?.includeSuperseded,
      memoryKind: options?.memoryKind,
    });
  },

  async delete(id: string): Promise<boolean> {
    return deleteMemory(id);
  },
};

export { MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS } from '../core/mcp-tools.js';
