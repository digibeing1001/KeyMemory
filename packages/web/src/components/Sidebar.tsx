import type { Layer } from '@keymemory/shared';
import { LAYER_CONFIG, LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, Folder, User, Layers, Plus, Heart, Globe, Tag, Moon, Sparkles } from './Icons';

type ViewMode = 'memories' | 'nebula' | 'tags' | 'dream';

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
  { mode: 'dream', label: '梦境', icon: Moon },
];

function getHealthColor(score: number): string {
  if (score >= 80) return 'var(--success)';
  if (score >= 60) return 'var(--warning)';
  return 'var(--danger)';
}

function getHealthGlow(score: number): string {
  if (score >= 80) return 'var(--success-glow)';
  if (score >= 60) return 'rgba(255, 149, 0, 0.3)';
  return 'var(--danger-glow)';
}

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
  const healthColor = healthScore !== null ? getHealthColor(healthScore) : 'var(--text-quaternary)';
  const healthGlow = healthScore !== null ? getHealthGlow(healthScore) : 'transparent';

  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 256,
        height: '100vh',
        background: 'var(--bg-sidebar)',
        backdropFilter: 'var(--blur-sidebar)',
        WebkitBackdropFilter: 'var(--blur-sidebar)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        borderRight: '1px solid var(--border)',
      }}
    >
      {/* Logo 区域 */}
      <div style={{ padding: '28px 20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--layer-project) 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px var(--accent-glow)',
            }}
          >
            <Sparkles size={16} style={{ color: '#fff' }} />
          </div>
          <h1
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text-on-sidebar)',
              margin: 0,
              lineHeight: 1.2,
              letterSpacing: '-0.03em',
            }}
          >
            KeyMemory
          </h1>
        </div>
        <p
          style={{
            fontSize: 12.5,
            color: 'var(--text-muted-sidebar)',
            margin: 0,
            fontWeight: 400,
            letterSpacing: '0.01em',
            paddingLeft: 42,
          }}
        >
          个人记忆系统
        </p>
      </div>

      {/* 新建按钮 */}
      <div style={{ padding: '0 16px 18px' }}>
        <button
          onClick={onCreateNew}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 'var(--radius-lg)',
            border: 'none',
            background: 'linear-gradient(135deg, var(--accent) 0%, #0051D5 100%)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'all var(--transition-normal)',
            letterSpacing: '-0.01em',
            boxShadow: '0 2px 8px var(--accent-glow)',
            position: 'relative',
            overflow: 'hidden',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
            e.currentTarget.style.boxShadow = '0 4px 16px var(--accent-glow)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 2px 8px var(--accent-glow)';
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'translateY(0) scale(0.98)';
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
        >
          <Plus size={15} />
          新建记忆
        </button>
      </div>

      <div
        style={{
          height: 1,
          background: 'linear-gradient(90deg, transparent 0%, var(--border) 20%, var(--border) 80%, transparent 100%)',
          margin: '0 20px',
        }}
      />

      {/* 视图切换 */}
      <div style={{ padding: '18px 20px 8px' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted-sidebar)',
          }}
        >
          视图
        </span>
      </div>

      <div style={{ padding: '0 10px' }}>
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
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted-sidebar)',
                background: isActive ? 'var(--bg-sidebar-active)' : 'transparent',
                transition: 'all var(--transition-fast)',
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
                marginBottom: 2,
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
          height: 1,
          background: 'linear-gradient(90deg, transparent 0%, var(--border) 20%, var(--border) 80%, transparent 100%)',
          margin: '14px 20px',
        }}
      />

      {/* 记忆层级 */}
      <div style={{ padding: '6px 20px 10px' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--text-muted-sidebar)',
          }}
        >
          记忆层级
        </span>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '4px 10px' }}>
        <div
          className={`sidebar-item${activeLayer === null ? ' active' : ''}`}
          onClick={() => onSelectLayer(null)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            cursor: 'pointer',
            color: activeLayer === null ? 'var(--accent)' : 'var(--text-muted-sidebar)',
            background: activeLayer === null ? 'var(--bg-sidebar-active)' : 'transparent',
            transition: 'all var(--transition-fast)',
            fontSize: 14,
            fontWeight: activeLayer === null ? 600 : 500,
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={17} />
            <span>全部</span>
          </span>
          <span className="stat-number" style={{
            fontSize: 13,
            fontWeight: 600,
            opacity: 0.5,
            color: activeLayer === null ? 'var(--accent)' : 'inherit',
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
                padding: '10px 14px',
                borderRadius: 'var(--radius-md)',
                cursor: 'pointer',
                color: isActive ? 'var(--accent)' : 'var(--text-muted-sidebar)',
                background: isActive ? 'var(--bg-sidebar-active)' : 'transparent',
                transition: 'all var(--transition-fast)',
                fontSize: 14,
                fontWeight: isActive ? 600 : 500,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <IconComponent size={17} style={{ color: isActive ? 'var(--accent)' : LAYER_ICON_COLORS[layer] }} />
                <span>{config.label}</span>
              </span>
              <span className="stat-number" style={{
                fontSize: 13,
                fontWeight: 600,
                opacity: 0.5,
                color: isActive ? 'var(--accent)' : 'inherit',
              }}>
                {stats?.active ?? 0}
              </span>
            </div>
          );
        })}
      </nav>

      {/* 底部统计 */}
      <div
        style={{
          padding: '18px 20px',
          borderTop: '1px solid var(--border)',
          background: 'rgba(255,255,255,0.4)',
        }}
      >
        {healthScore !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              marginBottom: 12,
              fontSize: 13,
              color: 'var(--text-muted-sidebar)',
            }}
          >
            <div style={{ position: 'relative' }}>
              <Heart
                size={16}
                style={{
                  color: healthColor,
                  filter: `drop-shadow(0 0 4px ${healthGlow})`,
                }}
              />
            </div>
            <span style={{ fontWeight: 500 }}>健康度</span>
            <span 
              className="stat-number" 
              style={{ 
                marginLeft: 'auto', 
                fontWeight: 700,
                color: healthColor,
              }}
            >
              {healthScore}
            </span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12.5,
            color: 'var(--text-muted-sidebar)',
          }}
        >
          <span>共 {totalMemories} 条记忆</span>
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--success)',
              boxShadow: '0 0 6px var(--success-glow)',
            }}
          />
        </div>
      </div>
    </aside>
  );
}
