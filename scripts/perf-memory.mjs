import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-perf-'));
process.env.KEYMEMORY_DATA_DIR = dataDir;

const { initDatabase, closeDatabase } = await import('../packages/server/dist/db/sqlite.js');
const { createMemory } = await import('../packages/server/dist/core/atom.js');
const { searchHybrid } = await import('../packages/server/dist/core/query.js');
const { buildAgentContextPack } = await import('../packages/server/dist/core/context-pack.js');
const { runDreamCycle } = await import('../packages/server/dist/core/dreaming.js');
const { getHealthReport } = await import('../packages/server/dist/core/health.js');
const { createMemoryRelation } = await import('../packages/server/dist/graph/entity.js');

const memoryCount = Number(process.env.KEYMEMORY_PERF_COUNT || 300);
const budgets = {
  ingestMs: Number(process.env.KEYMEMORY_PERF_INGEST_MS || 12000),
  searchP95Ms: Number(process.env.KEYMEMORY_PERF_SEARCH_P95_MS || 900),
  contextMs: Number(process.env.KEYMEMORY_PERF_CONTEXT_MS || 1800),
  dreamMs: Number(process.env.KEYMEMORY_PERF_DREAM_MS || 15000),
  healthMs: Number(process.env.KEYMEMORY_PERF_HEALTH_MS || 1200),
  totalMs: Number(process.env.KEYMEMORY_PERF_TOTAL_MS || 32000),
};

async function timed(fn) {
  const start = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - start };
}

function assertBudget(name, actual, budget) {
  if (actual > budget) {
    throw new Error(`${name} exceeded budget: ${actual.toFixed(1)}ms > ${budget}ms`);
  }
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? 0;
}

initDatabase();

try {
  const totalStart = performance.now();
  const ids = [];

  const ingest = await timed(async () => {
    for (let i = 0; i < memoryCount; i++) {
      const project = i % 12;
      const area = i % 5;
      const kind = i % 6 === 0
        ? 'Preference'
        : i % 6 === 1
          ? 'Decision'
          : i % 6 === 2
            ? 'Task'
            : i % 6 === 3
              ? 'Procedure'
              : i % 6 === 4
                ? 'Constraint'
                : 'Fact';
      const topic = `topic${i % 37}`;
      const memory = createMemory({
        title: `Perf ${kind} ${i}`,
        content: `[[Perf/Project${project}/Area${area}]] ${kind}: ${topic} production memory benchmark item ${i}. Agent should retrieve this for project scoped long-running work without scanning unrelated memories.`,
        layer: i % 6 === 2 ? 'short' : 'long',
        tags: ['perf', topic, `project:${project}`, `area:${area}`],
        source: 'perf',
        sourceId: `perf-${i}`,
      });
      ids.push(memory.id);
    }
  });

  for (let i = 0; i < Math.min(20, ids.length - 1); i += 2) {
    createMemoryRelation(ids[i], ids[i + 1], 'relates_to', 0.8, 'perf relation expansion');
  }

  const searchQueries = ['topic3', 'topic9', 'topic17', 'topic23', 'topic31', 'production memory benchmark'];
  const searchDurations = [];
  const searchCounts = [];
  for (const query of searchQueries) {
    const result = await timed(() => searchHybrid(query, { limit: 12 }));
    searchDurations.push(result.ms);
    searchCounts.push(result.value.length);
    if (result.value.length === 0) {
      throw new Error(`search returned no results for ${query}`);
    }
  }

  const context = await timed(() => buildAgentContextPack({
    query: 'topic17 production memory benchmark',
    project: 'Perf/Project5',
    maxItems: 12,
    maxChars: 5000,
  }));
  if (context.value.totalItems === 0 || !context.value.markdown.includes('KeyMemory Context')) {
    throw new Error(`context pack failed under perf load: ${JSON.stringify(context.value)}`);
  }

  const dream = await timed(() => runDreamCycle());
  if (dream.value.status !== 'completed') {
    throw new Error(`dream cycle failed under perf load: ${JSON.stringify(dream.value)}`);
  }

  const health = await timed(() => getHealthReport());
  if (typeof health.value.score !== 'number') {
    throw new Error(`health report failed under perf load: ${JSON.stringify(health.value)}`);
  }

  const searchP95 = percentile(searchDurations, 0.95);
  const totalMs = performance.now() - totalStart;

  assertBudget('ingest', ingest.ms, budgets.ingestMs);
  assertBudget('search p95', searchP95, budgets.searchP95Ms);
  assertBudget('context pack', context.ms, budgets.contextMs);
  assertBudget('dream cycle', dream.ms, budgets.dreamMs);
  assertBudget('health report', health.ms, budgets.healthMs);
  assertBudget('total perf run', totalMs, budgets.totalMs);

  console.log(JSON.stringify({
    ok: true,
    dataDir,
    memoryCount,
    budgets,
    timings: {
      ingestMs: Number(ingest.ms.toFixed(1)),
      searchP95Ms: Number(searchP95.toFixed(1)),
      contextMs: Number(context.ms.toFixed(1)),
      dreamMs: Number(dream.ms.toFixed(1)),
      healthMs: Number(health.ms.toFixed(1)),
      totalMs: Number(totalMs.toFixed(1)),
    },
    searchCounts,
    contextItems: context.value.totalItems,
    dreamCandidates: dream.value.totalCandidates,
    dreamMerged: dream.value.merged,
    healthScore: health.value.score,
  }, null, 2));
} finally {
  closeDatabase();
}
