import type { HealthReport, Layer } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { Flash, Clock, Anchor, User, Layers, Plus, Heart, Globe, Tag, Moon, Trash, Sun, Inbox, GitMerge, Close, Activity, LogOut, Plug, Search, Link } from './Icons';
import ProjectTree from './ProjectTree';
import { useI18n, type Language } from '../i18n';
import { LAYER_COLORS } from '../lib/memoryFormat';
import { useAuth } from '../auth/AuthContext';
import type { UserRole } from '../lib/api';

type ViewMode = 'memories' | 'mailbox' | 'valley' | 'nebula' | 'tags' | 'dream' | 'llm' | 'migration' | 'organize' | 'recycle' | 'workingSet' | 'integrations' | 'users' | 'today' | 'timeline' | 'library' | 'graph' | 'insights';

interface SidebarProps {
  layerStats: Record<Layer, { count: number; active: number }>;
  activeLayer: Layer | null;
  onSelectLayer: (layer: Layer | null) => void;
  onCreateNew: () => void;
  totalMemories: number;
  healthReport: HealthReport | null;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  isDark: boolean;
  onToggleTheme: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

const LAYER_ICONS: Record<Layer, typeof Flash> = {
  flash: Flash,
  short: Clock,
  long: Anchor,
  entity: User,
};

const ALL_VIEW_ITEMS: Array<{ mode: ViewMode; labelKey: string; icon: typeof Layers; adminOnly?: boolean }> = [
  { mode: 'mailbox', labelKey: 'nav.mailbox', icon: Inbox },
  { mode: 'memories', labelKey: 'nav.memories', icon: Layers },
  { mode: 'today', labelKey: 'nav.today', icon: Sun },
  { mode: 'timeline', labelKey: 'nav.timeline', icon: Clock },
  { mode: 'library', labelKey: 'nav.library', icon: Search },
  { mode: 'graph', labelKey: 'nav.graph', icon: Link },
  { mode: 'insights', labelKey: 'nav.insights', icon: Heart },
  { mode: 'workingSet', labelKey: 'nav.workingSet', icon: Activity },
  { mode: 'integrations', labelKey: 'nav.integrations', icon: Plug },
  { mode: 'valley', labelKey: 'nav.valley', icon: Globe },
  { mode: 'tags', labelKey: 'nav.tags', icon: Tag },
  { mode: 'dream', labelKey: 'nav.dream', icon: Moon, adminOnly: true },
  { mode: 'llm', labelKey: 'nav.llm', icon: GitMerge, adminOnly: true },
  { mode: 'migration', labelKey: 'nav.migration', icon: Inbox, adminOnly: true },
  { mode: 'users', labelKey: 'nav.users', icon: User, adminOnly: true },
  { mode: 'recycle', labelKey: 'nav.recycle', icon: Trash },
];

function isAdminRole(role: UserRole | undefined): boolean {
  return role === 'boss' || role === 'admin';
}

const ROLE_LABEL_ZH: Record<UserRole, string> = {
  boss: '主账户',
  exec: '主管',
  pm: '项目经理',
  member: '成员',
  admin: '管理员',
};

const ROLE_LABEL_EN: Record<UserRole, string> = {
  boss: 'Boss',
  exec: 'Exec',
  pm: 'PM',
  member: 'Member',
  admin: 'Admin',
};

function getHealthColor(score: number, reviewCount: number): string {
  if (score >= 80 && reviewCount === 0) return 'var(--success)';
  if (score >= 60) return 'var(--warning)';
  return 'var(--danger)';
}

function LanguageButton({ value, label }: { value: Language; label: string }) {
  const { language, setLanguage } = useI18n();
  const active = language === value;
  return (
    <button
      type="button"
      onClick={() => setLanguage(value)}
      className="sidebar-language-button"
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
  healthReport,
  viewMode,
  onViewModeChange,
  isDark,
  onToggleTheme,
  isMobileOpen = false,
  onCloseMobile,
}: SidebarProps) {
  const { t, layerLabel, layerHelp, language } = useI18n();
  const { user, logout } = useAuth();
  const zh = language === 'zh';
  const isAdmin = isAdminRole(user?.role);
  const visibleViewItems = ALL_VIEW_ITEMS.filter((item) => !item.adminOnly || isAdmin);
  const healthReviewCount = healthReport
    ? healthReport.duplicateCount + healthReport.orphanCount + healthReport.conflictCount + healthReport.decayingCount
    : 0;
  const healthColor = healthReport ? getHealthColor(healthReport.score, healthReviewCount) : 'var(--text-muted)';
  const healthIssues = healthReport ? [
    healthReport.orphanCount > 0 ? t('sidebar.healthOrphans', { count: healthReport.orphanCount }) : null,
    healthReport.conflictCount > 0 ? t('sidebar.healthConflicts', { count: healthReport.conflictCount }) : null,
    healthReport.duplicateCount > 0 ? t('sidebar.healthDuplicates', { count: healthReport.duplicateCount }) : null,
    healthReport.decayingCount > 0 ? t('sidebar.healthDecaying', { count: healthReport.decayingCount }) : null,
  ].filter((value): value is string => Boolean(value)) : [];

  return (
    <aside
      className={`app-sidebar${isMobileOpen ? ' is-mobile-open' : ''}`}
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
      <div className="sidebar-brand-row" style={{ padding: '16px 16px 12px' }}>
        <div className="sidebar-brand-lockup">
          <span className="sidebar-brand-mark"><span /><span /><span /></span>
          <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
            KeyMemory
            {user && (
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginLeft: 6 }}>
                · {user.name}
              </span>
            )}
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0', lineHeight: 1.45 }}>
            {user?.companyId
              ? `${user.companyId} · ${t('sidebar.subtitle')}`
              : t('sidebar.subtitle')}
          </p>
          </div>
        </div>
        <button
          type="button"
          className="sidebar-mobile-close"
          onClick={onCloseMobile}
          aria-label={t('common.close')}
        >
          <Close size={15} />
        </button>
      </div>

      {viewMode !== 'mailbox' && <div style={{ padding: '0 12px 12px' }}>
        <button
          onClick={onCreateNew}
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '8px 12px', fontSize: 13 }}
        >
          <Plus size={14} />
          {t('sidebar.newMemory')}
        </button>
      </div>}

      <div className="sidebar-scroll">
        <div style={{ height: 1, background: 'var(--border)', margin: '0 16px 8px' }} />

        <nav style={{ padding: '4px 8px' }}>
          {visibleViewItems.map((item) => {
            const isActive = viewMode === item.mode;
            const Icon = item.icon;
            return (
              <button
                type="button"
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

        <div style={{ padding: '4px 16px 6px' }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
            {t('sidebar.layers')}
          </span>
        </div>

        <nav className="sidebar-layer-list" style={{ padding: '0 8px 12px' }}>
          <button
            type="button"
            className={`sidebar-item sidebar-layer-item${activeLayer === null ? ' active' : ''}`}
            onClick={() => onSelectLayer(null)}
            style={{ justifyContent: 'space-between', width: '100%', border: 'none', background: 'transparent' }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Layers size={16} />
              <span>{t('common.all')}</span>
            </span>
            <span className="sidebar-count-pill">{totalMemories}</span>
          </button>

          {LAYERS.map((layer) => {
            const stats = layerStats[layer];
            const isActive = activeLayer === layer;
            const IconComponent = LAYER_ICONS[layer];

            return (
              <button
                type="button"
                key={layer}
                className={`sidebar-item sidebar-layer-item${isActive ? ' active' : ''}`}
                onClick={() => onSelectLayer(layer)}
                title={layerHelp(layer)}
                style={{ justifyContent: 'space-between', width: '100%', border: 'none', background: 'transparent' }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <IconComponent size={16} style={{ color: isActive ? 'var(--text-primary)' : LAYER_COLORS[layer] }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layerLabel(layer)}</span>
                </span>
                <span className="sidebar-count-pill">{stats?.active ?? 0}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
        {isAdmin && healthReport !== null && (
          <button
            type="button"
            className="sidebar-health"
            onClick={() => onViewModeChange('dream')}
            title={t('sidebar.healthOpenDream')}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Heart size={14} style={{ color: healthColor }} />
              <span style={{ display: 'grid', gap: 1, minWidth: 0 }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {healthReviewCount > 0 ? t('sidebar.healthNeedsReview', { count: healthReviewCount }) : t('sidebar.healthGood')}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                  {t('sidebar.healthScore', { score: healthReport.score })}
                </span>
              </span>
            </span>
            {healthIssues.length > 0 && (
              <span className="sidebar-health-breakdown">
                {healthIssues.slice(0, 2).join(' · ')}
              </span>
            )}
          </button>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sidebar.total', { count: totalMemories })}</span>
          <button
            type="button"
            onClick={onToggleTheme}
            className="sidebar-theme-button"
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

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: user ? 10 : 0 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sidebar.language')}</span>
          <div style={{ display: 'flex', gap: 4 }}>
            <LanguageButton value="zh" label="中" />
            <LanguageButton value="en" label="EN" />
          </div>
        </div>

        {user && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-light)',
              background: 'var(--surface-soft)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: 'linear-gradient(180deg, var(--accent), var(--accent-hover))',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {user.name.slice(0, 1).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {user.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {zh ? ROLE_LABEL_ZH[user.role] : ROLE_LABEL_EN[user.role]}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => { void logout(); }}
              title={zh ? '登出' : 'Log out'}
              aria-label={zh ? '登出' : 'Log out'}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 28,
                height: 28,
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
