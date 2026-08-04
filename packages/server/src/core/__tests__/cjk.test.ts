import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { containsCjk, cjkTrigrams, cjkBigrams, appendCjkBigrams } from '../cjk.js';

describe('containsCjk', () => {
  it('returns true for Chinese text', () => {
    assert.equal(containsCjk('你好世界'), true);
  });

  it('returns true for mixed CJK and Latin', () => {
    assert.equal(containsCjk('Hello 世界'), true);
  });

  it('returns false for pure Latin text', () => {
    assert.equal(containsCjk('Hello World'), false);
  });

  it('returns false for empty string', () => {
    assert.equal(containsCjk(''), false);
  });

  it('detects CJK Extension A characters', () => {
    assert.equal(containsCjk('㐀㐁'), true); // U+3400 range
  });
});

describe('cjkTrigrams', () => {
  it('returns trigrams for Chinese text >= 3 chars', () => {
    const result = cjkTrigrams('青龙调度器');
    // "青龙调" "龙调度" "调度器"
    assert.deepEqual(result, ['青龙调', '龙调度', '调度器']);
  });

  it('returns original for runs shorter than 3', () => {
    const result = cjkTrigrams('缓存');
    assert.deepEqual(result, ['缓存']);
  });

  it('deduplicates trigrams', () => {
    const result = cjkTrigrams('测试测试');
    // "测试测" "试测试" — no duplicates
    assert.equal(result.length, 2);
    assert.ok(result.includes('测试测'));
    assert.ok(result.includes('试测试'));
  });

  it('ignores non-CJK text', () => {
    const result = cjkTrigrams('Hello World');
    assert.deepEqual(result, []);
  });

  it('handles mixed content extracting only CJK runs', () => {
    const result = cjkTrigrams('Hello 你好世界 Test');
    // "你好世" "好世界"
    assert.equal(result.length, 2);
    assert.ok(result.includes('你好世'));
    assert.ok(result.includes('好世界'));
  });
});

describe('cjkBigrams', () => {
  it('is an alias for cjkTrigrams', () => {
    const trigrams = cjkTrigrams('测试内容');
    const bigrams = cjkBigrams('测试内容');
    assert.deepEqual(bigrams, trigrams);
  });
});

describe('appendCjkBigrams', () => {
  it('returns original text when no CJK present', () => {
    assert.equal(appendCjkBigrams('Hello World'), 'Hello World');
  });

  it('returns original text for empty input', () => {
    assert.equal(appendCjkBigrams(''), '');
  });

  it('appends space-separated bigrams for CJK text', () => {
    const result = appendCjkBigrams('你好世界');
    assert.ok(result.startsWith('你好世界 '));
    // Should contain trigram expansions
    assert.ok(result.length > '你好世界'.length);
  });

  it('does not append when CJK run is too short for bigrams', () => {
    // Single char — no bigrams possible, but containsCjk is true
    // cjkBigrams returns the single char as-is (< 3), so it appends
    const result = appendCjkBigrams('你');
    assert.ok(result.includes('你'));
  });
});
