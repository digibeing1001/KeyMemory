import { useState, useEffect } from 'react';
import { LAYERS, LAYER_CONFIG } from '@keymemory/shared';
import type { Memory, Layer } from '@keymemory/shared';
import { Edit, Archive, Trash, Tag, ChevronRight } from '../components/Icons';
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
  flash: '#e8913a',
  short: '#2eaadc',
  long: '#4dab7a',
  project: '#9b59b6',
  entity: '#e15759',
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
      <div className="flex h-full flex-col animate-fade-in">
        <div
          className="px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            新建记忆
          </h2>
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
      <div className="flex h-full flex-col animate-fade-in">
        <div
          className="px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            编辑记忆
          </h2>
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
    <div className="flex h-full flex-col animate-fade-in">
      <div
        className="shrink-0"
        style={{
          padding: '20px 32px 16px',
          borderBottom: '1px solid var(--border)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: 'var(--text-primary)',
              lineHeight: 1.3,
              flex: 1,
              margin: 0,
              marginRight: 16,
            }}
          >
            {memory.title}
          </h1>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsEditing(true)}
              className="btn"
              title="编辑"
            >
              <Edit size={14} />
              <span>编辑</span>
            </button>
            <button
              onClick={() => onArchive(memory.id)}
              className="btn"
              title="归档"
            >
              <Archive size={14} />
            </button>
            <button
              onClick={() => onDelete(memory.id)}
              className="btn"
              style={{ color: 'var(--danger)' }}
              title="删除"
            >
              <Trash size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="tag-pill"
            style={{ color: layerColor, background: `${layerColor}15` }}
          >
            {config.label}
          </span>
          {memory.project && (
            <span className="tag-pill" style={{ color: 'var(--layer-project)', background: 'rgba(155,89,182,0.1)' }}>
              {memory.project}
            </span>
          )}
          <span className="tag-pill">
            置信度 {Math.round(memory.confidence * 100)}%
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>·</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>创建 {formatDate(memory.createdAt)}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>·</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>访问 {memory.hitCount} 次</span>

          {memory.tags && memory.tags.length > 0 && (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>·</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Tag size={11} style={{ color: 'var(--text-muted)' }} />
                {memory.tags.map((tag) => (
                  <span key={tag} className="tag-pill">
                    {tag}
                  </span>
                ))}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '32px 32px 48px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="markdown-body">
            <MarkdownRenderer content={memory.content} />
          </div>

          {memory.metadata && Object.keys(memory.metadata).length > 0 && (
            <div className="mt-10 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => setMetadataExpanded(!metadataExpanded)}
                className="btn"
                style={{ fontSize: 12, color: 'var(--text-muted)' }}
              >
                <ChevronRight
                  size={12}
                  style={{
                    transform: metadataExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                    transition: 'transform var(--transition)',
                  }}
                />
                元数据 ({Object.keys(memory.metadata).length})
              </button>
              {metadataExpanded && (
                <div
                  className="mt-3 p-4"
                  style={{
                    background: 'var(--bg-secondary)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 12,
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                  }}
                >
                  {Object.entries(memory.metadata).map(([k, v]) => (
                    <div key={k} className="flex gap-3 py-1">
                      <span style={{ color: 'var(--text-muted)', minWidth: 80 }}>{k}</span>
                      <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-10 pt-6" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="mb-3 text-xs font-semibold uppercase" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>移动到层级</p>
            <div className="flex flex-wrap gap-2">
              {LAYERS.filter((l) => l !== memory.layer).map((l) => {
                const c = LAYER_COLORS[l];
                return (
                  <button
                    key={l}
                    onClick={() => onMoveLayer(memory.id, l)}
                    className="tag-pill"
                    style={{
                      color: c,
                      background: `${c}15`,
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: '4px 12px',
                    }}
                  >
                    {LAYER_CONFIG[l].label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
