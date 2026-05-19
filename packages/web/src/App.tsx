import { useState, useEffect } from 'react';
import type { Layer, SearchResult, HealthReport, Memory } from '@keymemory/shared';
import { useMemoryStore } from './hooks/useMemoryStore';
import { ToastProvider, useToast } from './components/Toast';
import { Search, Close } from './components/Icons';
import Sidebar from './components/Sidebar';
import Timeline from './components/Timeline';
import MemoryCard from './components/MemoryCard';
import NebulaGraph from './components/NebulaGraph';
import TagCloud from './components/TagCloud';
import DreamView from './components/DreamView';
import Editor from './views/Editor';
import { getHealth, getMemoryConnections, getTagCloud, getAgents, searchMemories } from './lib/api';
import type { MemoryGraphData, TagCloudData, AgentInfo } from './lib/api';

type ViewMode = 'memories' | 'nebula' | 'tags' | 'dream';

function AppInner() {
  const store = useMemoryStore();
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>('memories');
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [graphData, setGraphData] = useState<MemoryGraphData | null>(null);
  const [tagCloudData, setTagCloudData] = useState<TagCloudData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [agents, setAgents] = useState<AgentInfo[]>([]);

  useEffect(() => {
    getHealth()
      .then((res) => setHealthReport(res as unknown as HealthReport))
      .catch(() => {});
    getAgents()
      .then(setAgents)
      .catch(() => {});
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

  const handleSave = async (data: { title: string; content: string; layer: Layer; project?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => {
    try {
      await store.save(data);
      toast(store.selectedMemory ? '已更新' : '已创建', 'success');
      setGraphData(null);
      setTagCloudData(null);
    } catch {
      toast('保存失败', 'error');
    }
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
              <DreamView />
            </div>
          )}
        </div>
      </div>
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
