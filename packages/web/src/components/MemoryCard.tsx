import type { Memory } from '@keymemory/shared';
import { LAYER_CONFIG } from '@keymemory/shared';
import { Tag, Source } from './Icons';

interface MemoryCardProps {
  memory: Memory;
  onClick: (memory: Memory) => void;
  score?: number;
  matchType?: string;
  index?: number;
}

export default function MemoryCard({ memory, onClick, score, matchType, index = 0 }: MemoryCardProps) {
  const layerConfig = LAYER_CONFIG[memory.layer];
  const layerColor = layerConfig.color;

  return (
    <div
      className="memory-result animate-card-enter"
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
      style={{
        animationDelay: `${index * 40}ms`,
      }}
    >
      <div className="color-bar" />

      <div style={{ minWidth: 0, position: 'relative' }}>
        {score != null && (
          <span
            className="stat-number"
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--accent)',
              background: 'var(--accent-subtle)',
              padding: '2px 8px',
              borderRadius: 'var(--radius-xs)',
            }}
          >
            {Math.round(score * 100)}%
          </span>
        )}

        <div className="result-header" style={{ paddingRight: score != null ? 56 : 0 }}>
          <span className="result-title">{memory.title}</span>
          <span className="result-layer-badge">{layerConfig.label}</span>
          {matchType && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: 'var(--text-quaternary)',
                padding: '2px 8px',
                background: 'var(--bg-muted)',
                borderRadius: 'var(--radius-xs)',
                lineHeight: '16px',
              }}
            >
              {matchType}
            </span>
          )}
        </div>

        <p className="result-body">{memory.content}</p>

        <div className="result-meta">
          {memory.tags && memory.tags.length > 0 && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Tag size={11} style={{ color: 'var(--text-quaternary)' }} />
              {memory.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="tag-pill"
                >
                  {tag}
                </span>
              ))}
              {memory.tags.length > 3 && (
                <span style={{ fontSize: 11, color: 'var(--text-quaternary)', fontWeight: 500 }}>
                  +{memory.tags.length - 3}
                </span>
              )}
            </span>
          )}

          {memory.source && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
              <Source size={11} style={{ color: 'var(--text-quaternary)' }} />
              <span className="tag-pill">
                {memory.source}
              </span>
            </span>
          )}

          <span style={{ 
            fontSize: 12, 
            color: 'var(--text-quaternary)', 
            marginLeft: 'auto', 
            whiteSpace: 'nowrap',
            fontWeight: 500,
          }}>
            {new Date(memory.updatedAt).toLocaleDateString('zh-CN', { 
              year: 'numeric',
              month: 'short', 
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>
      </div>
    </div>
  );
}
