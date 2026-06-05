import fs from 'fs';
import path from 'path';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'crypto';
import { v4 as uuid } from 'uuid';
import type { ToolSecret, ToolSecretValue } from '@keymemory/shared';
import { getDataDir, getDatabase } from '../db/sqlite.js';

const SECRET_AAD = Buffer.from('keymemory-tool-secret-v1', 'utf8');
const KEY_FILE_NAME = 'master.key';

export interface SetToolSecretInput {
  tool: string;
  name?: string;
  value: string;
  metadata?: Record<string, unknown>;
}

function normalizeKeyPart(value: string, label: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '');
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > 80) throw new Error(`${label} must be 80 characters or less`);
  return normalized;
}

function normalizeTool(tool: string): string {
  return normalizeKeyPart(tool, 'tool');
}

function normalizeName(name?: string): string {
  return normalizeKeyPart(name ?? 'api_key', 'name');
}

function secretKeyPath(): string {
  return path.join(getDataDir(), 'secrets', KEY_FILE_NAME);
}

function decodeConfiguredSecretKey(value: string): Buffer {
  const trimmed = value.trim();
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex');
  try {
    const decoded = Buffer.from(trimmed, 'base64');
    if (decoded.length === 32) return decoded;
  } catch {
    // Fall through to hashing arbitrary passphrase-style input.
  }
  return createHash('sha256').update(trimmed).digest();
}

function loadSecretKey(): Buffer {
  if (process.env.KEYMEMORY_SECRET_KEY) {
    return decodeConfiguredSecretKey(process.env.KEYMEMORY_SECRET_KEY);
  }

  const filePath = secretKeyPath();
  if (fs.existsSync(filePath)) {
    return decodeConfiguredSecretKey(fs.readFileSync(filePath, 'utf8'));
  }

  const key = randomBytes(32);
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, key.toString('base64') + '\n', { encoding: 'utf8', mode: 0o600 });
  return key;
}

function encryptSecret(value: string): string {
  const key = loadSecretKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(SECRET_AAD);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

function decryptSecret(ciphertext: string): string {
  const [version, ivText, tagText, valueText] = ciphertext.split(':');
  if (version !== 'v1' || !ivText || !tagText || !valueText) {
    throw new Error('unsupported secret ciphertext format');
  }

  const key = loadSecretKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64'));
  decipher.setAAD(SECRET_AAD);
  decipher.setAuthTag(Buffer.from(tagText, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(valueText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function secretHash(value: string): string {
  return createHmac('sha256', loadSecretKey()).update(value).digest('hex');
}

function rowToSecret(row: Record<string, unknown>): ToolSecret {
  return {
    id: String(row.id),
    tool: String(row.tool),
    name: String(row.name),
    valueHash: String(row.value_hash),
    metadata: row.metadata ? JSON.parse(String(row.metadata)) as Record<string, unknown> : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : undefined,
  };
}

export function setToolSecret(input: SetToolSecretInput): ToolSecret {
  const db = getDatabase();
  const tool = normalizeTool(input.tool);
  const name = normalizeName(input.name);
  const value = input.value;
  if (!value) throw new Error('value is required');

  const now = new Date().toISOString();
  const existing = db.prepare('SELECT id, created_at FROM tool_secrets WHERE tool = ? AND name = ?').get(tool, name) as { id: string; created_at: string } | undefined;
  const id = existing?.id ?? uuid();
  const createdAt = existing?.created_at ?? now;

  db.prepare(`
    INSERT INTO tool_secrets (id, tool, name, value_ciphertext, value_hash, metadata, created_at, updated_at, last_accessed_at)
    VALUES (@id, @tool, @name, @valueCiphertext, @valueHash, @metadata, @createdAt, @updatedAt, NULL)
    ON CONFLICT(tool, name) DO UPDATE SET
      value_ciphertext = excluded.value_ciphertext,
      value_hash = excluded.value_hash,
      metadata = excluded.metadata,
      updated_at = excluded.updated_at
  `).run({
    id,
    tool,
    name,
    valueCiphertext: encryptSecret(value),
    valueHash: secretHash(value),
    metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt,
    updatedAt: now,
  });

  const row = db.prepare('SELECT * FROM tool_secrets WHERE tool = ? AND name = ?').get(tool, name) as Record<string, unknown>;
  return rowToSecret(row);
}

export function getToolSecret(toolInput: string, nameInput?: string): ToolSecretValue | null {
  const db = getDatabase();
  const tool = normalizeTool(toolInput);
  const name = normalizeName(nameInput);
  const row = db.prepare('SELECT * FROM tool_secrets WHERE tool = ? AND name = ?').get(tool, name) as Record<string, unknown> | undefined;
  if (!row) return null;

  const now = new Date().toISOString();
  db.prepare('UPDATE tool_secrets SET last_accessed_at = ? WHERE id = ?').run(now, row.id);

  return {
    ...rowToSecret({ ...row, last_accessed_at: now }),
    value: decryptSecret(String(row.value_ciphertext)),
  };
}

export function listToolSecrets(toolInput?: string): ToolSecret[] {
  const db = getDatabase();
  const rows = toolInput
    ? db.prepare('SELECT * FROM tool_secrets WHERE tool = ? ORDER BY tool, name').all(normalizeTool(toolInput)) as Record<string, unknown>[]
    : db.prepare('SELECT * FROM tool_secrets ORDER BY tool, name').all() as Record<string, unknown>[];
  return rows.map(rowToSecret);
}

export function deleteToolSecret(toolInput: string, nameInput?: string): boolean {
  const db = getDatabase();
  const tool = normalizeTool(toolInput);
  const name = normalizeName(nameInput);
  const result = db.prepare('DELETE FROM tool_secrets WHERE tool = ? AND name = ?').run(tool, name);
  return result.changes > 0;
}
