/**
 * KM-304：上下文卸载——长内容写入 refs/*.md，主上下文只留摘要 + 引用路径。
 *
 * 借鉴腾讯「上下文卸载」实践：长任务中产生的大段日志、调研、中间产物不塞进
 * 对话上下文，而是落盘为外部引用文件；主上下文只保留 Mermaid 任务地图与引用，
 * 显著降低每轮注入 token。文件落在数据目录 refs/ 下，随备份策略可携带。
 */
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir } from '../db/sqlite.js';

export interface OffloadInput {
  title: string;
  content: string;
  /** 可选摘要；缺省时取内容前 200 字。 */
  summary?: string;
  /** 可选关联的 loop run（仅记录在文件头部，便于追溯）。 */
  runId?: string;
  source?: string;
}

export interface OffloadResult {
  refPath: string;
  bytes: number;
  summary: string;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'note';
}

export function getRefsDir(): string {
  const dir = path.join(getDataDir(), 'refs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function offloadLongContent(input: OffloadInput): OffloadResult {
  const title = (input.title ?? '').trim() || 'untitled';
  const content = input.content ?? '';
  if (!content.trim()) throw new Error('content is required for offload');

  const summary = (input.summary ?? '').trim() || content.slice(0, 200).replace(/\s+/g, ' ').trim();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const refPath = path.join(getRefsDir(), `${stamp}-${slugify(title)}.md`);

  const header = [
    `# ${title}`,
    '',
    `- offloaded_at: ${new Date().toISOString()}`,
    input.runId ? `- loop_run: ${input.runId}` : null,
    input.source ? `- source: ${input.source}` : null,
    `- summary: ${summary}`,
    '',
    '---',
    '',
  ].filter(line => line !== null).join('\n');

  fs.writeFileSync(refPath, header + content, 'utf8');
  return { refPath, bytes: Buffer.byteLength(content, 'utf8'), summary };
}
