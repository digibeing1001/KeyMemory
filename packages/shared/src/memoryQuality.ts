import type { Memory } from './types.js';

export type MemoryQualitySeverity = 'info' | 'warning' | 'danger';

export interface MemoryQualityIssue {
  code:
    | 'sparse_content'
    | 'missing_project'
    | 'missing_kind'
    | 'missing_source'
    | 'missing_domain_tags'
    | 'low_confidence'
    | 'decaying'
    | 'stale_flash'
    | 'stale_short';
  severity: MemoryQualitySeverity;
  label: string;
  detail: string;
  action: string;
  penalty: number;
}

export interface MemoryQualityReport {
  score: number;
  maturity: 'seed' | 'usable' | 'trusted';
  issues: MemoryQualityIssue[];
  strengths: string[];
}

type MemoryQualityInput = Pick<
  Memory,
  | 'title'
  | 'content'
  | 'layer'
  | 'projectId'
  | 'confidence'
  | 'decayFactor'
  | 'createdAt'
  | 'updatedAt'
  | 'tags'
  | 'source'
  | 'sourceId'
  | 'metadata'
>;

const OPERATIONAL_TAG_PREFIXES = ['kind:', 'scope:', 'project:', 'sensitivity:'];

function metadataRecord(memory: MemoryQualityInput): Record<string, unknown> {
  return memory.metadata && typeof memory.metadata === 'object' ? memory.metadata : {};
}

function hasMemoryKind(memory: MemoryQualityInput): boolean {
  const metadata = metadataRecord(memory);
  return typeof metadata.memoryKind === 'string'
    || Boolean(memory.tags?.some(tag => tag.startsWith('kind:')));
}

function hasEvidence(memory: MemoryQualityInput): boolean {
  const metadata = metadataRecord(memory);
  const evidence = metadata.evidence;
  return Boolean(memory.source || memory.sourceId)
    || (Boolean(evidence) && typeof evidence === 'object');
}

function hasProjectSignal(memory: MemoryQualityInput): boolean {
  return Boolean(memory.projectId)
    || Boolean(memory.tags?.some(tag => tag.startsWith('project:') || tag === 'scope:project'));
}

function domainTags(memory: MemoryQualityInput): string[] {
  return (memory.tags ?? []).filter(tag => (
    !OPERATIONAL_TAG_PREFIXES.some(prefix => tag.toLowerCase().startsWith(prefix))
  ));
}

function plainTextLength(value: string): number {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[#>*_\-~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .length;
}

function daysSince(value: string): number {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

export function analyzeMemoryQuality(memory: MemoryQualityInput): MemoryQualityReport {
  const issues: MemoryQualityIssue[] = [];
  const strengths: string[] = [];
  const textLength = plainTextLength(`${memory.title}\n${memory.content}`);
  const tagCount = domainTags(memory).length;

  if (textLength < 40) {
    issues.push({
      code: 'sparse_content',
      severity: 'danger',
      label: 'Too little context',
      detail: 'This memory is short enough that future agents may retrieve it without knowing how to use it.',
      action: 'Add the decision, constraint, or example that makes it reusable.',
      penalty: 20,
    });
  } else {
    strengths.push('Reusable body');
  }

  if (!hasProjectSignal(memory) && memory.layer !== 'entity') {
    issues.push({
      code: 'missing_project',
      severity: 'warning',
      label: 'No project home',
      detail: 'Project routing is missing, so the memory may surface in unrelated work.',
      action: 'Assign a project path or add a project tag.',
      penalty: 12,
    });
  } else {
    strengths.push('Scoped');
  }

  if (!hasMemoryKind(memory)) {
    issues.push({
      code: 'missing_kind',
      severity: 'warning',
      label: 'No normalized kind',
      detail: 'Agents get better context packs when memories are grouped as preferences, decisions, tasks, procedures, and facts.',
      action: 'Add metadata.memoryKind or a kind:* tag.',
      penalty: 10,
    });
  } else {
    strengths.push('Typed');
  }

  if (!hasEvidence(memory)) {
    issues.push({
      code: 'missing_source',
      severity: 'info',
      label: 'No source evidence',
      detail: 'The memory has no visible origin, which makes audits and later cleanup harder.',
      action: 'Set source/sourceId or metadata.evidence when an agent writes it.',
      penalty: 8,
    });
  } else {
    strengths.push('Evidence linked');
  }

  if (tagCount === 0) {
    issues.push({
      code: 'missing_domain_tags',
      severity: 'info',
      label: 'No domain tags',
      detail: 'Only system tags are present, so graph and tag recall will be weaker.',
      action: 'Add one or two searchable domain tags.',
      penalty: 8,
    });
  } else {
    strengths.push('Discoverable');
  }

  if (memory.confidence < 0.7) {
    issues.push({
      code: 'low_confidence',
      severity: 'warning',
      label: 'Low confidence',
      detail: 'This memory should not be promoted until it has more evidence or user confirmation.',
      action: 'Confirm or refine the claim before moving it to long-term memory.',
      penalty: 14,
    });
  }

  if (memory.decayFactor < 0.5) {
    issues.push({
      code: 'decaying',
      severity: 'warning',
      label: 'Decaying',
      detail: 'The memory is losing relevance and may be a cleanup candidate.',
      action: 'Use it, update it, or archive it.',
      penalty: 10,
    });
  }

  const ageDays = daysSince(memory.updatedAt || memory.createdAt);
  if (memory.layer === 'flash' && ageDays >= 7) {
    issues.push({
      code: 'stale_flash',
      severity: 'warning',
      label: 'Old flash memory',
      detail: 'Flash memories should be sorted quickly so they do not become ambiguous backlog.',
      action: 'Promote, assign, or archive it.',
      penalty: 10,
    });
  }

  if (memory.layer === 'short' && ageDays >= 30 && memory.decayFactor < 0.8) {
    issues.push({
      code: 'stale_short',
      severity: 'info',
      label: 'Aging short-term memory',
      detail: 'This short-term memory is old enough to need a keep/archive decision.',
      action: 'Move to long-term only if it is still reusable.',
      penalty: 6,
    });
  }

  const score = Math.max(0, Math.min(100, 100 - issues.reduce((sum, issue) => sum + issue.penalty, 0)));
  const maturity = score >= 82 ? 'trusted' : score >= 62 ? 'usable' : 'seed';

  return { score, maturity, issues, strengths };
}
