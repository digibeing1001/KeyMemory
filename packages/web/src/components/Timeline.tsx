import type { Memory } from '@keymemory/shared';
import { useI18n } from '../i18n';
import { formatMemoryTitle, formatRelativeTime, LAYER_COLORS } from '../lib/memoryFormat';

interface TimelineProps {
  memories: Memory[];
  onMemoryClick?: (id: string) => void;
}

export default function Timeline({ memories, onMemoryClick }: TimelineProps) {
  const { language, layerLabel } = useI18n();
  const recentMemories = [...memories]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 20);

  if (recentMemories.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
        {language === 'zh' ? '暂无最近更新' : 'No recent updates'}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {recentMemories.map((memory) => (
        <button
          key={memory.id}
          className="timeline-item"
          onClick={() => onMemoryClick?.(memory.id)}
          style={{ cursor: onMemoryClick ? 'pointer' : 'default', border: 'none', background: 'transparent', textAlign: 'left', width: '100%' }}
        >
          <div className="timeline-dot" style={{ borderColor: LAYER_COLORS[memory.layer] }} />
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-primary)',
              lineHeight: 1.4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {formatMemoryTitle(memory)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: LAYER_COLORS[memory.layer], fontWeight: 600 }}>{layerLabel(memory.layer)}</span>
            <span>·</span>
            <span>{formatRelativeTime(memory.updatedAt, language)}</span>
          </div>
        </button>
      ))}
    </div>
  );
}
