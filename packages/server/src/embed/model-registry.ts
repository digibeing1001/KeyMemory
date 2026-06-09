import { HardwareProfile } from './hardware-profiler.js';

export interface ModelConfig {
  id: string;
  displayName: string;
  dim: number;
  diskSize: string;
  minRAM_GB: number;
  minVRAM_GB?: number;
  hfRepo: string;
  description: string;
  chineseOptimized: boolean;
  supportedTiers: Array<'low' | 'mid' | 'high'>;
}

export const MODEL_REGISTRY: Record<string, ModelConfig> = {
  'bge-m3': {
    id: 'bge-m3',
    displayName: 'BGE-M3（中文优化·高精度）',
    dim: 1024,
    diskSize: '~1.2GB',
    minRAM_GB: 4,
    hfRepo: 'Xenova/bge-m3',
    description: 'BAAI 出品，CMTEB 中文榜单领先，支持多语言稠密检索',
    chineseOptimized: true,
    supportedTiers: ['low', 'mid', 'high'],
  },
  'bge-small-zh': {
    id: 'bge-small-zh',
    displayName: 'BGE-small-zh（中文轻量）',
    dim: 512,
    diskSize: '~90MB',
    minRAM_GB: 1,
    hfRepo: 'Xenova/bge-small-zh-v1.5',
    description: 'BAAI 出品中文轻量模型，低配设备首选，中文效果远优于英文模型',
    chineseOptimized: true,
    supportedTiers: ['low', 'mid', 'high'],
  },
  'all-MiniLM-L6-v2': {
    id: 'all-MiniLM-L6-v2',
    displayName: 'all-MiniLM-L6-v2（英文轻量）',
    dim: 384,
    diskSize: '~22MB',
    minRAM_GB: 1,
    hfRepo: 'Xenova/all-MiniLM-L6-v2',
    description: '英文轻量模型，中文效果差，仅作为纯英文场景 fallback',
    chineseOptimized: false,
    supportedTiers: ['low', 'mid', 'high'],
  },
};

export function listAvailableModels(): ModelConfig[] {
  return Object.values(MODEL_REGISTRY);
}

export function getModelConfig(modelId: string): ModelConfig | undefined {
  return MODEL_REGISTRY[modelId];
}

export function selectModelByHardware(profile: HardwareProfile): string {
  const override = process.env.KEYMEMORY_EMBED_MODEL;
  if (override && MODEL_REGISTRY[override]) {
    return override;
  }

  const candidates = Object.values(MODEL_REGISTRY).filter(
    (m) =>
      m.supportedTiers.includes(profile.tier) &&
      profile.ramGB >= m.minRAM_GB
  );

  // 优先选择中文优化模型，同级别选维度更高的
  candidates.sort((a, b) => {
    if (a.chineseOptimized !== b.chineseOptimized) {
      return a.chineseOptimized ? -1 : 1;
    }
    // 同为中文优化：高配选大模型，低配选轻量模型
    if (a.chineseOptimized && b.chineseOptimized) {
      if (profile.tier === 'high' || profile.ramGB >= 8) {
        return b.dim - a.dim; // 高配选维度高的大模型
      }
      return a.dim - b.dim; // 低配选维度低的轻量模型
    }
    return b.dim - a.dim;
  });

  if (candidates.length > 0) {
    return candidates[0].id;
  }

  // 绝对 fallback：中文轻量模型
  return 'bge-small-zh';
}
