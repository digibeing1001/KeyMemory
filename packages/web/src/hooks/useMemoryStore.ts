import { useState, useEffect, useCallback, useRef } from 'react';
import type { Layer, Memory } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import * as api from '../lib/api';
import { useToast } from '../components/Toast';

interface LayerStatValue {
  count: number;
  active: number;
}

interface UseMemoryStoreReturn {
  memories: Memory[];
  selectedLayer: Layer | null;
  selectedId: string | null;
  isCreating: boolean;
  searchQuery: string | null;
  layerStats: Record<Layer, LayerStatValue>;
  healthOk: boolean;
  activeProject: string | null;
  loading: boolean;
  selectedMemory: Memory | null;
  selectLayer: (layer: Layer | null) => void;
  selectMemory: (id: string) => void;
  createNew: () => void;
  cancelCreate: () => void;
  save: (data: { title: string; content: string; layer: Layer; project?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  archiveMemory: (id: string) => Promise<void>;
  moveLayer: (id: string, layer: Layer) => Promise<void>;
  search: (query: string) => Promise<void>;
  clearSearch: () => void;
  setActiveProject: (project: string | null) => void;
  refresh: () => void;
}

export function useMemoryStore(): UseMemoryStoreReturn {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [selectedLayer, setSelectedLayer] = useState<Layer | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [layerStats, setLayerStats] = useState<Record<Layer, LayerStatValue>>(() => {
    const init = {} as Record<Layer, LayerStatValue>;
    for (const l of LAYERS) init[l] = { count: 0, active: 0 };
    return init;
  });
  const [healthOk, setHealthOk] = useState(false);
  const [activeProject, setActiveProjectState] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);
  const loadingCountRef = useRef(0);
  const { toast } = useToast();

  const updateLoading = useCallback((delta: number) => {
    loadingCountRef.current = Math.max(0, loadingCountRef.current + delta);
    if (mountedRef.current) setLoading(loadingCountRef.current > 0);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [selectedMemory, setSelectedMemory] = useState<Memory | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setSelectedMemory(null);
      return;
    }
    const found = memories.find((m) => m.id === selectedId);
    if (found) {
      setSelectedMemory(found);
    } else {
      // 如果当前列表中没有该记忆（如搜索结果来自其他层级），单独获取
      api.getMemory(selectedId)
        .then((m) => { if (mountedRef.current) setSelectedMemory(m); })
        .catch(() => { if (mountedRef.current) setSelectedMemory(null); });
    }
  }, [selectedId, memories]);

  const fetchMemories = useCallback(async () => {
    updateLoading(1);
    try {
      const list = await api.listMemories({
        layer: selectedLayer ?? undefined,
        project: activeProject ?? undefined,
        status: 'active',
      });
      if (mountedRef.current) setMemories(list);
    } catch (err) {
      toast('加载记忆失败: ' + ((err as Error).message || '请检查网络'), 'error');
      if (mountedRef.current) setMemories([]);
    } finally {
      updateLoading(-1);
    }
  }, [selectedLayer, activeProject, toast, updateLoading]);

  const fetchStats = useCallback(async () => {
    updateLoading(1);
    try {
      const stats = await api.getLayerStats();
      if (mountedRef.current) setLayerStats(stats);
    } catch (err) {
      toast('统计加载失败: ' + ((err as Error).message || '未知错误'), 'error');
    } finally {
      updateLoading(-1);
    }
  }, [toast, updateLoading]);

  const checkHealth = useCallback(async () => {
    try {
      await api.getHealth();
      if (mountedRef.current) setHealthOk(true);
    } catch {
      if (mountedRef.current) setHealthOk(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  useEffect(() => {
    checkHealth();
    const timer = setInterval(checkHealth, 30000);
    return () => clearInterval(timer);
  }, [checkHealth]);

  const selectLayer = useCallback((layer: Layer | null) => {
    setSelectedLayer(layer);
    setSelectedId(null);
    setIsCreating(false);
    setSearchQuery(null);
  }, []);

  const selectMemory = useCallback((id: string) => {
    setSelectedId(id);
    setIsCreating(false);
  }, []);

  const createNew = useCallback(() => {
    setIsCreating(true);
    setSelectedId(null);
  }, []);

  const cancelCreate = useCallback(() => {
    setIsCreating(false);
  }, []);

  const save = useCallback(async (data: { title: string; content: string; layer: Layer; project?: string; tags?: string[]; source?: string; metadata?: Record<string, unknown> }) => {
    updateLoading(1);
    try {
      if (selectedMemory) {
        const updated = await api.updateMemory(selectedMemory.id, data);
        setMemories((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      } else {
        const created = await api.createMemory(data);
        setMemories((prev) => [created, ...prev]);
        setSelectedId(created.id);
      }
      setIsCreating(false);
      fetchStats();
    } finally {
      updateLoading(-1);
    }
  }, [selectedMemory, fetchStats, updateLoading]);

  const deleteMemory = useCallback(async (id: string) => {
    updateLoading(1);
    try {
      await api.deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
      fetchStats();
    } finally {
      updateLoading(-1);
    }
  }, [selectedId, fetchStats, updateLoading]);

  const archiveMemory = useCallback(async (id: string) => {
    updateLoading(1);
    try {
      await api.forgetMemory(id, 'archive');
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
      fetchStats();
    } finally {
      updateLoading(-1);
    }
  }, [selectedId, fetchStats, updateLoading]);

  const moveLayer = useCallback(async (id: string, layer: Layer) => {
    updateLoading(1);
    try {
      const updated = await api.moveLayer(id, layer);
      setMemories((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      fetchStats();
    } finally {
      updateLoading(-1);
    }
  }, [fetchStats, updateLoading]);

  const search = useCallback(async (query: string) => {
    setSearchQuery(query);
    updateLoading(1);
    try {
      const results = await api.searchMemories(query, selectedLayer ?? undefined);
      if (mountedRef.current) setMemories(results);
    } catch (err) {
      toast('搜索失败: ' + ((err as Error).message || '请检查网络'), 'error');
      if (mountedRef.current) setMemories([]);
    } finally {
      updateLoading(-1);
    }
  }, [selectedLayer, toast, updateLoading]);

  const clearSearch = useCallback(() => {
    setSearchQuery(null);
    fetchMemories();
  }, [fetchMemories]);

  const setActiveProject = useCallback((project: string | null) => {
    setActiveProjectState(project);
  }, []);

  const refresh = useCallback(() => {
    fetchMemories();
    fetchStats();
  }, [fetchMemories, fetchStats]);

  return {
    memories,
    selectedLayer,
    selectedId,
    isCreating,
    searchQuery,
    layerStats,
    healthOk,
    activeProject,
    loading,
    selectedMemory,
    selectLayer,
    selectMemory,
    createNew,
    cancelCreate,
    save,
    deleteMemory,
    archiveMemory,
    moveLayer,
    search,
    clearSearch,
    setActiveProject,
    refresh,
  };
}
