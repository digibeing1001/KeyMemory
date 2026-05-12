import fs from 'fs';
import path from 'path';
import os from 'os';
import type { MemoryAdapter } from './base.js';
import type { Memory, Layer, SearchResult } from '@keymemory/shared';
import { createMemory, listMemories } from '../core/atom.js';
import { searchHybrid } from '../core/query.js';

const CLAUDE_DIR = '.claude';
const CLAUDE_MD = 'CLAUDE.md';

function getClaudeDir(): string {
  return path.join(os.homedir(), CLAUDE_DIR);
}

function getClaudeMdPath(): string {
  return path.join(getClaudeDir(), CLAUDE_MD);
}

export const claudeCodeAdapter: MemoryAdapter = {
  name: 'claude-code',

  async read(_id: string): Promise<Memory | null> {
    return null;
  },

  async write(data: { title: string; content: string; layer: Layer; project?: string }): Promise<Memory> {
    const mem = createMemory(data);
    await syncToClaudeMd();
    return mem;
  },

  async search(query: string, options?: { layer?: Layer; limit?: number }): Promise<SearchResult[]> {
    return searchHybrid(query, { layer: options?.layer, limit: options?.limit });
  },

  async delete(_id: string): Promise<boolean> {
    return true;
  },
};

export async function syncToClaudeMd(): Promise<void> {
  const longMemories = listMemories({ layer: 'long', status: 'active', limit: 50 });
  const projectMemories = listMemories({ status: 'active', limit: 100 })
    .filter(m => m.project);

  const sections: string[] = ['# KeyMemory Sync', ''];

  if (longMemories.length > 0) {
    sections.push('## Long-term Memories');
    for (const m of longMemories) {
      sections.push(`- **${m.title}**: ${m.content.slice(0, 300)}`);
    }
    sections.push('');
  }

  const projects = [...new Set(projectMemories.map(m => m.project!).filter(Boolean))];
  for (const project of projects) {
    const pMems = projectMemories.filter(m => m.project === project);
    sections.push(`## Project: ${project}`);
    for (const m of pMems) {
      sections.push(`- **${m.title}**: ${m.content.slice(0, 200)}`);
    }
    sections.push('');
  }

  const content = sections.join('\n');
  const claudeDir = getClaudeDir();

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  fs.writeFileSync(getClaudeMdPath(), content, 'utf-8');
}

export async function syncFromClaudeMd(): Promise<string | null> {
  const mdPath = getClaudeMdPath();
  if (!fs.existsSync(mdPath)) return null;
  return fs.readFileSync(mdPath, 'utf-8');
}
