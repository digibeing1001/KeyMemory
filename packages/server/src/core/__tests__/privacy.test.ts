import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSensitiveText,
  mergePrivacyFindings,
  redactSensitiveValue,
  privacyMetadata,
} from '../privacy.js';

describe('redactSensitiveText', () => {
  it('returns original text when no secrets found', () => {
    const result = redactSensitiveText('Hello world, this is a test.');
    assert.equal(result.text, 'Hello world, this is a test.');
    assert.equal(result.redacted, false);
    assert.deepEqual(result.findings, []);
  });

  it('redacts OpenAI API keys', () => {
    const result = redactSensitiveText('key=sk-abcdefghijklmnopqrstuvwxyz1234');
    assert.ok(result.redacted);
    assert.ok(!result.text.includes('sk-abcdefghijklmnopqrstuvwxyz1234'));
    assert.ok(result.text.includes('[REDACTED]:api_key'));
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].type, 'openai_api_key');
  });

  it('redacts Anthropic API keys', () => {
    const result = redactSensitiveText('token sk-ant-abcdefghijklmnopqrstuvwxyz1234 done');
    assert.ok(result.redacted);
    assert.ok(!result.text.includes('sk-ant-'));
    // May be caught by openai_api_key pattern first (sk- prefix); just ensure redaction happened
    assert.ok(result.findings.some(f => f.type === 'openai_api_key' || f.type === 'anthropic_api_key'));
  });

  it('redacts GitHub tokens', () => {
    const result = redactSensitiveText('ghp_abcdefghijklmnopqrstuvwxyz1234567890');
    assert.ok(result.redacted);
    assert.ok(result.text.includes('[REDACTED]:token'));
  });

  it('redacts AWS access keys', () => {
    const result = redactSensitiveText('AKIAIOSFODNN7EXAMPLE');
    assert.ok(result.redacted);
    assert.ok(result.text.includes('[REDACTED]:aws_key'));
  });

  it('redacts JWT tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = redactSensitiveText(jwt);
    assert.ok(result.redacted);
    assert.ok(result.text.includes('[REDACTED]:jwt'));
  });

  it('redacts labeled secrets', () => {
    const result = redactSensitiveText('password=mysecretpass123');
    assert.ok(result.redacted);
    assert.ok(!result.text.includes('mysecretpass123'));
    assert.ok(result.text.includes('password=[REDACTED]'));
  });

  it('redacts environment variable secrets', () => {
    const result = redactSensitiveText('API_KEY=supersecretvalue123');
    assert.ok(result.redacted);
    assert.ok(!result.text.includes('supersecretvalue123'));
  });

  it('redacts connection string passwords', () => {
    const result = redactSensitiveText('mongodb://user:secretpass@localhost:27017/db');
    assert.ok(result.redacted);
    assert.ok(!result.text.includes('secretpass'));
    assert.ok(result.text.includes('[REDACTED]:password'));
  });

  it('redacts multiple secrets in one text', () => {
    const result = redactSensitiveText('sk-abcdefghijklmnopqrstuvwxyz1234 and password=test123');
    assert.ok(result.redacted);
    assert.ok(result.findings.length >= 2);
  });
});

describe('mergePrivacyFindings', () => {
  it('returns empty array for empty input', () => {
    assert.deepEqual(mergePrivacyFindings([]), []);
  });

  it('merges findings of the same type', () => {
    const findings = [
      { type: 'openai_api_key', count: 1 },
      { type: 'openai_api_key', count: 2 },
      { type: 'jwt', count: 1 },
    ];
    const merged = mergePrivacyFindings(findings);
    assert.equal(merged.length, 2);
    const openai = merged.find(f => f.type === 'openai_api_key');
    assert.equal(openai?.count, 3);
  });

  it('preserves distinct types', () => {
    const findings = [
      { type: 'jwt', count: 1 },
      { type: 'aws_access_key', count: 1 },
    ];
    const merged = mergePrivacyFindings(findings);
    assert.equal(merged.length, 2);
  });
});

describe('redactSensitiveValue', () => {
  it('redacts string values', () => {
    const findings: Array<{ type: string; count: number }> = [];
    const result = redactSensitiveValue('sk-abcdefghijklmnopqrstuvwxyz1234', findings);
    assert.ok(typeof result === 'string');
    assert.ok(!(result as string).includes('sk-'));
    assert.ok(findings.length > 0);
  });

  it('recursively redacts arrays', () => {
    const findings: Array<{ type: string; count: number }> = [];
    const result = redactSensitiveValue(['safe', 'password=secret123'], findings);
    assert.ok(Array.isArray(result));
    assert.equal((result as string[])[0], 'safe');
    assert.ok(!(result as string[])[1].includes('secret123'));
  });

  it('recursively redacts objects', () => {
    const findings: Array<{ type: string; count: number }> = [];
    const result = redactSensitiveValue({ key: 'password=secret123' }, findings);
    assert.ok(typeof result === 'object');
    const obj = result as Record<string, unknown>;
    assert.ok(!(obj.key as string).includes('secret123'));
  });

  it('passes through non-string primitives', () => {
    const findings: Array<{ type: string; count: number }> = [];
    assert.equal(redactSensitiveValue(42, findings), 42);
    assert.equal(redactSensitiveValue(true, findings), true);
    assert.equal(redactSensitiveValue(null, findings), null);
  });
});

describe('privacyMetadata', () => {
  it('returns undefined for empty findings', () => {
    assert.equal(privacyMetadata([]), undefined);
  });

  it('returns metadata object for non-empty findings', () => {
    const result = privacyMetadata([{ type: 'jwt', count: 1 }]);
    assert.ok(result);
    assert.equal(result?.redacted, true);
    assert.equal(result?.redactionVersion, 1);
    assert.ok(Array.isArray(result?.findings));
  });
});
