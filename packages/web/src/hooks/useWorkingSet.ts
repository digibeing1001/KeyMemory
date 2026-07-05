import { useCallback, useEffect, useRef, useState } from 'react';
import type { Memory, LoopRun } from '@keymemory/shared';
import { listRecentHitMemories, listRecentCreatedMemories, listLoopRuns } from '../lib/api';

interface UseWorkingSetReturn {
  recentHits: Memory[];
  recentCreated: Memory[];
  loopRuns: LoopRun[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const DEFAULT_LIMIT = 20;

// 使用动态视图的数据 hook：把"近期被命中 / 近期被写入 / 智能体活动"三类
// 系统真正流动的数据合并到一处，作为记忆库使用情况的核心观测面板。
// 这一层是为了让用户能在 UI 上直观看到"哪些记忆被实际用到了、系统有没有在产出"，
// 而不是只看到长期层堆满的孤儿条目。
export function useWorkingSet(): UseWorkingSetReturn {
  const [recentHits, setRecentHits] = useState<Memory[]>([]);
  const [recentCreated, setRecentCreated] = useState<Memory[]>([]);
  const [loopRuns, setLoopRuns] = useState<LoopRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const inFlightRef = useRef(0);

  const updateLoading = (delta: number) => {
    inFlightRef.current = Math.max(0, inFlightRef.current + delta);
    if (mountedRef.current) setLoading(inFlightRef.current > 0);
  };

  const fetchAll = useCallback(async () => {
    updateLoading(1);
    setError(null);
    try {
      const [hits, created, runs] = await Promise.all([
        listRecentHitMemories(DEFAULT_LIMIT).catch((err: unknown) => {
          // loop_runs 表可能不存在等容错：单独失败不影响其它面板
          console.warn('[WorkingSet] recent-hits failed:', (err as Error)?.message);
          return [] as Memory[];
        }),
        listRecentCreatedMemories(DEFAULT_LIMIT).catch((err: unknown) => {
          console.warn('[WorkingSet] recent-created failed:', (err as Error)?.message);
          return [] as Memory[];
        }),
        listLoopRuns(DEFAULT_LIMIT).catch((err: unknown) => {
          console.warn('[WorkingSet] loop-runs failed:', (err as Error)?.message);
          return [] as LoopRun[];
        }),
      ]);
      if (!mountedRef.current) return;
      setRecentHits(hits);
      setRecentCreated(created);
      setLoopRuns(runs);
    } catch (err) {
      if (mountedRef.current) {
        setError((err as Error)?.message ?? 'Failed to load working set');
      }
    } finally {
      updateLoading(-1);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchAll]);

  const refresh = useCallback(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    recentHits,
    recentCreated,
    loopRuns,
    loading,
    error,
    refresh,
  };
}
