import { useMemo } from 'react';
import { useI18n } from '../i18n';
import { LAYER_COLORS } from '../lib/memoryFormat';

interface TagItem {
  name: string;
  count: number;
  layers?: Record<string, number>;
}

interface TagCloudProps {
  tags: TagItem[];
  projects?: Array<{ name: string; count: number }>;
  onTagClick?: (tagName: string) => void;
  loading?: boolean;
}

const MIN_FONT_SIZE = 13;
const MAX_FONT_SIZE = 24;

function getDominantLayer(layers?: Record<string, number>): string {
  if (!layers || Object.keys(layers).length === 0) return 'short';
  let max = 0;
  let dominant = 'short';
  for (const [layer, count] of Object.entries(layers)) {
    if (count > max) {
      max = count;
      dominant = layer;
    }
  }
  return dominant;
}

function getLayerColor(layer: string): string {
  if (layer === 'project') return '#7c5fa6';
  return (LAYER_COLORS as Record<string, string>)[layer] ?? '#2f8297';
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function TagCloud({ tags, projects, onTagClick, loading }: TagCloudProps) {
  const { language, t } = useI18n();
  const { minCount, maxCount, totalMemories } = useMemo(() => {
    if (tags.length === 0) return { minCount: 0, maxCount: 0, totalMemories: 0 };
    const counts = tags.map((tag) => tag.count);
    return {
      minCount: Math.min(...counts),
      maxCount: Math.max(...counts),
      totalMemories: counts.reduce((a, b) => a + b, 0),
    };
  }, [tags]);

  const getFontSize = (count: number): number => {
    if (maxCount === minCount) return (MIN_FONT_SIZE + MAX_FONT_SIZE) / 2;
    const ratio = (count - minCount) / (maxCount - minCount);
    return MIN_FONT_SIZE + ratio * (MAX_FONT_SIZE - MIN_FONT_SIZE);
  };

  const getFontWeight = (fontSize: number): number => {
    const ratio = (fontSize - MIN_FONT_SIZE) / (MAX_FONT_SIZE - MIN_FONT_SIZE);
    return 500 + ratio * 120;
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <div className="animate-pulse" style={{ width: 80, height: 20, borderRadius: 10, background: 'var(--bg-muted)' }} />
          <div className="animate-pulse" style={{ width: 100, height: 20, borderRadius: 10, background: 'var(--bg-muted)' }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
          {Array.from({ length: 12 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse"
              style={{
                width: 60 + (index % 4) * 24,
                height: 28 + (index % 3) * 6,
                borderRadius: 20,
                background: 'var(--bg-muted)',
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (tags.length === 0) {
    return (
      <div className="empty-state" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 15, fontWeight: 600 }}>
        {language === 'zh' ? '暂无标签数据' : 'No tag data yet'}
      </div>
    );
  }

  return (
    <div className="tag-cloud-page">
      <div className="tag-cloud-header" style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {t('nav.tags')}
        </span>
        <span style={{ fontSize: 13, color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>
          {language === 'zh' ? `${tags.length} 个标签 · ${totalMemories} 条记忆` : `${tags.length} tags · ${totalMemories} memories`}
        </span>
      </div>

      <div className="tag-cloud-wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {tags.map((tag) => {
          const dominantLayer = getDominantLayer(tag.layers);
          const color = getLayerColor(dominantLayer);
          const fontSize = getFontSize(tag.count);
          const fontWeight = getFontWeight(fontSize);

          return (
            <button
              type="button"
              key={tag.name}
              onClick={() => onTagClick?.(tag.name)}
              className="tag-cloud-token"
              style={{
                border: `1px solid ${hexToRgba(color, 0.15)}`,
                background: hexToRgba(color, 0.08),
                color,
                fontSize,
                fontWeight,
                cursor: 'pointer',
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
              }}
            >
              {tag.name}
            </button>
          );
        })}
      </div>

      {projects && projects.length > 0 && (
        <div className="tag-cloud-projects" style={{ marginTop: 28 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 12 }}>
            {t('sidebar.projects')}
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {projects.map((project) => (
              <button
                type="button"
                key={project.name}
                className="tag-cloud-project"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  cursor: onTagClick ? 'pointer' : 'default',
                  minWidth: 140,
                }}
                onClick={() => onTagClick?.(project.name)}
              >
                <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-primary)' }}>{project.name}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--layer-project)', background: 'rgba(155, 89, 182, 0.08)', padding: '2px 8px', borderRadius: 10, fontVariantNumeric: 'tabular-nums', lineHeight: '18px' }}>
                  {project.count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
