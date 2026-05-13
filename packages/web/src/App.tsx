import { useState, useCallback, useEffect } from 'react';
import type { Layer, SearchResult, HealthReport } from '@keymemory/shared';
import { useMemoryStore } from './hooks/useMemoryStore';
import { ToastProvider, useToast } from './components/Toast';
import { Search, Plus, Close, Heart } from './components/Icons';
import Sidebar from './components/Sidebar';
import LayerCards from './components/LayerCards';
import Timeline from './components/Timeline';
import MemoryCard from './components/MemoryCard';
import Editor from './views/Editor';
import ConfirmDialog from './components/ConfirmDialog';
import { getHealth } from './lib/api';

function AppInner() {
  const store = useMemoryStore();
  const { toast } = useToast();
  const [searchInput, setSearchInput] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [healthReport, setHealthReport] = useState<HealthReport | null>(null);
  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: string;
    danger: boolean;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', danger: false, onConfirm: () => {} });

  useEffect(() => {
    getHealth()
      .then((res) => setHealthReport(res))
      .catch(() => {});
  }, []);

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
        const sp = new URLSearchParams();
        sp.set('q', q);
        if (store.selectedLayer) sp.set('layer', store.selectedLayer);
        const res = await fetch(`/api/memories/search?${sp.toString()}`, {
          headers: { 'Content-Type': 'application/json' },
        });
        if (res.ok) {
          const results: SearchResult[] = await res.json();
          setSearchResults(results);
        } else {
          setSearchResults([]);
        }
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
      store.selectLayer(layer);
    },
    [store.selectLayer],
  );

  const handleSave = useCallback(
    async (data: { title: string; content: string; layer: Layer; project?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => {
      try {
        await store.save(data);
        toast(store.selectedMemory ? '记忆已更新' : '记忆已创建', 'success');
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
      } catch {
        toast('移动失败，请重试', 'error');
      }
    },
    [store, toast],
  );

  const totalMemories = Object.values(store.layerStats).reduce((sum, s) => sum + s.count, 0);
  const showDetailPanel = store.selectedId !== null || store.isCreating;

  return (
    <div className="flex h-screen" style={{ background: 'var(--bg-main)' }}>
      <Sidebar
        layerStats={store.layerStats}
        activeLayer={store.selectedLayer}
        onSelectLayer={handleLayerSelect}
        onCreateNew={store.createNew}
        totalMemories={totalMemories}
        healthScore={healthReport?.score ?? null}
      />

      <div className="flex flex-col flex-1" style={{ marginLeft: 220 }}>
        <header
          className="flex items-center gap-4 px-5 shrink-0"
          style={{ height: 52, background: 'var(--bg-card)', borderBottom: '1px solid var(--border)' }}
        >
          <form onSubmit={handleSearch} className="relative flex-1 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }}>
              <Search size={15} />
            </span>
            <input
              type="text"
              placeholder="搜索记忆..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-8 pr-7 py-1.5 text-sm outline-none"
              style={{
                background: 'var(--bg-main)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
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

          <button
            onClick={store.createNew}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium"
            style={{
              background: 'var(--accent)',
              color: '#fff',
              borderRadius: 'var(--radius-md)',
              transition: 'background var(--transition-fast)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
          >
            <Plus size={14} />
            新建
          </button>
        </header>

        <div
          className="shrink-0 px-5 flex items-center"
          style={{ height: 56, borderBottom: '1px solid var(--border)' }}
        >
          <LayerCards
            layerStats={store.layerStats}
            activeLayer={store.selectedLayer}
            onSelectLayer={handleLayerSelect}
          />
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5">
            {isSearchMode && searchResults.length > 0 && (
              <div className="mb-3 text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>
                找到 {searchResults.length} 条结果
              </div>
            )}

            {store.loading ? (
              <div className="flex items-center justify-center h-40" style={{ color: 'var(--text-tertiary)' }}>
                <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
                加载中...
              </div>
            ) : isSearchMode && searchResults.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                未找到匹配的记忆
              </div>
            ) : !isSearchMode && store.memories.length === 0 ? (
              <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--text-tertiary)' }}>
                暂无记忆
              </div>
            ) : (
              <div className="grid gap-2">
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
              </div>
            )}
          </div>

          <div
            className="w-[260px] shrink-0 overflow-y-auto p-5"
            style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border)' }}
          >
            <h3
              className="text-[11px] font-semibold uppercase tracking-wider mb-3"
              style={{ color: 'var(--text-tertiary)' }}
            >
              时间线
            </h3>
            <Timeline memories={store.memories} />
          </div>
        </div>

        {showDetailPanel && (
          <div className="detail-panel">
            <div className="panel-header">
              <h3 className="font-serif" style={{ fontSize: 15 }}>{store.isCreating ? '新建记忆' : store.selectedMemory?.title ?? '详情'}</h3>
              <button
                onClick={() => {
                  store.cancelCreate();
                  if (store.selectedId) store.selectMemory(store.selectedId);
                }}
                className="rounded p-1"
                style={{ color: 'var(--text-tertiary)', transition: 'color var(--transition-fast)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              >
                <Close size={16} />
              </button>
            </div>
            <div className="panel-body">
              <Editor
                memory={store.selectedMemory}
                isCreating={store.isCreating}
                loading={store.loading}
                onSave={handleSave}
                onDelete={handleDelete}
                onArchive={handleArchive}
                onMoveLayer={handleMoveLayer}
                onCancelCreate={store.cancelCreate}
              />
            </div>
          </div>
        )}

        <footer
          className="flex items-center justify-between px-5 py-1.5 shrink-0 text-[11px]"
          style={{ background: 'var(--bg-card)', borderTop: '1px solid var(--border)', color: 'var(--text-tertiary)' }}
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
              <button onClick={handleClearSearch} className="hover:underline">清除搜索</button>
            )}
            {store.selectedLayer && (
              <button onClick={() => handleLayerSelect(null)} className="hover:underline">清除筛选</button>
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
