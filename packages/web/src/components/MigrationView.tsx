import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import { LAYERS, type Layer } from '@keymemory/shared';
import {
  discoverMigrationSources,
  importDiscoveredMemories,
  importMemoryPath,
  previewMigrationSource,
} from '../lib/api';
import type { MigrationPreview, MigrationResult, MigrationSourceCandidate } from '../lib/api';
import { Inbox, Sparkles, CheckCircle, XCircle, FileSearch, RefreshCw, Folder } from './Icons';
import { useI18n } from '../i18n';

interface MigrationViewProps {
  onImported: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const inputStyle: CSSProperties = {
  width: '100%',
  background: 'var(--bg-primary)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  fontSize: 13,
  padding: '8px 10px',
};

const sectionStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  paddingTop: 18,
  marginTop: 22,
};

export default function MigrationView({ onImported, onToast }: MigrationViewProps) {
  const { t, layerLabel } = useI18n();
  const [manualPath, setManualPath] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [source, setSource] = useState('local-memory');
  const [format, setFormat] = useState<'auto' | 'json' | 'jsonl' | 'markdown' | 'text'>('auto');
  const [defaultLayer, setDefaultLayer] = useState<Layer>('long');
  const [defaultProjectPath, setDefaultProjectPath] = useState('');
  const [runDreamAfterImport, setRunDreamAfterImport] = useState(true);
  const [loading, setLoading] = useState<string | null>(null);
  const [sources, setSources] = useState<MigrationSourceCandidate[]>([]);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [preview, setPreview] = useState<MigrationPreview | null>(null);

  const commonOptions = {
    defaultLayer,
    defaultProjectPath: defaultProjectPath.trim() || undefined,
    runDream: runDreamAfterImport,
  };

  const writeOptions = (dryRun: boolean) => ({
    ...commonOptions,
    dryRun,
    createBackupBeforeImport: !dryRun,
  });

  const resultToast = (res: MigrationResult) => {
    if (res.dryRun) {
      onToast(`${t('common.preview')}: ${res.imported} ${t('migration.imported')}, ${res.skipped} ${t('migration.skipped')}`, res.failed > 0 ? 'info' : 'success');
      return;
    }
    onToast(`${t('migration.imported')} ${res.imported}, ${t('migration.skipped')} ${res.skipped}`, res.failed > 0 ? 'info' : 'success');
  };

  const scan = async () => {
    setLoading('scan');
    try {
      const found = await discoverMigrationSources(workspaceRoot.trim() || undefined);
      setSources(found);
      onToast(`${found.length} ${t('migration.source')}`, found.length > 0 ? 'success' : 'info');
    } catch (err) {
      onToast((err as Error).message || t('migration.errorScan'), 'error');
    } finally {
      setLoading(null);
    }
  };

  const importAll = async (dryRun = false) => {
    setLoading(dryRun ? 'all-preview' : 'all');
    setResult(null);
    try {
      const res = await importDiscoveredMemories({
        root: workspaceRoot.trim() || undefined,
        minConfidence: 0.65,
        ...writeOptions(dryRun),
      });
      setSources(res.sources);
      setResult(res);
      if (!res.dryRun) onImported();
      resultToast(res);
    } catch (err) {
      onToast((err as Error).message || t('migration.errorImport'), 'error');
    } finally {
      setLoading(null);
    }
  };

  // 只读逐条预览（AG3）：展示将迁移内容、跳过原因与重复候选，不写入任何数据。
  const previewCandidate = async (candidate: MigrationSourceCandidate) => {
    setLoading(`${candidate.id}:preview`);
    setPreview(null);
    try {
      const res = await previewMigrationSource(candidate.id);
      setPreview(res);
      if (!res.exists) {
        onToast(t('migration.previewMissing') || '来源路径不存在', 'error');
      }
    } catch (err) {
      onToast((err as Error).message || t('migration.errorPreview'), 'error');
    } finally {
      setLoading(null);
    }
  };

  const importCandidate = async (candidate: MigrationSourceCandidate) => {
    setLoading(candidate.id);
    setResult(null);
    try {
      const res = await importMemoryPath({
        path: candidate.path,
        source: candidate.source,
        format: candidate.format,
        recursive: candidate.kind === 'directory',
        ...writeOptions(false),
        defaultProjectPath: defaultProjectPath.trim() || candidate.defaultProjectPath,
      });
      setResult(res);
      if (!res.dryRun) onImported();
      resultToast(res);
    } catch (err) {
      onToast((err as Error).message || t('migration.errorImport'), 'error');
    } finally {
      setLoading(null);
    }
  };

  const previewManual = async () => {
    if (!manualPath.trim()) return;
    setLoading('manual-preview');
    setResult(null);
    try {
      const res = await importMemoryPath({
        path: manualPath.trim(),
        source: source.trim() || 'migration',
        format,
        recursive: true,
        ...writeOptions(true),
      });
      setResult(res);
      resultToast(res);
    } catch (err) {
      onToast((err as Error).message || t('migration.errorPreview'), 'error');
    } finally {
      setLoading(null);
    }
  };

  const submitManual = async (event: FormEvent) => {
    event.preventDefault();
    if (!manualPath.trim()) return;
    setLoading('manual');
    setResult(null);
    try {
      const res = await importMemoryPath({
        path: manualPath.trim(),
        source: source.trim() || 'migration',
        format,
        recursive: true,
        ...writeOptions(false),
      });
      setResult(res);
      onImported();
      resultToast(res);
    } catch (err) {
      onToast((err as Error).message || t('migration.errorImport'), 'error');
    } finally {
      setLoading(null);
    }
  };

  return (
    <main className="migration-view app-page" style={{ padding: 24 }}>
      <div style={{ maxWidth: 880 }}>
        <header className="page-header" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="km-icon-tile" style={{ width: 42, height: 42, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
            <Inbox size={22} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 750, color: 'var(--text-primary)' }}>{t('migration.title')}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.55 }}>{t('migration.subtitle')}</p>
          </div>
        </header>

        <section style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
            {t('migration.workspace')}
            <input
              value={workspaceRoot}
              onChange={(event) => setWorkspaceRoot(event.target.value)}
              placeholder={t('migration.workspacePlaceholder')}
              style={inputStyle}
            />
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={scan} disabled={loading !== null}>
              <FileSearch size={15} />
              {loading === 'scan' ? t('common.loading') : t('migration.scanSources')}
            </button>
            <button type="button" className="btn" onClick={() => importAll(true)} disabled={loading !== null}>
              {loading === 'all-preview' ? <Sparkles size={15} /> : <FileSearch size={15} />}
              {loading === 'all-preview' ? t('common.loading') : t('migration.previewAll')}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => importAll(false)} disabled={loading !== null}>
              {loading === 'all' ? <Sparkles size={15} /> : <RefreshCw size={15} />}
              {loading === 'all' ? t('common.loading') : t('migration.importAll')}
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>{t('migration.safety')}</p>

          {sources.length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
              {sources.map((candidate) => (
                <div
                  key={candidate.id}
                  className="migration-source-row"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                    gap: 12,
                    alignItems: 'center',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 12,
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 14, fontWeight: 650 }}>
                      {candidate.kind === 'directory' ? <Folder size={15} /> : <Inbox size={15} />}
                      <span>{candidate.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{candidate.fileCount ?? 0} {t('common.files')}</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>
                      {candidate.path}
                    </div>
                    {candidate.defaultProjectPath && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                        {t('migration.project')}: {candidate.defaultProjectPath}
                      </div>
                    )}
                  </div>
                  <button type="button" className="btn" onClick={() => previewCandidate(candidate)} disabled={loading !== null} style={{ minWidth: 88 }}>
                    {loading === `${candidate.id}:preview` ? <Sparkles size={14} /> : <FileSearch size={14} />}
                    {t('common.preview')}
                  </button>
                  <button type="button" className="btn" onClick={() => importCandidate(candidate)} disabled={loading !== null} style={{ minWidth: 88 }}>
                    {loading === candidate.id ? <Sparkles size={14} /> : <RefreshCw size={14} />}
                    {t('common.import')}
                  </button>
                </div>
              ))}
            </div>
          )}

          {preview && (
            <div style={{ display: 'grid', gap: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 14, background: 'var(--bg-secondary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ color: 'var(--text-primary)', fontSize: 13 }}>{t('migration.previewTitle') || '迁移预览（只读，不写入）'}</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {preview.importable} {t('migration.importable') || '可导入'} · {preview.skipped} {t('migration.skipped')} · {preview.duplicateCandidates} {t('migration.duplicates') || '疑似重复'}
                  {preview.truncated ? ' · …' : ''}
                </span>
              </div>
              {!preview.exists && <p style={{ color: 'var(--danger)', fontSize: 12, margin: 0 }}>{t('migration.previewMissing') || '来源路径不存在'}</p>}
              {preview.items.map((item) => (
                <div key={item.index} style={{ display: 'grid', gap: 4, borderTop: '1px solid var(--border)', paddingTop: 8, opacity: item.willSkip ? 0.65 : 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600 }}>
                    <span>#{item.index} {item.title}</span>
                    <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{item.layer}{item.projectPath ? ` · ${item.projectPath}` : ''} · {item.contentLength} {t('common.chars') || '字'}</span>
                  </div>
                  {item.contentSnippet && <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5 }}>{item.contentSnippet}</p>}
                  {item.willSkip && item.skipReason && <p style={{ margin: 0, color: 'var(--warning, #b58a2e)', fontSize: 11.5 }}>{item.skipReason}</p>}
                  {item.duplicates.length > 0 && (
                    <p style={{ margin: 0, color: 'var(--warning, #b58a2e)', fontSize: 11.5 }}>
                      {(t('migration.similarExisting') || '库中已有相似记忆')}: {item.duplicates.map(d => `${d.title} (${d.matchType})`).join('；')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <form onSubmit={submitManual} style={{ ...sectionStyle, display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
            {t('migration.manualPath')}
            <input
              value={manualPath}
              onChange={(event) => setManualPath(event.target.value)}
              placeholder="C:/Users/.../memory.json or /home/.../notes"
              style={inputStyle}
            />
          </label>

          <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              {t('migration.source')}
              <input value={source} onChange={(event) => setSource(event.target.value)} style={inputStyle} />
            </label>

            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              {t('migration.format')}
              <select value={format} onChange={(event) => setFormat(event.target.value as typeof format)} style={inputStyle}>
                <option value="auto">Auto</option>
                <option value="json">JSON</option>
                <option value="jsonl">JSONL / NDJSON</option>
                <option value="markdown">Markdown</option>
                <option value="text">Text</option>
              </select>
            </label>
          </div>

          <div className="form-grid-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              {t('migration.defaultLayer')}
              <select value={defaultLayer} onChange={(event) => setDefaultLayer(event.target.value as Layer)} style={inputStyle}>
                {LAYERS.map((layer) => (
                  <option key={layer} value={layer}>{layerLabel(layer)}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              {t('migration.defaultProject')}
              <input
                value={defaultProjectPath}
                onChange={(event) => setDefaultProjectPath(event.target.value)}
                placeholder="KeyMemory/Migration"
                style={inputStyle}
              />
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
            <input type="checkbox" checked={runDreamAfterImport} onChange={(event) => setRunDreamAfterImport(event.target.checked)} />
            {t('migration.runDream')}
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={previewManual} disabled={loading !== null || !manualPath.trim()} style={{ minWidth: 132 }}>
              {loading === 'manual-preview' ? <Sparkles size={15} /> : <FileSearch size={15} />}
              {loading === 'manual-preview' ? t('common.loading') : t('migration.previewPath')}
            </button>
            <button className="btn btn-primary" disabled={loading !== null || !manualPath.trim()} style={{ justifySelf: 'start', minWidth: 132 }}>
              {loading === 'manual' ? <Sparkles size={15} /> : <Inbox size={15} />}
              {loading === 'manual' ? t('common.loading') : t('migration.importPath')}
            </button>
          </div>
        </form>

        {result && (
          <section style={sectionStyle}>
            {result.dryRun && <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 0 }}>{t('migration.previewOnly')}</p>}
            {result.backup?.valid && (
              <p style={{ color: 'var(--success)', fontSize: 13, marginTop: 0 }}>
                {t('migration.backup', { path: result.backup.filePath || '' })}
              </p>
            )}
            <div className="metric-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <Metric label={t('common.files')} value={result.files} />
              <Metric label={t('migration.imported')} value={result.imported} good />
              <Metric label={t('migration.skipped')} value={result.skipped} />
              <Metric label={t('migration.failed')} value={result.failed} bad={result.failed > 0} />
            </div>

            {result.projectPaths.length > 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 14 }}>
                {t('migration.project')}: {result.projectPaths.join(', ')}
              </p>
            )}
            {result.dreamReportId && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                {t('migration.dreamReport')}: {result.dreamReportId.slice(0, 8)}
              </p>
            )}
            {result.errors.length > 0 && (
              <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                {result.errors.slice(0, 5).map((error, index) => (
                  <div key={index} style={{ color: 'var(--danger)', fontSize: 12 }}>
                    {error.item || `#${index + 1}`}: {error.error}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, good, bad }: { label: string; value: number; good?: boolean; bad?: boolean }) {
  const Icon = bad ? XCircle : CheckCircle;
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12, background: 'var(--bg-secondary)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: good ? 'var(--success)' : bad ? 'var(--danger)' : 'var(--text-muted)', fontSize: 12 }}>
        <Icon size={14} />
        {label}
      </div>
      <div style={{ color: 'var(--text-primary)', fontSize: 22, fontWeight: 700, marginTop: 6 }}>{value}</div>
    </div>
  );
}
