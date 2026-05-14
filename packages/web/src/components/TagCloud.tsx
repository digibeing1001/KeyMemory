import { useMemo } from 'react';

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

const LAYER_COLORS: Record<string, string> = {
  flash: '#FF9F0A',
  short: '#007AFF',
  long: '#34C759',
  project: '#AF52DE',
  entity: '#FF2D55',
};

const MIN_FONT_SIZE = 13;
const MAX_FONT_SIZE = 28;

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
  return LAYER_COLORS[layer] ?? '#007AFF';
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function TagCloud({ tags, projects, onTagClick, loading }: TagCloudProps) {
  const { minCount, maxCount, totalMemories } = useMemo(() => {
    if (tags.length === 0) return { minCount: 0, maxCount: 0, totalMemories: 0 };
    const counts = tags.map((t) => t.count);
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
    return 500 + ratio * 100;
  };

  if (loading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          <div
            className="animate-shimmer"
            style={{ width: 80, height: 20, borderRadius: 10, background: 'var(--bg-muted)' }}
          />
          <div
            className="animate-shimmer"
            style={{ width: 100, height: 20, borderRadius: 10, background: 'var(--bg-muted)' }}
          />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center' }}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className="animate-shimmer"
              style={{
                width: 60 + Math.random() * 60,
                height: 28 + Math.random() * 12,
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
      <div
        style={{
          padding: '48px 24px',
          textAlign: 'center',
          color: 'var(--text-tertiary)',
          fontSize: 15,
          fontWeight: 500,
        }}
      >
        暂无标签数据
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 24px' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}
        >
          标签
        </span>
        <span
          style={{
            fontSize: 13,
            color: 'var(--text-tertiary)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {tags.length} 个标签 · {totalMemories} 条记忆
        </span>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          justifyContent: 'center',
        }}
      >
        {tags.map((tag) => {
          const dominantLayer = getDominantLayer(tag.layers);
          const color = getLayerColor(dominantLayer);
          const fontSize = getFontSize(tag.count);
          const fontWeight = getFontWeight(fontSize);

          return (
            <button
              key={tag.name}
              onClick={() => onTagClick?.(tag.name)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: `1px solid ${hexToRgba(color, 0.15)}`,
                background: hexToRgba(color, 0.08),
                color,
                fontSize,
                fontWeight,
                cursor: 'pointer',
                transition:
                  'transform var(--transition-fast), background var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast)',
                letterSpacing: '-0.01em',
                lineHeight: 1.4,
                whiteSpace: 'nowrap',
                outline: 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'scale(1.05)';
                e.currentTarget.style.background = hexToRgba(color, 0.15);
                e.currentTarget.style.boxShadow = `0 2px 8px ${hexToRgba(color, 0.15)}`;
                e.currentTarget.style.borderColor = hexToRgba(color, 0.25);
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.background = hexToRgba(color, 0.08);
                e.currentTarget.style.boxShadow = 'none';
                e.currentTarget.style.borderColor = hexToRgba(color, 0.15);
              }}
            >
              {tag.name}
            </button>
          );
        })}
      </div>

      {projects && projects.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              display: 'block',
              marginBottom: 12,
            }}
          >
            项目
          </span>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            {projects.map((project) => (
              <div
                key={project.name}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-md)',
                  padding: '12px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  transition:
                    'border-color var(--transition-fast), box-shadow var(--transition-fast), transform var(--transition-fast)',
                  cursor: onTagClick ? 'pointer' : 'default',
                  minWidth: 140,
                }}
                onClick={() => onTagClick?.(project.name)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)';
                  e.currentTarget.style.boxShadow = 'none';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                <span
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {project.name}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: 'var(--layer-project)',
                    background: 'rgba(175, 82, 222, 0.08)',
                    padding: '2px 8px',
                    borderRadius: 10,
                    fontVariantNumeric: 'tabular-nums',
                    lineHeight: '18px',
                  }}
                >
                  {project.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
