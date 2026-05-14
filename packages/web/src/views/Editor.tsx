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
  flash: '#FF9F0A',
  short: '#007AFF',
  long: '#34C759',
  project: '#AF52DE',
  entity: '#FF2D55',
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
      <div className="flex h-full flex-col" style={{ background: 'transparent' }}>
        <div className="px-6 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>新建记忆</h2>
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
      <div className="flex h-full flex-col" style={{ background: 'transparent' }}>
        <div className="px-6 py-4" style={{ borderBottom: '0.5px solid var(--border)' }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>编辑记忆</h2>
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
    <div className="flex h-full flex-col" style={{ background: 'transparent' }}>
      <div
        className="shrink-0"
        style={{
          padding: '20px 32px 16px',
          borderBottom: '0.5px solid var(--border)',
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2
            className="line-clamp-2"
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: '-0.03em',
              lineHeight: 1.3,
              flex: 1,
              marginRight: 16,
            }}
          >
            {memory.title}
          </h2>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setIsEditing(true)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-muted)', transition: 'all var(--transition-fast)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.background = 'var(--accent-light)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-muted)'; }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Edit size={13} /> 编辑</span>
            </button>
            <button
              onClick={() => onArchive(memory.id)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-muted)', transition: 'all var(--transition-fast)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--warning)'; e.currentTarget.style.background = 'rgba(255,159,10,0.08)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-muted)'; }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Archive size={13} /> 归档</span>
            </button>
            <button
              onClick={() => onDelete(memory.id)}
              className="rounded-lg px-3 py-1.5 text-sm font-medium"
              style={{ color: 'var(--text-secondary)', background: 'var(--bg-muted)', transition: 'all var(--transition-fast)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.background = 'var(--danger-light)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.background = 'var(--bg-muted)'; }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Trash size={13} /> 删除</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className="rounded-md px-3 py-1 text-xs font-semibold"
            style={{ background: `${layerColor}14`, color: layerColor }}
          >
            {config.label}
          </span>
          {memory.project && (
            <span className="rounded-md px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(175,82,222,0.08)', color: 'var(--layer-project)' }}>
              {memory.project}
            </span>
          )}
          <span className="rounded-md px-2.5 py-1 text-xs font-medium" style={{ background: 'var(--bg-muted)', color: 'var(--text-tertiary)' }}>
            置信度 {Math.round(memory.confidence * 100)}%
          </span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>·</span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>创建 {formatDate(memory.createdAt)}</span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>·</span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>访问 {memory.hitCount} 次</span>

          {memory.tags && memory.tags.length > 0 && (
            <>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Tag size={11} style={{ color: 'var(--text-tertiary)' }} />
                {memory.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}
                  >
                    {tag}
                  </span>
                ))}
              </span>
            </>
          )}

          {memory.source && (
            <>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>·</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Source size={11} style={{ color: 'var(--text-tertiary)' }} />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{memory.source}</span>
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '32px 32px 40px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <MarkdownRenderer content={memory.content} />

          {memory.metadata && Object.keys(memory.metadata).length > 0 && (
            <div className="mt-8 pt-6" style={{ borderTop: '0.5px solid var(--border)' }}>
              <button
                onClick={() => setMetadataExpanded(!metadataExpanded)}
                className="flex items-center gap-1.5 text-xs font-medium mb-2"
                style={{ color: 'var(--text-tertiary)' }}
              >
                <ChevronRight size={12} style={{ transform: metadataExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform var(--transition-fast)' }} />
                元数据 ({Object.keys(memory.metadata).length})
              </button>
              {metadataExpanded && (
                <div
                  className="rounded-xl p-4 text-xs leading-relaxed"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-secondary)' }}
                >
                  {Object.entries(memory.metadata).map(([k, v]) => (
                    <div key={k} className="flex gap-3 py-1">
                      <span className="font-medium" style={{ color: 'var(--text-tertiary)', minWidth: 80 }}>{k}</span>
                      <span>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-8 pt-6" style={{ borderTop: '0.5px solid var(--border)' }}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)', letterSpacing: '0.06em' }}>移动到层级</p>
            <div className="flex flex-wrap gap-2">
              {LAYERS.filter((l) => l !== memory.layer).map((l) => {
                const c = LAYER_COLORS[l];
                return (
                  <button
                    key={l}
                    onClick={() => onMoveLayer(memory.id, l)}
                    className="rounded-lg px-4 py-2 text-sm font-medium"
                    style={{
                      background: `${c}0D`,
                      color: c,
                      border: `1.5px solid ${c}1A`,
                      transition: 'all 200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `${c}26`;
                      e.currentTarget.style.borderColor = `${c}66`;
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = `0 6px 16px ${c}40`;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = `${c}0D`;
                      e.currentTarget.style.borderColor = `${c}1A`;
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }}
                    onMouseDown={(e) => {
                      e.currentTarget.style.transform = 'translateY(1px)';
                      e.currentTarget.style.background = `${c}40`;
                      e.currentTarget.style.borderColor = c;
                      e.currentTarget.style.boxShadow = `0 0 0 3px ${c}26, 0 2px 8px ${c}33`;
                    }}
                    onMouseUp={(e) => {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.background = `${c}26`;
                      e.currentTarget.style.borderColor = `${c}66`;
                      e.currentTarget.style.boxShadow = `0 6px 16px ${c}40`;
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
