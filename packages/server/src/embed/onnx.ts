import ort from 'onnxruntime-node';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { getDataDir } from '../db/sqlite.js';

const MODEL_DIR = path.join(getDataDir(), 'models');
const MODEL_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';
const MODEL_PATH = path.join(MODEL_DIR, 'all-MiniLM-L6-v2.onnx');
const TOKENIZER_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json';

const EMBEDDING_DIM = 384;

let session: ort.InferenceSession | null = null;

async function downloadFile(url: string, dest: string, maxRetries: number = 3): Promise<void> {
  const dir = path.dirname(dest);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let retryCount = 0;

  const attemptDownload = (): Promise<void> => {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location;
          if (redirectUrl) {
            downloadFile(redirectUrl, dest, maxRetries).then(resolve).catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download, status code: ${response.statusCode}`));
          return;
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close();
          resolve();
        });
      }).on('error', (err) => {
        fs.unlinkSync(dest);
        reject(err);
      });
    });
  };

  while (retryCount < maxRetries) {
    try {
      return await attemptDownload();
    } catch (err) {
      retryCount++;
      if (retryCount >= maxRetries) {
        throw err;
      }
      console.log(`Download failed, retrying (${retryCount}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, 2000 * retryCount)); // 递增等待时间
    }
  }

  throw new Error('Max retries exceeded');
}

async function ensureModel(): Promise<void> {
  if (fs.existsSync(MODEL_PATH)) return;
  console.log('Downloading embedding model all-MiniLM-L6-v2...');
  await downloadFile(MODEL_URL, MODEL_PATH);
  console.log('Model downloaded successfully.');
}

export async function initEmbedding(): Promise<void> {
  await ensureModel();
  const modelBuffer = fs.readFileSync(MODEL_PATH);
  session = await ort.InferenceSession.create(new Uint8Array(modelBuffer.buffer, modelBuffer.byteOffset, modelBuffer.byteLength), {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
  });
  console.log('ONNX embedding session initialized.');
}

function simpleTokenize(text: string): number[] {
  const vocabSize = 30522;
  const tokens: number[] = [101]; //<[BOS_never_used_51bce0c785ca2f68081bfa7d91973934]> - CLS token

  // 改进的分词逻辑：保留基本标点，提高准确性
  const processed = text
    .toLowerCase()
    .replace(/([.,!?;:"'()\[\]{}])/g, ' $1 ') // 在标点前后加空格
    .replace(/\s+/g, ' ')
    .trim();

  const words = processed.split(' ').slice(0, 510); // 保留 510 tokens 以内

  for (const word of words) {
    if (!word) continue;

    // 改进的哈希函数：更稳定的哈希
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      const char = word.charCodeAt(i);
      hash = ((hash << 5) - hash + char);
      hash = hash & 0x7fffffff; // 确保正数
    }

    // 分配 token 范围：999-30521
    const tokenId = (hash % (vocabSize - 999)) + 999;
    tokens.push(tokenId);
  }

  tokens.push(102); // [SEP]
  return tokens;
}

export async function embed(text: string): Promise<Float32Array> {
  if (!session) throw new Error('Embedding session not initialized. Call initEmbedding() first.');

  const tokens = simpleTokenize(text);
  const inputIds = new ort.Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]);
  const attentionMask = new ort.Tensor('int64', BigInt64Array.from(tokens.map(() => 1n)), [1, tokens.length]);
  const tokenTypeIds = new ort.Tensor('int64', BigInt64Array.from(tokens.map(() => 0n)), [1, tokens.length]);

  const output = await session.run({
    input_ids: inputIds,
    attention_mask: attentionMask,
    token_type_ids: tokenTypeIds,
  });

  const lastHidden = output['last_hidden_state'];
  const data = lastHidden.data as Float32Array;
  const seqLen = lastHidden.dims[1];
  const hiddenSize = lastHidden.dims[2];

  const pooled = new Float32Array(hiddenSize);
  for (let i = 0; i < hiddenSize; i++) {
    let sum = 0;
    for (let j = 0; j < seqLen; j++) {
      sum += data[j * hiddenSize + i];
    }
    pooled[i] = sum / seqLen;
  }

  let norm = 0;
  for (let i = 0; i < pooled.length; i++) norm += pooled[i] * pooled[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < pooled.length; i++) pooled[i] /= norm;
  }

  return pooled;
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = [];
  for (const text of texts) {
    results.push(await embed(text));
  }
  return results;
}

export function embeddingToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

export function bufferToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

export { EMBEDDING_DIM };
