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
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
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

const EVENT_COLORS: Record<TimelineEvent['type'], string> = {
  create: 'var(--success)',
  access: 'var(--accent)',
  decay: 'var(--warning)',
  import: 'var(--layer-project)',
};

function deriveEvents(memories: Memory[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const m of memories.slice(0, 20)) {
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
  }

  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return events.slice(0, 20);
}

export default function Timeline({ memories, onMemoryClick }: TimelineProps) {
  const events = deriveEvents(memories);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fade-in">
        <div 
          className="empty-state-icon mb-4"
          style={{ width: 48, height: 48 }}
        >
          <Clock size={20} />
        </div>
        <p className="text-sm font-medium" style={{ color: 'var(--text-quaternary)' }}>
          暂无时间线事件
        </p>
      </div>
    );
  }

  return (
    <div className="relative pl-8">
      <div
        className="absolute left-[10px] top-3 bottom-3"
        style={{ 
          width: 2, 
          background: 'linear-gradient(180deg, var(--border) 0%, var(--border-light) 50%, var(--border) 100%)',
          borderRadius: 2,
        }}
      />
      <div className="flex flex-col gap-3.5">
        {events.map((event, index) => {
          const cfg = LAYER_CONFIG[event.layer];
          const IconComponent = EVENT_ICONS[event.type];
          const eventColor = EVENT_COLORS[event.type];
          
          return (
            <div 
              key={event.id} 
              className="relative animate-slide-up"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              <div
                className="absolute top-3 rounded-full"
                style={{
                  width: 10,
                  height: 10,
                  background: cfg.color,
                  boxShadow: `0 0 0 3px var(--bg-card), 0 0 8px ${cfg.color}40`,
                  left: -28,
                  zIndex: 1,
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
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--border)',
                  padding: '12px 14px',
                  cursor: onMemoryClick ? 'pointer' : 'default',
                  transition: 'all var(--transition-fast)',
                  outline: 'none',
                  position: 'relative',
                  overflow: 'hidden',
                }}
                onMouseEnter={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.background = 'var(--bg-card-hover)';
                    e.currentTarget.style.borderColor = 'var(--border-strong)';
                    e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                    e.currentTarget.style.transform = 'translateX(2px)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.background = 'var(--bg-card)';
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.boxShadow = 'none';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }
                }}
                onFocus={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.boxShadow = '0 0 0 2px rgba(0,113,235,0.15)';
                  }
                }}
                onBlur={(e) => {
                  if (onMemoryClick) {
                    e.currentTarget.style.boxShadow = 'none';
                  }
                }}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 'var(--radius-xs)',
                      background: `${eventColor}12`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <IconComponent size={12} style={{ color: eventColor }} />
                  </div>
                  <span
                    className="truncate"
                    style={{
                      fontSize: 13,
                      color: 'var(--text-primary)',
                      lineHeight: '20px',
                      maxWidth: '100%',
                      fontWeight: 600,
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {event.title}
                  </span>
                  <span
                    className="shrink-0 rounded-md px-2 py-0.5"
                    style={{
                      fontSize: 10.5,
                      color: cfg.color,
                      background: `${cfg.color}12`,
                      lineHeight: '16px',
                      fontWeight: 600,
                    }}
                  >
                    {cfg.label}
                  </span>
                  <span
                    className="ml-auto shrink-0 stat-number"
                    style={{
                      fontSize: 11,
                      color: 'var(--text-quaternary)',
                      lineHeight: '16px',
                      fontWeight: 500,
                    }}
                  >
                    {timeAgo(event.timestamp)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 pl-[30px]">
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--text-quaternary)',
                      lineHeight: '16px',
                      fontWeight: 500,
                    }}
                  >
                    {EVENT_LABELS[event.type]}
                  </span>
                  {event.detail && (
                    <>
                      <span style={{ color: 'var(--text-quaternary)', fontSize: 11 }}>·</span>
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--text-tertiary)',
                          lineHeight: '16px',
                          fontWeight: 500,
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
