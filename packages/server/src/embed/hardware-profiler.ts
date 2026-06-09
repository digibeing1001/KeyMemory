import os from 'os';
import { execSync } from 'child_process';

export interface HardwareProfile {
  ramGB: number;
  cpuCores: number;
  gpuVRAM_GB?: number;
  gpuName?: string;
  isAppleSilicon: boolean;
  tier: 'low' | 'mid' | 'high';
}

function tryNvidiaSmi(): { vramGB: number; name: string } | undefined {
  try {
    const result = execSync(
      'nvidia-smi --query-gpu=memory.total,name --format=csv,noheader,nounits',
      { encoding: 'utf8', timeout: 5000, windowsHide: true }
    );
    const lines = result.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return undefined;
    // Use the first GPU
    const [memStr, ...nameParts] = lines[0].split(',').map(s => s.trim());
    const memMB = parseInt(memStr, 10);
    if (Number.isNaN(memMB)) return undefined;
    return { vramGB: Math.round(memMB / 1024), name: nameParts.join(', ') };
  } catch {
    return undefined;
  }
}

function tryAppleSilicon(): { vramGB: number; name: string } | undefined {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return undefined;
  try {
    // Apple Silicon has unified memory; use half of RAM as available GPU memory
    const ramMB = os.totalmem() / (1024 * 1024);
    return { vramGB: Math.round(ramMB / 1024 / 2), name: 'Apple Silicon' };
  } catch {
    return undefined;
  }
}

function determineTier(
  ramGB: number,
  cpuCores: number,
  gpuVRAM?: number
): 'low' | 'mid' | 'high' {
  if (gpuVRAM !== undefined) {
    if (gpuVRAM >= 16) return 'high';
    if (gpuVRAM >= 4) return 'mid';
  }
  // CPU-only fallback
  if (ramGB >= 32 && cpuCores >= 8) return 'high';
  if (ramGB >= 8 && cpuCores >= 4) return 'mid';
  return 'low';
}

export function detectHardware(): HardwareProfile {
  const ramGB = Math.max(1, Math.round(os.totalmem() / (1024 * 1024 * 1024)));
  const cpuCores = Math.max(1, os.cpus().length);

  const nvidia = tryNvidiaSmi();
  const apple = tryAppleSilicon();

  const gpu = nvidia ?? apple;
  const tier = determineTier(ramGB, cpuCores, gpu?.vramGB);

  return {
    ramGB,
    cpuCores,
    gpuVRAM_GB: gpu?.vramGB,
    gpuName: gpu?.name,
    isAppleSilicon: apple !== undefined,
    tier,
  };
}
