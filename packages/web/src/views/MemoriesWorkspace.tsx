/**
 * KM-401：从 App.tsx 拆出的记忆主工作区（列表/搜索/详情/时间轴）。
 */
import type { Layer, Memory, SearchResult } from '@keymemory/shared';
import { Search } from '../components/Icons';
import LayerCards from '../components/LayerCards';
import MemoryCard from '../components/MemoryCard';
import MemoryDetailPanel from '../components/MemoryDetailPanel';
import Timeline from '../components/Timeline';
import Editor from './Editor';
import type { useMemoryStore } from '../hooks/useMemoryStore';

interface MemoriesWorkspaceProps {
  store: ReturnType<typeof useMemoryStore>;
  isSearchMode: boolean;
  searchResults: SearchResult[];
  visibleItems: Memory[];
  language: string;
  t: (key: string) => string;
  onSave: (data: { title: string; content: string; layer: Layer; projectId?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onMoveLayer: (id: string, layer: Layer) => void;
  onLayerSelect: (layer: Layer | null) => void;
}

export default function MemoriesWorkspace({
  store,
  isSearchMode,
  searchResults,
  visibleItems,
  language,
  t,
  onSave,
  onDelete,
  onArchive,
  onMoveLayer,
  onLayerSelect,
}: MemoriesWorkspaceProps) {
  return (
    <>
      <div className="memory-list-shell flex-1 overflow-y-auto">
        {store.isCreating ? (
          <Editor
            memory={null}
            isCreating={store.isCreating}
            loading={store.loading}
            onSave={onSave}
            onDelete={onDelete}
            onArchive={onArchive}
            onMoveLayer={onMoveLayer}
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
                onSelectLayer={onLayerSelect}
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
            onSave={onSave}
            onDelete={onDelete}
            onArchive={onArchive}
            onMoveLayer={onMoveLayer}
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
  );
}
