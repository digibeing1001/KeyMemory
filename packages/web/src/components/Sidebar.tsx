import type { Layer } from '@keymemory/shared';
import { LAYER_CONFIG, LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, Folder, User, Layers, Plus, Heart } from './Icons';

interface SidebarProps {
  layerStats: Record<Layer, { count: number; active: number }>;
  activeLayer: Layer | null;
  onSelectLayer: (layer: Layer | null) => void;
  onCreateNew: () => void;
  totalMemories: number;
  healthScore: number | null;
}

const LAYER_ICONS: Record<Layer, typeof Flash> = {
  flash: Flash,
  short: Clock,
  long: Anchor,
  project: Folder,
  entity: User,
};

const LAYER_ICON_COLORS: Record<Layer, string> = {
  flash: 'var(--layer-flash)',
  short: 'var(--layer-short)',
  long: 'var(--layer-long)',
  project: 'var(--layer-project)',
  entity: 'var(--layer-entity)',
};

export default function Sidebar({
  layerStats,
  activeLayer,
  onSelectLayer,
  onCreateNew,
  totalMemories,
  healthScore,
}: SidebarProps) {
  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 220,
        height: '100vh',
        background: 'var(--bg-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
      }}
    >
      <div style={{ padding: '20px 16px 12px' }}>
        <h1
          className="font-serif"
          style={{
            fontSize: 19,
            color: 'var(--text-on-sidebar)',
            margin: 0,
            lineHeight: 1.2,
          }}
        >
          KeyMemory
        </h1>
      </div>

      <div style={{ padding: '0 16px 12px' }}>
        <button
          onClick={onCreateNew}
          style={{
            width: '100%',
            padding: 9,
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            transition: 'opacity 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.85';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          <Plus size={14} />
          新建记忆
        </button>
      </div>

      <div
        style={{
          height: 1,
          background: 'var(--bg-sidebar-hover)',
          margin: '0 16px',
        }}
      />

      <div style={{ padding: '16px 16px 8px' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'var(--text-muted-sidebar)',
          }}
        >
          记忆层级
        </span>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        <div
          className={`sidebar-item${activeLayer === null ? ' active' : ''}`}
          onClick={() => onSelectLayer(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderRadius: 8,
            cursor: 'pointer',
            color: activeLayer === null ? 'var(--text-on-sidebar)' : 'var(--text-muted-sidebar)',
            background: activeLayer === null ? 'var(--bg-sidebar-hover)' : 'transparent',
            transition: 'background 0.15s ease, color 0.15s ease',
            fontSize: 13,
          }}
          onMouseEnter={(e) => {
            if (activeLayer !== null) {
              e.currentTarget.style.background = 'var(--bg-sidebar-hover)';
              e.currentTarget.style.color = 'var(--text-on-sidebar)';
            }
          }}
          onMouseLeave={(e) => {
            if (activeLayer !== null) {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted-sidebar)';
            }
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={16} />
            <span>全部</span>
          </span>
          <span style={{ fontSize: 12, opacity: 0.7 }}>{totalMemories}</span>
        </div>

        {LAYERS.map((layer) => {
          const config = LAYER_CONFIG[layer];
          const stats = layerStats[layer];
          const isActive = activeLayer === layer;
          const IconComponent = LAYER_ICONS[layer];

          return (
            <div
              key={layer}
              className={`sidebar-item${isActive ? ' active' : ''}`}
              onClick={() => onSelectLayer(layer)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                color: isActive ? 'var(--text-on-sidebar)' : 'var(--text-muted-sidebar)',
                background: isActive ? 'var(--bg-sidebar-hover)' : 'transparent',
                transition: 'background 0.15s ease, color 0.15s ease',
                fontSize: 13,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'var(--bg-sidebar-hover)';
                  e.currentTarget.style.color = 'var(--text-on-sidebar)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--text-muted-sidebar)';
                }
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <IconComponent size={16} style={{ color: LAYER_ICON_COLORS[layer] }} />
                <span>{config.label}</span>
              </span>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{stats?.count ?? 0}</span>
            </div>
          );
        })}
      </nav>

      <div
        style={{
          padding: '16px',
          borderTop: '1px solid var(--bg-sidebar-hover)',
        }}
      >
        {healthScore !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 8,
              fontSize: 12,
              color: 'var(--text-muted-sidebar)',
            }}
          >
            <Heart
              size={14}
              style={{
                color:
                  healthScore >= 80
                    ? '#22c55e'
                    : healthScore >= 60
                      ? '#f59e0b'
                      : '#ef4444',
              }}
            />
            <span>健康度 {healthScore}</span>
          </div>
        )}
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted-sidebar)',
          }}
        >
          共 {totalMemories} 条记忆
        </div>
      </div>
    </aside>
  );
}
