import { useState, useEffect } from 'react';
import type { Layer, SearchResult, HealthReport, Memory } from '@keymemory/shared';
import { useMemoryStore } from './hooks/useMemoryStore';
import { ToastProvider, useToast } from './components/Toast';
import { Search, Close, Key } from './components/Icons';
import Sidebar from './components/Sidebar';
import Timeline from './components/Timeline';
import MemoryCard from './components/MemoryCard';
import NebulaGraph from './components/NebulaGraph';
import TagCloud from './components/TagCloud';
import DreamView from './components/DreamView';
import MigrationView from './components/MigrationView';
import ProjectSuggestionsView from './components/ProjectSuggestionsView';
import Editor from './views/Editor';
import { getHealth, getMemoryConnections, getTagCloud, getAgents, searchMemories, listRecycleBin, restoreFromRecycleBin, permanentlyDeleteMemory, setStoredApiKey, clearStoredApiKey } from './lib/api';
import type { MemoryGraphData, TagCloudData, AgentInfo } from './lib/api';

type ViewMode = 'memories' | 'nebula' | 'tags' | 'dream' | 'migration' | 'organize' | 'recycle';

function AppInner() {
  const store = useMemoryStore();
  const { toast } = useToast();
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('keymemory_view_mode');
    if (saved === 'memories' || saved === 'nebula' || saved === 'tags' || saved === 'dream' || saved === 'migration' || saved === 'organize' || saved === 'recycle') {
      return saved;
    }
    return 'memories';
  });
  const [recycleBinData, setRecycleBinData] = useState<Memory[]>([]);
  const [recycleBinLoading, setRecycleBinLoading] = useState(false);
  const [projectRefreshToken, setProjectRefreshToken] = useState(0);
  const [isDark, setIsDark] = useState(() => {
    const saved = localStorage.getItem('keymemory_theme');
    if (saved === 'dark' || saved === 'light') return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('keymemory_theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const setViewMode = (mode: ViewMode) => {
    setViewModeState(mode);
    localStorage.setItem('keymemory_view_mode', mode);
  };
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [graphData, setGraphData] = useState<MemoryGraphData | null>(null);
  const [tagCloudData, setTagCloudData] = useState<TagCloudData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [authLocked, setAuthLocked] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');

  useEffect(() => {
    getHealth()
      .then((res) => setHealthReport(res as unknown as HealthReport))
      .catch(() => {});
    getAgents()
      .then(setAgents)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setAuthLocked(true);
    window.addEventListener('keymemory:unauthorized', onUnauthorized);
    return () => window.removeEventListener('keymemory:unauthorized', onUnauthorized);
  }, []);

  const submitApiKey = (event: React.FormEvent) => {
    event.preventDefault();
    setStoredApiKey(apiKeyInput);
    setApiKeyInput('');
    setAuthLocked(false);
    store.refresh();
    getHealth()
      .then((res) => setHealthReport(res as unknown as HealthReport))
      .catch(() => {});
    getAgents()
      .then(setAgents)
      .catch(() => {});
  };

  const resetApiKey = () => {
    clearStoredApiKey();
    setApiKeyInput('');
    setAuthLocked(true);
  };

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

  const handleRestore = async (id: string) => {
    try {
      await restoreFromRecycleBin(id);
      toast('记忆已恢复', 'success');
      setRecycleBinData((prev) => prev.filter((m) => m.id !== id));
      store.refresh();
    } catch {
      toast('恢复失败', 'error');
    }
  };

  const handlePermanentDelete = async (id: string) => {
    if (!confirm('确定要永久删除这条记忆吗？此操作不可撤销。')) return;
    try {
      await permanentlyDeleteMemory(id);
      toast('记忆已永久删除', 'success');
      setRecycleBinData((prev) => prev.filter((m) => m.id !== id));
      store.refresh();
    } catch {
      toast('删除失败', 'error');
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchInput.trim();
    if (!q) {
      setIsSearchMode(false);
      setSearchResults([]);
      store.clearSearch();
      return;
    }
    setIsSearchMode(true);
    try {
      const results = await searchMemories(q, store.selectedLayer ?? undefined);
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
  };

  const handleSave = async (data: { title: string; content: string; layer: Layer; projectId?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => {
    try {
      await store.save(data);
      toast(store.selectedMemory ? '已更新' : '已创建', 'success');
      setGraphData(null);
      setTagCloudData(null);
    } catch {
      toast('保存失败', 'error');
    }
  };

  const handleProjectSelect = (projectId: string | null) => {
    setIsSearchMode(false);
    setSearchResults([]);
    setSearchInput('');
    setViewMode('memories');
    store.setActiveProject(projectId);
  };

  const handleProjectChanged = () => {
    setProjectRefreshToken((value) => value + 1);
    setGraphData(null);
    setTagCloudData(null);
    store.refresh();
  };

  const handleDelete = (id: string) => {
    store.deleteMemory(id).then(() => {
      toast('已删除', 'success');
      setGraphData(null);
      setTagCloudData(null);
    }).catch(() => toast('删除失败', 'error'));
  };

  const handleArchive = (id: string) => {
    store.archiveMemory(id).then(() => {
      toast('已归档', 'success');
      setGraphData(null);
      setTagCloudData(null);
    }).catch(() => toast('归档失败', 'error'));
  };

  const handleMoveLayer = async (id: string, layer: Layer) => {
    try {
      await store.moveLayer(id, layer);
      toast('已移动', 'success');
      setGraphData(null);
      setTagCloudData(null);
    } catch {
      toast('移动失败', 'error');
    }
  };

  const handleTagClick = (tagName: string) => {
    setViewMode('memories');
    setSearchInput(tagName);
    setIsSearchMode(true);
    searchMemories(tagName)
      .then((results) => setSearchResults(results))
      .catch(() => setSearchResults([]));
  };

  const handleCloseDetail = () => {
    store.cancelCreate();
    store.selectMemory(null as unknown as string);
  };

  const totalMemories = Object.values(store.layerStats).reduce((sum, s) => sum + s.active, 0);
  const showDetail = store.selectedId !== null || store.isCreating;

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-primary)' }}>
      <Sidebar
        layerStats={store.layerStats}
        activeLayer={store.selectedLayer}
        onSelectLayer={handleLayerSelect}
        onCreateNew={store.createNew}
        totalMemories={totalMemories}
        healthScore={healthReport?.score ?? null}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        isDark={isDark}
        onToggleTheme={() => setIsDark((d) => !d)}
        activeProjectId={store.activeProject}
        onSelectProject={handleProjectSelect}
        projectRefreshToken={projectRefreshToken}
      />

      <div className="flex flex-col flex-1" style={{ marginLeft: 240 }}>
        <header
          className="flex items-center shrink-0 px-6"
          style={{
            height: 56,
            background: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-4 flex-1" style={{ minWidth: 0 }}>
            <form onSubmit={handleSearch} className="relative flex-1" style={{ maxWidth: 480 }}>
              <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="搜索记忆..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full"
                style={{
                  background: 'var(--bg-secondary)',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  padding: '6px 10px 6px 34px',
                  fontSize: 13,
                  transition: 'border-color var(--transition)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-focus)';
                  e.currentTarget.style.background = 'var(--bg-primary)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.background = 'var(--bg-secondary)';
                }}
              />
              {isSearchMode && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', cursor: 'pointer', background: 'none', border: 'none' }}
                >
                  <Close size={14} />
                </button>
              )}
            </form>

            {isSearchMode && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {searchResults.length} 条结果
              </span>
            )}
          </div>

          <div className="flex items-center gap-2" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: store.healthOk ? 'var(--success)' : 'var(--danger)',
              }}
            />
            {store.healthOk ? '已连接' : '未连接'}
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {viewMode === 'memories' && (
            <>
              <div className="flex-1 overflow-y-auto">
                {showDetail ? (
                  <Editor
                    memory={store.selectedMemory}
                    isCreating={store.isCreating}
                    loading={store.loading}
                    onSave={handleSave}
                    onDelete={handleDelete}
                    onArchive={handleArchive}
                    onMoveLayer={handleMoveLayer}
                    onCancelCreate={handleCloseDetail}
                  />
                ) : (
                  <div className="px-6 py-5">
                    {store.loading ? (
                      <div className="empty-state">
                        <div className="animate-pulse" style={{ width: 20, height: 20, border: '2px solid var(--border)', borderTopColor: 'var(--text-muted)', borderRadius: '50%' }} />
                        <span className="mt-3" style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中...</span>
                      </div>
                    ) : isSearchMode && searchResults.length === 0 ? (
                      <div className="empty-state">
                        <Search size={24} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>未找到匹配的记忆</span>
                      </div>
                    ) : !isSearchMode && store.memories.length === 0 ? (
                      <div className="empty-state">
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>暂无记忆</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>点击左侧「新建记忆」开始记录</span>
                      </div>
                    ) : (
                      <div className="flex flex-col">
                        {(isSearchMode ? searchResults : store.memories).map((item, index) => (
                          <MemoryCard
                            key={isSearchMode ? (item as SearchResult).memory.id : (item as Memory).id}
                            memory={isSearchMode ? (item as SearchResult).memory : item as Memory}
                            score={isSearchMode ? (item as SearchResult).score : undefined}
                            matchType={isSearchMode ? (item as SearchResult).matchType : undefined}
                            onClick={() => store.selectMemory(isSearchMode ? (item as SearchResult).memory.id : (item as Memory).id)}
                          />
                        ))}
                        {!isSearchMode && store.hasMore && (
                          <button
                            onClick={store.loadMore}
                            className="btn mx-auto mt-4"
                            style={{ border: '1px solid var(--border)' }}
                          >
                            加载更多
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                className="w-[320px] shrink-0 overflow-y-auto px-5 py-5"
                style={{
                  background: 'var(--bg-secondary)',
                  borderLeft: '1px solid var(--border)',
                }}
              >
                <h3
                  className="text-xs font-semibold uppercase mb-4"
                  style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}
                >
                  时间线
                </h3>
                <Timeline memories={store.memories} onMemoryClick={(id) => store.selectMemory(id)} />
              </div>
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

          {viewMode === 'migration' && (
            <div className="flex-1 overflow-y-auto">
              <MigrationView
                onImported={() => {
                  handleProjectChanged();
                }}
                onToast={toast}
              />
            </div>
          )}

          {viewMode === 'organize' && (
            <div className="flex-1 overflow-y-auto">
              <ProjectSuggestionsView
                onChanged={handleProjectChanged}
                onToast={toast}
              />
            </div>
          )}

          {viewMode === 'recycle' && (
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
                    回收站
                  </h2>
                  <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
                    已删除、已归档的记忆可以在此恢复或永久清除
                  </p>
                </div>
              </div>
              {recycleBinLoading ? (
                <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
                  <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
                  加载中...
                </div>
              ) : recycleBinData.length === 0 ? (
                <div
                  className="flex flex-col items-center justify-center"
                  style={{
                    padding: 56,
                    color: 'var(--text-tertiary)',
                    background: 'var(--bg-card)',
                    borderRadius: 'var(--radius-lg)',
                    border: '0.5px solid var(--border)',
                  }}
                >
                  <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>回收站为空</span>
                  <span style={{ fontSize: 13, marginTop: 6, opacity: 0.6 }}>删除或归档的记忆将出现在这里</span>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {recycleBinData.map((mem) => (
                    <div
                      key={mem.id}
                      style={{
                        padding: '16px 20px',
                        borderRadius: 'var(--radius-md)',
                        border: '0.5px solid var(--border)',
                        background: 'var(--bg-card)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div className="flex items-center gap-4">
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: mem.status === 'deleted' ? 'rgba(255,59,48,0.1)' : 'rgba(245,166,35,0.1)',
                            color: mem.status === 'deleted' ? '#FF3B30' : '#F5A623',
                          }}
                        >
                          {mem.status === 'deleted' ? '已删除' : mem.status === 'archived' ? '已归档' : '已衰变'}
                        </span>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{mem.title}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                            [{mem.layer}] {mem.content.slice(0, 60)}{mem.content.length > 60 ? '...' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleRestore(mem.id)}
                          style={{
                            padding: '5px 12px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--success)',
                            background: 'transparent',
                            color: 'var(--success)',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          恢复
                        </button>
                        <button
                          onClick={() => handlePermanentDelete(mem.id)}
                          style={{
                            padding: '5px 12px',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid #FF3B30',
                            background: 'transparent',
                            color: '#FF3B30',
                            fontSize: 12,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          永久删除
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
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
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
                清除
              </button>
              <button type="submit" className="btn btn-primary" disabled={!apiKeyInput.trim()}>
                <Key size={14} />
                解锁
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
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
