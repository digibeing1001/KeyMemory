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
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
        {memory.content}
      </p>
      <div className="mt-1.5 flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
        {memory.project && <span style={{ color: 'var(--layer-project)' }}>{memory.project}</span>}
        <span>{Math.round(memory.confidence * 100)}%</span>
        <span>·</span>
        <span>{new Date(memory.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}</span>
      </div>
    </button>
  );
}
