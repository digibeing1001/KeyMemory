/**
 * KM-401：从 App.tsx 拆出的回收站视图。
 */
import type { Memory } from '@keymemory/shared';
import { LAYER_COLORS, formatDate, formatMemoryTitle } from '../lib/memoryFormat';

interface RecycleBinViewProps {
  memories: Memory[];
  loading: boolean;
  locale: string;
  t: (key: string) => string;
  layerLabel: (layer: Memory['layer']) => string;
  onRestore: (id: string) => void;
  onPermanentDelete: (id: string) => void;
}

export default function RecycleBinView({ memories, loading, locale, t, layerLabel, onRestore, onPermanentDelete }: RecycleBinViewProps) {
  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>
            {t('recycle.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
            {t('recycle.subtitle')}
          </p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
          <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
          {t('common.loading')}
        </div>
      ) : memories.length === 0 ? (
        <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: 56 }}>
          <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-secondary)' }}>{t('recycle.empty')}</span>
          <span style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)' }}>{t('recycle.emptyHint')}</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {memories.map((memory) => (
            <div
              key={memory.id}
              style={{
                padding: '16px 18px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--bg-card)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <div className="flex items-center gap-4" style={{ minWidth: 0 }}>
                <span className="tag-pill" style={{ color: LAYER_COLORS[memory.layer], background: `${LAYER_COLORS[memory.layer]}18` }}>
                  {layerLabel(memory.layer)}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 650, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {formatMemoryTitle(memory)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {formatDate(memory.updatedAt, locale)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => onRestore(memory.id)} className="btn">
                  {t('recycle.restore')}
                </button>
                <button onClick={() => onPermanentDelete(memory.id)} className="btn" style={{ color: 'var(--danger)' }}>
                  {t('recycle.permanentDelete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
