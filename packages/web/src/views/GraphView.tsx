/**
 * KM-407：Graph 视图——关系图可见可治理。
 * 展示记忆连接图的节点/边统计，共现弱边（relates_to 且 strength 低）可批量剪枝。
 */
import { useEffect, useMemo, useState } from 'react';
import { getMemoryConnections, pruneGraphWeakEdges } from '../lib/api';
import type { MemoryGraphData } from '../lib/api';
import { Card, Badge, EmptyState } from '../components/ui';
import ConfirmDialog from '../components/ConfirmDialog';
import { useI18n } from '../i18n';
import { userFacingRelation } from '../lib/userFacing';

interface GraphViewProps {
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

export default function GraphView({ onToast }: GraphViewProps) {
  const { language } = useI18n();
  const zh = language === 'zh';
  const [graph, setGraph] = useState<MemoryGraphData | null>(null);
  const [minStrength, setMinStrength] = useState(0.2);
  const [pruning, setPruning] = useState(false);
  const [confirming, setConfirming] = useState(false);

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
      onToast(zh ? `已清理 ${result.pruned} 条低可信关联，记忆正文没有被删除` : `Removed ${result.pruned} low-confidence links; memory bodies were not deleted`, 'success');
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
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--text-primary)' }}>{zh ? '记忆关联管理' : 'Memory links'}</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          {zh ? '关联帮助 Agent 找到同一件事的补充信息。这里可以清理系统自动产生但可信度较低的关联，不会删除记忆正文。' : 'Links help Agents find supporting context. You can remove low-confidence automatic links here without deleting memories.'}
        </p>
      </header>

      <Card
        title={zh ? '当前关联概况' : 'Current link overview'}
        extra={graph && <Badge>{graph.nodesCount} {zh ? '条记忆' : 'memories'} · {graph.edges.length} {zh ? '条关联' : 'links'}</Badge>}
      >
        {graph && graph.edges.length === 0 ? (
          <EmptyState title={zh ? '还没有记忆关联' : 'No memory links yet'} hint={zh ? '当记忆内容相关、互相引用或新说法取代旧说法时，关联会出现在这里。' : 'Links appear when memories are related, reference each other, or replace older information.'} />
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {edgeTypeCounts.map(([type, count]) => (
              <Badge key={type} tone={type === 'relates_to' ? 'neutral' : 'good'}>{userFacingRelation(type, language)} × {count}</Badge>
            ))}
          </div>
        )}
      </Card>

      <Card title={zh ? '清理低可信关联' : 'Clean up low-confidence links'}>
        <div style={{ display: 'grid', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {zh ? '清理范围' : 'Cleanup threshold'} <strong>{Math.round(minStrength * 100)}%</strong>
            <input
              type="range"
              min={0.05}
              max={0.9}
              step={0.05}
              value={minStrength}
              onChange={event => setMinStrength(Number(event.target.value))}
              aria-label={zh ? '低可信关联清理范围' : 'Low-confidence link cleanup threshold'}
              style={{ flex: 1 }}
            />
          </label>
          <span>
            {zh ? '当前会清理' : 'This will remove'} <strong style={{ color: weakEdgeCount > 0 ? '#b58a2e' : 'inherit' }}>{weakEdgeCount}</strong> {zh ? '条由内容共现自动产生、可信度较低的关联。明确的引用、来源和“新说法取代旧说法”不会受影响。' : 'automatic co-occurrence links below this confidence level. Explicit references, sources, and replacement links are not affected.'}
          </span>
          <div>
            <button className="btn btn-primary" disabled={pruning || weakEdgeCount === 0} onClick={() => setConfirming(true)}>
              {pruning ? (zh ? '清理中…' : 'Cleaning…') : (zh ? `清理 ${weakEdgeCount} 条低可信关联` : `Remove ${weakEdgeCount} low-confidence links`)}
            </button>
          </div>
        </div>
      </Card>
      <ConfirmDialog
        open={confirming}
        title={zh ? '确认清理这些关联？' : 'Remove these links?'}
        message={zh ? `将移除 ${weakEdgeCount} 条可信度低于 ${Math.round(minStrength * 100)}% 的自动关联。记忆正文不会被删除，明确引用和新旧版本关系也不会改变。` : `This removes ${weakEdgeCount} automatic links below ${Math.round(minStrength * 100)}% confidence. Memory bodies and explicit lineage links remain unchanged.`}
        confirmLabel={zh ? '确认清理' : 'Remove links'}
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); void handlePrune(); }}
      />
    </div>
  );
}
