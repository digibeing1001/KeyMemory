import { useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import type { Layer } from '@keymemory/shared';
import {
  discoverMigrationSources,
  importDiscoveredMemories,
  importMemoryPath,
} from '../lib/api';
import type { MigrationResult, MigrationSourceCandidate } from '../lib/api';
import { Inbox, Sparkles, CheckCircle, XCircle, FileSearch, RefreshCw, Folder } from './Icons';

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
  const [manualPath, setManualPath] = useState('');
  const [workspaceRoot, setWorkspaceRoot] = useState('');
  const [source, setSource] = useState('local-memory');
  const [format, setFormat] = useState<'auto' | 'json' | 'jsonl' | 'markdown' | 'text'>('auto');
  const [defaultLayer, setDefaultLayer] = useState<Layer>('long');
  const [defaultProjectPath, setDefaultProjectPath] = useState('');
  const [runDream, setRunDream] = useState(true);
  const [loading, setLoading] = useState<string | null>(null);
  const [sources, setSources] = useState<MigrationSourceCandidate[]>([]);
  const [result, setResult] = useState<MigrationResult | null>(null);

  const commonOptions = {
    defaultLayer,
    defaultProjectPath: defaultProjectPath.trim() || undefined,
    runDream,
  };

  const writeOptions = (dryRun: boolean) => ({
    ...commonOptions,
    dryRun,
    createBackupBeforeImport: !dryRun,
  });

  const scan = async () => {
    setLoading('scan');
    try {
      const found = await discoverMigrationSources(workspaceRoot.trim() || undefined);
      setSources(found);
      onToast(`发现 ${found.length} 个可迁移来源`, found.length > 0 ? 'success' : 'info');
    } catch (err) {
      onToast((err as Error).message || '扫描失败', 'error');
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
      if (res.dryRun) {
        onToast(`预览 ${res.imported} 条，跳过 ${res.skipped} 条`, res.failed > 0 ? 'info' : 'success');
        return;
      }
      onToast(`迁移 ${res.imported} 条，跳过 ${res.skipped} 条`, res.failed > 0 ? 'info' : 'success');
    } catch (err) {
      onToast((err as Error).message || '迁移失败', 'error');
    } finally {
      setLoading(null);
    }
  };

  const importCandidate = async (candidate: MigrationSourceCandidate, dryRun = false) => {
    setLoading(dryRun ? `${candidate.id}:preview` : candidate.id);
    setResult(null);
    try {
      const res = await importMemoryPath({
        path: candidate.path,
        source: candidate.source,
        format: candidate.format,
        recursive: candidate.kind === 'directory',
        ...writeOptions(dryRun),
        defaultProjectPath: defaultProjectPath.trim() || candidate.defaultProjectPath,
      });
      setResult(res);
      if (!res.dryRun) onImported();
      if (res.dryRun) {
        onToast(`预览 ${res.imported} 条，跳过 ${res.skipped} 条`, res.failed > 0 ? 'info' : 'success');
        return;
      }
      onToast(`迁移 ${res.imported} 条，跳过 ${res.skipped} 条`, res.failed > 0 ? 'info' : 'success');
    } catch (err) {
      onToast((err as Error).message || '迁移失败', 'error');
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
      onToast(`Preview ${res.imported} memories, skipped ${res.skipped}`, res.failed > 0 ? 'info' : 'success');
    } catch (err) {
      onToast((err as Error).message || 'Preview failed', 'error');
    } finally {
      setLoading(null);
    }
  };

  const submitManual = async (e: FormEvent) => {
    e.preventDefault();
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
      onToast(`迁移 ${res.imported} 条，跳过 ${res.skipped} 条`, res.failed > 0 ? 'info' : 'success');
    } catch (err) {
      onToast((err as Error).message || '迁移失败', 'error');
    } finally {
      setLoading(null);
    }
  };

  return (
    <main style={{ padding: 24, overflowY: 'auto', height: '100%' }}>
      <div style={{ maxWidth: 860 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Inbox size={22} style={{ color: 'var(--accent)' }} />
          <h2 style={{ margin: 0, fontSize: 20, color: 'var(--text-primary)' }}>迁移记忆</h2>
        </div>

        <section style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
            工作区根路径
            <input
              value={workspaceRoot}
              onChange={(e) => setWorkspaceRoot(e.target.value)}
              placeholder="留空则使用当前工作区"
              style={inputStyle}
            />
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="btn" onClick={scan} disabled={loading !== null}>
              <FileSearch size={15} />
              {loading === 'scan' ? '扫描中' : '扫描来源'}
            </button>
            <button className="btn" onClick={() => importAll(true)} disabled={loading !== null}>
              {loading === 'all-preview' ? <Sparkles size={15} /> : <FileSearch size={15} />}
              {loading === 'all-preview' ? 'Previewing' : 'Preview all'}
            </button>
            <button className="btn btn-primary" onClick={() => importAll(false)} disabled={loading !== null}>
              {loading === 'all' ? <Sparkles size={15} /> : <RefreshCw size={15} />}
              {loading === 'all' ? '迁移中' : '一键迁移'}
            </button>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: 0 }}>
            Write imports create a portable backup first. Preview writes nothing.
          </p>

          {sources.length > 0 && (
            <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
              {sources.map(candidate => (
                <div
                  key={candidate.id}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}>
                      {candidate.kind === 'directory' ? <Folder size={15} /> : <Inbox size={15} />}
                      <span>{candidate.name}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{candidate.fileCount ?? 0} files</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 4 }}>
                      {candidate.path}
                    </div>
                    {candidate.defaultProjectPath && (
                      <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                        Project: {candidate.defaultProjectPath}
                      </div>
                    )}
                  </div>
                  <button className="btn" onClick={() => importCandidate(candidate, true)} disabled={loading !== null} style={{ minWidth: 88 }}>
                    {loading === `${candidate.id}:preview` ? <Sparkles size={14} /> : <FileSearch size={14} />}
                    Preview
                  </button>
                  <button className="btn" onClick={() => importCandidate(candidate, false)} disabled={loading !== null} style={{ minWidth: 88 }}>
                    {loading === candidate.id ? <Sparkles size={14} /> : <RefreshCw size={14} />}
                    导入
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <form onSubmit={submitManual} style={{ ...sectionStyle, display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
            文件或目录路径
            <input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="C:/Users/.../memory.json 或 /home/.../notes"
              style={inputStyle}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              来源
              <input value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle} />
            </label>

            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              格式
              <select value={format} onChange={(e) => setFormat(e.target.value as typeof format)} style={inputStyle}>
                <option value="auto">自动识别</option>
                <option value="json">JSON</option>
                <option value="jsonl">JSONL / NDJSON</option>
                <option value="markdown">Markdown</option>
                <option value="text">文本</option>
              </select>
            </label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              默认层级
              <select value={defaultLayer} onChange={(e) => setDefaultLayer(e.target.value as Layer)} style={inputStyle}>
                <option value="long">长期</option>
                <option value="short">短期</option>
                <option value="flash">闪念</option>
                <option value="entity">人事物</option>
              </select>
            </label>

            <label style={{ display: 'grid', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
              默认项目路径
              <input
                value={defaultProjectPath}
                onChange={(e) => setDefaultProjectPath(e.target.value)}
                placeholder="KeyMemory/迁移"
                style={inputStyle}
              />
            </label>
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 13 }}>
            <input type="checkbox" checked={runDream} onChange={(e) => setRunDream(e.target.checked)} />
            导入后运行梦境整理
          </label>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button type="button" className="btn" onClick={previewManual} disabled={loading !== null || !manualPath.trim()} style={{ minWidth: 132 }}>
              {loading === 'manual-preview' ? <Sparkles size={15} /> : <FileSearch size={15} />}
              {loading === 'manual-preview' ? 'Previewing' : 'Preview path'}
            </button>
          <button className="btn btn-primary" disabled={loading !== null || !manualPath.trim()} style={{ justifySelf: 'start', minWidth: 132 }}>
            {loading === 'manual' ? <Sparkles size={15} /> : <Inbox size={15} />}
            {loading === 'manual' ? '迁移中' : '导入路径'}
          </button>
          </div>
        </form>

        {result && (
          <section style={sectionStyle}>
            {result.dryRun && (
              <p style={{ color: 'var(--accent)', fontSize: 13, marginTop: 0 }}>
                Preview only: no memories were written and dream consolidation was not run.
              </p>
            )}
            {result.backup?.valid && (
              <p style={{ color: 'var(--success)', fontSize: 13, marginTop: 0 }}>
                Safety backup created: {result.backup.filePath}
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <Metric label="文件" value={result.files} />
              <Metric label="导入" value={result.imported} good />
              <Metric label="跳过" value={result.skipped} />
              <Metric label="失败" value={result.failed} bad={result.failed > 0} />
            </div>

            {result.projectPaths.length > 0 && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 14 }}>
                项目：{result.projectPaths.join('、')}
              </p>
            )}
            {result.dreamReportId && (
              <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
                梦境报告：{result.dreamReportId.slice(0, 8)}
              </p>
            )}
            {result.errors.length > 0 && (
              <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
                {result.errors.slice(0, 5).map((err, idx) => (
                  <div key={idx} style={{ color: 'var(--danger)', fontSize: 12 }}>
                    {err.item || `#${idx + 1}`}: {err.error}
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
      <div style={{ color: 'var(--text-primary)', fontSize: 22, fontWeight: 600, marginTop: 6 }}>{value}</div>
    </div>
  );
}
