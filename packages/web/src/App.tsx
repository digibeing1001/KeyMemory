import { useState, useCallback, useEffect } from 'react';
import type { Layer, SearchResult, HealthReport } from '@keymemory/shared';
import { useMemoryStore } from './hooks/useMemoryStore';
import { ToastProvider, useToast } from './components/Toast';
import { Search, Close, Heart, ArrowLeft } from './components/Icons';
import Sidebar from './components/Sidebar';
import Timeline from './components/Timeline';
import MemoryCard from './components/MemoryCard';
import NebulaGraph from './components/NebulaGraph';
import TagCloud from './components/TagCloud';
import DreamView from './components/DreamView';
import Editor from './views/Editor';
import ConfirmDialog from './components/ConfirmDialog';
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
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    danger: boolean;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', danger: false, onConfirm: () => {} });

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

  const showConfirm = useCallback(
    (title: string, message: string, onConfirm: () => void, danger = false) => {
      setConfirm({ open: true, title, message, danger, onConfirm });
    },
    [],
  );

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
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
    },
    [searchInput, store.selectedLayer, store.clearSearch],
  );

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setIsSearchMode(false);
    setSearchResults([]);
    store.clearSearch();
  }, [store.clearSearch]);

  const handleLayerSelect = useCallback(
    (layer: Layer | null) => {
      setIsSearchMode(false);
      setSearchResults([]);
      setSearchInput('');
      setViewMode('memories');
      store.selectLayer(layer);
    },
    [store.selectLayer],
  );

  const handleSave = useCallback(
    async (data: { title: string; content: string; layer: Layer; project?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => {
      try {
        await store.save(data);
        toast(store.selectedMemory ? '记忆已更新' : '记忆已创建', 'success');
        setGraphData(null);
        setTagCloudData(null);
      } catch {
        toast('保存失败，请重试', 'error');
      }
    },
    [store, toast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      showConfirm('删除记忆', '确定要删除这条记忆吗？此操作不可撤销。', async () => {
        try {
          await store.deleteMemory(id);
          toast('记忆已删除', 'success');
          setGraphData(null);
          setTagCloudData(null);
        } catch {
          toast('删除失败，请重试', 'error');
        }
      }, true);
    },
    [store, toast, showConfirm],
  );

  const handleArchive = useCallback(
    (id: string) => {
      showConfirm('归档记忆', '确定要归档这条记忆吗？', async () => {
        try {
          await store.archiveMemory(id);
          toast('记忆已归档', 'success');
          setGraphData(null);
          setTagCloudData(null);
        } catch {
          toast('归档失败，请重试', 'error');
        }
      });
    },
    [store, toast, showConfirm],
  );

  const handleMoveLayer = useCallback(
    async (id: string, layer: Layer) => {
      try {
        await store.moveLayer(id, layer);
        toast('层级已移动', 'success');
        setGraphData(null);
        setTagCloudData(null);
      } catch {
        toast('移动失败，请重试', 'error');
      }
    },
    [store, toast],
  );

  const handleTagClick = useCallback(
    (tagName: string) => {
      setViewMode('memories');
      setSearchInput(tagName);
      setIsSearchMode(true);
      searchMemories(tagName)
        .then((results) => setSearchResults(results))
        .catch(() => setSearchResults([]));
    },
    [],
  );

  const handleCloseDetail = useCallback(() => {
    store.cancelCreate();
    store.selectMemory(null as unknown as string);
  }, [store]);

  const totalMemories = Object.values(store.layerStats).reduce((sum, s) => sum + s.active, 0);
  const showDetail = store.selectedId !== null || store.isCreating;

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-main)' }}>
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
          className="flex items-center shrink-0"
          style={{
            height: 64,
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(20px) saturate(150%)',
            WebkitBackdropFilter: 'blur(20px) saturate(150%)',
            borderBottom: '0.5px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-4 flex-1 px-8" style={{ minWidth: 0 }}>
            {showDetail && (
              <button
                onClick={handleCloseDetail}
                className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium"
                style={{
                  color: 'var(--text-secondary)',
                  background: 'var(--bg-muted)',
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-muted)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <ArrowLeft size={14} />
                返回
              </button>
            )}
            <form onSubmit={handleSearch} className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }}>
                <Search size={15} />
              </span>
              <input
                type="text"
                placeholder="搜索记忆..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-8 pr-7 py-2 text-sm"
                style={{
                  background: 'var(--bg-muted)',
                  border: '1px solid transparent',
                  borderRadius: 'var(--radius-md)',
                  color: 'var(--text-primary)',
                  transition: 'all var(--transition-fast)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.background = 'var(--bg-card)';
                  e.currentTarget.style.borderColor = 'var(--accent)';
                  e.currentTarget.style.boxShadow = '0 0 0 3px rgba(0,122,255,0.12)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.background = 'var(--bg-muted)';
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
              {isSearchMode && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  <Close size={14} />
                </button>
              )}
            </form>
          </div>

          <div
            className="shrink-0 flex items-center px-6"
            style={{
              width: 300,
              borderLeft: '0.5px solid var(--border)',
              height: '100%',
            }}
          >
            <div className="flex flex-col gap-1 w-full">
              <div className="flex items-center gap-2">
                <div
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    background: store.healthOk ? 'var(--success)' : 'var(--danger)',
                    boxShadow: store.healthOk
                      ? '0 0 6px rgba(52,199,89,0.5)'
                      : '0 0 6px rgba(255,59,48,0.5)',
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {store.healthOk ? '已连接' : '未连接'}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  KeyMemory Server
                </span>
              </div>
              {agents.length > 0 && (
                <div className="flex flex-col gap-0.5 mt-1">
                  {agents.map((agent) => (
                    <div key={agent.agentId} className="flex items-center gap-2">
                      <div
                        style={{
                          width: 5,
                          height: 5,
                          borderRadius: '50%',
                          background: 'var(--accent)',
                          boxShadow: '0 0 4px rgba(0,122,255,0.4)',
                        }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {agent.agentId}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto', opacity: 0.6 }}>
                        {agent.memoryCount} 条
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {agents.length === 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', opacity: 0.5, marginTop: 2 }}>
                  暂无 Agent 连接
                </span>
              )}
            </div>
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
                  <div className="px-8 py-6">
                    {isSearchMode && searchResults.length > 0 && (
                      <div className="mb-4 text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                        找到 {searchResults.length} 条结果
                      </div>
                    )}

                    {store.loading ? (
                      <div className="flex items-center justify-center h-48" style={{ color: 'var(--text-tertiary)' }}>
                        <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
                        加载中...
                      </div>
                    ) : isSearchMode && searchResults.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48" style={{ color: 'var(--text-tertiary)' }}>
                        <Search size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                        <span className="text-sm">未找到匹配的记忆</span>
                      </div>
                    ) : !isSearchMode && store.memories.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48" style={{ color: 'var(--text-tertiary)' }}>
                        <Heart size={32} style={{ marginBottom: 8, opacity: 0.4 }} />
                        <span className="text-sm">暂无记忆</span>
                      </div>
                    ) : (
                      <div className="grid gap-4">
                        {isSearchMode
                          ? searchResults.map((result) => (
                              <MemoryCard
                                key={result.memory.id}
                                memory={result.memory}
                                score={result.score}
                                matchType={result.matchType}
                                onClick={() => store.selectMemory(result.memory.id)}
                              />
                            ))
                          : store.memories.map((memory) => (
                              <MemoryCard
                                key={memory.id}
                                memory={memory}
                                onClick={() => store.selectMemory(memory.id)}
                              />
                            ))}
                        {!isSearchMode && store.hasMore && (
                          <div className="flex justify-center py-4">
                            <button
                              onClick={store.loadMore}
                              className="px-6 py-2 text-sm font-medium rounded-lg"
                              style={{
                                color: 'var(--accent)',
                                background: 'var(--bg-muted)',
                                border: '1px solid var(--border)',
                                transition: 'all var(--transition-fast)',
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-muted)'; }}
                            >
                              加载更多
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                className="w-[380px] shrink-0 overflow-y-auto px-6 py-6"
                style={{
                  background: 'rgba(255,255,255,0.5)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  borderLeft: '0.5px solid var(--border)',
                }}
              >
                <h3
                  className="text-xs font-semibold uppercase tracking-wider mb-5"
                  style={{ color: 'var(--text-tertiary)', letterSpacing: '0.08em', fontSize: 12 }}
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
            <div className="flex-1 overflow-y-auto px-8 py-6">
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

        <footer
          className="flex items-center justify-between px-8 py-2 shrink-0 text-xs"
          style={{
            background: 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
            borderTop: '0.5px solid var(--border)',
            color: 'var(--text-tertiary)',
          }}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <Heart size={11} style={{ color: store.healthOk ? 'var(--success)' : 'var(--danger)' }} />
              {healthReport?.score ?? '—'}
            </span>
            <span>{totalMemories} 条记忆</span>
          </div>
          <div className="flex items-center gap-3">
            {isSearchMode && (
              <button onClick={handleClearSearch} className="hover:underline" style={{ color: 'var(--accent)' }}>清除搜索</button>
            )}
            {store.selectedLayer && (
              <button onClick={() => handleLayerSelect(null)} className="hover:underline" style={{ color: 'var(--accent)' }}>清除筛选</button>
            )}
          </div>
        </footer>
      </div>

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        danger={confirm.danger}
        confirmLabel={confirm.danger ? '删除' : '确认'}
        onConfirm={() => {
          confirm.onConfirm();
          setConfirm((prev) => ({ ...prev, open: false }));
        }}
        onCancel={() => setConfirm((prev) => ({ ...prev, open: false }))}
      />
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
