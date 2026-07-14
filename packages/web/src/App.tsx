import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import type { Layer, SearchResult, HealthReport, Memory } from '@keymemory/shared';
import { useMemoryStore } from './hooks/useMemoryStore';
import { ToastProvider, useToast } from './components/Toast';
import { Search, Close, Key, Menu, BookOpen } from './components/Icons';
import Sidebar from './components/Sidebar';
import Timeline from './components/Timeline';
import MemoryCard from './components/MemoryCard';
import MemoryDetailPanel from './components/MemoryDetailPanel';
import LayerCards from './components/LayerCards';
import NebulaGraph from './components/NebulaGraph';
import TagCloud from './components/TagCloud';
import DreamView from './components/DreamView';
import LLMConfigView from './components/LLMConfigView';
import MigrationView from './components/MigrationView';
import ProjectSuggestionsView from './components/ProjectSuggestionsView';
import WorkingSetView from './components/WorkingSetView';
import IntegrationView from './components/IntegrationView';
import UserGuide from './components/UserGuide';
import Editor from './views/Editor';
import { I18nProvider, useI18n } from './i18n';
import {
  getHealth,
  getMemoryConnections,
  getTagCloud,
  searchMemories,
  listRecycleBin,
  restoreFromRecycleBin,
  permanentlyDeleteMemory,
  setStoredApiKey,
  clearStoredApiKey,
} from './lib/api';
import type { MemoryGraphData, TagCloudData } from './lib/api';
import { formatDate, formatMemoryTitle, LAYER_COLORS } from './lib/memoryFormat';

type ViewMode = 'memories' | 'nebula' | 'tags' | 'dream' | 'migration' | 'organize' | 'recycle' | 'workingSet' | 'llm' | 'integrations';

function isViewMode(value: string | null): value is ViewMode {
  return value === 'memories'
    || value === 'nebula'
    || value === 'tags'
    || value === 'dream'
    || value === 'migration'
    || value === 'organize'
    || value === 'recycle'
    || value === 'workingSet'
    || value === 'llm'
    || value === 'integrations';
}

function AppInner() {
  const store = useMemoryStore();
  const { t, language, layerLabel } = useI18n();
  const { toast } = useToast();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const linked = new URLSearchParams(window.location.search).get('view');
    if (isViewMode(linked)) return linked;
    const saved = localStorage.getItem('keymemory_view_mode');
    return isViewMode(saved) ? saved : 'memories';
  });
  const [recycleBinData, setRecycleBinData] = useState<Memory[]>([]);
  const [recycleBinLoading, setRecycleBinLoading] = useState(false);
  const [projectRefreshToken, setProjectRefreshToken] = useState(0);
  const [isDark, setIsDark] = useState(() => {
    const themeVersion = localStorage.getItem('keymemory_theme_version');
    const saved = localStorage.getItem('keymemory_theme');
    if (themeVersion === 'memory-control-plane-20260715' && (saved === 'dark' || saved === 'light')) {
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
  const [authLocked, setAuthLocked] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [guideFirstRun, setGuideFirstRun] = useState(() => localStorage.getItem('keymemory_onboarding_completed_v1') !== 'true');
  const [guideOpen, setGuideOpen] = useState(() => {
    const forced = new URLSearchParams(window.location.search).get('onboarding') === '1';
    return forced || localStorage.getItem('keymemory_onboarding_completed_v1') !== 'true';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('keymemory_theme', isDark ? 'dark' : 'light');
    localStorage.setItem('keymemory_theme_version', 'memory-control-plane-20260715');
  }, [isDark]);

  useEffect(() => {
    getHealth()
      .then((res) => setHealthReport(res as unknown as HealthReport))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setAuthLocked(true);
    window.addEventListener('keymemory:unauthorized', onUnauthorized);
    return () => window.removeEventListener('keymemory:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    if (viewMode === 'nebula' && !graphData) {
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
    localStorage.setItem('keymemory_view_mode', mode);
    setSidebarOpen(false);
  };

  const submitApiKey = (event: FormEvent) => {
    event.preventDefault();
    setStoredApiKey(apiKeyInput);
    setApiKeyInput('');
    setAuthLocked(false);
    store.refresh();
    getHealth().then((res) => setHealthReport(res as unknown as HealthReport)).catch(() => {});
  };

  const resetApiKey = () => {
    clearStoredApiKey();
    setApiKeyInput('');
    setAuthLocked(true);
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

  const handleProjectSelect = (projectId: string | null) => {
    setIsSearchMode(false);
    setSearchResults([]);
    setSearchInput('');
    setViewMode('memories');
    store.setActiveProject(projectId);
    store.selectMemory(null);
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
    setProjectRefreshToken((value) => value + 1);
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
        activeProjectId={store.activeProject}
        onSelectProject={handleProjectSelect}
        projectRefreshToken={projectRefreshToken}
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
            <form onSubmit={handleSearch} className="app-search-form relative flex-1" style={{ maxWidth: 520 }}>
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
            </form>

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

          {viewMode === 'nebula' && (
            <div className="flex-1 relative">
              <NebulaGraph
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
                projects={tagCloudData?.projects}
                onTagClick={handleTagClick}
                loading={!tagCloudData}
              />
            </div>
          )}

          {viewMode === 'dream' && (
            <div className="flex-1 overflow-y-auto">
              <DreamView
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

          {viewMode === 'organize' && (
            <div className="flex-1 overflow-y-auto">
              <ProjectSuggestionsView onChanged={handleProjectChanged} onToast={toast} />
            </div>
          )}

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

      <UserGuide
        open={guideOpen}
        firstRun={guideFirstRun}
        onClose={() => setGuideOpen(false)}
        onComplete={() => {
          localStorage.setItem('keymemory_onboarding_completed_v1', 'true');
          setGuideFirstRun(false);
        }}
        onOpenIntegrations={() => {
          setViewMode('integrations');
          setGuideOpen(false);
        }}
      />

      {authLocked && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 100,
            background: 'rgba(0, 0, 0, 0.32)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <form
            onSubmit={submitApiKey}
            style={{
              width: 'min(420px, 100%)',
              background: 'var(--bg-primary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 20,
              boxShadow: '0 18px 50px rgba(0, 0, 0, 0.18)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <Key size={18} style={{ color: 'var(--accent)' }} />
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: 'var(--text-primary)' }}>
                API Key
              </h2>
            </div>
            <input
              type="password"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
              autoFocus
              placeholder="KEYMEMORY_API_KEY"
              style={{
                width: '100%',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                padding: '9px 10px',
                fontSize: 13,
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button type="button" className="btn" onClick={resetApiKey}>
                {language === 'zh' ? '清除' : 'Clear'}
              </button>
              <button type="submit" className="btn btn-primary" disabled={!apiKeyInput.trim()}>
                <Key size={14} />
                {language === 'zh' ? '解锁' : 'Unlock'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </I18nProvider>
  );
}
