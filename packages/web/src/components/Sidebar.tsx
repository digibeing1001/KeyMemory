import type { Layer } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, User, Layers, Plus, Heart, Globe, Tag, Moon, Trash, Sun, Inbox, GitMerge } from './Icons';
import ProjectTree from './ProjectTree';
import { useI18n, type Language } from '../i18n';
import { LAYER_COLORS } from '../lib/memoryFormat';

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

const VIEW_ITEMS: Array<{ mode: ViewMode; labelKey: string; icon: typeof Layers }> = [
  { mode: 'memories', labelKey: 'nav.memories', icon: Layers },
  { mode: 'nebula', labelKey: 'nav.nebula', icon: Globe },
  { mode: 'tags', labelKey: 'nav.tags', icon: Tag },
  { mode: 'dream', labelKey: 'nav.dream', icon: Moon },
  { mode: 'migration', labelKey: 'nav.migration', icon: Inbox },
  { mode: 'organize', labelKey: 'nav.organize', icon: GitMerge },
  { mode: 'recycle', labelKey: 'nav.recycle', icon: Trash },
];

function getHealthColor(score: number): string {
  if (score >= 80) return 'var(--success)';
  if (score >= 60) return 'var(--warning)';
  return 'var(--danger)';
}

function LanguageButton({ value, label }: { value: Language; label: string }) {
  const { language, setLanguage } = useI18n();
  const active = language === value;
  return (
    <button
      onClick={() => setLanguage(value)}
      style={{
        height: 26,
        minWidth: 40,
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--accent)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
        fontSize: 12,
        fontWeight: 650,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
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
  const { t, layerLabel, layerHelp } = useI18n();

  return (
    <aside
      className="app-sidebar"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        width: 248,
        height: '100vh',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
        zIndex: 40,
        borderRight: '1px solid var(--border)',
      }}
    >
      <div style={{ padding: '16px 16px 12px' }}>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
          KeyMemory
        </h1>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.45 }}>
          {t('sidebar.subtitle')}
        </p>
      </div>

      <div style={{ padding: '0 12px 12px' }}>
        <button
          onClick={onCreateNew}
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '8px 12px', fontSize: 13 }}
        >
          <Plus size={14} />
          {t('sidebar.newMemory')}
        </button>
      </div>

      <div style={{ height: 1, background: 'var(--border)', margin: '0 16px 8px' }} />

      <nav style={{ padding: '4px 8px' }}>
        {VIEW_ITEMS.map((item) => {
          const isActive = viewMode === item.mode;
          const Icon = item.icon;
          return (
            <button
              key={item.mode}
              className={`sidebar-item${isActive ? ' active' : ''}`}
              onClick={() => onViewModeChange(item.mode)}
              style={{ width: '100%', border: 'none', background: 'transparent', textAlign: 'left' }}
            >
              <Icon size={16} />
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div style={{ height: 1, background: 'var(--border)', margin: '8px 16px' }} />

      <ProjectTree activeProjectId={activeProjectId} onSelectProject={onSelectProject} refreshToken={projectRefreshToken} />

      <div style={{ height: 1, background: 'var(--border)', margin: '0 16px 8px' }} />

      <div style={{ padding: '4px 16px 6px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
          {t('sidebar.layers')}
        </span>
      </div>

      <nav style={{ flex: 1, overflowY: 'auto', padding: '0 8px' }}>
        <button
          className={`sidebar-item${activeLayer === null ? ' active' : ''}`}
          onClick={() => onSelectLayer(null)}
          style={{ justifyContent: 'space-between', width: '100%', border: 'none', background: 'transparent' }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={16} />
            <span>{t('common.all')}</span>
          </span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{totalMemories}</span>
        </button>

        {LAYERS.map((layer) => {
          const stats = layerStats[layer];
          const isActive = activeLayer === layer;
          const IconComponent = LAYER_ICONS[layer];

          return (
            <button
              key={layer}
              className={`sidebar-item${isActive ? ' active' : ''}`}
              onClick={() => onSelectLayer(layer)}
              title={layerHelp(layer)}
              style={{ justifyContent: 'space-between', width: '100%', border: 'none', background: 'transparent' }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <IconComponent size={16} style={{ color: isActive ? 'var(--text-primary)' : LAYER_COLORS[layer] }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layerLabel(layer)}</span>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stats?.active ?? 0}</span>
            </button>
          );
        })}
      </nav>

      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
        {healthScore !== null && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
            <Heart size={14} style={{ color: getHealthColor(healthScore) }} />
            <span>{t('sidebar.health')} {healthScore}</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sidebar.total', { count: totalMemories })}</span>
          <button
            onClick={onToggleTheme}
            title={isDark ? t('sidebar.switchToLight') : t('sidebar.switchToDark')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 8px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--text-muted)',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
            {isDark ? t('sidebar.themeLight') : t('sidebar.themeDark')}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sidebar.language')}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <LanguageButton value="zh" label="中" />
            <LanguageButton value="en" label="EN" />
          </div>
        </div>
      </div>
    </aside>
  );
}
