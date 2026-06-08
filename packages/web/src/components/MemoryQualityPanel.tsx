import type { Memory } from '@keymemory/shared';
import { analyzeMemoryQuality, type MemoryQualityIssue } from '@keymemory/shared';
import { useI18n } from '../i18n';

interface MemoryQualityPanelProps {
  memory: Memory;
  compact?: boolean;
}

const ISSUE_COPY: Record<MemoryQualityIssue['code'], {
  zh: { label: string; action: string };
  en: { label: string; action: string };
}> = {
  sparse_content: {
    zh: { label: '上下文太少', action: '补充结论、约束或例子。' },
    en: { label: 'Too little context', action: 'Add the decision, constraint, or example.' },
  },
  missing_project: {
    zh: { label: '缺少项目归属', action: '分配项目路径或项目标签。' },
    en: { label: 'No project home', action: 'Assign a project path or project tag.' },
  },
  missing_kind: {
    zh: { label: '缺少记忆类型', action: '补充 kind 标签或 memoryKind。' },
    en: { label: 'No memory kind', action: 'Add a kind tag or memoryKind.' },
  },
  missing_source: {
    zh: { label: '缺少来源证据', action: '补充 source、sourceId 或 evidence。' },
    en: { label: 'No source evidence', action: 'Add source, sourceId, or evidence.' },
  },
  missing_domain_tags: {
    zh: { label: '缺少领域标签', action: '添加一两个可检索标签。' },
    en: { label: 'No domain tags', action: 'Add one or two searchable tags.' },
  },
  low_confidence: {
    zh: { label: '可信度偏低', action: '确认后再长期保留。' },
    en: { label: 'Low confidence', action: 'Confirm before keeping long-term.' },
  },
  decaying: {
    zh: { label: '正在衰减', action: '更新、使用或归档它。' },
    en: { label: 'Decaying', action: 'Update, use, or archive it.' },
  },
  stale_flash: {
    zh: { label: '闪念过久未整理', action: '升级、归类或归档。' },
    en: { label: 'Old flash memory', action: 'Promote, assign, or archive it.' },
  },
  stale_short: {
    zh: { label: '短期记忆已变旧', action: '决定长期保留或归档。' },
    en: { label: 'Aging short-term memory', action: 'Keep long-term or archive.' },
  },
};

const STRENGTH_COPY: Record<string, { zh: string; en: string }> = {
  'Reusable body': { zh: '上下文可复用', en: 'Reusable body' },
  Scoped: { zh: '归属清晰', en: 'Scoped' },
  Typed: { zh: '类型明确', en: 'Typed' },
  'Evidence linked': { zh: '来源可追溯', en: 'Evidence linked' },
  Discoverable: { zh: '便于检索', en: 'Discoverable' },
};

function severityColor(severity: MemoryQualityIssue['severity']): string {
  if (severity === 'danger') return 'var(--danger)';
  if (severity === 'warning') return 'var(--warning)';
  return 'var(--accent)';
}

function maturityLabel(maturity: 'seed' | 'usable' | 'trusted', language: 'zh' | 'en'): string {
  if (language === 'zh') {
    if (maturity === 'trusted') return '可信长期记忆';
    if (maturity === 'usable') return '可用但需观察';
    return '种子记忆';
  }
  if (maturity === 'trusted') return 'Trusted';
  if (maturity === 'usable') return 'Usable';
  return 'Seed';
}

export default function MemoryQualityPanel({ memory, compact = false }: MemoryQualityPanelProps) {
  const { language } = useI18n();
  const report = analyzeMemoryQuality(memory);
  const visibleIssues = compact ? report.issues.slice(0, 3) : report.issues;
  const locale = language === 'zh' ? 'zh' : 'en';

  return (
    <section className={`memory-quality-panel${compact ? ' is-compact' : ''}`}>
      <div className="memory-quality-head">
        <div>
          <div className="memory-quality-eyebrow">
            {language === 'zh' ? '记忆洞察' : 'Memory insight'}
          </div>
          <strong>{maturityLabel(report.maturity, locale)}</strong>
        </div>
        <span className="memory-quality-score">{report.score}</span>
      </div>

      {report.strengths.length > 0 && (
        <div className="memory-quality-strengths">
          {report.strengths.slice(0, compact ? 3 : 5).map((strength) => {
            const copy = STRENGTH_COPY[strength]?.[locale] ?? strength;
            return <span key={strength} className="tag-pill">{copy}</span>;
          })}
        </div>
      )}

      {visibleIssues.length === 0 ? (
        <p className="memory-quality-empty">
          {language === 'zh' ? '这条记忆有足够的来源、结构和上下文，可以放心被 Agent 召回。' : 'This memory has enough evidence, structure, and context for agent recall.'}
        </p>
      ) : (
        <div className="memory-quality-issues">
          {visibleIssues.map((issue) => {
            const copy = ISSUE_COPY[issue.code][locale];
            return (
              <div key={issue.code} className="memory-quality-issue">
                <span style={{ background: severityColor(issue.severity) }} />
                <div>
                  <strong>{copy.label}</strong>
                  <p>{copy.action}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
