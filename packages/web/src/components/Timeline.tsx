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
  onMemoryClick?: (id: string) => void;
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

export default function Timeline({ memories, onMemoryClick }: TimelineProps) {
  const events = deriveEvents(memories);

  if (events.length === 0) {
    return (
      <div className="flex items-center justify-center py-12" style={{ color: 'var(--text-tertiary)' }}>
        <p className="text-sm">暂无时间线事件</p>
      </div>
    );
  }

  return (
    <div className="relative pl-7">
      <div
        className="absolute left-[8px] top-2 bottom-2"
        style={{ width: 1.5, background: 'var(--border)', borderRadius: 1 }}
      />
      <div className="flex flex-col gap-3">
        {events.map((event) => {
          const cfg = LAYER_CONFIG[event.layer];
          const IconComponent = EVENT_ICONS[event.type];
          return (
            <div key={event.id} className="relative">
              <div
                className="absolute top-3 rounded-full"
                style={{
                  width: 9,
                  height: 9,
                  background: cfg.color,
                  boxShadow: `0 0 0 2.5px var(--bg-card)`,
                  left: -25,
                }}
              />
              <div
                onClick={() => onMemoryClick?.(event.id.replace(/-(create|access|decay|import)$/, ''))}
                tabIndex={onMemoryClick ? 0 : undefined}
                role={onMemoryClick ? 'button' : undefined}
                aria-label={`${event.title} - ${EVENT_LABELS[event.type]}`}
                onKeyDown={(e) => {
                  if (onMemoryClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onMemoryClick(event.id.replace(/-(create|access|decay|import)$/, ''));
                  }
                }}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  padding: '10px 12px',
                  cursor: onMemoryClick ? 'pointer' : 'default',
                  transition: 'all var(--transition-fast)',
                  outline: 'none',
                }}
                onMouseEnter={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.background = 'var(--bg-hover)';
                    e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.background = 'var(--bg-card)';
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = 'none';
                  }
                }}
                onFocus={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,122,255,0.2)';
                  }
                }}
                onBlur={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.boxShadow = 'none';
                  }
                }}
              >
                <div className="flex items-center gap-2">
                  <IconComponent size={13} style={{ color: cfg.color, flexShrink: 0 }} />
                  <span
                    className="truncate"
                    style={{
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      lineHeight: '18px',
                      maxWidth: '100%',
                      fontWeight: 500,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {event.title}
                  </span>
                  <span
                    className="shrink-0 rounded px-2 py-0.5"
                    style={{
                      fontSize: 11,
                      color: cfg.color,
                      background: `${cfg.color}14`,
                      lineHeight: '16px',
                      fontWeight: 500,
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
                <div className="mt-1 flex items-center gap-2">
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-tertiary)',
                      lineHeight: '16px',
                    }}
                  >
                    {EVENT_LABELS[event.type]}
                  </span>
                  {event.detail && (
                    <>
                      <span style={{ color: 'var(--text-tertiary)', fontSize: 11 }}>·</span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-tertiary)',
                          lineHeight: '16px',
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
