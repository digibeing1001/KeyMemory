import { useState, useEffect, useCallback, useRef } from 'react';
import type { Layer, Memory } from '@keymemory/shared';
import { LAYERS } from '@keymemory/shared';
import * as api from '../lib/api';

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

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  const selectedMemory = selectedId ? memories.find((m) => m.id === selectedId) ?? null : null;

  const fetchMemories = useCallback(async () => {
    try {
      const list = await api.listMemories({
        layer: selectedLayer ?? undefined,
        project: activeProject ?? undefined,
        status: 'active',
      });
      if (mountedRef.current) setMemories(list);
    } catch {
      if (mountedRef.current) setMemories([]);
    }
  }, [selectedLayer, activeProject]);

  const fetchStats = useCallback(async () => {
    try {
      const stats = await api.getLayerStats();
      if (mountedRef.current) setLayerStats(stats);
    } catch {}
  }, []);

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
    setLoading(true);
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
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedMemory, fetchStats]);

  const deleteMemory = useCallback(async (id: string) => {
    setLoading(true);
    try {
      await api.deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
      fetchStats();
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedId, fetchStats]);

  const archiveMemory = useCallback(async (id: string) => {
    setLoading(true);
    try {
      await api.forgetMemory(id, 'archive');
      setMemories((prev) => prev.filter((m) => m.id !== id));
      if (selectedId === id) setSelectedId(null);
      fetchStats();
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedId, fetchStats]);

  const moveLayer = useCallback(async (id: string, layer: Layer) => {
    setLoading(true);
    try {
      const updated = await api.moveLayer(id, layer);
      setMemories((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      fetchStats();
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetchStats]);

  const search = useCallback(async (query: string) => {
    setSearchQuery(query);
    setLoading(true);
    try {
      const results = await api.searchMemories(query, selectedLayer ?? undefined);
      if (mountedRef.current) setMemories(results);
    } catch {
      if (mountedRef.current) setMemories([]);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [selectedLayer]);

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
