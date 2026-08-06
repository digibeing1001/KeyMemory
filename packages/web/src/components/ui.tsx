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
    embeddings_unavailable: { message: '按含义搜索暂不可用，目前仍可使用关键词搜索', fixHint: '打开“智能整理设置”，检查本地语义模型' },
    llm_unavailable: { message: '智能整理模型尚未连接，自动判断功能暂时关闭', fixHint: '打开“智能整理设置”并完成模型连接' },
    fts_unavailable: { message: '中文搜索暂时使用兼容模式，排序可能不够准确', fixHint: '重启 KeyMemory；若仍异常，请打开诊断信息' },
    refine_backlog: { message: '还有较多新内容等待后台整理', fixHint: '保持 KeyMemory 运行，系统会继续自动处理' },
  };
  const notices: DegradedNotice[] = paths.map(key => ({
    key,
    ...(noticeMap[key] ?? { message: '部分增强功能暂时不可用', fixHint: '打开记忆健康页面查看诊断说明' }),
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
