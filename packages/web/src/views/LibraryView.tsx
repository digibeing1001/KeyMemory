/**
 * KM-406：Library 视图——找得到 + 可解释。
 * 层级分面筛选 + 搜索；每条结果可展开"为什么召回"浮层，
 * 渲染 SearchScoreBreakdown 五项贡献值（Part 5 原则①：每条召回都能回答为什么是它）。
 */
import { useEffect, useState } from 'react';
import type { Memory, Layer, SearchResult } from '@keymemory/shared';
import { listMemories, searchMemoriesExplained } from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';

const LAYER_LABELS: Record<Layer, string> = {
  flash: '待整理 flash',
  short: '短期 short',
  long: '长期 long',
  entity: '实体 entity',
};

export default function LibraryView() {
  const [layerFilter, setLayerFilter] = useState<Layer | 'all'>('all');
  const [query, setQuery] = useState('');
  const [memories, setMemories] = useState<Memory[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query.trim()) return; // 搜索模式下由搜索驱动
    let cancelled = false;
    setLoading(true);
    listMemories({ layer: layerFilter === 'all' ? undefined : layerFilter, limit: 100 })
      .then(list => { if (!cancelled) setMemories(list); })
      .catch(() => { if (!cancelled) setMemories([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [layerFilter, query]);

  const runSearch = async () => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setLoading(true);
    try {
      const results = await searchMemoriesExplained(query.trim(), 20);
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const rows = searchResults
    ? searchResults.map(r => ({ memory: r.memory, breakdown: r.scoreBreakdown, score: r.score }))
    : memories.map(m => ({ memory: m, breakdown: undefined, score: undefined }));

  return (
    <div style={{ display: 'grid', gap: 14, padding: 20, maxWidth: 1080 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--text-primary)' }}>Library · 记忆库</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          分面筛选 + 搜索；点开任意结果查看"为什么召回它"。
        </p>
      </header>

      <Card>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={query}
            onChange={event => { setQuery(event.target.value); if (!event.target.value) setSearchResults(null); }}
            onKeyDown={event => { if (event.key === 'Enter') void runSearch(); }}
            placeholder="搜索记忆（回车）…"
            style={{ flex: 1, minWidth: 220, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13 }}
          />
          <button className="btn btn-primary" onClick={() => void runSearch()}>搜索</button>
          <select
            value={layerFilter}
            onChange={event => setLayerFilter(event.target.value as Layer | 'all')}
            disabled={Boolean(query.trim())}
            style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 13 }}
          >
            <option value="all">全部层级</option>
            {(Object.keys(LAYER_LABELS) as Layer[]).map(layer => (
              <option key={layer} value={layer}>{LAYER_LABELS[layer]}</option>
            ))}
          </select>
        </div>
      </Card>

      {loading ? (
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>加载中…</span>
      ) : rows.length === 0 ? (
        <EmptyState title="没有匹配的记忆" hint="调整筛选或换一个关键词" />
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {rows.map(({ memory, breakdown, score }) => (
            <Card key={memory.id}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Badge>{LAYER_LABELS[memory.layer] ?? memory.layer}</Badge>
                <strong style={{ fontSize: 13.5, color: 'var(--text-primary)', flex: 1 }}>{memory.title}</strong>
                {score !== undefined && <Badge tone="good">score {score.toFixed(4)}</Badge>}
                {breakdown && (
                  <button className="btn" onClick={() => setExpandedId(expandedId === memory.id ? null : memory.id)}>
                    {expandedId === memory.id ? '收起' : '为什么召回'}
                  </button>
                )}
              </div>
              <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>
                {memory.content.slice(0, 160)}{memory.content.length > 160 ? '…' : ''}
              </span>
              {expandedId === memory.id && breakdown && (
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 4, fontSize: 12.5, color: 'var(--text-secondary)' }}>
                  <strong style={{ fontSize: 12.5 }}>评分构成（finalScore = (全文+语义) × 质量乘数）</strong>
                  <span>全文贡献 {breakdown.fulltextContribution.toFixed(6)}{breakdown.fulltextRank ? `（rank ${breakdown.fulltextRank}）` : ''}</span>
                  <span>语义贡献 {breakdown.semanticContribution.toFixed(6)}{breakdown.semanticRank ? `（rank ${breakdown.semanticRank}）` : ''}</span>
                  <span>热度加成 {breakdown.hitBoost.toFixed(6)} · 置信加成 {breakdown.confidenceBoost.toFixed(6)} · 持久层加成 {breakdown.durableLayerBoost.toFixed(6)}</span>
                  {breakdown.qualityMultiplier !== undefined && <span>质量乘数 ×{breakdown.qualityMultiplier.toFixed(4)}（乘性微调，上限 ±15%）</span>}
                  <span>最终得分 {breakdown.finalScore.toFixed(6)}</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
