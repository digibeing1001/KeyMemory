import type { FC, CSSProperties } from 'react';
import type { Layer } from '@keymemory/shared';
import { LAYER_CONFIG, LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, Folder, User } from './Icons';

interface IconProps {
  className?: string;
  style?: CSSProperties;
  size?: number;
}

interface LayerCardsProps {
  layerStats: Record<Layer, { count: number; active: number }>;
  activeLayer: Layer | null;
  onSelectLayer: (layer: Layer | null) => void;
}

const LAYER_COLORS: Record<Layer, string> = {
  flash: 'var(--layer-flash)',
  short: 'var(--layer-short)',
  long: 'var(--layer-long)',
  project: 'var(--layer-project)',
  entity: 'var(--layer-entity)',
};

const LAYER_ICONS: Record<Layer, FC<IconProps>> = {
  flash: Flash,
  short: Clock,
  long: Anchor,
  project: Folder,
  entity: User,
};

export default function LayerCards({ layerStats, activeLayer, onSelectLayer }: LayerCardsProps) {
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {LAYERS.map((layer) => {
        const config = LAYER_CONFIG[layer];
        const color = LAYER_COLORS[layer];
        const stats = layerStats[layer];
        const isActive = activeLayer === layer;
        const Icon = LAYER_ICONS[layer];

        return (
          <button
            key={layer}
            onClick={() => onSelectLayer(isActive ? null : layer)}
            className="layer-card"
            style={{
              flex: 1,
              height: 56,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              background: isActive ? 'var(--accent-light)' : 'transparent',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              color: 'var(--text-primary)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon size={18} style={{ color }} />
              <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>
                {config.label}
              </span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              {stats.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
