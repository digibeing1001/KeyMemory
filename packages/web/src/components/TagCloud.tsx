import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Search } from './Icons';
import { useI18n } from '../i18n';
import { LAYER_COLORS } from '../lib/memoryFormat';

interface TagItem {
  name: string;
  count: number;
  layers?: Record<string, number>;
  lastUsedAt?: string;
  aliases?: string[];
}

interface SuspectTagItem {
  name: string;
  count: number;
  reason: string;
}

interface TagCloudProps {
  tags: TagItem[];
  suspectTags?: SuspectTagItem[];
  projects?: Array<{ name: string; count: number }>;
  onTagClick?: (tagName: string) => void;
  loading?: boolean;
}

const MIN_FONT_SIZE = 14;
const MAX_FONT_SIZE = 35;

function getDominantLayer(layers?: Record<string, number>): string {
  if (!layers || Object.keys(layers).length === 0) return 'short';
  return Object.entries(layers).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'short';
}

function getLayerColor(layer: string): string {
  if (layer === 'project') return '#8065a3';
  return (LAYER_COLORS as Record<string, string>)[layer] ?? '#2f8297';
}

export default function TagCloud({ tags, suspectTags = [], projects, onTagClick, loading }: TagCloudProps) {
  const { language } = useI18n();
  const [mode, setMode] = useState<'cloud' | 'cleanup'>('cloud');
  const [query, setQuery] = useState('');

  const maxCount = useMemo(() => Math.max(1, ...tags.map(tag => tag.count)), [tags]);
  const filteredTags = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return tags.filter(tag => !needle || `${tag.name} ${(tag.aliases ?? []).join(' ')}`.toLocaleLowerCase().includes(needle)).slice(0, 80);
  }, [query, tags]);
  const totalUses = useMemo(() => tags.reduce((sum, tag) => sum + tag.count, 0), [tags]);

  const fontSize = (count: number) => {
    const ratio = Math.log1p(count) / Math.log1p(maxCount);
    return MIN_FONT_SIZE + ratio * (MAX_FONT_SIZE - MIN_FONT_SIZE);
  };

  if (loading) {
    return <div className="tag-cloud-loading">{language === 'zh' ? '正在整理标签…' : 'Preparing tags…'}</div>;
  }

  return (
    <main className="tag-cloud-page">
      <header className="tag-cloud-heading">
        <div>
          <span>{language === 'zh' ? '记忆主题' : 'MEMORY THEMES'}</span>
          <h2>{language === 'zh' ? '标签云' : 'Tag cloud'}</h2>
          <p>{language === 'zh' ? '字号代表出现频率，颜色代表记忆主要所在的层级。点击标签即可查看相关记忆。' : 'Size shows frequency and color shows the dominant memory layer. Select a tag to see its memories.'}</p>
        </div>
        <dl>
          <div><dt>{language === 'zh' ? '有效标签' : 'Valid tags'}</dt><dd>{tags.length}</dd></div>
          <div><dt>{language === 'zh' ? '使用次数' : 'Uses'}</dt><dd>{totalUses}</dd></div>
          <div><dt>{language === 'zh' ? '已隐藏问题' : 'Hidden issues'}</dt><dd>{suspectTags.length}</dd></div>
        </dl>
      </header>

      <div className="tag-cloud-toolbar">
        <div className="tag-cloud-tabs">
          <button className={mode === 'cloud' ? 'active' : ''} onClick={() => setMode('cloud')}>{language === 'zh' ? '精选标签云' : 'Curated cloud'}</button>
          <button className={mode === 'cleanup' ? 'active' : ''} onClick={() => setMode('cleanup')}>
            {language === 'zh' ? '清理记录' : 'Cleanup'}
            {suspectTags.length > 0 && <b>{suspectTags.length}</b>}
          </button>
        </div>
        <label>
          <Search size={15} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={language === 'zh' ? '搜索标签' : 'Search tags'} />
        </label>
      </div>

      {mode === 'cloud' ? (
        <>
          {filteredTags.length === 0 ? (
            <div className="tag-cloud-empty">{language === 'zh' ? '没有找到符合条件的标签' : 'No matching tags'}</div>
          ) : (
            <section className="tag-cloud-canvas" aria-label={language === 'zh' ? '标签云' : 'Tag cloud'}>
              <span className="tag-cloud-orbit" aria-hidden="true" />
              {filteredTags.map((tag, index) => {
                const color = getLayerColor(getDominantLayer(tag.layers));
                const aliases = tag.aliases && tag.aliases.length > 1 ? ` · ${language === 'zh' ? '已合并写法' : 'Merged spellings'}: ${tag.aliases.join(' / ')}` : '';
                return (
                  <button
                    type="button"
                    key={tag.name}
                    onClick={() => onTagClick?.(tag.name)}
                    className="tag-cloud-word"
                    title={`${tag.name} · ${tag.count}${aliases}`}
                    style={{ color, fontSize: fontSize(tag.count), '--tag-order': index } as CSSProperties}
                  >
                    {tag.name}
                    <sup>{tag.count}</sup>
                  </button>
                );
              })}
            </section>
          )}

          {projects && projects.length > 0 && (
            <section className="tag-cloud-projects">
              <header>
                <h3>{language === 'zh' ? '项目主题' : 'Project themes'}</h3>
                <span>{language === 'zh' ? '项目仍可作为主题入口，但不再是记忆文件夹。' : 'Projects remain theme entry points, not memory folders.'}</span>
              </header>
              <div>
                {projects.slice(0, 18).map(project => (
                  <button type="button" key={project.name} onClick={() => onTagClick?.(project.name)}>
                    <strong>{project.name}</strong><span>{project.count}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <section className="tag-cleanup-panel">
          <header>
            <h3>{language === 'zh' ? '没有进入标签云的内容' : 'Items excluded from the cloud'}</h3>
            <p>{language === 'zh' ? '系统内部标记、日期状态、疑似乱码和不符合标签规则的内容会留在原记忆中，但不会污染标签云。' : 'Internal markers, date states, corrupted text, and invalid labels stay on their memories but no longer pollute the cloud.'}</p>
          </header>
          {suspectTags.length === 0 ? (
            <div className="tag-cloud-empty">{language === 'zh' ? '没有发现需要隐藏的问题标签' : 'No problematic tags found'}</div>
          ) : (
            <div className="tag-cleanup-list">
              {suspectTags.map(tag => (
                <article key={`${tag.name}-${tag.reason}`}>
                  <span>{tag.reason}</span>
                  <strong>{tag.name}</strong>
                  <small>{language === 'zh' ? `出现 ${tag.count} 次 · 已从标签云隐藏` : `${tag.count} uses · hidden from cloud`}</small>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
