import type { ReactNode } from 'react';
import SearchBar from './SearchBar';

interface LayoutProps {
  children: ReactNode;
  onSearch: (query: string) => void;
  onClearSearch: () => void;
  onCreateNew: () => void;
  healthOk: boolean;
  loading?: boolean;
}

export default function Layout({ children, onSearch, onClearSearch, onCreateNew, healthOk, loading }: LayoutProps) {
  return (
    <div className="flex h-screen flex-col" style={{ background: 'var(--bg-warm)' }}>
      <header className="flex h-11 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
        <div className="flex items-center gap-3">
          <span className="font-serif text-xl tracking-tight" style={{ color: 'var(--text-primary)' }}>
            KeyMemory
          </span>
          {loading && (
            <div className="animate-pulse-soft h-1.5 w-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          )}
        </div>

        <div className="flex items-center gap-3">
          <SearchBar onSearch={onSearch} onClear={onClearSearch} />

          <button
            onClick={onCreateNew}
            className="flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-all hover:opacity-90"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            新建
          </button>

          <div className="flex items-center gap-1.5">
            <div
              className={`h-1.5 w-1.5 rounded-full ${healthOk ? 'animate-pulse-soft' : ''}`}
              style={{ background: healthOk ? 'var(--success)' : 'var(--danger)' }}
            />
            <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
              {healthOk ? '正常' : '异常'}
            </span>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">{children}</div>
    </div>
  );
}
