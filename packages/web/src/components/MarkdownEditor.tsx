import { useState, useEffect } from 'react';
import { LAYERS, LAYER_CONFIG } from '@keymemory/shared';
import type { Layer, Memory } from '@keymemory/shared';

interface MarkdownEditorProps {
  memory?: Memory | null;
  onSave: (data: { title: string; content: string; layer: Layer; project?: string }) => void;
  onCancel: () => void;
  loading?: boolean;
}

export default function MarkdownEditor({ memory, onSave, onCancel, loading }: MarkdownEditorProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [layer, setLayer] = useState<Layer>('flash');
  const [project, setProject] = useState('');

  useEffect(() => {
    if (memory) {
      setTitle(memory.title);
      setContent(memory.content);
      setLayer(memory.layer);
      setProject(memory.project || '');
    } else {
      setTitle('');
      setContent('');
      setLayer('flash');
      setProject('');
    }
  }, [memory?.id]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    onSave({
      title: title.trim(),
      content: content.trim(),
      layer,
      project: project.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex h-full flex-col">
      <div className="space-y-3 p-4">
        <div>
          <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>标题</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="输入标题..."
            autoFocus
            className="w-full rounded-md border px-3 py-1.5 text-sm transition-colors focus:outline-none"
            style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>层级</label>
            <select
              value={layer}
              onChange={(e) => setLayer(e.target.value as Layer)}
              className="w-full rounded-md border px-3 py-1.5 text-sm transition-colors focus:outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            >
              {LAYERS.map((l) => (
                <option key={l} value={l}>{LAYER_CONFIG[l].label}</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>项目</label>
            <input
              type="text"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="可选..."
              className="w-full rounded-md border px-3 py-1.5 text-sm transition-colors focus:outline-none"
              style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 px-4">
        <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>内容</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="支持 Markdown 格式..."
          className="h-[calc(100%-24px)] w-full resize-none rounded-md border px-3 py-2 font-mono text-xs leading-relaxed transition-colors focus:outline-none"
          style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ color: 'var(--text-secondary)' }}
        >
          取消
        </button>
        <button
          type="submit"
          disabled={!title.trim() || !content.trim() || loading}
          className="flex items-center gap-1.5 rounded-md px-4 py-1.5 text-xs font-semibold text-white transition-all hover:opacity-90 disabled:opacity-40"
          style={{ background: 'var(--accent)' }}
        >
          {loading && (
            <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24">
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
