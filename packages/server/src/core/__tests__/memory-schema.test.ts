import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  inferMemoryLayer,
  inferMemoryKind,
  isMeaningfulTag,
  cleanTag,
  normalizeTags,
  stripTitlePrefix,
  extractProjectPathFromContent,
  inferProjectPathFromContent,
} from '../memory-schema.js';

describe('inferMemoryLayer', () => {
  it('returns long for high importance metadata', () => {
    assert.equal(inferMemoryLayer('title', 'content', { importance: 'high' }), 'long');
  });

  it('returns short for low importance metadata', () => {
    assert.equal(inferMemoryLayer('title', 'content', { importance: 'low' }), 'short');
  });

  it('returns long for preference category', () => {
    assert.equal(inferMemoryLayer('title', 'content', { category: 'preference' }), 'long');
  });

  it('returns entity for person category', () => {
    assert.equal(inferMemoryLayer('title', 'content', { category: 'person' }), 'entity');
  });

  it('returns short for task category', () => {
    assert.equal(inferMemoryLayer('title', 'content', { category: 'task' }), 'short');
  });

  it('returns entity for entity content signals', () => {
    assert.equal(inferMemoryLayer('title', '职位：高级工程师 联系方式：test@test.com'), 'entity');
  });

  it('returns long for preference keywords', () => {
    assert.equal(inferMemoryLayer('偏好', '我喜欢用TypeScript开发'), 'long');
  });

  it('returns short for todo keywords', () => {
    assert.equal(inferMemoryLayer('待办', '今天完成报告'), 'short');
  });

  it('defaults to short for neutral content', () => {
    assert.equal(inferMemoryLayer('title', 'content'), 'short');
  });

  it('uses evaluation for flash layer when score is low', () => {
    const eval_ = { total: 0.3, projectRelevance: 0, longTermValue: 0, novelty: 0, userEmphasis: 0, reusability: 0, action: 'ignore' as const };
    assert.equal(inferMemoryLayer('title', 'content', undefined, eval_), 'flash');
  });

  it('uses evaluation for long layer when score is high', () => {
    const eval_ = { total: 0.8, projectRelevance: 0, longTermValue: 0, novelty: 0, userEmphasis: 0, reusability: 0, action: 'auto_record' as const };
    assert.equal(inferMemoryLayer('title', 'content', undefined, eval_), 'long');
  });
});

describe('inferMemoryKind', () => {
  it('detects preference kind', () => {
    assert.equal(inferMemoryKind('我喜欢用React'), 'preference');
  });

  it('detects decision kind', () => {
    assert.equal(inferMemoryKind('决定采用PostgreSQL数据库'), 'decision');
  });

  it('detects task kind', () => {
    assert.equal(inferMemoryKind('待办：完成API设计'), 'task');
  });

  it('detects procedure kind', () => {
    assert.equal(inferMemoryKind('部署流程：先build再deploy'), 'procedure');
  });

  it('detects project_fact via [[]] marker', () => {
    assert.equal(inferMemoryKind('参考[[KeyMemory]]的设计'), 'project_fact');
  });

  it('defaults to raw_note for neutral content', () => {
    assert.equal(inferMemoryKind('一些普通内容'), 'raw_note');
  });
});

describe('isMeaningfulTag', () => {
  it('rejects tags shorter than 2 chars', () => {
    assert.equal(isMeaningfulTag('a'), false);
  });

  it('rejects tags longer than 30 chars', () => {
    assert.equal(isMeaningfulTag('a'.repeat(31)), false);
  });

  it('rejects namespace prefixes', () => {
    assert.equal(isMeaningfulTag('type:preference'), false);
    assert.equal(isMeaningfulTag('source:agent'), false);
    assert.equal(isMeaningfulTag('scope:global'), false);
  });

  it('rejects path separators', () => {
    assert.equal(isMeaningfulTag('path/to/file'), false);
    assert.equal(isMeaningfulTag('path\\to\\file'), false);
    assert.equal(isMeaningfulTag('~/home/dir'), false);
  });

  it('rejects date/version patterns', () => {
    assert.equal(isMeaningfulTag('v2026-06-05'), false);
    assert.equal(isMeaningfulTag('verified-2026-06-05'), false);
  });

  it('rejects pure numbers/punctuation', () => {
    assert.equal(isMeaningfulTag('123'), false);
    assert.equal(isMeaningfulTag('___'), false);
  });

  it('rejects tags with parentheses', () => {
    assert.equal(isMeaningfulTag('tag（描述）'), false);
    assert.equal(isMeaningfulTag('tag(desc)'), false);
  });

  it('accepts meaningful tags', () => {
    assert.equal(isMeaningfulTag('preference'), true);
    assert.equal(isMeaningfulTag('typescript'), true);
    assert.equal(isMeaningfulTag('react19'), true);
  });

  it('accepts sensitivity:redacted as special case', () => {
    assert.equal(isMeaningfulTag('sensitivity:redacted'), true);
  });
});

describe('cleanTag', () => {
  it('trims whitespace', () => {
    assert.equal(cleanTag('  tag  '), 'tag');
  });

  it('removes surrounding quotes', () => {
    assert.equal(cleanTag('"tag"'), 'tag');
    assert.equal(cleanTag("'tag'"), 'tag');
  });

  it('removes CJK quotes', () => {
    assert.equal(cleanTag('「标签」'), '标签');
  });
});

describe('normalizeTags', () => {
  it('returns empty array for undefined', () => {
    assert.deepEqual(normalizeTags(undefined), []);
  });

  it('returns empty array for empty array', () => {
    assert.deepEqual(normalizeTags([]), []);
  });

  it('deduplicates case-insensitively', () => {
    const result = normalizeTags(['TypeScript', 'typescript', 'TYPESCRIPT']);
    assert.equal(result.length, 1);
  });

  it('filters out meaningless tags', () => {
    const result = normalizeTags(['good', 'a', 'type:bad', 'path/to/file']);
    assert.deepEqual(result, ['good']);
  });

  it('limits to 8 tags', () => {
    const tags = Array.from({ length: 12 }, (_, i) => `tag${i}x`);
    const result = normalizeTags(tags);
    assert.equal(result.length, 8);
  });
});

describe('stripTitlePrefix', () => {
  it('strips bracket prefix', () => {
    assert.equal(stripTitlePrefix('[闪念] 一个好想法'), '一个好想法');
  });

  it('strips colon prefix', () => {
    assert.equal(stripTitlePrefix('灵感: 关于架构的思考'), '关于架构的思考');
  });

  it('strips Chinese colon prefix', () => {
    assert.equal(stripTitlePrefix('想法：试试新方案'), '试试新方案');
  });

  it('strips multiple layers', () => {
    assert.equal(stripTitlePrefix('闪念: 灵感: 深层想法'), '深层想法');
  });

  it('does not strip without separator', () => {
    assert.equal(stripTitlePrefix('闪念机制的设计'), '闪念机制的设计');
  });

  it('returns clean title when no prefix', () => {
    assert.equal(stripTitlePrefix('普通标题'), '普通标题');
  });
});

describe('extractProjectPathFromContent', () => {
  it('extracts [[project]] path', () => {
    assert.equal(extractProjectPathFromContent('参考[[KeyMemory]]的设计'), 'KeyMemory');
  });

  it('extracts nested project path', () => {
    assert.equal(extractProjectPathFromContent('[[KeyMemory/server]]模块'), 'KeyMemory/server');
  });

  it('returns undefined for no project reference', () => {
    assert.equal(extractProjectPathFromContent('普通内容无项目引用'), undefined);
  });

  it('rejects generic project names', () => {
    assert.equal(extractProjectPathFromContent('[[test]]'), undefined);
    assert.equal(extractProjectPathFromContent('[[notes]]'), undefined);
  });
});

describe('inferProjectPathFromContent', () => {
  it('extracts from projectPath field', () => {
    assert.equal(inferProjectPathFromContent('projectPath: KeyMemory/api'), 'KeyMemory/api');
  });

  it('extracts from Chinese project label', () => {
    const result = inferProjectPathFromContent('项目：KeyMemory核心模块');
    assert.ok(result);
  });

  it('returns undefined for no match', () => {
    assert.equal(inferProjectPathFromContent('无关内容'), undefined);
  });
});
