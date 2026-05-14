import type { Memory } from '@keymemory/shared';
import { LAYER_CONFIG } from '@keymemory/shared';
import { Tag, Source } from './Icons';

interface MemoryCardProps {
  memory: Memory;
  onClick: (memory: Memory) => void;
  score?: number;
  matchType?: string;
}

export default function MemoryCard({ memory, onClick, score, matchType }: MemoryCardProps) {
  const layerConfig = LAYER_CONFIG[memory.layer];

  return (
    <div
      className="memory-result"
      data-layer={memory.layer}
      onClick={() => onClick(memory)}
    >
      <div className="color-bar" />

      <div style={{ minWidth: 0, position: 'relative' }}>
        {score != null && (
          <span
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--accent)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {Math.round(score * 100)}%
          </span>
        )}

        <div className="result-header" style={{ paddingRight: score != null ? 44 : 0 }}>
          <span className="result-title">{memory.title}</span>
          <span className="result-layer-badge">{layerConfig.label}</span>
        </div>

        <p className="result-body">{memory.content}</p>

        <div className="result-meta">
          {memory.tags && memory.tags.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <Tag size={12} />
              {memory.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 12,
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-xs)',
                    background: 'var(--bg-muted)',
                    color: 'var(--text-secondary)',
                    lineHeight: '18px',
                  }}
                >
                  {tag}
                </span>
              ))}
              {memory.tags.length > 3 && (
                <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                  +{memory.tags.length - 3}
                </span>
              )}
            </span>
          )}

          {memory.source && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
              <Source size={12} />
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--bg-muted)',
                  color: 'var(--text-secondary)',
                  lineHeight: '18px',
                }}
              >
                {memory.source}
              </span>
            </span>
          )}

          <span style={{ fontSize: 12, color: 'var(--text-tertiary)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
            {new Date(memory.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      </div>
    </div>
  );
}
