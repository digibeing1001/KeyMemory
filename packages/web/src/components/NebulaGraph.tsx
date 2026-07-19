import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Inbox, Link, Search } from './Icons';
import { useI18n } from '../i18n';
import { redactSensitiveText } from '../lib/memoryFormat';

interface GraphNode {
  id: string;
  title: string;
  summary?: string;
  layer: string;
  tags?: string[];
  project?: string;
  valley?: string;
  updatedAt?: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
  label?: string;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface NebulaGraphProps {
  data: GraphData | null;
  onNodeClick?: (nodeId: string) => void;
  loading?: boolean;
}

interface Valley {
  name: string;
  nodes: GraphNode[];
  latestAt: number;
  layers: Set<string>;
}

const LAYER_ACCENTS: Record<string, string> = {
  flash: '#b77635',
  short: '#2f8297',
  long: '#4f8a67',
  project: '#8065a3',
  entity: '#a45f72',
};

function compactDate(value: string | undefined, locale: string): string {
  if (!value) return '';
  return new Date(value).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function edgeLabel(edge: GraphEdge, language: 'zh' | 'en'): string {
  if (edge.label && !/^(shared_tag|shared_project|shared_entity)$/i.test(edge.label)) return edge.label;
  const labels: Record<string, [string, string]> = {
    shared_tag: ['共享标签', 'Shared tag'],
    shared_project: ['同一项目', 'Same project'],
    shared_entity: ['相关人物或事物', 'Shared entity'],
    extends: ['补充了', 'Extends'],
    supersedes: ['更新了', 'Supersedes'],
    supports: ['支持', 'Supports'],
    contradicts: ['存在分歧', 'Contradicts'],
  };
  return labels[edge.type]?.[language === 'zh' ? 0 : 1] ?? (language === 'zh' ? '相关记忆' : 'Related memory');
}

export default function NebulaGraph({ data, onNodeClick, loading }: NebulaGraphProps) {
  const { language } = useI18n();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [query, setQuery] = useState('');
  const [selectedValley, setSelectedValley] = useState<string | null>(null);

  const valleys = useMemo<Valley[]>(() => {
    const grouped = new Map<string, GraphNode[]>();
    for (const node of data?.nodes ?? []) {
      const name = node.valley?.trim() || node.project?.trim() || node.tags?.[0] || (language === 'zh' ? '独立记忆' : 'Standalone memories');
      const nodes = grouped.get(name) ?? [];
      nodes.push(node);
      grouped.set(name, nodes);
    }
    return [...grouped.entries()].map(([name, nodes]) => ({
      name,
      nodes: nodes.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
      latestAt: Math.max(...nodes.map(node => node.updatedAt ? new Date(node.updatedAt).getTime() : 0)),
      layers: new Set(nodes.map(node => node.layer)),
    })).sort((a, b) => b.latestAt - a.latestAt || b.nodes.length - a.nodes.length || a.name.localeCompare(b.name));
  }, [data, language]);

  const visibleValleys = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return valleys;
    return valleys.filter(valley => valley.name.toLocaleLowerCase().includes(needle)
      || valley.nodes.some(node => `${node.title} ${node.summary ?? ''} ${(node.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(needle)));
  }, [query, valleys]);

  useEffect(() => {
    if (selectedValley && valleys.some(valley => valley.name === selectedValley)) return;
    setSelectedValley(valleys[0]?.name ?? null);
  }, [selectedValley, valleys]);

  const selected = valleys.find(valley => valley.name === selectedValley) ?? null;
  const nodeById = useMemo(() => new Map((data?.nodes ?? []).map(node => [node.id, node])), [data]);
  const selectedIds = useMemo(() => new Set(selected?.nodes.map(node => node.id) ?? []), [selected]);
  const nearby = useMemo(() => {
    if (!selected) return [];
    return (data?.edges ?? []).filter(edge => selectedIds.has(edge.source) !== selectedIds.has(edge.target))
      .map(edge => ({
        edge,
        node: nodeById.get(selectedIds.has(edge.source) ? edge.target : edge.source),
      }))
      .filter((item): item is { edge: GraphEdge; node: GraphNode } => Boolean(item.node))
      .sort((a, b) => b.edge.weight - a.edge.weight)
      .filter((item, index, all) => all.findIndex(other => other.node.id === item.node.id) === index)
      .slice(0, 8);
  }, [data, nodeById, selected, selectedIds]);

  if (loading) {
    return <div className="memory-valley-loading">{language === 'zh' ? '正在整理记忆山谷…' : 'Preparing memory valleys…'}</div>;
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="memory-valley-empty">
        <Inbox size={30} />
        <strong>{language === 'zh' ? '还没有形成记忆山谷' : 'No memory valleys yet'}</strong>
        <span>{language === 'zh' ? '当记忆被邮件、项目、标签或关系串联后，会在这里自然聚成主题。' : 'Memories will gather here as mail, projects, tags, and relationships connect them.'}</span>
      </div>
    );
  }

  return (
    <main className="memory-valley-page">
      <header className="memory-valley-header">
        <div>
          <span>{language === 'zh' ? '记忆关系' : 'MEMORY RELATIONSHIPS'}</span>
          <h2>{language === 'zh' ? '记忆山谷' : 'Memory valleys'}</h2>
          <p>{language === 'zh' ? '先按项目与主题看全貌，再进入一条记忆查看它真正相关的上下文。' : 'See the landscape by project and theme, then open a memory for its real context.'}</p>
        </div>
        <dl>
          <div><dt>{language === 'zh' ? '主题山谷' : 'Valleys'}</dt><dd>{valleys.length}</dd></div>
          <div><dt>{language === 'zh' ? '记忆' : 'Memories'}</dt><dd>{data.nodes.length}</dd></div>
          <div><dt>{language === 'zh' ? '关键关系' : 'Key links'}</dt><dd>{data.edges.length}</dd></div>
        </dl>
      </header>

      <label className="memory-valley-search">
        <Search size={16} />
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder={language === 'zh' ? '搜索主题、记忆或标签' : 'Search themes, memories, or tags'} />
        <span>{visibleValleys.length}</span>
      </label>

      <div className="memory-valley-layout">
        <section className="memory-valley-overview" aria-label={language === 'zh' ? '主题山谷' : 'Theme valleys'}>
          {visibleValleys.map((valley, index) => {
            const dominantLayer = valley.nodes[0]?.layer ?? 'short';
            const accent = LAYER_ACCENTS[dominantLayer] ?? LAYER_ACCENTS.short;
            const selectedNow = selected?.name === valley.name;
            return (
              <button
                type="button"
                className={`memory-valley-card${selectedNow ? ' is-selected' : ''}`}
                key={valley.name}
                onClick={() => setSelectedValley(valley.name)}
                style={{ '--valley-accent': accent, '--valley-depth': Math.min(1, valley.nodes.length / 12), '--valley-index': index } as CSSProperties}
              >
                <span className="memory-valley-contour" aria-hidden="true" />
                <span className="memory-valley-card-copy">
                  <small>{compactDate(valley.nodes[0]?.updatedAt, locale)}</small>
                  <strong>{redactSensitiveText(valley.name)}</strong>
                  <em>{language === 'zh' ? `${valley.nodes.length} 条记忆 · ${valley.layers.size} 个层级` : `${valley.nodes.length} memories · ${valley.layers.size} layers`}</em>
                </span>
                <span className="memory-valley-peek">
                  {valley.nodes.slice(0, 3).map(node => <i key={node.id}>{redactSensitiveText(node.title)}</i>)}
                </span>
              </button>
            );
          })}
        </section>

        <aside className="memory-valley-detail">
          {selected && (
            <>
              <header>
                <span>{language === 'zh' ? '当前山谷' : 'CURRENT VALLEY'}</span>
                <h3>{redactSensitiveText(selected.name)}</h3>
                <p>{language === 'zh' ? `${selected.nodes.length} 条记忆按最近更新排列。` : `${selected.nodes.length} memories, newest first.`}</p>
              </header>
              <div className="memory-valley-memory-list">
                {selected.nodes.map(node => (
                  <button type="button" key={node.id} onClick={() => onNodeClick?.(node.id)}>
                    <span style={{ background: LAYER_ACCENTS[node.layer] ?? LAYER_ACCENTS.short }} />
                    <div>
                      <strong>{redactSensitiveText(node.title)}</strong>
                      {node.summary && <p>{redactSensitiveText(node.summary)}</p>}
                      <small>{compactDate(node.updatedAt, locale)}{node.tags?.length ? ` · ${node.tags.slice(0, 2).join('、')}` : ''}</small>
                    </div>
                  </button>
                ))}
              </div>
              <section className="memory-valley-nearby">
                <h4><Link size={14} />{language === 'zh' ? '通往其他山谷' : 'Paths to other valleys'}</h4>
                {nearby.length === 0 ? (
                  <p>{language === 'zh' ? '这个主题暂时没有可靠的跨主题关系。' : 'No reliable cross-theme relationships yet.'}</p>
                ) : nearby.map(({ edge, node }) => (
                  <button key={`${edge.source}-${edge.target}-${edge.type}`} onClick={() => onNodeClick?.(node.id)}>
                    <span>{edgeLabel(edge, language)}</span>
                    <strong>{redactSensitiveText(node.title)}</strong>
                  </button>
                ))}
              </section>
            </>
          )}
        </aside>
      </div>
    </main>
  );
}
