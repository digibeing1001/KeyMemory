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
import AppHeader from './components/AppHeader';
import TagCloud from './components/TagCloud';
import DreamView from './components/DreamView';
import LLMConfigView from './components/LLMConfigView';
import MigrationView from './components/MigrationView';
import ProjectSuggestionsView from './components/ProjectSuggestionsView';
import MailboxView from './components/MailboxView';
import WorkingSetView from './components/WorkingSetView';
import IntegrationView from './components/IntegrationView';
import TodayView from './views/TodayView';
import TimelineView from './views/TimelineView';
import LibraryView from './views/LibraryView';
import GraphView from './views/GraphView';
import InsightsView from './views/InsightsView';
import UserGuide from './components/UserGuide';
import MemoriesWorkspace from './views/MemoriesWorkspace';
import RecycleBinView from './views/RecycleBinView';
import Editor from './views/Editor';
import UsersView from './views/UsersView';
import Login from './auth/Login';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { I18nProvider, useI18n } from './i18n';
import {
  getHealth,
  getTagCloud,
  searchMemories,
  listRecycleBin,
  restoreFromRecycleBin,
  permanentlyDeleteMemory,
  discoverAgentIntegrations,
} from './lib/api';
import type { TagCloudData, UserRole } from './lib/api';
import { formatDate, formatMemoryTitle, LAYER_COLORS } from './lib/memoryFormat';

type ViewMode = 'memories' | 'mailbox' | 'nebula' | 'tags' | 'dream' | 'llm' | 'migration' | 'organize' | 'recycle' | 'workingSet' | 'integrations' | 'users' | 'today' | 'timeline' | 'library' | 'graph' | 'insights';

function isViewMode(value: string | null): value is ViewMode {
  return value === 'mailbox'
    || value === 'memories'
    || value === 'nebula'
    || value === 'tags'
    || value === 'dream'
    || value === 'llm'
    || value === 'migration'
    || value === 'organize'
    || value === 'recycle'
    || value === 'workingSet'
    || value === 'integrations'
    || value === 'users'
    || value === 'today'
    || value === 'timeline'
    || value === 'library'
    || value === 'graph'
    || value === 'insights';
}

const ADMIN_ONLY_VIEWS: ViewMode[] = ['dream', 'llm', 'migration', 'organize', 'users'];

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
    return isViewMode(saved) ? saved : 'mailbox';
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
  const [tagCloudData, setTagCloudData] = useState<TagCloudData | null>(null);
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
      setTagCloudData(null);
    } catch {
      toast(language === 'zh' ? '保存失败' : 'Save failed', 'error');
    }
  };

  const handleProjectChanged = () => {
    setTagCloudData(null);
    store.refresh();
  };

  const handleDelete = (id: string) => {
    store.deleteMemory(id)
      .then(() => {
        toast(language === 'zh' ? '已删除' : 'Deleted', 'success');
        setTagCloudData(null);
      })
      .catch(() => toast(language === 'zh' ? '删除失败' : 'Delete failed', 'error'));
  };

  const handleArchive = (id: string) => {
    store.archiveMemory(id)
      .then(() => {
        toast(language === 'zh' ? '已归档' : 'Archived', 'success');
        setTagCloudData(null);
      })
      .catch(() => toast(language === 'zh' ? '归档失败' : 'Archive failed', 'error'));
  };

  const handleMoveLayer = async (id: string, layer: Layer) => {
    try {
      await store.moveLayer(id, layer);
      toast(language === 'zh' ? '记忆状态已更新' : 'Memory state updated', 'success');
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
        <AppHeader
          viewMode={viewMode}
          searchInput={searchInput}
          onSearchInputChange={setSearchInput}
          isSearchMode={isSearchMode}
          searchResultCount={searchResults.length}
          onSearch={handleSearch}
          onClearSearch={handleClearSearch}
          onOpenSidebar={() => setSidebarOpen(true)}
          onOpenGuide={() => {
            setGuideFirstRun(false);
            setGuideOpen(true);
          }}
          healthOk={store.healthOk}
          language={language}
          t={t}
        />

        <div className="app-content-row flex flex-1 overflow-hidden">
          {viewMode === 'mailbox' && <MailboxView onOpenIntegrations={() => setViewMode('integrations')} />}

          {viewMode === 'memories' && (
            <MemoriesWorkspace
              store={store}
              isSearchMode={isSearchMode}
              searchResults={searchResults}
              visibleItems={visibleItems}
              language={language}
              t={t}
              onSave={handleSave}
              onDelete={handleDelete}
              onArchive={handleArchive}
              onMoveLayer={handleMoveLayer}
              onLayerSelect={handleLayerSelect}
            />
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
                degradedPaths={healthReport?.degradedPaths ?? []}
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

          {viewMode === 'today' && (
            <div className="flex-1 overflow-y-auto">
              <TodayView degradedPaths={healthReport?.degradedPaths ?? []} onToast={toast} />
            </div>
          )}

          {viewMode === 'timeline' && (
            <div className="flex-1 overflow-y-auto">
              <TimelineView />
            </div>
          )}

          {viewMode === 'library' && (
            <div className="flex-1 overflow-y-auto">
              <LibraryView />
            </div>
          )}

          {viewMode === 'graph' && (
            <div className="flex-1 overflow-y-auto">
              <GraphView onToast={toast} />
            </div>
          )}

          {viewMode === 'insights' && (
            <div className="flex-1 overflow-y-auto">
              <InsightsView />
            </div>
          )}

          {viewMode === 'migration' && (
            <div className="flex-1 overflow-y-auto">
              <MigrationView onImported={handleProjectChanged} onToast={toast} />
            </div>
          )}

          {viewMode === 'organize' && isAdmin && (
            <div className="flex-1 overflow-y-auto">
              <ProjectSuggestionsView onChanged={handleProjectChanged} onToast={toast} />
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
            <RecycleBinView
              memories={recycleBinData}
              loading={recycleBinLoading}
              locale={locale}
              t={t}
              layerLabel={layerLabel}
              onRestore={handleRestore}
              onPermanentDelete={handlePermanentDelete}
            />
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
