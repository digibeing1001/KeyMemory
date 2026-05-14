import type { Layer } from '@keymemory/shared';
import { LAYER_CONFIG, LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, Folder, User } from './Icons';

interface IconProps {
  className?: string;
  style?: React.CSSProperties;
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

const LAYER_ICONS: Record<Layer, React.FC<IconProps>> = {
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
            style={{
              flex: 1,
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 14px',
              border: 'none',
              cursor: 'pointer',
              transition: 'all var(--transition-fast)',
              background: isActive ? 'var(--accent-light)' : 'transparent',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              position: 'relative',
            }}
          >
            {isActive && (
              <div style={{
                position: 'absolute',
                bottom: 0,
                left: '20%',
                right: '20%',
                height: 2.5,
                background: 'var(--accent)',
                borderRadius: '1px',
              }} />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon size={17} style={{ color: isActive ? 'var(--accent)' : color }} />
              <span style={{
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                letterSpacing: '-0.01em',
              }}>
                {config.label}
              </span>
            </div>
            <span style={{
              fontSize: 17,
              fontWeight: 600,
              color: isActive ? 'var(--accent)' : 'var(--text-primary)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-0.02em',
            }}>
              {stats.active}
            </span>
          </button>
        );
      })}
    </div>
  );
}
