import { useState, useEffect } from 'react';
import { LAYERS, LAYER_CONFIG } from '@keymemory/shared';
import type { Memory, Layer } from '@keymemory/shared';
import MarkdownEditor from '../components/MarkdownEditor';

interface EditorProps {
  memory: Memory | null;
  isCreating: boolean;
  loading?: boolean;
  onSave: (data: { title: string; content: string; layer: Layer; project?: string }) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onMoveLayer: (id: string, layer: Layer) => void;
  onCancelCreate: () => void;
}

const LAYER_COLORS: Record<Layer, string> = {
  flash: 'var(--layer-flash)',
  short: 'var(--layer-short)',
  long: 'var(--layer-long)',
  project: 'var(--layer-project)',
  entity: 'var(--layer-entity)',
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Editor({
  memory,
  isCreating,
  loading,
  onSave,
  onDelete,
  onArchive,
  onMoveLayer,
  onCancelCreate,
}: EditorProps) {
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    setIsEditing(false);
  }, [memory?.id, isCreating]);

  if (isCreating) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--bg-card)' }}>
        <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-serif text-sm" style={{ color: 'var(--text-primary)' }}>新建记忆</h2>
        </div>
        <MarkdownEditor onSave={onSave} onCancel={onCancelCreate} loading={loading} />
      </div>
    );
  }

  if (!memory) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: 'var(--bg-card)' }}>
        <div className="text-center">
          <p className="font-serif text-3xl" style={{ color: 'var(--border)' }}>◇</p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>选择一条记忆查看详情</p>
          <p className="mt-0.5 text-[10px]" style={{ color: 'var(--text-tertiary)' }}>或点击「新建」创建</p>
        </div>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="flex h-full flex-col" style={{ background: 'var(--bg-card)' }}>
        <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-serif text-sm" style={{ color: 'var(--text-primary)' }}>编辑记忆</h2>
        </div>
        <MarkdownEditor
          memory={memory}
          onSave={(data) => {
            onSave(data);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
          loading={loading}
        />
      </div>
    );
  }

  const config = LAYER_CONFIG[memory.layer];
  const layerColor = LAYER_COLORS[memory.layer];

  return (
    <div className="flex h-full flex-col" style={{ background: 'var(--bg-card)' }}>
      <div className="border-b px-4 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-sm line-clamp-1" style={{ color: 'var(--text-primary)' }}>{memory.title}</h2>
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => setIsEditing(true)}
              className="rounded p-1 transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              title="编辑"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={() => onArchive(memory.id)}
              className="rounded p-1 transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
              title="归档"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(memory.id)}
              className="rounded p-1 transition-colors"
              style={{ color: 'var(--danger)' }}
              title="删除"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span
            className="rounded px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: `${layerColor}15`, color: layerColor }}
          >
            {config.label}
          </span>
          {memory.project && (
            <span className="rounded px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--layer-project)' }}>
              {memory.project}
            </span>
          )}
          <span className="rounded px-2 py-0.5 text-[10px]" style={{ background: 'var(--bg-sidebar)', color: 'var(--text-tertiary)' }}>
            {Math.round(memory.confidence * 100)}%
          </span>
        </div>

        <div className="mb-3 text-[10px] leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>
          <div>创建 {formatDate(memory.createdAt)}</div>
          <div>更新 {formatDate(memory.updatedAt)}</div>
          <div>访问 {memory.hitCount} 次</div>
        </div>

        <pre className="whitespace-pre-wrap rounded-lg p-3 font-mono text-xs leading-relaxed" style={{ background: 'var(--bg-sidebar)', color: 'var(--text-secondary)' }}>
          {memory.content}
        </pre>

        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>移动到层级</p>
          <div className="flex flex-wrap gap-1">
            {LAYERS.filter((l) => l !== memory.layer).map((l) => (
              <button
                key={l}
                onClick={() => onMoveLayer(memory.id, l)}
                className="rounded px-2 py-1 text-[10px] font-medium transition-colors hover:opacity-80"
                style={{ background: `${LAYER_COLORS[l]}12`, color: LAYER_COLORS[l] }}
              >
                → {LAYER_CONFIG[l].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
