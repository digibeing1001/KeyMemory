import type { CSSProperties } from 'react';
import type { Memory, Layer } from '@keymemory/shared';
import { LAYER_CONFIG } from '@keymemory/shared';
import { Plus, Clock, Activity, Source } from './Icons';

interface TimelineEvent {
  id: string;
  type: 'create' | 'access' | 'decay' | 'import';
  title: string;
  layer: Layer;
  timestamp: string;
  detail?: string;
}

interface TimelineProps {
  memories: Memory[];
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  return `${days}天前`;
}

const EVENT_ICONS: Record<TimelineEvent['type'], React.FC<{ size?: number; style?: CSSProperties }>> = {
  create: Plus,
  access: Activity,
  decay: Clock,
  import: Source,
};

const EVENT_LABELS: Record<TimelineEvent['type'], string> = {
  create: '创建',
  access: '访问',
  decay: '衰减',
  import: '导入',
};

function deriveEvents(memories: Memory[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const m of memories) {
    events.push({
      id: `${m.id}-create`,
      type: 'create',
      title: m.title,
      layer: m.layer,
      timestamp: m.createdAt,
    });

    if (m.hitCount > 0 && m.lastHitAt) {
      events.push({
        id: `${m.id}-access`,
        type: 'access',
        title: m.title,
        layer: m.layer,
        timestamp: m.lastHitAt,
        detail: `累计访问 ${m.hitCount} 次`,
      });
    }

    if (m.decayFactor < 1) {
      events.push({
        id: `${m.id}-decay`,
        type: 'decay',
        title: m.title,
        layer: m.layer,
        timestamp: m.updatedAt,
        detail: `衰减系数 ${m.decayFactor.toFixed(2)}`,
      });
    }

    if (m.source) {
      events.push({
        id: `${m.id}-import`,
        type: 'import',
        title: m.title,
        layer: m.layer,
        timestamp: m.createdAt,
        detail: `来源: ${m.source}`,
      });
    }
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return events.slice(0, 15);
}

export default function Timeline({ memories }: TimelineProps) {
  const events = deriveEvents(memories);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-secondary)' }}>
        <p className="text-sm">暂无时间线事件</p>
      </div>
    );
  }

  return (
    <div className="relative pl-6">
      <div
        className="absolute left-[7px] top-2 bottom-2"
        style={{ width: 1.5, background: 'var(--border)' }}
      />
      <div className="flex flex-col gap-2">
        {events.map((event) => {
          const cfg = LAYER_CONFIG[event.layer];
          const IconComponent = EVENT_ICONS[event.type];
          return (
            <div key={event.id} className="timeline-item relative">
              <div
                className="absolute top-2.5 rounded-full"
                style={{
                  width: 8,
                  height: 8,
                  background: cfg.color,
                  boxShadow: `0 0 0 2px var(--bg-card)`,
                  left: -22,
                }}
              />
              <div
                className="rounded-lg px-3 py-2"
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-sm)',
                }}
              >
                <div className="flex items-center gap-2">
                  <IconComponent size={12} style={{ color: cfg.color, flexShrink: 0 }} />
                  <span
                    className="truncate"
                    style={{
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      lineHeight: '18px',
                      maxWidth: '100%',
                    }}
                  >
                    {event.title}
                  </span>
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5"
                    style={{
                      fontSize: 10,
                      color: cfg.color,
                      background: `${cfg.color}18`,
                      lineHeight: '14px',
                    }}
                  >
                    {cfg.label}
                  </span>
                  <span
                    className="ml-auto shrink-0"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      lineHeight: '16px',
                    }}
                  >
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span
                    style={{
                      fontSize: 10,
                      color: 'var(--text-tertiary)',
                    }}
                  >
                    {EVENT_LABELS[event.type]}
                  </span>
                  {event.detail && (
                    <>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>·</span>
                      <span
                        style={{
                          fontSize: 10,
                          color: 'var(--text-tertiary)',
                        }}
                      >
                        {event.detail}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
