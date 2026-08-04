/**
 * KM-407：Graph 视图——关系图可见可治理。
 * 展示记忆连接图的节点/边统计，共现弱边（relates_to 且 strength 低）可批量剪枝。
 */
import { useEffect, useMemo, useState } from 'react';
import { getMemoryConnections, pruneGraphWeakEdges } from '../lib/api';
import type { MemoryGraphData } from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';

interface GraphViewProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export default function GraphView({ onToast }: GraphViewProps) {
  const [graph, setGraph] = useState<MemoryGraphData | null>(null);
  const [minStrength, setMinStrength] = useState(0.2);
  const [pruning, setPruning] = useState(false);

  const load = async () => {
    try {
      setGraph(await getMemoryConnections());
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  };

  useEffect(() => { void load(); }, []);

  const weakEdgeCount = useMemo(() => (
    graph ? graph.edges.filter(edge => edge.type === 'relates_to' && (edge.strength ?? 0) < minStrength).length : 0
  ), [graph, minStrength]);

  const handlePrune = async () => {
    setPruning(true);
    try {
      const result = await pruneGraphWeakEdges(minStrength);
      onToast(`已剪除 ${result.pruned} 条弱关系边（strength < ${minStrength}）`, 'success');
      await load();
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setPruning(false);
    }
  };

  const edgeTypeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph?.edges ?? []) counts.set(edge.type, (counts.get(edge.type) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [graph]);

  return (
    <div style={{ display: 'grid', gap: 14, padding: 20, maxWidth: 980 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--text-primary)' }}>Graph · 关系治理</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          共现弱边会污染上下文扩展——定期剪枝，强语义边（supersedes 等）不受影响。
        </p>
      </header>

      <Card
        title="图谱规模"
        extra={graph && <Badge>{graph.nodesCount} 节点 · {graph.edges.length} 边</Badge>}
      >
        {graph && graph.edges.length === 0 ? (
          <EmptyState title="还没有关系边" hint="在记忆详情中建立关系，或等待 dream 自动关联" />
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {edgeTypeCounts.map(([type, count]) => (
              <Badge key={type} tone={type === 'relates_to' ? 'neutral' : 'good'}>{type} × {count}</Badge>
            ))}
          </div>
        )}
      </Card>

      <Card title="弱边剪枝">
        <div style={{ display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            强度阈值 <strong>{minStrength.toFixed(2)}</strong>
            <input
              type="range"
              min={0.05}
              max={0.9}
              step={0.05}
              value={minStrength}
              onChange={event => setMinStrength(Number(event.target.value))}
              aria-label="弱边强度阈值"
              style={{ flex: 1 }}
            />
          </label>
          <span>
            当前将剪除 <strong style={{ color: weakEdgeCount > 0 ? '#b58a2e' : 'inherit' }}>{weakEdgeCount}</strong> 条
            relates_to 弱边（strength &lt; {minStrength.toFixed(2)}）。supersedes/derived_from 等强语义边不受影响。
          </span>
          <div>
            <button className="btn btn-primary" disabled={pruning || weakEdgeCount === 0} onClick={() => void handlePrune()}>
              {pruning ? '剪枝中…' : `剪除 ${weakEdgeCount} 条弱边`}
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
