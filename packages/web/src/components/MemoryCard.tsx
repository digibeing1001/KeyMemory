import type { Memory, Layer } from '@keymemory/shared';

interface MemoryCardProps {
  memory: Memory;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const LAYER_COLORS: Record<Layer, string> = {
  flash: 'var(--layer-flash)',
  short: 'var(--layer-short)',
  long: 'var(--layer-long)',
  project: 'var(--layer-project)',
  entity: 'var(--layer-entity)',
};

export default function MemoryCard({ memory, isSelected, onSelect }: MemoryCardProps) {
  const layerColor = LAYER_COLORS[memory.layer];

  return (
    <button
      onClick={() => onSelect(memory.id)}
      className="w-full rounded-md px-3 py-2 text-left transition-all"
      style={{
        background: isSelected ? 'var(--accent-light)' : 'transparent',
        borderLeft: isSelected ? `3px solid var(--accent)` : '3px solid transparent',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className="line-clamp-1 text-xs font-medium"
          style={{ color: isSelected ? 'var(--accent)' : 'var(--text-primary)' }}
        >
          {memory.title}
        </p>
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold"
          style={{ background: `${layerColor}18`, color: layerColor }}
        >
          {memory.layer}
        </span>
      </div>
      <p className="mt-0.5 line-clamp-3 text-sm leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        {memory.content}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
        {memory.tags && memory.tags.length > 0 && (
          <div className="flex items-center gap-0.5">
            {memory.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="inline-block rounded-full px-1.5 py-px text-[9px]"
                style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--layer-project)' }}
              >
                {tag}
              </span>
            ))}
            {memory.tags.length > 3 && <span>+{memory.tags.length - 3}</span>}
          </div>
        )}
        {memory.source && (
          <span
            className="inline-flex items-center gap-0.5 rounded px-1 py-px text-[11px]"
            style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--layer-long)' }}
          >
            <svg className="h-2 w-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            {memory.source}
          </span>
        )}
        {memory.project && <span style={{ color: 'var(--layer-project)' }}>{memory.project}</span>}
        <span>{Math.round(memory.confidence * 100)}%</span>
        <span>·</span>
        <span>{new Date(memory.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
      </div>
    </button>
  );
}
