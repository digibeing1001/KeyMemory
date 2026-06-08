import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ProjectSuggestion } from '@keymemory/shared';
import {
  acceptProjectSuggestion,
  listProjectSuggestions,
  rejectProjectSuggestion,
} from '../lib/api';
import { CheckCircle, FileSearch, GitMerge, RefreshCw, Sparkles, XCircle } from './Icons';
import { useI18n } from '../i18n';

type ToastType = 'success' | 'error' | 'info';
type SuggestionStatus = ProjectSuggestion['status'];

interface ProjectSuggestionsViewProps {
  onChanged: () => void;
  onToast: (message: string, type?: ToastType) => void;
}

const inputStyle: CSSProperties = {
  width: '100%',
  minWidth: 200,
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 13,
  padding: '8px 10px',
};

export default function ProjectSuggestionsView({ onChanged, onToast }: ProjectSuggestionsViewProps) {
  const { t } = useI18n();
  const statuses: Array<{ value: SuggestionStatus; label: string }> = [
    { value: 'pending', label: t('organize.pending') },
    { value: 'accepted', label: t('organize.accepted') },
    { value: 'rejected', label: t('organize.rejected') },
  ];
  const [status, setStatus] = useState<SuggestionStatus>('pending');
  const [suggestions, setSuggestions] = useState<ProjectSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [showIds, setShowIds] = useState<Record<string, boolean>>({});

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
      onToast((err as Error).message || t('organize.errorLoad'), 'error');
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
      if (!result.success) throw new Error(result.error || t('organize.errorAccept'));
      onToast(t('organize.acceptedToast'), 'success');
      onChanged();
      await load(status);
    } catch (err) {
      onToast((err as Error).message || t('organize.errorAccept'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (suggestion: ProjectSuggestion) => {
    setBusyId(suggestion.id);
    try {
      await rejectProjectSuggestion(suggestion.id);
      onToast(t('organize.rejectedToast'), 'success');
      onChanged();
      await load(status);
    } catch (err) {
      onToast((err as Error).message || t('organize.errorReject'), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const activeStatusLabel = statuses.find((item) => item.value === status)?.label ?? status;

  return (
    <main className="project-suggestions-view app-page" style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ maxWidth: 940 }}>
        <header className="page-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="km-icon-tile" style={{ width: 42, height: 42, borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
              <GitMerge size={21} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 750, color: 'var(--text-primary)' }}>{t('organize.title')}</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                {t('organize.subtitle')}
              </p>
            </div>
          </div>
          <button type="button" className="btn" onClick={() => load()} disabled={loading || busyId !== null}>
            {loading ? <Sparkles size={15} /> : <RefreshCw size={15} />}
            {t('common.refresh')}
          </button>
        </header>

        <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
          {statuses.map((item) => (
            <button
              type="button"
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
            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('common.loading')}</span>
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
            <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 650 }}>
              {t('organize.noSuggestions', { status: activeStatusLabel })}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('organize.emptyHint')}
            </span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {suggestions.map((suggestion) => {
              const isPending = suggestion.status === 'pending';
              const confidence = Math.round(suggestion.confidence * 100);
              const isLowConfidence = confidence < 60;
              return (
                <section
                  key={suggestion.id}
                  className="project-suggestion-card"
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--bg-secondary)',
                    padding: 16,
                    display: 'grid',
                    gap: 12,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontWeight: 700, fontSize: 16 }}>
                        <GitMerge size={17} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {suggestion.suggestedParentName}
                        </span>
                      </div>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '7px 0 0', lineHeight: 1.6 }}>
                        {suggestion.reason}
                      </p>
                    </div>
                    <div style={{ display: 'grid', justifyItems: 'end', gap: 4, flexShrink: 0 }}>
                      <span style={{ color: isLowConfidence ? 'var(--warning)' : 'var(--success)', fontSize: 12, fontWeight: 750 }}>
                        {t('organize.confidence', { value: confidence })}
                      </span>
                      {isLowConfidence && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('organize.lowConfidence')}</span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('organize.projectCount', { count: suggestion.projectIds.length })}
                    </span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setShowIds((prev) => ({ ...prev, [suggestion.id]: !prev[suggestion.id] }))}
                      style={{ padding: '4px 8px', fontSize: 12 }}
                    >
                      {showIds[suggestion.id] ? t('common.close') : t('organize.ids')}
                    </button>
                  </div>

                  {showIds[suggestion.id] && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {suggestion.projectIds.map((projectId) => (
                        <code key={projectId} style={{ fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '2px 6px' }}>
                          {projectId}
                        </code>
                      ))}
                    </div>
                  )}

                  {isPending ? (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input
                        aria-label={t('organize.parentName')}
                        value={names[suggestion.id] ?? suggestion.suggestedParentName}
                        onChange={(event) => setNames((prev) => ({ ...prev, [suggestion.id]: event.target.value }))}
                        placeholder={t('organize.parentName')}
                        style={{ ...inputStyle, flex: '1 1 240px' }}
                        disabled={busyId !== null}
                      />
                      <button type="button" className="btn btn-primary" onClick={() => accept(suggestion)} disabled={busyId !== null}>
                        {busyId === suggestion.id ? <Sparkles size={14} /> : <CheckCircle size={14} />}
                        {t('organize.accept')}
                      </button>
                      <button type="button" className="btn" onClick={() => reject(suggestion)} disabled={busyId !== null}>
                        <XCircle size={14} />
                        {t('organize.reject')}
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                      {suggestion.status === 'accepted' ? <CheckCircle size={14} /> : <XCircle size={14} />}
                      {statuses.find((item) => item.value === suggestion.status)?.label ?? suggestion.status}
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
