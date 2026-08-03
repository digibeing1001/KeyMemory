import { useState, useEffect } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import type { Layer, SearchResult, HealthReport, Memory } from '@keymemory/shared';
import { useMemoryStore } from './hooks/useMemoryStore';
import { ToastProvider, useToast } from './components/Toast';
import { Search, Close, Menu, Inbox, BookOpen } from './components/Icons';
import Sidebar from './components/Sidebar';
import Timeline from './components/Timeline';
import MemoryCard from './components/MemoryCard';
import MemoryDetailPanel from './components/MemoryDetailPanel';
import LayerCards from './components/LayerCards';
import MemoryValley from './components/MemoryValley';
import TagCloud from './components/TagCloud';
import DreamView from './components/DreamView';
import LLMConfigView from './components/LLMConfigView';
import MigrationView from './components/MigrationView';
import MailboxView from './components/MailboxView';
import WorkingSetView from './components/WorkingSetView';
import IntegrationView from './components/IntegrationView';
import UserGuide from './components/UserGuide';
import Editor from './views/Editor';
import UsersView from './views/UsersView';
import Login from './auth/Login';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { I18nProvider, useI18n } from './i18n';
import {
  getHealth,
  getMemoryConnections,
  getTagCloud,
  searchMemories,
  listRecycleBin,
  restoreFromRecycleBin,
  permanentlyDeleteMemory,
  discoverAgentIntegrations,
} from './lib/api';
import type { MemoryGraphData, TagCloudData, UserRole } from './lib/api';
import { formatDate, formatMemoryTitle, LAYER_COLORS } from './lib/memoryFormat';

type ViewMode = 'memories' | 'mailbox' | 'valley' | 'nebula' | 'tags' | 'dream' | 'llm' | 'migration' | 'organize' | 'recycle' | 'workingSet' | 'integrations' | 'users';

function isViewMode(value: string | null): value is ViewMode {
  return value === 'mailbox'
    || value === 'memories'
    || value === 'valley'
    || value === 'tags'
    || value === 'dream'
    || value === 'migration'
    || value === 'recycle'
    || value === 'workingSet'
    || value === 'users';
}

const ADMIN_ONLY_VIEWS: ViewMode[] = ['dream', 'migration', 'organize', 'users'];

function isAdminRole(role: UserRole | undefined): boolean {
  return role === 'boss' || role === 'admin';
}

function LoadingScreen() {
  return (
    <div className="flex items-center justify-center" style={{ height: '100vh', color: 'var(--text-muted)' }}>
      <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
      Loading...
    </div>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

function AppInner() {
  const store = useMemoryStore();
  const { t, language, layerLabel } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const isAdmin = isAdminRole(user?.role);
  // localStorage 偏好按用户隔离:登录后 key 带 userId 前缀;
  // 未登录(LoginRoute 不会进入 AppInner,但保留兜底)用全局 key。
  const prefPrefix = user?.id ? `keymemory_${user.id}_` : 'keymemory_';
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const saved = localStorage.getItem(`${prefPrefix}view_mode`);
    return isViewMode(saved) ? saved : 'memories';
  });
  const [recycleBinData, setRecycleBinData] = useState<Memory[]>([]);
  const [recycleBinLoading, setRecycleBinLoading] = useState(false);
  const [isDark, setIsDark] = useState(() => {
    const themeVersion = localStorage.getItem(`${prefPrefix}theme_version`);
    const saved = localStorage.getItem(`${prefPrefix}theme`);
    if (themeVersion === 'bright-notes-20260601' && (saved === 'dark' || saved === 'light')) {
      return saved === 'dark';
    }
    return true;
  });
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [graphData, setGraphData] = useState<MemoryGraphData | null>(null);
  const [tagCloudData, setTagCloudData] = useState<TagCloudData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [guideFirstRun, setGuideFirstRun] = useState(() => localStorage.getItem('keymemory_onboarding_completed_v1') !== 'true');
  const [guideOpen, setGuideOpen] = useState(() => {
    const forced = new URLSearchParams(window.location.search).get('onboarding') === '1';
    return forced || localStorage.getItem('keymemory_onboarding_completed_v1') !== 'true';
  });

  const dismissGuide = () => {
    localStorage.setItem('keymemory_onboarding_completed_v1', 'true');
    setGuideFirstRun(false);
    setGuideOpen(false);
  };

  // AG5：无任何已接入 Agent 时，每次会话自动展示一次引导（用户关闭后本会话不再重弹）。
  // 真实检测：以 /integrations/discover 的 connectedCount 为准，不伪造状态。
  useEffect(() => {
    let cancelled = false;
    discoverAgentIntegrations()
      .then(report => {
        if (cancelled) return;
        if (report.connectedCount > 0) return;
        if (sessionStorage.getItem('keymemory_connect_guide_dismissed_v1') === 'true') return;
        setGuideOpen(true);
      })
      .catch(() => { /* 服务暂不可用时不自动弹出，可经顶部“使用说明”手动打开 */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem(`${prefPrefix}theme`, isDark ? 'dark' : 'light');
    localStorage.setItem(`${prefPrefix}theme_version`, 'bright-notes-20260601');
  }, [isDark, prefPrefix]);

  useEffect(() => {
    getHealth()
      .then((res) => setHealthReport(res as unknown as HealthReport))
      .catch(() => {});
  }, []);

  // 非管理员用户访问受限视图时回退到 memories
  useEffect(() => {
    if (!isAdmin && ADMIN_ONLY_VIEWS.includes(viewMode)) {
      setViewModeState('memories');
      localStorage.setItem(`${prefPrefix}view_mode`, 'memories');
    }
  }, [isAdmin, viewMode, prefPrefix]);

  useEffect(() => {
    if (viewMode === 'valley' && !graphData) {
      setGraphLoading(true);
      getMemoryConnections()
        .then(setGraphData)
        .catch(() => setGraphData(null))
        .finally(() => setGraphLoading(false));
    }
  }, [viewMode, graphData]);

  useEffect(() => {
    if (viewMode === 'tags' && !tagCloudData) {
      getTagCloud()
        .then(setTagCloudData)
        .catch(() => setTagCloudData(null));
    }
  }, [viewMode, tagCloudData]);

  useEffect(() => {
    if (viewMode === 'recycle') {
      setRecycleBinLoading(true);
      listRecycleBin()
        .then(setRecycleBinData)
        .catch(() => setRecycleBinData([]))
        .finally(() => setRecycleBinLoading(false));
    }
  }, [viewMode]);

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem(`${prefPrefix}view_mode`, mode);
    setSidebarOpen(false);
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchInput.trim();
    if (!query) {
      handleClearSearch();
      return;
    }
    setIsSearchMode(true);
    store.selectMemory(null);
    try {
      const results = await searchMemories(query, store.selectedLayer ?? undefined, store.activeProject ?? undefined);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    }
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setIsSearchMode(false);
    setSearchResults([]);
    store.clearSearch();
  };

  const handleLayerSelect = (layer: Layer | null) => {
    setIsSearchMode(false);
    setSearchResults([]);
    setSearchInput('');
    setViewMode('memories');
    store.selectLayer(layer);
    setSidebarOpen(false);
  };

  const handleSave = async (data: { title: string; content: string; layer: Layer; projectId?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => {
    try {
      await store.save(data);
      toast(store.selectedMemory ? (language === 'zh' ? '已更新' : 'Updated') : (language === 'zh' ? '已创建' : 'Created'), 'success');
      setGraphData(null);
      setTagCloudData(null);
    } catch {
      toast(language === 'zh' ? '保存失败' : 'Save failed', 'error');
    }
  };

  const handleProjectChanged = () => {
    setGraphData(null);
    setTagCloudData(null);
    store.refresh();
  };

  const handleDelete = (id: string) => {
    store.deleteMemory(id)
      .then(() => {
        toast(language === 'zh' ? '已删除' : 'Deleted', 'success');
        setGraphData(null);
        setTagCloudData(null);
      })
      .catch(() => toast(language === 'zh' ? '删除失败' : 'Delete failed', 'error'));
  };

  const handleArchive = (id: string) => {
    store.archiveMemory(id)
      .then(() => {
        toast(language === 'zh' ? '已归档' : 'Archived', 'success');
        setGraphData(null);
        setTagCloudData(null);
      })
      .catch(() => toast(language === 'zh' ? '归档失败' : 'Archive failed', 'error'));
  };

  const handleMoveLayer = async (id: string, layer: Layer) => {
    try {
      await store.moveLayer(id, layer);
      toast(language === 'zh' ? '记忆状态已更新' : 'Memory state updated', 'success');
      setGraphData(null);
      setTagCloudData(null);
    } catch {
      toast(language === 'zh' ? '移动失败' : 'Move failed', 'error');
    }
  };

  const handleTagClick = (tagName: string) => {
    setViewMode('memories');
    setSearchInput(tagName);
    setIsSearchMode(true);
    store.selectMemory(null);
    searchMemories(tagName)
      .then((results) => setSearchResults(results))
      .catch(() => setSearchResults([]));
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreFromRecycleBin(id);
      toast(language === 'zh' ? '已恢复' : 'Restored', 'success');
      setRecycleBinData((prev) => prev.filter((memory) => memory.id !== id));
      store.refresh();
    } catch {
      toast(language === 'zh' ? '恢复失败' : 'Restore failed', 'error');
    }
  };

  const handlePermanentDelete = async (id: string) => {
    const ok = confirm(language === 'zh' ? '确定永久删除这条记忆吗？此操作不可撤销。' : 'Delete this memory forever? This cannot be undone.');
    if (!ok) return;
    try {
      await permanentlyDeleteMemory(id);
      toast(language === 'zh' ? '已永久删除' : 'Deleted forever', 'success');
      setRecycleBinData((prev) => prev.filter((memory) => memory.id !== id));
      store.refresh();
    } catch {
      toast(language === 'zh' ? '删除失败' : 'Delete failed', 'error');
    }
  };

  const totalMemories = Object.values(store.layerStats).reduce((sum, stats) => sum + stats.active, 0);
  const visibleItems = isSearchMode ? searchResults.map((result) => result.memory) : store.memories;

  return (
    <div className="app-layout flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <button
        type="button"
        className={`mobile-sidebar-backdrop${sidebarOpen ? ' is-visible' : ''}`}
        aria-label={t('common.close')}
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
      />
      <Sidebar
        layerStats={store.layerStats}
        activeLayer={store.selectedLayer}
        onSelectLayer={handleLayerSelect}
        onCreateNew={() => {
          store.createNew();
          setSidebarOpen(false);
        }}
        totalMemories={totalMemories}
        healthReport={healthReport}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isDark={isDark}
        onToggleTheme={() => setIsDark((value) => !value)}
        isMobileOpen={sidebarOpen}
        onCloseMobile={() => setSidebarOpen(false)}
      />

      <div className="app-main flex flex-col flex-1" style={{ marginLeft: 248 }}>
        <header
          className="flex items-center shrink-0 px-6"
          style={{
            height: 58,
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            className="mobile-nav-button"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('common.expand')}
          >
            <Menu size={17} />
          </button>
          <div className="flex items-center gap-4 flex-1" style={{ minWidth: 0 }}>
            {viewMode !== 'mailbox' && <form onSubmit={handleSearch} className="app-search-form relative flex-1" style={{ maxWidth: 520 }}>
              <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder={t('app.searchPlaceholder')}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="w-full"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  padding: '7px 34px 7px 36px',
                  fontSize: 13,
                }}
              />
              {isSearchMode && (
                <button
                  type="button"
                  aria-label={t('common.close')}
                  onClick={handleClearSearch}
                  className="search-clear-button"
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none' }}
                >
                  <Close size={14} />
                </button>
              )}
            </form>}

            {viewMode === 'mailbox' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                <Inbox size={17} style={{ color: 'var(--accent)' }} />
                <div style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', color: 'var(--text-primary)', fontSize: 13 }}>{language === 'zh' ? '记忆邮箱' : 'Memory mailbox'}</strong>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{language === 'zh' ? '人类Agent与记忆在同一项目中' : 'Humans, Agents, and memory in one project'}</span>
                </div>
              </div>
            )}

            {isSearchMode && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {searchResults.length} {t('app.searchResults')}
              </span>
            )}
          </div>

          <div className="app-header-status flex items-center gap-2" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <button
              type="button"
              className="app-guide-button"
              onClick={() => {
                setGuideFirstRun(false);
                setGuideOpen(true);
              }}
            >
              <BookOpen size={14} />
              {language === 'zh' ? '使用说明' : 'Guide'}
            </button>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: store.healthOk ? 'var(--success)' : 'var(--danger)' }} />
            {store.healthOk ? t('app.connected') : t('app.disconnected')}
          </div>
        </header>

        <div className="app-content-row flex flex-1 overflow-hidden">
          {viewMode === 'mailbox' && <MailboxView />}

          {viewMode === 'memories' && (
            <>
              <div className="memory-list-shell flex-1 overflow-y-auto">
                {store.isCreating ? (
                  <Editor
                    memory={null}
                    isCreating={store.isCreating}
                    loading={store.loading}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                    onMoveLayer={handleMoveLayer}
                    onCancelCreate={store.cancelCreate}
                  />
                ) : (
                  <div className="px-6 py-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text-primary)', fontWeight: 750 }}>
                          {t('app.memoryList')}
                        </h2>
                        <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: 12 }}>
                          {t('app.selectedHint')}
                        </p>
                      </div>
                    </div>

                    {!isSearchMode && (
                      <LayerCards
                        layerStats={store.layerStats}
                        activeLayer={store.selectedLayer}
                        onSelectLayer={handleLayerSelect}
                      />
                    )}

                    {store.loading ? (
                      <div className="empty-state">
                        <div className="animate-pulse" style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--text-muted)', borderRadius: '50%' }} />
                        <span className="mt-3" style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('common.loading')}</span>
                      </div>
                    ) : isSearchMode && searchResults.length === 0 ? (
                      <div className="empty-state">
                        <Search size={24} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('app.noSearchResults')}</span>
                      </div>
                    ) : !isSearchMode && store.memories.length === 0 ? (
                      <div className="empty-state">
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('app.noMemories')}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{t('app.noMemoriesHint')}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {visibleItems.map((memory) => {
                          const searchItem = isSearchMode ? searchResults.find((result) => result.memory.id === memory.id) : undefined;
                          return (
                            <MemoryCard
                              key={memory.id}
                              memory={memory}
                              selected={store.selectedId === memory.id}
                              score={searchItem?.score}
                              matchType={searchItem?.matchType}
                              onClick={() => store.selectMemory(memory.id)}
                            />
                          );
                        })}
                        {!isSearchMode && store.hasMore && (
                          <button onClick={store.loadMore} className="btn mx-auto mt-4" style={{ border: '1px solid var(--border)' }}>
                            {language === 'zh' ? '加载更多' : 'Load more'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {!store.isCreating && (
                store.selectedMemory ? (
                  <MemoryDetailPanel
                    memory={store.selectedMemory}
                    loading={store.loading}
                    onClose={() => store.selectMemory(null)}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                    onMoveLayer={handleMoveLayer}
                  />
                ) : (
                  <aside
                    className="timeline-panel w-[340px] shrink-0 overflow-y-auto px-5 py-5"
                    style={{ background: 'var(--bg-secondary)', borderLeft: '1px solid var(--border)' }}
                  >
                    <h3 className="text-xs font-semibold uppercase mb-4" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>
                      {t('app.timeline')}
                    </h3>
                    <Timeline memories={store.memories} onMemoryClick={(id) => store.selectMemory(id)} />
                  </aside>
                )
              )}
            </>
          )}

          {viewMode === 'valley' && (
            <div className="flex-1 relative">
              <MemoryValley
                data={graphData}
                onNodeClick={(nodeId) => {
                  setViewMode('memories');
                  store.selectMemory(nodeId);
                }}
                loading={graphLoading}
              />
            </div>
          )}

          {viewMode === 'tags' && (
            <div className="flex-1 overflow-y-auto px-6 py-5">
              <TagCloud
                tags={tagCloudData?.tags ?? []}
                suspectTags={tagCloudData?.suspectTags ?? []}
                projects={tagCloudData?.projects}
                onTagClick={handleTagClick}
                loading={!tagCloudData}
              />
            </div>
          )}

          {viewMode === 'dream' && (
            <div className="flex-1 overflow-y-auto">
              <DreamView
                onHealthChanged={() => {
                  getHealth().then((res) => setHealthReport(res as unknown as HealthReport)).catch(() => {});
                }}
                onMemorySelect={(id) => {
                  setViewMode('memories');
                  store.selectMemory(id);
                }}
              />
            </div>
          )}

          {viewMode === 'llm' && (
            <div className="flex-1 overflow-y-auto">
              <LLMConfigView />
            </div>
          )}

          {viewMode === 'workingSet' && (
            <div className="flex-1 overflow-y-auto">
              <WorkingSetView
                onMemorySelect={(id) => {
                  setViewMode('memories');
                  store.selectMemory(id);
                }}
              />
            </div>
          )}

          {viewMode === 'integrations' && (
            <div className="flex-1 overflow-y-auto">
              <IntegrationView />
            </div>
          )}

          {viewMode === 'migration' && (
            <div className="flex-1 overflow-y-auto">
              <MigrationView onImported={handleProjectChanged} onToast={toast} />
            </div>
          )}

          {viewMode === 'users' && isAdmin && (
            <div className="flex-1 overflow-y-auto">
              <UsersView />
            </div>
          )}

          <UserGuide
            open={guideOpen}
            firstRun={guideFirstRun}
            onClose={() => {
              sessionStorage.setItem('keymemory_connect_guide_dismissed_v1', 'true');
              setGuideOpen(false);
            }}
            onComplete={dismissGuide}
            onOpenIntegrations={() => {
              sessionStorage.setItem('keymemory_connect_guide_dismissed_v1', 'true');
              setGuideOpen(false);
              setViewMode('integrations');
            }}
          />

          {viewMode === 'recycle' && (
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>
                    {t('recycle.title')}
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                    {t('recycle.subtitle')}
                  </p>
                </div>
              </div>
              {recycleBinLoading ? (
                <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
                  <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
                  {t('common.loading')}
                </div>
              ) : recycleBinData.length === 0 ? (
                <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: 56 }}>
                  <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-secondary)' }}>{t('recycle.empty')}</span>
                  <span style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)' }}>{t('recycle.emptyHint')}</span>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {recycleBinData.map((memory) => (
                    <div
                      key={memory.id}
                      style={{
                        padding: '16px 18px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 16,
                      }}
                    >
                      <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
                        <span className="tag-pill" style={{ color: LAYER_COLORS[memory.layer], background: `${LAYER_COLORS[memory.layer]}18` }}>
                          {layerLabel(memory.layer)}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {formatMemoryTitle(memory)}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            {formatDate(memory.updatedAt, locale)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleRestore(memory.id)} className="btn">
                          {t('recycle.restore')}
                        </button>
                        <button onClick={() => handlePermanentDelete(memory.id)} className="btn" style={{ color: 'var(--danger)' }}>
                          {t('recycle.permanentDelete')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />
            <Route path="/" element={<ProtectedRoute><AppInner /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
