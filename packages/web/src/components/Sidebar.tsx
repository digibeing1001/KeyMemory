import type { Layer } from '@keymemory/shared';
import { LAYER_CONFIG, LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, User, Layers, Plus, Heart, Globe, Tag, Moon, Trash, Sun, Inbox, GitMerge } from './Icons';
import ProjectTree from './ProjectTree';

type ViewMode = 'memories' | 'nebula' | 'tags' | 'dream' | 'migration' | 'organize' | 'recycle';

interface SidebarProps {
  layerStats: Record<Layer, { count: number; active: number }>;
  activeLayer: Layer | null;
  onSelectLayer: (layer: Layer | null) => void;
  onCreateNew: () => void;
  totalMemories: number;
  healthScore: number | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  activeProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  projectRefreshToken: number;
}

const LAYER_ICONS: Record<Layer, typeof Flash> = {
  flash: Flash,
  short: Clock,
  long: Anchor,
  entity: User,
};

const LAYER_ICON_COLORS: Record<Layer, string> = {
  flash: 'var(--layer-flash)',
  short: 'var(--layer-short)',
  long: 'var(--layer-long)',
  entity: 'var(--layer-entity)',
};

const VIEW_ITEMS: Array<{ mode: ViewMode; label: string; icon: typeof Layers }> = [
  { mode: 'memories', label: '记忆', icon: Layers },
  { mode: 'nebula', label: '星云图', icon: Globe },
  { mode: 'tags', label: '标签云', icon: Tag },
  { mode: 'dream', label: '梦境', icon: Moon },
  { mode: 'migration', label: '迁移', icon: Inbox },
  { mode: 'organize', label: 'Organize', icon: GitMerge },
  { mode: 'recycle', label: '回收站', icon: Trash },
];

function getHealthColor(score: number): string {
  if (score >= 80) return 'var(--success)';
  if (score >= 60) return 'var(--warning)';
  return 'var(--danger)';
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
  isDark,
  onToggleTheme,
  activeProjectId,
  onSelectProject,
  projectRefreshToken,
}: SidebarProps) {
  return (
    <aside
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 240,
        height: '100vh',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        borderRight: '1px solid var(--border)',
      }}
    >
      <div style={{ padding: '16px 16px 12px' }}>
        <h1
          style={{
            fontSize: 16,
            fontWeight: 600,
            color: 'var(--text-primary)',
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          KeyMemory
        </h1>
        <p
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            margin: '4px 0 0',
          }}
        >
          个人记忆系统
        </p>
      </div>

      <div style={{ padding: '0 12px 12px' }}>
        <button
          onClick={onCreateNew}
          className="btn btn-primary"
          style={{
            width: '100%',
            justifyContent: 'center',
            padding: '7px 12px',
            fontSize: 13,
          }}
        >
          <Plus size={14} />
          新建记忆
        </button>
      </div>

      <div
        style={{
          height: 1,
          background: 'var(--border)',
          margin: '0 16px 8px',
        }}
      />

      <div style={{ padding: '4px 8px' }}>
        {VIEW_ITEMS.map((item) => {
          const isActive = viewMode === item.mode;
          const Icon = item.icon;
          return (
            <div
              key={item.mode}
              className={`sidebar-item${isActive ? ' active' : ''}`}
              onClick={() => onViewModeChange(item.mode)}
            >
              <Icon size={16} />
              <span>{item.label}</span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          height: 1,
          background: 'var(--border)',
          margin: '8px 16px',
        }}
      />

      <ProjectTree activeProjectId={activeProjectId} onSelectProject={onSelectProject} refreshToken={projectRefreshToken} />

      <div
        style={{
          height: 1,
          background: 'var(--border)',
          margin: '0 16px 8px',
        }}
      />

      <div style={{ padding: '4px 16px 6px' }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
          }}
        >
          记忆层级
        </span>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        <div
          className={`sidebar-item${activeLayer === null ? ' active' : ''}`}
          onClick={() => onSelectLayer(null)}
          style={{ justifyContent: 'space-between' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={16} />
            <span>全部</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
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
              style={{ justifyContent: 'space-between' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <IconComponent size={16} style={{ color: isActive ? 'var(--text-primary)' : LAYER_ICON_COLORS[layer] }} />
                <span>{config.label}</span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {stats?.active ?? 0}
              </span>
            </div>
          );
        })}
      </nav>

      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid var(--border)',
        }}
      >
        {healthScore !== null && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 6,
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <Heart size={14} style={{ color: getHealthColor(healthScore) }} />
            <span>健康度 {healthScore}</span>
          </div>
        )}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            共 {totalMemories} 条记忆
          </span>
          <button
            onClick={onToggleTheme}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 12,
              cursor: 'pointer',
              transition: 'background var(--transition)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            title={isDark ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            {isDark ? '亮色' : '暗色'}
          </button>
        </div>
      </div>
    </aside>
  );
}
