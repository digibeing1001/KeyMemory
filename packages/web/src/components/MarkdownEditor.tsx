import { useState, useEffect } from 'react';
import { LAYERS, LAYER_CONFIG } from '@keymemory/shared';
import type { Layer, Memory } from '@keymemory/shared';

interface MarkdownEditorProps {
  memory?: Memory | null;
  onSave: (data: { title: string; content: string; layer: Layer; projectId?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function MarkdownEditor({ memory, onSave, onCancel, loading }: MarkdownEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [layer, setLayer] = useState<Layer>('flash');
  const [projectId, setProjectId] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [source, setSource] = useState('');
  const [metadataInput, setMetadataInput] = useState('');

  useEffect(() => {
    if (memory) {
      setTitle(memory.title);
      setContent(memory.content);
      setLayer(memory.layer);
      setProjectId(memory.projectId || '');
      setTagsInput(memory.tags?.join(', ') || '');
      setSource(memory.source || '');
      setMetadataInput(memory.metadata ? JSON.stringify(memory.metadata, null, 2) : '');
    } else {
      setTitle('');
      setContent('');
      setLayer('flash');
      setProjectId('');
      setTagsInput('');
      setSource('');
      setMetadataInput('');
    }
  }, [memory?.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    const tags = tagsInput.trim() ? tagsInput.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    let metadata: Record<string, unknown> | undefined;
    if (metadataInput.trim()) {
      try {
        const parsed = JSON.parse(metadataInput);
        if (typeof parsed === 'object' && parsed !== null) {
          metadata = parsed;
        }
      } catch {}
    }
    onSave({
      title: title.trim(),
      content: content.trim(),
      layer,
      projectId: projectId.trim() || undefined,
      tags,
      source: source.trim() || undefined,
      metadata,
    });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 14px',
    fontSize: 14,
    color: 'var(--text-primary)',
    transition: 'all var(--transition-fast)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    letterSpacing: '0.02em',
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      <div style={{ padding: '24px 32px', maxWidth: 800, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入标题..."
            autoFocus
            style={{ ...inputStyle, fontSize: 17, fontWeight: 600, padding: '12px 16px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>层级</label>
            <select
              value={layer}
              onChange={(e) => setLayer(e.target.value as Layer)}
              style={inputStyle}
            >
              {LAYERS.map((l) => (
                <option key={l} value={l}>{LAYER_CONFIG[l].label}</option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>项目ID</label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="可选..."
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>标签</label>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="逗号分隔..."
              style={inputStyle}
            />
          </div>

          <div style={{ flex: 1 }}>
            <label style={labelStyle}>来源</label>
            <input
              type="text"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="可选..."
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>元数据 (JSON)</label>
          <input
            type="text"
            value={metadataInput}
            onChange={(e) => setMetadataInput(e.target.value)}
            placeholder='{"key": "value"}'
            style={{ ...inputStyle, fontSize: 13, fontFamily: 'var(--font-mono)' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, padding: '0 32px', maxWidth: 800, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column' }}>
        <label style={labelStyle}>内容</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="支持 Markdown 格式..."
          style={{
            ...inputStyle,
            flex: 1,
            resize: 'none',
            fontSize: 14,
            lineHeight: 1.7,
            padding: '14px 16px',
            fontFamily: 'var(--font-mono)',
          }}
        />
      </div>

      <div
        className="shrink-0 flex items-center justify-end gap-3"
        style={{ padding: '16px 32px', borderTop: '0.5px solid var(--border)', maxWidth: 800, margin: '0 auto', width: '100%' }}
      >
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-5 py-2.5 text-sm font-medium"
          style={{
            color: 'var(--text-secondary)',
            transition: 'all var(--transition-fast)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-muted)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          取消
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !content.trim() || loading}
          className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-semibold text-white"
          style={{
            background: 'var(--accent)',
            transition: 'all var(--transition-fast)',
            opacity: (!title.trim() || !content.trim() || loading) ? 0.4 : 1,
          }}
          onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = 'var(--accent-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--accent)'; }}
        >
          {loading && (
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {memory ? '保存' : '创建'}
        </button>
      </div>
    </form>
  );
}
