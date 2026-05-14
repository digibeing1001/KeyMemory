import type { Layer } from '@keymemory/shared';
import { LAYER_CONFIG, LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, Folder, User, Layers, Plus, Heart, Globe, Tag } from './Icons';

type ViewMode = 'memories' | 'nebula' | 'tags';

interface SidebarProps {
  layerStats: Record<Layer, { count: number; active: number }>;
  activeLayer: Layer | null;
  onSelectLayer: (layer: Layer | null) => void;
  onCreateNew: () => void;
  totalMemories: number;
  healthScore: number | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
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

const VIEW_ITEMS: Array<{ mode: ViewMode; label: string; icon: typeof Layers }> = [
  { mode: 'memories', label: '记忆', icon: Layers },
  { mode: 'nebula', label: '星云图', icon: Globe },
  { mode: 'tags', label: '标签云', icon: Tag },
];

export default function Sidebar({
  layerStats,
  activeLayer,
  onSelectLayer,
  onCreateNew,
  totalMemories,
  healthScore,
  viewMode,
  onViewModeChange,
}: SidebarProps) {
  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 240,
        height: '100vh',
        background: 'var(--bg-sidebar)',
        backdropFilter: 'var(--blur-sidebar)',
        WebkitBackdropFilter: 'var(--blur-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        borderRight: '0.5px solid var(--border)',
      }}
    >
      <div style={{ padding: '24px 16px 20px' }}>
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--text-on-sidebar)',
            margin: 0,
            lineHeight: 1.3,
            letterSpacing: '-0.03em',
          }}
        >
          KeyMemory
        </h1>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-muted-sidebar)',
            margin: '6px 0 0',
            fontWeight: 400,
          }}
        >
          个人记忆系统
        </p>
      </div>

      <div style={{ padding: '0 12px 14px' }}>
        <button
          onClick={onCreateNew}
          style={{
            width: '100%',
            padding: '11px 12px',
            borderRadius: 'var(--radius-md)',
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'all var(--transition-fast)',
            letterSpacing: '-0.01em',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-hover)';
            e.currentTarget.style.transform = 'scale(1.02)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent)';
            e.currentTarget.style.transform = 'scale(1)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.98)';
          }}
        >
          <Plus size={14} />
          新建记忆
        </button>
      </div>

      <div
        style={{
          height: 0.5,
          background: 'var(--border)',
          margin: '0 16px',
        }}
      />

      <div style={{ padding: '16px 16px 8px' }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted-sidebar)',
          }}
        >
          视图
        </span>
      </div>

      <div style={{ padding: '0 8px' }}>
        {VIEW_ITEMS.map((item) => {
          const isActive = viewMode === item.mode;
          const Icon = item.icon;
          return (
            <div
              key={item.mode}
              className={`sidebar-item${isActive ? ' active' : ''}`}
              onClick={() => onViewModeChange(item.mode)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted-sidebar)',
                background: isActive ? 'var(--bg-sidebar-active)' : 'transparent',
                transition: 'all var(--transition-fast)',
                fontSize: 14,
                fontWeight: 500,
                marginBottom: 2,
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
              <Icon size={17} />
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          height: 0.5,
          background: 'var(--border)',
          margin: '12px 16px',
        }}
      />

      <div style={{ padding: '4px 16px 8px' }}>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted-sidebar)',
          }}
        >
          记忆层级
        </span>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>
        <div
          className={`sidebar-item${activeLayer === null ? ' active' : ''}`}
          onClick={() => onSelectLayer(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '9px 12px',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            color: activeLayer === null ? 'var(--accent)' : 'var(--text-muted-sidebar)',
            background: activeLayer === null ? 'var(--bg-sidebar-active)' : 'transparent',
            transition: 'all var(--transition-fast)',
            fontSize: 14,
            fontWeight: 500,
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
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={17} />
            <span>全部</span>
          </span>
          <span style={{
            fontSize: 13,
            fontWeight: 500,
            opacity: 0.6,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {totalMemories}
          </span>
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
                padding: '9px 12px',
                borderRadius: 'var(--radius-sm)',
                cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted-sidebar)',
                background: isActive ? 'var(--bg-sidebar-active)' : 'transparent',
                transition: 'all var(--transition-fast)',
                fontSize: 14,
                fontWeight: 500,
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
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <IconComponent size={17} style={{ color: isActive ? 'var(--accent)' : LAYER_ICON_COLORS[layer] }} />
                <span>{config.label}</span>
              </span>
              <span style={{
                fontSize: 13,
                fontWeight: 500,
                opacity: 0.6,
                fontVariantNumeric: 'tabular-nums',
              }}>
                {stats?.active ?? 0}
              </span>
            </div>
          );
        })}
      </nav>

      <div
        style={{
          padding: '16px 16px',
          borderTop: '0.5px solid var(--border)',
        }}
      >
        {healthScore !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 8,
              fontSize: 13,
              color: 'var(--text-muted-sidebar)',
            }}
          >
            <Heart
              size={15}
              style={{
                color:
                  healthScore >= 80
                    ? 'var(--success)'
                    : healthScore >= 60
                      ? 'var(--warning)'
                      : 'var(--danger)',
              }}
            />
            <span>健康度 {healthScore}</span>
          </div>
        )}
        <div
          style={{
            fontSize: 13,
            color: 'var(--text-muted-sidebar)',
          }}
        >
          共 {totalMemories} 条记忆
        </div>
      </div>
    </aside>
  );
}
