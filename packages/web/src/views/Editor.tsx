import { useState, useEffect } from 'react';
import { LAYERS, LAYER_CONFIG } from '@keymemory/shared';
import type { Memory, Layer } from '@keymemory/shared';
import { Edit, Archive, Trash, Tag, Source, ChevronRight } from '../components/Icons';
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
    return null;
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
              className="rounded p-1"
              style={{ color: 'var(--text-tertiary)', transition: 'color var(--transition-fast)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              title="编辑"
            >
              <Edit size={14} />
            </button>
            <button
              onClick={() => onArchive(memory.id)}
              className="rounded p-1"
              style={{ color: 'var(--text-tertiary)', transition: 'color var(--transition-fast)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              title="归档"
            >
              <Archive size={14} />
            </button>
            <button
              onClick={() => onDelete(memory.id)}
              className="rounded p-1"
              style={{ color: 'var(--text-tertiary)', transition: 'color var(--transition-fast)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }}
              title="删除"
            >
              <Trash size={14} />
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
          <span className="rounded px-2 py-0.5 text-[10px]" style={{ background: 'var(--bg-muted)', color: 'var(--text-tertiary)' }}>
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
          <div className="mt-3 flex flex-wrap items-center gap-1">
            <Tag size={11} style={{ color: 'var(--text-tertiary)' }} />
            {memory.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}
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
              style={{ background: 'rgba(5,150,105,0.08)', color: 'var(--layer-long)' }}
            >
              <Source size={10} />
              {memory.source}
            </span>
          </div>
        )}

        {memory.metadata && Object.keys(memory.metadata).length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => setMetadataExpanded(!metadataExpanded)}
              className="flex items-center gap-1 text-[10px] font-medium"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <ChevronRight size={10} style={{ transform: metadataExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform var(--transition-fast)' }} />
              元数据 ({Object.keys(memory.metadata).length})
            </button>
            {metadataExpanded && (
              <div
                className="mt-1.5 rounded-lg p-2.5 text-[11px] leading-relaxed"
                style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}
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
                className="rounded px-2 py-1 text-xs font-medium"
                style={{ background: `${LAYER_COLORS[l]}12`, color: LAYER_COLORS[l], transition: 'opacity var(--transition-fast)' }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.75'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
              >
                {LAYER_CONFIG[l].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
