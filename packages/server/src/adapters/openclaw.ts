import type { MemoryAdapter } from './base.js';
import type { Memory, Layer, SearchResult } from '@keymemory/shared';
import { createMemory, getMemory, deleteMemory } from '../core/atom.js';
import { searchHybrid } from '../core/query.js';

export const openClawAdapter: MemoryAdapter = {
  name: 'openclaw',

  async read(id: string): Promise<Memory | null> {
    return getMemory(id);
  },

  async write(data: { title: string; content: string; layer: Layer; projectId?: string }): Promise<Memory> {
    return createMemory(data);
  },

  async search(query: string, options?: { layer?: Layer; limit?: number }): Promise<SearchResult[]> {
    return searchHybrid(query, { layer: options?.layer, limit: options?.limit });
  },

  async delete(id: string): Promise<boolean> {
    return deleteMemory(id);
  },
};

export const MCP_TOOLS = [
  {
    name: 'memory_create',
    description: 'Create a new memory in KeyMemory',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        content: { type: 'string' },
        layer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'] },
        projectId: { type: 'string' },
      },
      required: ['title', 'content', 'layer'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search memories in KeyMemory',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        layer: { type: 'string', enum: ['flash', 'short', 'long', 'entity'] },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_read',
    description: 'Read a specific memory by ID',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete a memory',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
];

export const MCP_RESOURCES = [
  {
    uri: 'keymemory://stats',
    name: 'KeyMemory Statistics',
    description: 'Current memory statistics by layer',
  },
];

export const MCP_PROMPTS = [
  {
    name: 'memory_context',
    description: 'Inject relevant memories into the conversation context',
    arguments: [
      { name: 'project', description: 'Current project name', required: false },
      { name: 'query', description: 'Context query', required: false },
    ],
  },
];
