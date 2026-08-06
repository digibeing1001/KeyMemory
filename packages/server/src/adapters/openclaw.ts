import type { MemoryAdapter } from './base.js';
import type { Memory, SearchResult, CreateMemoryInput, IsolationMode } from '@keymemory/shared';
import { createMemory, getMemory, deleteMemory } from '../core/atom.js';
import { searchHybrid } from '../core/query.js';
import { routeMemory, createAgentContext, visibleSpacesFor } from './base.js';
import type { MemorySearchOptions } from './base.js';

interface OpenClawAdapterOptions {
  agentId: string;
  isolationMode?: IsolationMode;
  userId?: string;
}

export function createOpenClawAdapter(options: OpenClawAdapterOptions): MemoryAdapter {
  const ctx = createAgentContext(options.agentId, options.isolationMode ?? 'hybrid', options.userId);
  // 预计算可见空间集合，供 read/search/context-pack 等读取路径做 pre-filter
  const accessibleSpaces = visibleSpacesFor(options.agentId, ctx.isolationMode, options.userId);

  return {
    // Mailbox sender/read receipts need the concrete host identity, not the adapter family.
    name: options.agentId,

    async read(id: string): Promise<Memory | null> {
      const mem = getMemory(id);
      if (!mem) return null;
      const accessibleSet = new Set(accessibleSpaces);
      if (!accessibleSet.has(mem.agentSpace)) return null;
      return mem;
    },

    async write(data: CreateMemoryInput): Promise<Memory> {
      // openclaw 也走 routeMemory 路由，确保写入时正确设置 agentSpace/ownerAgentId
      const decision = routeMemory(data.content, data.layer ?? 'short', ctx);
      const writeData = {
        ...data,
        agentSpace: decision.targetSpace,
        ownerAgentId: options.agentId,
      };
      return createMemory(writeData);
    },

    async search(query: string, options?: MemorySearchOptions): Promise<SearchResult[]> {
      // 与 hermes adapter 一致：spread 透传所有过滤参数，agentSpaces 由 adapter 强制注入
      const results = await searchHybrid(query, {
        ...options,
        agentSpaces: accessibleSpaces,
      });
      // 双保险后置校验
      const accessibleSet = new Set(accessibleSpaces);
      return results.filter(r => accessibleSet.has(r.memory.agentSpace));
    },

    async delete(id: string): Promise<boolean> {
      const mem = await getMemory(id);
      if (!mem) return false;
      const canDelete = mem.agentSpace === ctx.privateSpace
        || (mem.agentSpace === 'global' && mem.ownerAgentId === options.agentId);
      if (!canDelete) return false;
      return deleteMemory(id);
    },

    getAgentSpaces(): string[] {
      return accessibleSpaces;
    },
  };
}

/**
 * 向后兼容：默认单例。stdio 模式（mcp-server.ts）未提供 agentId 时使用。
 * 默认 agentId='openclaw', isolationMode='hybrid'，能读 global + agent:openclaw 空间。
 */
export const openClawAdapter: MemoryAdapter = createOpenClawAdapter({ agentId: 'openclaw' });

export { MCP_PROMPTS, MCP_RESOURCES, MCP_TOOLS } from '../core/mcp-tools.js';
