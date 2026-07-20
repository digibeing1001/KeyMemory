import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { Layer, Memory } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import { Archive, Close, Contract, Edit, Expand, Link, Tag, Trash } from './Icons';
import MarkdownEditor from './MarkdownEditor';
import MarkdownRenderer from './MarkdownRenderer';
import MemoryQualityPanel from './MemoryQualityPanel';
import { getRelatedMemories, type RelatedMemory } from '../lib/api';
import { useI18n } from '../i18n';
import { formatDateTime, formatMemoryTitle, getMemoryKind, LAYER_COLORS, redactSensitiveText, summarizeMemory } from '../lib/memoryFormat';

interface MemoryDetailPanelProps {
  memory: Memory | null;
  loading?: boolean;
  onClose: () => void;
  onSave: (data: { title: string; content: string; layer: Layer; projectId?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => void;
  onDelete: (id: string) => void;
  onArchive: (id: string) => void;
  onMoveLayer: (id: string, layer: Layer) => void;
}

function metaRow(label: string, value: ReactNode) {
  return (
    <div className="memory-meta-row" style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', gap: 10, alignItems: 'baseline' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

export default function MemoryDetailPanel({
  memory,
  loading,
  onClose,
  onSave,
  onDelete,
  onArchive,
  onMoveLayer,
}: MemoryDetailPanelProps) {
  const { language, t, layerLabel, layerHelp, memoryKindLabel } = useI18n();
  const [editing, setEditing] = useState(false);
  const [showBody, setShowBody] = useState(true);
  const [isWide, setIsWide] = useState(true);
  const [related, setRelated] = useState<RelatedMemory[]>([]);

  useEffect(() => {
    setEditing(false);
    setShowBody(true);
    setRelated([]);
    if (!memory?.id) return;
    getRelatedMemories(memory.id).then(setRelated).catch(() => setRelated([]));
  }, [memory?.id]);

  if (!memory) {
    return (
      <aside
        className="memory-detail-panel"
        style={{
          width: 380,
          borderLeft: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          padding: 24,
        }}
      >
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--bg-card)',
            padding: 22,
          }}
        >
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>{t('detail.noSelection')}</h3>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {t('detail.noSelectionHint')}
          </p>
        </div>
      </aside>
    );
  }

  if (editing) {
    return (
      <aside
        className={`memory-detail-panel memory-detail-editor${isWide ? ' is-wide' : ' is-compact'}`}
        style={{
          borderLeft: '1px solid var(--border)',
          background: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="flex items-center justify-between" style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 650, color: 'var(--text-primary)' }}>{t('detail.editing')}</h2>
          <button type="button" className="btn" onClick={() => setEditing(false)} aria-label={t('common.close')}>
            <Close size={14} />
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <MarkdownEditor
            memory={memory}
            loading={loading}
            onSave={(data) => {
              onSave(data);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      </aside>
    );
  }

  const kind = getMemoryKind(memory);
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const title = formatMemoryTitle(memory);

  return (
    <aside
      className={`memory-detail-panel${isWide ? ' is-wide' : ' is-compact'}`}
      style={{
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div className="memory-detail-header flex items-center justify-between" style={{ padding: '16px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 650 }}>{t('detail.title')}</div>
          <h2 className="memory-detail-title" style={{ margin: '3px 0 0', fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.35 }}>
            {title}
          </h2>
        </div>
        <div className="memory-detail-header-actions">
          <button
            type="button"
            className="btn memory-detail-size-toggle"
            onClick={() => setIsWide(value => !value)}
            aria-label={isWide ? (language === 'zh' ? '收窄详情栏' : 'Use compact details') : (language === 'zh' ? '展开完整详情' : 'Expand full details')}
            title={isWide ? (language === 'zh' ? '收窄详情栏' : 'Use compact details') : (language === 'zh' ? '展开完整详情' : 'Expand full details')}
          >
            {isWide ? <Contract size={14} /> : <Expand size={14} />}
          </button>
          <button type="button" className="btn" onClick={onClose} aria-label={t('common.close')}>
            <Close size={14} />
          </button>
        </div>
      </div>

      <div className="memory-detail-scroll" style={{ overflowY: 'auto', padding: 18 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          <span className="tag-pill" style={{ color: LAYER_COLORS[memory.layer], background: `${LAYER_COLORS[memory.layer]}18` }}>
            {layerLabel(memory.layer)}
          </span>
          <span className="tag-pill">{memoryKindLabel(kind)}</span>
          {memory.source && <span className="tag-pill">{memory.source}</span>}
        </div>

        <section
          className="memory-summary-section"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: 16,
            marginBottom: 14,
          }}
        >
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.65 }}>
            {summarizeMemory(memory, 220)}
          </p>
        </section>

        <MemoryQualityPanel memory={memory} />

        <section className="memory-meta-grid" style={{ display: 'grid', gap: 9, marginBottom: 18 }}>
          {metaRow(t('editor.layer'), (
            <>
              <strong style={{ color: 'var(--text-primary)' }}>{layerLabel(memory.layer)}</strong>
              <span style={{ display: 'block', marginTop: 2 }}>{layerHelp(memory.layer)}</span>
            </>
          ))}
          {metaRow(t('detail.project'), memory.projectId || '-')}
          {metaRow(t('detail.created'), formatDateTime(memory.createdAt, locale))}
          {metaRow(t('detail.updated'), formatDateTime(memory.updatedAt, locale))}
          {metaRow(t('detail.hits'), memory.hitCount)}
          {metaRow(t('common.confidence'), `${Math.round(memory.confidence * 100)}%`)}
        </section>

        {memory.tags && memory.tags.length > 0 && (
          <section style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 650, marginBottom: 8 }}>
              <Tag size={13} />
              {t('detail.tags')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {memory.tags.map((tag) => (
                <span key={tag} className="tag-pill">{tag}</span>
              ))}
            </div>
          </section>
        )}

        <section
          className={`memory-body-section${showBody ? ' is-expanded' : ''}`}
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 18,
          }}
        >
          <button
            type="button"
            className="memory-body-toggle"
            onClick={() => setShowBody((value) => !value)}
            aria-expanded={showBody}
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '13px 15px',
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              color: 'var(--text-primary)',
              fontWeight: 650,
              fontSize: 13,
            }}
          >
            <span>{t('detail.content')}</span>
            <span style={{ color: 'var(--accent)', fontSize: 12 }}>
              {showBody ? t('detail.hideContent') : t('detail.showContent')}
            </span>
          </button>
          {!showBody && (
            <p style={{ margin: 0, padding: '0 15px 14px', color: 'var(--text-muted)', fontSize: 12 }}>
              {t('detail.contentHint')}
            </p>
          )}
          {showBody && (
            <div className="memory-body-expanded markdown-body" style={{ padding: '0 15px 16px', fontSize: 13 }}>
              <MarkdownRenderer content={redactSensitiveText(memory.content)} />
            </div>
          )}
        </section>

        {related.length > 0 && (
          <section style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', fontWeight: 650, marginBottom: 8 }}>
              <Link size={13} />
              {t('detail.related')}
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {related.slice(0, 5).map((item) => (
                <div key={item.memoryId} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 10, background: 'var(--bg-card)' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>{redactSensitiveText(item.title)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{item.relationType} · {item.layer}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 650, marginBottom: 8 }}>
            {t('detail.moveTo')}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {LAYERS.filter((layer) => layer !== memory.layer).map((layer) => (
              <button
                type="button"
                key={layer}
                className="tag-pill"
                onClick={() => onMoveLayer(memory.id, layer)}
                style={{
                  color: LAYER_COLORS[layer],
                  background: `${LAYER_COLORS[layer]}18`,
                  border: `1px solid ${LAYER_COLORS[layer]}30`,
                  cursor: 'pointer',
                }}
                title={layerHelp(layer)}
              >
                {layerLabel(layer)}
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="memory-detail-actions flex items-center gap-2" style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
        <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
          <Edit size={14} />
          {t('common.edit')}
        </button>
        <button type="button" className="btn" onClick={() => onArchive(memory.id)}>
          <Archive size={14} />
          {t('common.archive')}
        </button>
        <button type="button" className="btn" onClick={() => onDelete(memory.id)} style={{ color: 'var(--danger)', marginLeft: 'auto' }}>
          <Trash size={14} />
          {t('common.delete')}
        </button>
      </div>
    </aside>
  );
}
