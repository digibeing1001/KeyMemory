import { useState, useEffect } from 'react';
import { LAYERS } from '@keymemory/shared';
import type { Layer, Memory } from '@keymemory/shared';
import { useI18n } from '../i18n';

interface MarkdownEditorProps {
  memory?: Memory | null;
  onSave: (data: { title: string; content: string; layer: Layer; projectId?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function MarkdownEditor({ memory, onSave, onCancel, loading }: MarkdownEditorProps) {
  const { t, layerLabel, layerHelp } = useI18n();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [layer, setLayer] = useState<Layer>('flash');
  const [projectId, setProjectId] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [source, setSource] = useState('');
  const [metadataInput, setMetadataInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (memory) {
      setTitle(memory.title);
      setContent(memory.content);
      setLayer(memory.layer);
      setProjectId(memory.projectId || '');
      setTagsInput(memory.tags?.join(', ') || '');
      setSource(memory.source || '');
      setMetadataInput(memory.metadata ? JSON.stringify(memory.metadata, null, 2) : '');
      setShowAdvanced(false);
      return;
    }

    setTitle('');
    setContent('');
    setLayer('flash');
    setProjectId('');
    setTagsInput('');
    setSource('');
    setMetadataInput('');
    setShowAdvanced(false);
  }, [memory?.id, memory]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    const tags = tagsInput.trim() ? tagsInput.split(',').map((tag) => tag.trim()).filter(Boolean) : undefined;
    let metadata: Record<string, unknown> | undefined;
    if (metadataInput.trim()) {
      try {
        const parsed = JSON.parse(metadataInput);
        if (typeof parsed === 'object' && parsed !== null) metadata = parsed;
      } catch {
        // Invalid metadata should not block a normal memory save.
      }
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
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--text-primary)',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 650,
    color: 'var(--text-secondary)',
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      <div style={{ padding: '22px 28px', width: '100%' }}>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>{t('editor.title')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('editor.titlePlaceholder')}
            autoFocus
            style={{ ...inputStyle, fontSize: 16, fontWeight: 650 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, marginBottom: 18 }}>
          <label style={{ display: 'block' }}>
            <span style={labelStyle}>{t('editor.layer')}</span>
            <select value={layer} onChange={(e) => setLayer(e.target.value as Layer)} style={inputStyle}>
              {LAYERS.map((item) => (
                <option key={item} value={item}>
                  {layerLabel(item)} - {layerHelp(item)}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'block' }}>
            <span style={labelStyle}>{t('editor.projectId')}</span>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder={t('editor.optional')}
              style={inputStyle}
            />
          </label>
        </div>

        <div style={{ marginBottom: 18 }}>
          <label style={{ display: 'block' }}>
            <span style={labelStyle}>{t('editor.tags')}</span>
            <input
              type="text"
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder={t('editor.tagsPlaceholder')}
              style={inputStyle}
            />
          </label>
        </div>

        <div className="editor-advanced-fields" style={{ marginBottom: 18, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', overflow: 'hidden' }}>
          <button
            type="button"
            onClick={() => setShowAdvanced((value) => !value)}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              fontSize: 13,
              fontWeight: 650,
            }}
          >
            <span>{t('editor.advancedFields')}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
              {showAdvanced ? t('common.collapse') : t('common.expand')}
            </span>
          </button>
          {!showAdvanced && (
            <p style={{ margin: 0, padding: '0 14px 12px', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              {t('editor.advancedHint')}
            </p>
          )}
          {showAdvanced && (
            <div style={{ padding: '0 14px 14px', display: 'grid', gap: 14 }}>
              <label style={{ display: 'block' }}>
                <span style={labelStyle}>{t('common.source')}</span>
                <input
                  type="text"
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t('editor.optional')}
                  style={inputStyle}
                />
              </label>

              <label style={{ display: 'block' }}>
                <span style={labelStyle}>{t('editor.metadata')}</span>
                <input
                  type="text"
                  value={metadataInput}
                  onChange={(e) => setMetadataInput(e.target.value)}
                  placeholder='{"key": "value"}'
                  style={{ ...inputStyle, fontSize: 13, fontFamily: 'var(--font-mono)' }}
                />
              </label>
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 260, padding: '0 28px 22px', display: 'flex', flexDirection: 'column' }}>
        <label style={labelStyle}>{t('editor.content')}</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={t('editor.contentPlaceholder')}
          style={{
            ...inputStyle,
            flex: 1,
            resize: 'none',
            lineHeight: 1.7,
            fontFamily: 'var(--font-mono)',
          }}
        />
      </div>

      <div
        className="shrink-0 flex items-center justify-end gap-3"
        style={{ padding: '14px 28px', borderTop: '1px solid var(--border)' }}
      >
        <button type="button" onClick={onCancel} className="btn">
          {t('common.cancel')}
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !content.trim() || loading}
          className="btn btn-primary"
          style={{ opacity: (!title.trim() || !content.trim() || loading) ? 0.45 : 1 }}
        >
          {loading && <span className="animate-spin" style={{ width: 12, height: 12, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />}
          {memory ? t('common.save') : t('editor.create')}
        </button>
      </div>
    </form>
  );
}
