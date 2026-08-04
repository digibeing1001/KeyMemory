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

export default function InsightsView() {
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

  const metrics: Array<{ label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' }> = [
    { label: '健康分', value: report.score, tone: scoreTone },
    { label: '数据流动度', value: report.flowScore ?? '-', tone: (report.flowScore ?? 100) >= 80 ? 'good' : (report.flowScore ?? 100) >= 60 ? 'warn' : 'bad' },
    { label: '疑似重复', value: report.duplicateCount, tone: report.duplicateCount > 0 ? 'warn' : 'good' },
    { label: '孤儿记忆', value: report.orphanCount, tone: report.orphanCount > 0 ? 'warn' : 'good' },
    { label: '潜在冲突', value: report.conflictCount, tone: report.conflictCount > 0 ? 'warn' : 'good' },
    { label: '衰减中', value: report.decayingCount },
    { label: '短期层活跃', value: report.shortActive ?? '-' },
    { label: '长期层零命中', value: report.longZeroHit ?? '-', tone: (report.longZeroHit ?? 0) > 10 ? 'warn' : undefined },
    { label: 'Dream 产出(近10次)', value: report.dreamEffectiveness ?? '-', tone: (report.dreamEffectiveness ?? 1) === 0 ? 'warn' : undefined },
    { label: 'Loop 运行数', value: report.loopRuns ?? '-' },
  ];

  const layers = Object.entries(report.layerDistribution ?? {});

  return (
    <div style={{ display: 'grid', gap: 14, padding: 20, maxWidth: 980 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--text-primary)' }}>Insights · 系统健康</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          记忆库是否在真正流动——指标异常时可直接定位。
        </p>
      </header>

      <DegradedBanner paths={report.degradedPaths ?? []} />

      <Card title="核心指标">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 10 }}>
          {metrics.map(metric => (
            <div key={metric.label} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--bg-secondary)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{metric.label}</div>
              <div style={{ marginTop: 4 }}>
                <Badge tone={metric.tone ?? 'neutral'}>{metric.value}</Badge>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card title="层级分布">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {layers.map(([layer, count]) => (
            <Badge key={layer}>{layer}: {count}</Badge>
          ))}
        </div>
      </Card>

      <Card title={`孤儿记忆样例（${orphans.length}）`}>
        {orphans.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>没有孤儿记忆，结构健康。</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {orphans.map((orphan, index) => (
              <li key={`${orphan.memoryId}-${index}`} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                {orphan.title} <span style={{ color: 'var(--text-muted)' }}>— 缺少：{orphan.missing.join('、')}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
