import { useState, useRef, useCallback } from 'react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  onClear: () => void;
}

export default function SearchBar({ onSearch, onClear }: SearchBarProps) {
  const [value, setValue] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const debouncedSearch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSearch(query);
      }, 300);
    },
    [onSearch],
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim()) {
      onSearch(value.trim());
    } else {
      onClear();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setValue(v);
    if (v.trim()) {
      debouncedSearch(v.trim());
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onClear();
    }
  };

  const handleClear = () => {
    setValue('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    onClear();
  };

  return (
    <form onSubmit={handleSubmit} className="relative flex items-center">
      <svg className="pointer-events-none absolute left-2.5 h-3.5 w-3.5" style={{ color: 'var(--text-tertiary)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder="搜索记忆..."
        className="h-7 w-56 rounded-md border pl-8 pr-7 text-xs transition-colors focus:outline-none"
        style={{
          borderColor: 'var(--border)',
          background: 'var(--bg-warm)',
          color: 'var(--text-primary)',
        }}
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="absolute right-2 flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:opacity-70"
          style={{ color: 'var(--text-tertiary)' }}
        >
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </form>
  );
}
