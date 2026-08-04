import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchCache, makeCacheKey } from '../cache.js';

// searchCache is a singleton; clear before each test for isolation
beforeEach(() => {
  searchCache.clear();
});

describe('searchCache', () => {
  it('returns null for missing keys', () => {
    assert.equal(searchCache.get('nonexistent'), null);
  });

  it('stores and retrieves data', () => {
    const data = [{ memory: {} as any, score: 0.9, matchType: 'fulltext' as const }];
    searchCache.set('key1', data);
    const result = searchCache.get('key1');
    assert.deepEqual(result, data);
  });

  it('reports correct size', () => {
    assert.equal(searchCache.size(), 0);
    searchCache.set('a', []);
    assert.equal(searchCache.size(), 1);
    searchCache.set('b', []);
    assert.equal(searchCache.size(), 2);
  });

  it('clears all entries', () => {
    searchCache.set('a', []);
    searchCache.set('b', []);
    searchCache.clear();
    assert.equal(searchCache.size(), 0);
    assert.equal(searchCache.get('a'), null);
  });

  it('evicts oldest entry when max capacity reached', () => {
    // maxEntries = 100
    for (let i = 0; i < 101; i++) {
      searchCache.set(`key${i}`, []);
    }
    // key0 should have been evicted
    assert.equal(searchCache.get('key0'), null);
    assert.equal(searchCache.size(), 100);
    // key100 should still exist
    assert.deepEqual(searchCache.get('key100'), []);
  });
});

describe('makeCacheKey', () => {
  it('creates a JSON string from query and options', () => {
    const key = makeCacheKey('test query', { layer: 'long', limit: 10 });
    const parsed = JSON.parse(key);
    assert.equal(parsed.query, 'test query');
    assert.equal(parsed.layer, 'long');
    assert.equal(parsed.limit, 10);
  });

  it('handles undefined options', () => {
    const key = makeCacheKey('query');
    const parsed = JSON.parse(key);
    assert.equal(parsed.query, 'query');
    assert.equal(parsed.layer, undefined);
    assert.equal(parsed.limit, undefined);
  });

  it('produces different keys for different inputs', () => {
    const key1 = makeCacheKey('query1', { layer: 'short' });
    const key2 = makeCacheKey('query2', { layer: 'short' });
    const key3 = makeCacheKey('query1', { layer: 'long' });
    assert.notEqual(key1, key2);
    assert.notEqual(key1, key3);
  });

  it('produces same key for same inputs', () => {
    const key1 = makeCacheKey('test', { layer: 'long', limit: 5 });
    const key2 = makeCacheKey('test', { layer: 'long', limit: 5 });
    assert.equal(key1, key2);
  });
});
