import type { Memory } from '@keymemory/shared';
import { LAYER_CONFIG } from '@keymemory/shared';
import { Tag } from './Icons';

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
      className="memory-card"
      data-layer={memory.layer}
      onClick={() => onClick(memory)}
      tabIndex={0}
      role="button"
      aria-label={memory.title}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(memory);
        }
      }}
    >
      <div className="flex gap-3">
        <div
          className="card-indicator"
          style={{ background: layerConfig.color }}
        />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <span className="card-title" style={{ flex: 1 }}>{memory.title}</span>
            
            {score != null && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--accent)',
                  flexShrink: 0,
                }}
              >
                {Math.round(score * 100)}%
              </span>
            )}
            
            <span
              className="tag-pill"
              style={{ color: layerConfig.color, background: `${layerConfig.color}15` }}
            >
              {layerConfig.label}
            </span>
            
            {matchType && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {matchType}
              </span>
            )}
          </div>

          <p className="card-body">{memory.content}</p>

          <div className="card-meta">
            {memory.tags && memory.tags.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Tag size={11} />
                <span style={{ display: 'flex', gap: 4 }}>
                  {memory.tags.slice(0, 3).map((tag) => (
                    <span key={tag} className="tag-pill">
                      {tag}
                    </span>
                  ))}
                  {memory.tags.length > 3 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      +{memory.tags.length - 3}
                    </span>
                  )}
                </span>
              </span>
            )}

            <span style={{ marginLeft: 'auto' }}>
              {new Date(memory.updatedAt).toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric',
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
