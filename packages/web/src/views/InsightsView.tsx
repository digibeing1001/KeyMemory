/**
 * KM-409：Insights 视图——系统健康可视化。
 * HealthReport 的分数/流动度/孤儿/冲突/降级路径全部可见，
 * 健康分下降时能定位到具体指标（Part 5 原则③：降级必须可见）。
 */
import { useEffect, useState } from 'react';
import type { HealthReport } from '@keymemory/shared';
import { getHealth, listOrphanIssues } from '../lib/api';
import type { OrphanIssue } from '../lib/api';
import { Card, Badge, DegradedBanner, EmptyState } from '../components/ui';
import { useI18n } from '../i18n';
import { userFacingLayer, userFacingOrphanRequirement } from '../lib/userFacing';

export default function InsightsView() {
  const { language } = useI18n();
  const zh = language === 'zh';
  const [report, setReport] = useState<(HealthReport & { status?: string; timestamp?: string }) | null>(null);
  const [orphans, setOrphans] = useState<OrphanIssue[]>([]);

  useEffect(() => {
    getHealth().then(setReport).catch(() => setReport(null));
    listOrphanIssues(20).then(setOrphans).catch(() => setOrphans([]));
  }, []);

  if (!report) {
    return <div style={{ padding: 20 }}><EmptyState title="健康报告加载失败" hint="请确认服务运行中" /></div>;
  }

  const scoreTone = report.score >= 80 ? 'good' : report.score >= 60 ? 'warn' : 'bad';

  const metrics: Array<{ label: string; help: string; value: string | number; tone?: 'good' | 'warn' | 'bad' }> = [
    { label: zh ? '整体健康度' : 'Overall health', help: zh ? '综合重复、冲突、过期和使用情况得出的参考分。' : 'A reference score combining duplication, conflicts, aging, and usage.', value: report.score, tone: scoreTone },
    { label: zh ? '记忆活跃度' : 'Memory activity', help: zh ? '近期记忆是否持续被写入、使用和整理。' : 'Whether memories are being written, used, and organized.', value: report.flowScore ?? '-', tone: (report.flowScore ?? 100) >= 80 ? 'good' : (report.flowScore ?? 100) >= 60 ? 'warn' : 'bad' },
    { label: zh ? '疑似重复' : 'Possible duplicates', help: zh ? '内容高度相似、可能可以合并的记忆。' : 'Highly similar memories that may be merged.', value: report.duplicateCount, tone: report.duplicateCount > 0 ? 'warn' : 'good' },
    { label: zh ? '缺少关联线索' : 'Missing context links', help: zh ? '尚未关联工作邮件、主题标签或其他记忆的条目。' : 'Items not yet linked to work mail, topic tags, or other memories.', value: report.orphanCount, tone: report.orphanCount > 0 ? 'warn' : 'good' },
    { label: zh ? '可能互相矛盾' : 'Possible conflicts', help: zh ? '对同一事实可能有不同说法，建议人工核对。' : 'Memories that may disagree and need review.', value: report.conflictCount, tone: report.conflictCount > 0 ? 'warn' : 'good' },
    { label: zh ? '建议复查' : 'Needs review', help: zh ? '长期未使用、可能已经过时的记忆。' : 'Memories that may be stale after long inactivity.', value: report.decayingCount },
    { label: zh ? '近期仍会用' : 'Useful soon', help: zh ? '当前处于“近期有用”状态的记忆。' : 'Memories currently marked useful soon.', value: report.shortActive ?? '-' },
    { label: zh ? '长期保留但尚未使用' : 'Kept but unused', help: zh ? '长期保存后还没有被 Agent 检索到的记忆。' : 'Long-term memories not yet retrieved by an Agent.', value: report.longZeroHit ?? '-', tone: (report.longZeroHit ?? 0) > 10 ? 'warn' : undefined },
    { label: zh ? '最近自动整理成果' : 'Recent organize results', help: zh ? '最近十次自动整理实际完成的合并、归档和增强数量。' : 'Changes produced by the latest ten organize runs.', value: report.dreamEffectiveness ?? '-', tone: (report.dreamEffectiveness ?? 1) === 0 ? 'warn' : undefined },
    { label: zh ? 'Agent 长任务记录' : 'Agent long-task records', help: zh ? '使用可恢复任务记录的 Agent 工作数量。' : 'Agent tasks using resumable work records.', value: report.loopRuns ?? '-' },
  ];

  const layers = Object.entries(report.layerDistribution ?? {});

  return (
    <div style={{ display: 'grid', gap: 14, padding: 20, maxWidth: 980 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--text-primary)' }}>{zh ? '记忆健康' : 'Memory health'}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {zh ? '查看记忆是否在被使用、是否需要整理。这里的提示不会自动删除任何内容。' : 'See whether memory is being used and what may need attention. Nothing is deleted here.'}
        </p>
      </header>

      <DegradedBanner paths={report.degradedPaths ?? []} />

      <Card title={zh ? '需要关注的情况' : 'What needs attention'}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {metrics.map(metric => (
            <div key={metric.label} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--bg-secondary)' }}>
               <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{metric.label}</div>
              <div style={{ marginTop: 4 }}>
                <Badge tone={metric.tone ?? 'neutral'}>{metric.value}</Badge>
              </div>
              <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.45, color: 'var(--text-muted)' }}>{metric.help}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card title={zh ? '各记忆状态的数量' : 'Memories by state'}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {layers.map(([layer, count]) => (
            <Badge key={layer}>{userFacingLayer(layer, language)}：{count}</Badge>
          ))}
        </div>
      </Card>

      <Card title={zh ? `需要补充线索的记忆（${orphans.length}）` : `Memories needing context (${orphans.length})`}>
        {orphans.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{zh ? '每条记忆都已有至少一种可用的关联线索。' : 'Every memory has at least one useful context link.'}</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {orphans.map((orphan, index) => (
              <li key={`${orphan.memoryId}-${index}`} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {orphan.title} <span style={{ color: 'var(--text-muted)' }}>— {zh ? '可补充' : 'Add'}：{orphan.missing.map(item => userFacingOrphanRequirement(item, language)).join(zh ? '、' : ', ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
