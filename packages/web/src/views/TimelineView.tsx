/**
 * KM-405：Timeline 视图——时态能力出口。
 * as-of 滑块直连 listMemories(asOf)：拖动即可查看"那一天我认为什么是对的"，
 * 被 supersede/超出有效期窗口的记忆随时间点自然消失。
 */
import { useEffect, useMemo, useState } from 'react';
import type { Memory } from '@keymemory/shared';
import { listMemories } from '../lib/api';
import { Card, EmptyState, Timeline } from '../components/ui';
import type { TimelineEntry } from '../components/ui';
import { useI18n } from '../i18n';
import { userFacingLayer } from '../lib/userFacing';

const DAY_MS = 86400000;

export default function TimelineView({ embedded = false }: { embedded?: boolean }) {
  const { language } = useI18n();
  const [offsetDays, setOffsetDays] = useState(0); // 0 = 现在
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(false);

  const asOf = useMemo(() => new Date(Date.now() - offsetDays * DAY_MS).toISOString(), [offsetDays]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMemories({ asOf, limit: 100 })
      .then(list => { if (!cancelled) setMemories(list); })
      .catch(() => { if (!cancelled) setMemories([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [asOf]);

  const entries: TimelineEntry[] = useMemo(() => (
    [...memories]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(mem => ({
        time: new Date(mem.updatedAt).toLocaleString(),
        title: mem.title,
        description: `${userFacingLayer(mem.layer, language)}${mem.validTo ? ` · 有效期至 ${new Date(mem.validTo).toLocaleDateString()}` : ''}`,
        tone: mem.layer === 'long' || mem.layer === 'entity' ? 'good' : mem.layer === 'short' ? 'neutral' : 'warn',
      }))
  ), [language, memories]);

  return (
    <div style={{ display: 'grid', gap: 14, padding: embedded ? 0 : 20, maxWidth: 980 }}>
      {!embedded && (
        <header>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--text-primary)' }}>时间回溯</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
            拖动滑块，查看过去某一天当时仍然有效的记忆。
          </p>
        </header>
      )}

      <Card
        title={offsetDays === 0 ? '当前时刻' : `${offsetDays} 天前`}
        extra={<span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(asOf).toLocaleString()}</span>}
      >
        <input
          type="range"
          min={0}
          max={365}
          value={offsetDays}
          onChange={event => setOffsetDays(Number(event.target.value))}
          aria-label="历史时间滑块（距今天数）"
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-muted)' }}>
          <span>今天</span>
          <span>3 个月前</span>
          <span>1 年前</span>
        </div>
      </Card>

      <Card title={loading ? '加载中…' : `该时刻有效的记忆（${memories.length}）`}>
        {!loading && entries.length === 0 ? (
          <EmptyState title="该时刻没有有效记忆" hint="试试把滑块移近现在" />
        ) : (
          <Timeline entries={entries} />
        )}
      </Card>
    </div>
  );
}
