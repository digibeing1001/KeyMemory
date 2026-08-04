import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessCompleteness,
  assessValue,
  tryCompleteFromContext,
  ContentQualityError,
} from '../content-quality.js';

describe('assessCompleteness', () => {
  it('returns complete for well-formed content', () => {
    const result = assessCompleteness('这是一段完整的记忆内容。');
    assert.equal(result.complete, true);
    assert.equal(result.issues.length, 0);
  });

  it('detects empty content', () => {
    const result = assessCompleteness('');
    assert.equal(result.complete, false);
    assert.ok(result.issues.some(i => i.type === 'mid-sentence-cut'));
  });

  it('detects Chinese dangling connector punctuation', () => {
    const result = assessCompleteness('今天讨论了项目进度，');
    assert.equal(result.complete, false);
    assert.ok(result.issues.some(i => i.type === 'dangling-connector'));
  });

  it('detects Chinese dangling connector words', () => {
    const result = assessCompleteness('我们需要考虑以下因素以及');
    assert.equal(result.complete, false);
    assert.ok(result.issues.some(i => i.reason.includes('以及')));
  });

  it('detects English dangling connector words', () => {
    const result = assessCompleteness('the result depends on');
    assert.equal(result.complete, false);
    assert.ok(result.issues.some(i => i.type === 'dangling-connector'));
  });

  it('detects unclosed code blocks', () => {
    const result = assessCompleteness('```javascript\nconst x = 1;');
    assert.equal(result.complete, false);
    assert.ok(result.issues.some(i => i.reason.includes('代码块未闭合')));
  });

  it('does not flag closed code blocks', () => {
    const result = assessCompleteness('```js\nconst x = 1;\n```');
    assert.equal(result.complete, true);
  });

  it('detects unresolved pronoun references', () => {
    const result = assessCompleteness('他认为这个方案不可行');
    assert.equal(result.complete, false);
    assert.ok(result.issues.some(i => i.type === 'unresolved-reference'));
  });

  it('does not flag pronouns with explicit references', () => {
    const result = assessCompleteness('他认为[[项目A]]的方案不可行');
    // Has [[...]] anchor, so no unresolved-reference
    assert.equal(result.complete, true);
  });
});

describe('assessValue', () => {
  it('rejects empty content', () => {
    const result = assessValue('');
    assert.equal(result.verdict, 'reject');
    assert.ok(result.reasons.includes('内容为空'));
  });

  it('rejects pure greetings', () => {
    assert.equal(assessValue('好的').verdict, 'reject');
    assert.equal(assessValue('谢谢').verdict, 'reject');
    assert.equal(assessValue('ok').verdict, 'reject');
    assert.equal(assessValue('thanks').verdict, 'reject');
    assert.equal(assessValue('收到').verdict, 'reject');
  });

  it('accepts content with information signals', () => {
    // Contains a number
    assert.equal(assessValue('会议讨论了3个方案').verdict, 'accept');
    // Contains URL
    assert.equal(assessValue('参考文档 https://example.com/docs').verdict, 'accept');
    // Contains project reference
    assert.equal(assessValue('[[KeyMemory]] 的架构设计').verdict, 'accept');
  });

  it('rejects short boilerplate without info signals', () => {
    const result = assessValue('如有疑问请联系我');
    assert.equal(result.verdict, 'reject');
  });

  it('accepts short content with decision keywords', () => {
    const result = assessValue('决定采用React框架');
    assert.equal(result.verdict, 'accept');
  });

  it('returns a score between 0 and 1', () => {
    const result = assessValue('项目使用TypeScript 5.0开发');
    assert.ok(result.score >= 0 && result.score <= 1);
  });
});

describe('tryCompleteFromContext', () => {
  it('returns null for short fragments', () => {
    const result = tryCompleteFromContext('短', [{ label: 'ctx', text: '上下文内容' }]);
    assert.equal(result, null);
  });

  it('returns null for empty segments', () => {
    const result = tryCompleteFromContext('一段需要补全的内容', []);
    assert.equal(result, null);
  });

  it('completes fragment by extending tail from context', () => {
    const fragment = '采用React框架';
    const segments = [{ label: 'chat', text: '我们决定采用React框架进行开发。' }];
    const result = tryCompleteFromContext(fragment, segments);
    assert.ok(result);
    assert.equal(result!.basis.strategy, 'extend-tail');
    assert.ok(result!.completed.includes('采用React框架'));
    assert.ok(result!.completed.includes('进行开发'));
  });

  it('completes fragment by restoring head from context', () => {
    const fragment = '框架进行开发';
    const segments = [{ label: 'chat', text: '我们决定采用React框架进行开发' }];
    const result = tryCompleteFromContext(fragment, segments);
    assert.ok(result);
    assert.equal(result!.basis.strategy, 'restore-head');
  });

  it('returns null when context does not contain fragment', () => {
    const fragment = '完全不相关的内容片段';
    const segments = [{ label: 'chat', text: '今天天气不错适合出去散步' }];
    const result = tryCompleteFromContext(fragment, segments);
    assert.equal(result, null);
  });
});

describe('ContentQualityError', () => {
  it('creates error with code and reasons', () => {
    const err = new ContentQualityError('low value', ['纯寒暄']);
    assert.equal(err.code, 'low-value-content');
    assert.equal(err.name, 'ContentQualityError');
    assert.deepEqual(err.reasons, ['纯寒暄']);
    assert.ok(err instanceof Error);
  });
});
