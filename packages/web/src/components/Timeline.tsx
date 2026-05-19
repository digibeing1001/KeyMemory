import type { Memory, Layer } from '@keymemory/shared';
import { LAYER_CONFIG } from '@keymemory/shared';

interface TimelineProps {
  memories: Memory[];
  onMemoryClick?: (id: string) => void;
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

export default function Timeline({ memories, onMemoryClick }: TimelineProps) {
  const recentMemories = [...memories]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 20);

  if (recentMemories.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        暂无时间线事件
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {recentMemories.map((memory) => {
        const cfg = LAYER_CONFIG[memory.layer];
        return (
          <div
            key={memory.id}
            className="timeline-item"
            onClick={() => onMemoryClick?.(memory.id)}
            style={{ cursor: onMemoryClick ? 'pointer' : 'default' }}
          >
            <div
              className="timeline-dot"
              style={{ borderColor: cfg.color }}
            />
            <div
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: 'var(--text-primary)',
                lineHeight: 1.4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {memory.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                marginTop: 2,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ color: cfg.color, fontWeight: 500 }}>{cfg.label}</span>
              <span>·</span>
              <span>{timeAgo(memory.updatedAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
