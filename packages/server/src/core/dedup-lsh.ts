/**
 * KM-204/D8：LSH（局部敏感哈希）近似去重候选生成
 *
 * 旧实现是主线程 O(n²) 全量余弦比较：2000 条 ≈ 200 万次比较阻塞事件循环，
 * 被迫把 fullScanLimit 从 2000 降到 500 掩盖复杂度，代价是大库去重覆盖率单调下降。
 *
 * 方案：随机超平面 LSH（SimHash 族，对余弦相似度单调敏感）+ 多轮放大召回：
 * - 每轮：向量投影到 P=128 个确定性超平面得位签名，切成 B=16 段（每段 R=8 位，
 *   256 个桶），任一段完全相同即成为候选对；
 * - R=8 使随机对（cos≈0）单段碰撞概率仅 ≈1/256，候选规模远小于 O(n²)；
 * - cos≈0.9 单轮召回 ≈34%，默认 rounds=5 轮不同种子取并集 → 累计召回 ≈82%，
 *   cos≥0.95 时接近 100%；只对候选对做精确余弦复核（分块让出事件循环）。
 *
 * 超平面由固定种子确定性生成并按维度缓存：同库多次运行结果可复现。
 */

export interface LshOptions {
  /** 每轮签名位数，默认 128 */
  bits?: number;
  /** 每轮分段数（bands），默认 16；bits 必须能被 bands 整除且每段位数为 4 的倍数 */
  bands?: number;
  /** 轮数（不同种子的独立哈希取并集，放大召回），默认 5 */
  rounds?: number;
  /** 随机种子基数（确定性） */
  seed?: number;
  /** 单桶候选上限，防止热桶退化 */
  maxBucketSize?: number;
}

export interface LshItem {
  index: number;
  vec: Float32Array;
}

/** 确定性伪随机数（mulberry32），保证同种子生成同一组超平面。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const planeCache = new Map<string, Float32Array[]>();

/** 生成（或取缓存的）单位超平面组。Box-Muller 生成近似高斯分量后归一化。 */
export function getHyperplanes(dim: number, bits: number, seed: number): Float32Array[] {
  const key = `${dim}:${bits}:${seed}`;
  const cached = planeCache.get(key);
  if (cached) return cached;
  const rand = mulberry32(seed);
  const planes: Float32Array[] = [];
  for (let b = 0; b < bits; b++) {
    const plane = new Float32Array(dim);
    let norm = 0;
    for (let d = 0; d < dim; d += 2) {
      const u1 = Math.max(rand(), 1e-12);
      const u2 = rand();
      const r = Math.sqrt(-2 * Math.log(u1));
      const g1 = r * Math.cos(2 * Math.PI * u2);
      const g2 = r * Math.sin(2 * Math.PI * u2);
      plane[d] = g1;
      norm += g1 * g1;
      if (d + 1 < dim) {
        plane[d + 1] = g2;
        norm += g2 * g2;
      }
    }
    const inv = norm > 0 ? 1 / Math.sqrt(norm) : 0;
    for (let d = 0; d < dim; d++) plane[d] *= inv;
    planes.push(plane);
  }
  planeCache.set(key, planes);
  return planes;
}

function dotPlane(vec: Float32Array, plane: Float32Array): number {
  let sum = 0;
  const n = Math.min(vec.length, plane.length);
  for (let i = 0; i < n; i++) sum += vec[i] * plane[i];
  return sum;
}

/** 计算一条向量的 LSH 签名（每个 bit 打包进十六进制字符串）。 */
export function lshSignature(vec: Float32Array, planes: Float32Array[]): string {
  let sig = '';
  for (let i = 0; i < planes.length; i += 4) {
    let nibble = 0;
    for (let k = 0; k < 4 && i + k < planes.length; k++) {
      if (dotPlane(vec, planes[i + k]) >= 0) nibble |= 1 << k;
    }
    sig += nibble.toString(16);
  }
  return sig;
}

/**
 * 生成候选对索引集合（近似 O(n) 建桶 + 桶内两两，桶大小有上限）。
 * 返回去重后的候选对 [i, j]（i < j），调用方再做精确余弦复核。
 */
export function lshCandidatePairs(items: LshItem[], options: LshOptions = {}): Array<[number, number]> {
  if (items.length < 2) return [];
  const bits = options.bits ?? 128;
  const bands = options.bands ?? 16;
  const rounds = Math.max(1, options.rounds ?? 5);
  const seedBase = options.seed ?? 0x5eed;
  const maxBucketSize = options.maxBucketSize ?? 64;
  if (bits % bands !== 0) throw new Error('LSH bits must be divisible by bands');
  if ((bits / bands) % 4 !== 0) throw new Error('LSH bits per band must be a multiple of 4');
  const segLen = bits / bands / 4; // 每段的十六进制字符数（4bit/字符）

  const dim = items[0].vec.length;
  const pairSet = new Set<string>();
  const pairs: Array<[number, number]> = [];
  const addPair = (a: number, b: number): void => {
    const i = Math.min(a, b);
    const j = Math.max(a, b);
    const key = `${i}:${j}`;
    if (!pairSet.has(key)) {
      pairSet.add(key);
      pairs.push([i, j]);
    }
  };

  for (let round = 0; round < rounds; round++) {
    const planes = getHyperplanes(dim, bits, seedBase + round * 7919);
    const signatures = items.map(item => lshSignature(item.vec, planes));
    for (let band = 0; band < bands; band++) {
      const buckets = new Map<string, number[]>();
      const start = band * segLen;
      for (let i = 0; i < items.length; i++) {
        const key = signatures[i].slice(start, start + segLen);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(i);
        else buckets.set(key, [i]);
      }
      for (const bucket of buckets.values()) {
        if (bucket.length < 2) continue;
        const capped = bucket.length > maxBucketSize ? bucket.slice(0, maxBucketSize) : bucket;
        for (let x = 0; x < capped.length; x++) {
          for (let y = x + 1; y < capped.length; y++) {
            addPair(capped[x], capped[y]);
          }
        }
      }
    }
  }
  return pairs;
}

/** 让出事件循环（分块处理时避免长时间占用主线程）。 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
