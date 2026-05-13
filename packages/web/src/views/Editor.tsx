import { useState, useEffect } from 'react';
import { LAYERS, LAYER_CONFIG } from '@keymemory/shared';
import type { Memory, Layer } from '@keymemory/shared';
import MarkdownEditor from '../components/MarkdownEditor';
import MarkdownRenderer from '../components/MarkdownRenderer';

interface EditorProps {
  memory: Memory | null;
  isCreating: boolean;
  loading?: boolean;
  onSave: (data: { title: string; content: string; layer: Layer; project?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => void;
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
  const [metadataExpanded, setMetadataExpanded] = useState(false);

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
            className="rounded px-2 py-0.5 text-xs font-semibold"
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

        <MarkdownRenderer content={memory.content} />

        {memory.tags && memory.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {memory.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'rgba(139,92,246,0.1)', color: 'var(--layer-project)' }}
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {memory.source && (
          <div className="mt-2">
            <span
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium"
              style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--layer-long)' }}
            >
              <svg className="h-2.5 w-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              {memory.source}
            </span>
          </div>
        )}

        {memory.metadata && Object.keys(memory.metadata).length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setMetadataExpanded(!metadataExpanded)}
              className="flex items-center gap-1 text-[10px] font-medium transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <svg
                className="h-2.5 w-2.5 transition-transform"
                style={{ transform: metadataExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
              </svg>
              元数据 ({Object.keys(memory.metadata).length})
            </button>
            {metadataExpanded && (
              <div
                className="mt-1.5 rounded-lg p-2.5 text-[11px] leading-relaxed"
                style={{ background: 'var(--bg-sidebar)', color: 'var(--text-secondary)' }}
              >
                {Object.entries(memory.metadata).map(([k, v]) => (
                  <div key={k} className="flex gap-2 py-0.5">
                    <span className="font-medium" style={{ color: 'var(--text-tertiary)' }}>{k}</span>
                    <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>移动到层级</p>
          <div className="flex flex-wrap gap-1">
            {LAYERS.filter((l) => l !== memory.layer).map((l) => (
              <button
                key={l}
                onClick={() => onMoveLayer(memory.id, l)}
                className="rounded px-2 py-1 text-xs font-medium transition-colors hover:opacity-80"
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
