/**
 * KM-401：从 App.tsx 拆出的顶部栏（搜索/邮箱标题/指南入口/连接状态）。
 */
import type { FormEvent } from 'react';
import { Menu, Search, Close, Inbox, BookOpen } from './Icons';

interface AppHeaderProps {
  viewMode: string;
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  isSearchMode: boolean;
  searchResultCount: number;
  onSearch: (event: FormEvent) => void;
  onClearSearch: () => void;
  onOpenSidebar: () => void;
  onOpenGuide: () => void;
  healthOk: boolean;
  language: string;
  t: (key: string) => string;
}

export default function AppHeader({
  viewMode,
  searchInput,
  onSearchInputChange,
  isSearchMode,
  searchResultCount,
  onSearch,
  onClearSearch,
  onOpenSidebar,
  onOpenGuide,
  healthOk,
  language,
  t,
}: AppHeaderProps) {
  return (
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
        onClick={onOpenSidebar}
        aria-label={t('common.expand')}
      >
        <Menu size={17} />
      </button>
      <div className="flex items-center gap-4 flex-1" style={{ minWidth: 0 }}>
        {viewMode !== 'mailbox' && <form onSubmit={onSearch} className="app-search-form relative flex-1" style={{ maxWidth: 520 }}>
          <Search size={15} style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder={t('app.searchPlaceholder')}
            value={searchInput}
            onChange={(event) => onSearchInputChange(event.target.value)}
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
              onClick={onClearSearch}
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
            {searchResultCount} {t('app.searchResults')}
          </span>
        )}
      </div>

      <div className="app-header-status flex items-center gap-2" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        <button type="button" className="app-guide-button" onClick={onOpenGuide}>
          <BookOpen size={14} />
          {language === 'zh' ? '使用说明' : 'Guide'}
        </button>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: healthOk ? 'var(--success)' : 'var(--danger)' }} />
        {healthOk ? t('app.connected') : t('app.disconnected')}
      </div>
    </header>
  );
}
