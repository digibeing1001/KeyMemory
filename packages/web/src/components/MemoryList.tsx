import type { Memory } from '@keymemory/shared';
import MemoryCard from './MemoryCard';

interface MemoryListProps {
  memories: Memory[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading?: boolean;
  searchQuery?: string | null;
}

export default function MemoryList({ memories, selectedId, onSelect, loading, searchQuery }: MemoryListProps) {
  const sorted = [...memories].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-card)' }}>
      <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: 'var(--border)' }}>
        <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
          {searchQuery ? `搜索「${searchQuery}」· ` : ''}
          {sorted.length} 条记忆
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <svg className="h-5 w-5 animate-spin" style={{ color: 'var(--text-tertiary)' }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>加载中...</p>
            </div>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="font-serif text-2xl" style={{ color: 'var(--text-tertiary)' }}>
                {searchQuery ? '∅' : '◇'}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {searchQuery ? `未找到「${searchQuery}」相关记忆` : '暂无记忆'}
              </p>
              {!searchQuery && (
                <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                  点击「新建」创建第一条记忆
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {sorted.map((m) => (
              <MemoryCard
                key={m.id}
                memory={m}
                isSelected={m.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
