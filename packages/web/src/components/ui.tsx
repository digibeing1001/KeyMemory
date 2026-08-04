/**
 * KM-403：基础组件层。
 * Card / Badge / EmptyState / Timeline / DegradedBanner——
 * 供六视图复用，避免样式散落在 122KB 手写 CSS 里。
 */
import type { ReactNode } from 'react';

export function Card({ title, extra, children, className }: { title?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section
      className={className}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)',
        padding: 16,
        display: 'grid',
        gap: 12,
      }}
    >
      {(title || extra) && (
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 650, color: 'var(--text-primary)' }}>{title}</h3>
          {extra}
        </header>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const colors: Record<string, { fg: string; bg: string }> = {
    neutral: { fg: 'var(--text-secondary)', bg: 'var(--bg-secondary)' },
    good: { fg: 'var(--success, #16a34a)', bg: 'color-mix(in srgb, var(--success, #16a34a) 12%, transparent)' },
    warn: { fg: '#b58a2e', bg: 'color-mix(in srgb, #b58a2e 12%, transparent)' },
    bad: { fg: 'var(--danger, #dc2626)', bg: 'color-mix(in srgb, var(--danger, #dc2626) 12%, transparent)' },
  };
  const c = colors[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11.5,
        fontWeight: 600,
        padding: '2px 8px',
        borderRadius: 999,
        color: c.fg,
        background: c.bg,
      }}
    >
      {children}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)',
        padding: '40px 24px',
        display: 'grid',
        gap: 6,
        justifyItems: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <strong style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{title}</strong>
      {hint && <span style={{ fontSize: 12.5 }}>{hint}</span>}
    </div>
  );
}

export interface TimelineEntry {
  time: string;
  title: string;
  description?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad';
}

/** 时间轴：as-of 视图与 Today 视图共用的纵向事件列表。 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <EmptyState title="暂无事件" hint="时间轴会随记忆与整理记录累积" />;
  const toneColor: Record<string, string> = {
    neutral: 'var(--text-muted)',
    good: 'var(--success, #16a34a)',
    warn: '#b58a2e',
    bad: 'var(--danger, #dc2626)',
  };
  return (
    <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 0 }}>
      {entries.map((entry, index) => (
        <li
          key={`${entry.time}-${index}`}
          style={{ display: 'grid', gridTemplateColumns: '132px 14px 1fr', gap: 10, alignItems: 'start', paddingBottom: 14 }}
        >
          <time style={{ fontSize: 12, color: 'var(--text-muted)', paddingTop: 1 }}>{entry.time}</time>
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              marginTop: 4,
              justifySelf: 'center',
              background: toneColor[entry.tone ?? 'neutral'],
              boxShadow: index < entries.length - 1 ? `0 14px 0 -4.5px var(--border)` : undefined,
            }}
          />
          <div style={{ display: 'grid', gap: 2 }}>
            <strong style={{ fontSize: 13, color: 'var(--text-primary)' }}>{entry.title}</strong>
            {entry.description && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{entry.description}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export interface DegradedNotice {
  key: string;
  message: string;
  fixHint: string;
}

/**
 * KM-403 + Part 5 原则③：降级必须可见。
 * 把 HealthReport.degradedPaths 翻译为用户可读的横幅，附"如何修复"。
 */
export function DegradedBanner({ paths }: { paths: string[] }) {
  if (!paths || paths.length === 0) return null;
  const noticeMap: Record<string, Omit<DegradedNotice, 'key'>> = {
    embeddings_unavailable: { message: '语义检索不可用，当前仅关键词匹配', fixHint: '下载嵌入模型：pnpm download-model，或在设置中配置' },
    llm_unavailable: { message: 'LLM 未配置：关联推理与语义冲突判定已关闭', fixHint: '在 LLM 设置页配置 baseUrl 与模型' },
    fts_unavailable: { message: '中文检索出现模糊匹配降级，结果排序可能不准确', fixHint: '升级后首次重建索引：POST /api/embeddings/rebuild-all' },
    refine_backlog: { message: '异步提炼积压超过 50 条', fixHint: '等待后台提炼或重启服务触发恢复' },
  };
  const notices: DegradedNotice[] = paths.map(key => ({
    key,
    ...(noticeMap[key] ?? { message: `降级路径生效：${key}`, fixHint: '查看服务日志定位原因' }),
  }));
  return (
    <div role="alert" style={{ display: 'grid', gap: 6 }}>
      {notices.map(notice => (
        <div
          key={notice.key}
          style={{
            border: '1px solid color-mix(in srgb, #b58a2e 45%, transparent)',
            background: 'color-mix(in srgb, #b58a2e 10%, transparent)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            display: 'grid',
            gap: 2,
            fontSize: 12.5,
          }}
        >
          <strong style={{ color: '#b58a2e' }}>⚠ {notice.message}</strong>
          <span style={{ color: 'var(--text-muted)' }}>如何修复：{notice.fixHint}</span>
        </div>
      ))}
    </div>
  );
}
