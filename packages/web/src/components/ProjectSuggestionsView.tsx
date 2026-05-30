import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ProjectSuggestion } from '@keymemory/shared';
import {
  acceptProjectSuggestion,
  listProjectSuggestions,
  rejectProjectSuggestion,
} from '../lib/api';
import { CheckCircle, FileSearch, GitMerge, RefreshCw, Sparkles, XCircle } from './Icons';

type ToastType = 'success' | 'error' | 'info';
type SuggestionStatus = ProjectSuggestion['status'];

interface ProjectSuggestionsViewProps {
  onChanged: () => void;
  onToast: (message: string, type?: ToastType) => void;
}

const statuses: Array<{ value: SuggestionStatus; label: string }> = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
];

const inputStyle: CSSProperties = {
  width: '100%',
  minWidth: 180,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 13,
  padding: '7px 9px',
};

export default function ProjectSuggestionsView({ onChanged, onToast }: ProjectSuggestionsViewProps) {
  const [status, setStatus] = useState<SuggestionStatus>('pending');
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});

  const load = async (nextStatus = status) => {
    setLoading(true);
    try {
      const rows = await listProjectSuggestions(nextStatus);
      setSuggestions(rows);
      setNames((prev) => {
        const next = { ...prev };
        for (const row of rows) {
          if (!next[row.id]) next[row.id] = row.suggestedParentName;
        }
        return next;
      });
    } catch (err) {
      setSuggestions([]);
      onToast((err as Error).message || 'Failed to load project suggestions', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const accept = async (suggestion: ProjectSuggestion) => {
    setBusyId(suggestion.id);
    try {
      const customName = (names[suggestion.id] || suggestion.suggestedParentName).trim();
      const result = await acceptProjectSuggestion(suggestion.id, customName || undefined);
      if (!result.success) throw new Error(result.error || 'Failed to accept suggestion');
      onToast('Project suggestion accepted', 'success');
      onChanged();
      await load(status);
    } catch (err) {
      onToast((err as Error).message || 'Failed to accept suggestion', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (suggestion: ProjectSuggestion) => {
    setBusyId(suggestion.id);
    try {
      await rejectProjectSuggestion(suggestion.id);
      onToast('Project suggestion rejected', 'success');
      onChanged();
      await load(status);
    } catch (err) {
      onToast((err as Error).message || 'Failed to reject suggestion', 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ maxWidth: 940 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <GitMerge size={22} style={{ color: 'var(--accent)' }} />
            <div>
              <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-primary)' }}>Project Organization</h2>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Review dream-created project clusters before changing the tree.
              </p>
            </div>
          </div>
          <button className="btn" onClick={() => load()} disabled={loading || busyId !== null}>
            {loading ? <Sparkles size={15} /> : <RefreshCw size={15} />}
            Refresh
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {statuses.map((item) => (
            <button
              key={item.value}
              className={`btn${status === item.value ? ' btn-primary' : ''}`}
              onClick={() => setStatus(item.value)}
              disabled={busyId !== null}
            >
              {status === item.value ? <CheckCircle size={14} /> : <FileSearch size={14} />}
              {item.label}
            </button>
          ))}
        </div>

        {loading && suggestions.length === 0 ? (
          <div className="empty-state">
            <Sparkles size={24} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Loading suggestions...</span>
          </div>
        ) : suggestions.length === 0 ? (
          <div
            className="empty-state"
            style={{
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 42,
            }}
          >
            <GitMerge size={24} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>No {status} suggestions</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Run a dream cycle after migration or long usage to surface project clusters.
            </span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {suggestions.map((suggestion) => {
              const isPending = suggestion.status === 'pending';
              const confidence = Math.round(suggestion.confidence * 100);
              return (
                <section
                  key={suggestion.id}
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-secondary)',
                    padding: 14,
                    display: 'grid',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontWeight: 650, fontSize: 15 }}>
                        <GitMerge size={16} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {suggestion.suggestedParentName}
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '6px 0 0', lineHeight: 1.55 }}>
                        {suggestion.reason}
                      </p>
                    </div>
                    <span
                      style={{
                        flexShrink: 0,
                        color: confidence >= 75 ? 'var(--success)' : 'var(--warning)',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {confidence}% confidence
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {suggestion.projectIds.map((projectId) => (
                      <code
                        key={projectId}
                        style={{
                          fontSize: 11,
                          color: 'var(--text-secondary)',
                          background: 'var(--bg-primary)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '2px 6px',
                        }}
                      >
                        {projectId.slice(0, 8)}
                      </code>
                    ))}
                  </div>

                  {isPending ? (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        value={names[suggestion.id] ?? suggestion.suggestedParentName}
                        onChange={(event) => setNames((prev) => ({ ...prev, [suggestion.id]: event.target.value }))}
                        placeholder="Parent project name"
                        style={{ ...inputStyle, flex: '1 1 240px' }}
                        disabled={busyId !== null}
                      />
                      <button className="btn btn-primary" onClick={() => accept(suggestion)} disabled={busyId !== null}>
                        {busyId === suggestion.id ? <Sparkles size={14} /> : <CheckCircle size={14} />}
                        Accept
                      </button>
                      <button className="btn" onClick={() => reject(suggestion)} disabled={busyId !== null}>
                        <XCircle size={14} />
                        Reject
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                      {suggestion.status === 'accepted' ? <CheckCircle size={14} /> : <XCircle size={14} />}
                      {suggestion.status}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
