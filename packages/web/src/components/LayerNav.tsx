import type { Layer } from '@keymemory/shared';
import { LAYER_CONFIG, LAYERS } from '@keymemory/shared';

interface LayerNavProps {
  activeLayer: Layer | null;
  onSelectLayer: (layer: Layer | null) => void;
  layerStats: Record<Layer, { count: number; active: number }>;
}

const LAYER_COLORS: Record<Layer, string> = {
  flash: 'var(--layer-flash)',
  short: 'var(--layer-short)',
  long: 'var(--layer-long)',
  project: 'var(--layer-project)',
  entity: 'var(--layer-entity)',
};

export default function LayerNav({ activeLayer, onSelectLayer, layerStats }: LayerNavProps) {
  return (
    <nav className="flex h-full flex-col py-3" style={{ background: 'var(--bg-sidebar)' }}>
      <div className="mb-2 px-4">
        <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--text-tertiary)' }}>
          层级
        </span>
      </div>

      <button
        onClick={() => onSelectLayer(null)}
        className="flex items-center justify-between px-4 py-1.5 text-xs transition-colors"
        style={{
          color: activeLayer === null ? 'var(--accent)' : 'var(--text-secondary)',
          background: activeLayer === null ? 'var(--accent-light)' : 'transparent',
          fontWeight: activeLayer === null ? 600 : 400,
        }}
      >
        <span>全部</span>
        <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
          {LAYERS.reduce((sum, l) => sum + layerStats[l].active, 0)}
        </span>
      </button>

      {LAYERS.map((layer) => {
        const config = LAYER_CONFIG[layer];
        const isActive = activeLayer === layer;
        const count = layerStats[layer].active;

        return (
          <button
            key={layer}
            onClick={() => onSelectLayer(layer)}
            className="flex items-center justify-between px-4 py-1.5 text-xs transition-colors"
            style={{
              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
              background: isActive ? 'var(--bg-card)' : 'transparent',
              fontWeight: isActive ? 600 : 400,
              borderLeft: isActive ? `2px solid ${LAYER_COLORS[layer]}` : '2px solid transparent',
            }}
          >
            <span className="flex items-center gap-2">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: LAYER_COLORS[layer] }}
              />
              {config.label}
            </span>
            <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {count}
            </span>
          </button>
        );
      })}

      <div className="mt-auto px-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          KeyMemory v0.1
        </span>
      </div>
    </nav>
  );
}
