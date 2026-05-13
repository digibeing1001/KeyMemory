import ort from 'onnxruntime-node';
import path from 'path';
import fs from 'fs';
import https from 'https';
import { fileURLToPath } from 'url';
import { getDataDir } from '../db/sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUILTIN_MODEL_DIR = path.resolve(__dirname, '..', '..', 'models');
const USER_MODEL_DIR = path.join(getDataDir(), 'models');

const MODEL_FILENAME = 'all-MiniLM-L6-v2.onnx';
const TOKENIZER_FILENAME = 'tokenizer.json';

const MODEL_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model.onnx';
const TOKENIZER_URL = 'https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/tokenizer.json';

const EMBEDDING_DIM = 384;

let session: ort.InferenceSession | null = null;
let tokenizer: BertTokenizer | null = null;

function resolveModelPath(filename: string): string | null {
  const builtin = path.join(BUILTIN_MODEL_DIR, filename);
  if (fs.existsSync(builtin)) return builtin;

  const user = path.join(USER_MODEL_DIR, filename);
  if (fs.existsSync(user)) return user;

  return null;
}

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
        try { fs.unlinkSync(dest); } catch {}
        reject(err);
      });
    });
  };

  while (retryCount < maxRetries) {
    try {
      return await attemptDownload();
    } catch (err) {
      retryCount++;
      if (retryCount >= maxRetries) throw err;
      console.log(`Download failed, retrying (${retryCount}/${maxRetries})...`);
      await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
    }
  }

  throw new Error('Max retries exceeded');
}

async function ensureModel(): Promise<string> {
  const existing = resolveModelPath(MODEL_FILENAME);
  if (existing) return existing;

  console.log('Built-in model not found, downloading all-MiniLM-L6-v2...');
  const dest = path.join(USER_MODEL_DIR, MODEL_FILENAME);
  await downloadFile(MODEL_URL, dest);
  console.log('Model downloaded successfully.');
  return dest;
}

async function ensureTokenizer(): Promise<string> {
  const existing = resolveModelPath(TOKENIZER_FILENAME);
  if (existing) return existing;

  console.log('Built-in tokenizer not found, downloading...');
  const dest = path.join(USER_MODEL_DIR, TOKENIZER_FILENAME);
  await downloadFile(TOKENIZER_URL, dest);
  console.log('Tokenizer downloaded successfully.');
  return dest;
}

interface TokenizerConfig {
  model: {
    type: string;
    vocab: Record<string, number>;
    unk_token: string;
  };
  normalizer?: { type: string; [key: string]: unknown };
  pre_tokenizer?: { type: string; [key: string]: unknown };
}

class BertTokenizer {
  private vocab: Record<string, number> = {};
  private idToToken: Map<number, string> = new Map();
  private unkTokenId: number = 100;
  private clsTokenId: number = 101;
  private sepTokenId: number = 102;
  private maxInputCharsPerWord = 200;

  load(config: TokenizerConfig): void {
    this.vocab = config.model.vocab;

    for (const [token, id] of Object.entries(this.vocab)) {
      this.idToToken.set(id, token);
    }

    const unkToken = config.model.unk_token || '[UNK]';
    this.unkTokenId = this.vocab[unkToken] ?? 100;
    this.clsTokenId = this.vocab['[CLS]'] ?? 101;
    this.sepTokenId = this.vocab['[SEP]'] ?? 102;
  }

  tokenize(text: string): number[] {
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
    const tokens: number[] = [this.clsTokenId];

    const words = this.preTokenize(normalized);

    for (const word of words) {
      if (tokens.length >= 510) break;

      const wordTokens = this.wordPiece(word);
      for (const t of wordTokens) {
        if (tokens.length >= 510) break;
        tokens.push(t);
      }
    }

    tokens.push(this.sepTokenId);
    return tokens;
  }

  private preTokenize(text: string): string[] {
    return text
      .replace(/([.,!?;:"'()\[\]{}\-\/\\@#$%^&*+=<>~`|])/g, ' $1 ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
  }

  private wordPiece(word: string): number[] {
    if (word.length > this.maxInputCharsPerWord) {
      return [this.unkTokenId];
    }

    const tokens: number[] = [];
    let start = 0;

    while (start < word.length) {
      let end = word.length;
      let found = false;

      while (start < end) {
        let substr = word.slice(start, end);
        if (start > 0) substr = '##' + substr;

        if (this.vocab.hasOwnProperty(substr)) {
          tokens.push(this.vocab[substr]);
          found = true;
          break;
        }
        end--;
      }

      if (!found) {
        tokens.push(this.unkTokenId);
        start++;
      } else {
        start = end;
      }
    }

    return tokens;
  }
}

export async function initEmbedding(): Promise<void> {
  const modelPath = await ensureModel();
  const tokenizerPath = await ensureTokenizer();

  tokenizer = new BertTokenizer();
  const tokenizerConfig = JSON.parse(fs.readFileSync(tokenizerPath, 'utf8'));
  tokenizer.load(tokenizerConfig);

  const modelBuffer = fs.readFileSync(modelPath);
  session = await ort.InferenceSession.create(
    new Uint8Array(modelBuffer.buffer, modelBuffer.byteOffset, modelBuffer.byteLength),
    {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
    },
  );

  const source = modelPath.includes(BUILTIN_MODEL_DIR) ? 'built-in' : 'user data';
  console.log(`ONNX embedding session initialized (model: ${source}).`);
}

export async function embed(text: string): Promise<Float32Array> {
  if (!session) throw new Error('Embedding session not initialized. Call initEmbedding() first.');
  if (!tokenizer) throw new Error('Tokenizer not initialized.');

  const tokens = tokenizer.tokenize(text);
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
