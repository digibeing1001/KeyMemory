import type { Layer, Memory, MemoryKind } from '@keymemory/shared';

export const LAYER_COLORS: Record<Layer, string> = {
  flash: '#f59e0b',
  short: '#3b82f6',
  long: '#10b981',
  entity: '#ec4899',
};

const MEMORY_KINDS = new Set<MemoryKind>([
  'preference',
  'project_fact',
  'decision',
  'task',
  'procedure',
  'concept',
  'relationship',
  'event',
  'constraint',
  'raw_note',
]);

const SENSITIVE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/((?:api[_ -]?key|secret|token|password|passwd|pwd)\s*[:=]\s*)([^\s,;'"`]{8,})/gi, '$1[redacted]'],
  [/\bntn_[A-Za-z0-9]{8,}\b/g, 'ntn_[redacted]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[redacted]'],
  [/\bgh[pousr]_[A-Za-z0-9_]{12,}\b/g, 'gh_[redacted]'],
  [/\bAKIA[0-9A-Z]{12,}\b/g, 'AKIA[redacted]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, 'AIza[redacted]'],
  [/\bxox[baprs]-[0-9A-Za-z-]{12,}\b/g, 'xox-[redacted]'],
];

export function getMemoryKind(memory: Memory): MemoryKind {
  const metaKind = memory.metadata?.['memoryKind'];
  if (typeof metaKind === 'string' && MEMORY_KINDS.has(metaKind as MemoryKind)) {
    return metaKind as MemoryKind;
  }

  const tagKind = memory.tags?.find((tag) => tag.startsWith('kind:'))?.slice(5);
  if (tagKind && MEMORY_KINDS.has(tagKind as MemoryKind)) return tagKind as MemoryKind;

  const typeKind = memory.tags?.find((tag) => tag.startsWith('type:'))?.slice(5);
  if (typeKind && MEMORY_KINDS.has(typeKind as MemoryKind)) return typeKind as MemoryKind;

  return 'raw_note';
}

export function redactSensitiveText(value: string): string {
  return SENSITIVE_REPLACEMENTS.reduce((text, [pattern, replacement]) => (
    text.replace(pattern, replacement)
  ), value);
}

export function formatMemoryTitle(memory: Pick<Memory, 'title'>): string {
  return redactSensitiveText(memory.title || 'Untitled');
}

export function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_\-~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function summarizeMemory(memory: Memory, maxLength = 140): string {
  const text = redactSensitiveText(stripMarkdown(redactSensitiveText(memory.content)));
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

export function formatDateTime(value: string, locale: string): string {
  return new Date(value).toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string, locale: string): string {
  return new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

export function formatRelativeTime(value: string, language: 'zh' | 'en'): string {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (language === 'en') {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return formatDate(value, 'en-US');
  }

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  if (days < 7) return `${days} 天前`;
  return formatDate(value, 'zh-CN');
}
