import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, tokensToCharsBudget } from '../token-estimate.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('estimates CJK characters as ~1 token each', () => {
    const result = estimateTokens('你好世界');
    // 4 CJK chars → ~4 tokens
    assert.equal(result, 4);
  });

  it('estimates Latin words by length', () => {
    const result = estimateTokens('hello');
    // "hello" = 5 chars → Math.max(1, round(5/4)) = 1 token
    assert.equal(result, 1);
  });

  it('estimates longer Latin words as more tokens', () => {
    const result = estimateTokens('internationalization');
    // 20 chars → round(20/4) = 5 tokens
    assert.equal(result, 5);
  });

  it('handles mixed CJK and Latin text', () => {
    const result = estimateTokens('你好hello世界');
    // 2 CJK + "hello" (1 token) + 2 CJK = ~5
    assert.ok(result >= 4 && result <= 6);
  });

  it('counts numbers', () => {
    const result = estimateTokens('12345');
    // "12345" → 5 chars → max(1, ceil(5/2)) = 3
    assert.equal(result, 3);
  });

  it('handles text with only spaces and punctuation', () => {
    const result = estimateTokens('   ');
    assert.equal(result, 0);
  });
});

describe('tokensToCharsBudget', () => {
  it('returns a positive number for positive tokens', () => {
    const result = tokensToCharsBudget(1000);
    assert.ok(result > 0);
  });

  it('returns higher chars for English-dominant text hint', () => {
    const englishHint = 'hello world this is english text';
    const chineseHint = '你好世界这是中文文本内容';
    const englishBudget = tokensToCharsBudget(100, englishHint);
    const chineseBudget = tokensToCharsBudget(100, chineseHint);
    // English: each token ≈ more chars; Chinese: each token ≈ fewer chars
    assert.ok(englishBudget >= chineseBudget);
  });

  it('returns 0 for 0 tokens', () => {
    assert.equal(tokensToCharsBudget(0), 0);
  });

  it('uses default hint when none provided', () => {
    const result = tokensToCharsBudget(100);
    assert.ok(result > 0);
    assert.ok(result <= 400); // max 4 chars per token
  });
});
