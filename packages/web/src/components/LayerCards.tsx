import type { CSSProperties, FC } from 'react';
import type { Layer } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { Anchor, Clock, Flash, User } from './Icons';
import { useI18n } from '../i18n';
import { LAYER_COLORS } from '../lib/memoryFormat';

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

const LAYER_ICONS: Record<Layer, FC<IconProps>> = {
  flash: Flash,
  short: Clock,
  long: Anchor,
  entity: User,
};

export default function LayerCards({ layerStats, activeLayer, onSelectLayer }: LayerCardsProps) {
  const { t, layerLabel, layerHelp } = useI18n();
  const totalActive = LAYERS.reduce((sum, layer) => sum + (layerStats[layer]?.active ?? 0), 0);

  return (
    <section className="memory-state-guide" style={{ marginBottom: 18 }}>
      <div className="flex items-end justify-between gap-4" style={{ marginBottom: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', fontWeight: 700 }}>
            {t('memoryState.title')}
          </h3>
          <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>
            {t('memoryState.hint')}
          </p>
        </div>
        {activeLayer && (
          <button
            className="btn"
            type="button"
            onClick={() => onSelectLayer(null)}
            style={{ flexShrink: 0 }}
          >
            {t('memoryState.clear')}
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
        <button
          type="button"
          data-layer-filter="all"
          onClick={() => onSelectLayer(null)}
          aria-pressed={activeLayer === null}
          style={{
            minHeight: 84,
            textAlign: 'left',
            padding: '12px 14px',
            border: activeLayer === null ? '1px solid var(--accent)' : '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            background: activeLayer === null ? 'var(--bg-selected)' : 'var(--bg-card)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
          }}
        >
          <div className="flex items-center justify-between gap-3">
            <strong style={{ fontSize: 13 }}>{t('memoryState.all')}</strong>
            <span style={{ fontSize: 20, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>{totalActive}</span>
          </div>
          <p style={{ margin: '7px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
            {t('memoryState.allHelp')}
          </p>
        </button>

        {LAYERS.map((layer) => {
          const color = LAYER_COLORS[layer];
          const stats = layerStats[layer] ?? { active: 0, count: 0 };
          const isActive = activeLayer === layer;
          const Icon = LAYER_ICONS[layer];

          return (
            <button
              key={layer}
              type="button"
              data-layer-filter={layer}
              onClick={() => onSelectLayer(isActive ? null : layer)}
              aria-pressed={isActive}
              title={layerHelp(layer)}
              style={{
                minHeight: 84,
                textAlign: 'left',
                padding: '12px 14px',
                border: isActive ? `1px solid ${color}` : '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                background: isActive ? `${color}12` : 'var(--bg-card)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2" style={{ minWidth: 0 }}>
                  <Icon size={15} style={{ color, flexShrink: 0 }} />
                  <strong style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {layerLabel(layer)}
                  </strong>
                </span>
                <span style={{ fontSize: 20, fontWeight: 750, color, fontVariantNumeric: 'tabular-nums' }}>{stats.active}</span>
              </div>
              <p style={{ margin: '7px 0 0', fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                {layerHelp(layer)}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}
