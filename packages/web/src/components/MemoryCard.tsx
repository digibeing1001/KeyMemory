import type { Memory } from '@keymemory/shared';
import { Tag } from './Icons';
import { useI18n } from '../i18n';
import { formatDate, formatMemoryTitle, getMemoryKind, LAYER_COLORS, summarizeMemory } from '../lib/memoryFormat';

interface MemoryCardProps {
  memory: Memory;
  onClick: (memory: Memory) => void;
  selected?: boolean;
  score?: number;
  matchType?: string;
}

export default function MemoryCard({ memory, onClick, selected, score, matchType }: MemoryCardProps) {
  const { language, layerLabel, memoryKindLabel } = useI18n();
  const kind = getMemoryKind(memory);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const title = formatMemoryTitle(memory);

  return (
    <button
      type="button"
      className={`memory-card memory-list-item${selected ? ' selected' : ''}`}
      data-layer={memory.layer}
      onClick={() => onClick(memory)}
      aria-label={title}
      aria-pressed={Boolean(selected)}
      style={{ textAlign: 'left', width: '100%' }}
    >
      <div className="flex gap-3">
        <div className="card-indicator" style={{ background: LAYER_COLORS[memory.layer] }} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="flex items-center gap-2">
            <span className="card-title" style={{ flex: 1 }}>{title}</span>

            {score != null && (
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
                {Math.round(score * 100)}%
              </span>
            )}

            <span className="tag-pill" style={{ color: LAYER_COLORS[memory.layer], background: `${LAYER_COLORS[memory.layer]}18` }}>
              {layerLabel(memory.layer)}
            </span>
          </div>

          <p className="card-body">{summarizeMemory(memory, 150)}</p>

          <div className="card-meta">
            <span className="tag-pill">{memoryKindLabel(kind)}</span>

            {memory.tags && memory.tags.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                <Tag size={11} />
                <span style={{ display: 'flex', gap: 4, minWidth: 0, overflow: 'hidden' }}>
                  {memory.tags.slice(0, 2).map((tag) => (
                    <span key={tag} className="tag-pill">
                      {tag}
                    </span>
                  ))}
                  {memory.tags.length > 2 && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      +{memory.tags.length - 2}
                    </span>
                  )}
                </span>
              </span>
            )}

            {matchType && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                {matchType}
              </span>
            )}

            <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {formatDate(memory.updatedAt, locale)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
