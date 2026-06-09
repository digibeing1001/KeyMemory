import { pipeline, env } from '@xenova/transformers';
import path from 'path';
import fs from 'fs';
import { getDataDir } from '../db/sqlite.js';
import { detectHardware } from './hardware-profiler.js';
import { getModelConfig, selectModelByHardware, MODEL_REGISTRY } from './model-registry.js';

const MODEL_DIR = path.join(getDataDir(), 'models');

let extractor: any = null;
let modelAvailable = false;
let modelLoadError: string | null = null;
let currentModelId: string | null = null;
let currentDim = 384;

export function isEmbeddingAvailable(): boolean {
  return modelAvailable;
}

export function getEmbeddingLoadError(): string | null {
  return modelLoadError;
}

export function getCurrentModelInfo(): { id: string | null; dim: number; name: string } {
  const config = currentModelId ? getModelConfig(currentModelId) : undefined;
  return {
    id: currentModelId,
    dim: currentDim,
    name: config?.displayName ?? '未知',
  };
}

function printModelGuide(modelId: string, hardware: ReturnType<typeof detectHardware>): void {
  const config = getModelConfig(modelId);
  if (!config) return;

  const lines = [
    '',
    '╔══════════════════════════════════════════════════════════════════════╗',
    '║              嵌入模型未就绪 · 开发阶段引导                            ║',
    '╠══════════════════════════════════════════════════════════════════════╣',
    `║  推荐模型 : ${config.displayName.padEnd(55)}║`,
    `║  向量维度 : ${String(config.dim).padEnd(55)}║`,
    `║  磁盘占用 : ${config.diskSize.padEnd(55)}║`,
    `║  中文优化 : ${(config.chineseOptimized ? '✓ 是' : '✗ 否').padEnd(55)}║`,
    `║  您的硬件 : ${`${hardware.ramGB}GB RAM · ${hardware.cpuCores}核 CPU${hardware.gpuName ? ' · ' + hardware.gpuName : ''}`.padEnd(55)}║`,
    '╠══════════════════════════════════════════════════════════════════════╣',
    '║  开发阶段：模型未自动下载，语义搜索暂不可用                           ║',
    '║                                                                      ║',
    '║  部署时自动下载：                                                     ║',
    '║    $ KEYMEMORY_AUTO_DOWNLOAD=1 npm start                             ║',
    '║                                                                      ║',
    '║  或手动指定模型（环境变量）：                                         ║',
    '║    $ KEYMEMORY_EMBED_MODEL=bge-small-zh npm start            ║',
    '║                                                                      ║',
    '║  可用模型列表：                                                       ║',
  ];

  for (const m of Object.values(MODEL_REGISTRY)) {
    const tag = m.chineseOptimized ? '[中文]' : '[英文]';
    lines.push(`║    · ${tag} ${m.displayName} — ${m.diskSize}${m.minVRAM_GB ? ` · 需 ${m.minVRAM_GB}GB+ VRAM` : ''}`.padEnd(72) + '║');
  }

  lines.push('╚══════════════════════════════════════════════════════════════════════╝', '');
  console.log(lines.join('\n'));
}

export async function initEmbedding(): Promise<void> {
  try {
    const hardware = detectHardware();
    const selectedModelId = selectModelByHardware(hardware);
    const config = getModelConfig(selectedModelId);

    if (!config) {
      throw new Error(`未知模型: ${selectedModelId}`);
    }

    currentModelId = selectedModelId;
    currentDim = config.dim;

    // Configure Transformers.js environment
    env.cacheDir = MODEL_DIR;
    const allowRemote = process.env.KEYMEMORY_AUTO_DOWNLOAD === '1';
    env.allowRemoteModels = allowRemote;
    env.allowLocalModels = true;

    console.log(`[KeyMemory] 硬件检测: ${hardware.ramGB}GB RAM · ${hardware.cpuCores}核 CPU${hardware.gpuName ? ' · GPU: ' + hardware.gpuName : ''}`);
    console.log(`[KeyMemory] 推荐模型: ${config.displayName} (${config.dim}维)`);

    try {
      extractor = await pipeline('feature-extraction', config.hfRepo);
      modelAvailable = true;
      modelLoadError = null;
      console.log(`[KeyMemory] 嵌入模型加载成功: ${config.displayName}`);
    } catch (err) {
      const msg = (err as Error).message;
      if (
        msg.includes('fetch') ||
        msg.includes('download') ||
        msg.includes('remote') ||
        msg.includes('Could not locate file') ||
        msg.includes('ENOENT')
      ) {
        printModelGuide(selectedModelId, hardware);
        modelLoadError = `模型未就绪: ${config.displayName}。开发阶段跳过下载；部署时设置 KEYMEMORY_AUTO_DOWNLOAD=1。`;
      } else {
        modelLoadError = msg;
        console.error(`[KeyMemory] 模型加载失败: ${msg}`);
      }
      modelAvailable = false;
      console.log('[KeyMemory] 语义搜索已禁用，全文搜索仍可用。');
    }
  } catch (err) {
    modelAvailable = false;
    modelLoadError = (err as Error).message;
    console.error(`[KeyMemory] 嵌入初始化失败: ${modelLoadError}`);
  }
}

export async function embed(text: string): Promise<Float32Array | null> {
  if (!modelAvailable || !extractor) return null;

  try {
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    const data = output.data;
    if (data instanceof Float32Array) {
      return data;
    }
    if (Array.isArray(data)) {
      return new Float32Array(data);
    }
    return null;
  } catch (err) {
    console.error(`[KeyMemory] Embedding error: ${(err as Error).message}`);
    return null;
  }
}

export async function embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
  if (!modelAvailable || !extractor || texts.length === 0) {
    return texts.map(() => null);
  }

  try {
    const output = await extractor(texts, { pooling: 'mean', normalize: true });
    const results: (Float32Array | null)[] = [];

    if (Array.isArray(output)) {
      for (const item of output) {
        const data = item?.data;
        if (data instanceof Float32Array) {
          results.push(data);
        } else if (Array.isArray(data)) {
          results.push(new Float32Array(data));
        } else {
          results.push(null);
        }
      }
    } else {
      // Single tensor returned for batch — should not happen with pooling,
      // but handle defensively
      const data = output?.data;
      if (data instanceof Float32Array) {
        results.push(data);
      } else {
        results.push(null);
      }
    }

    // Pad to expected length if batch result is short
    while (results.length < texts.length) {
      results.push(null);
    }

    return results;
  } catch (err) {
    console.error(`[KeyMemory] Batch embedding error: ${(err as Error).message}`);
    return texts.map(() => null);
  }
}

export function embeddingToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function getEmbeddingDim(): number {
  return currentDim;
}
