# KeyMemory Performance Budget

Generated: 2026-05-30

## Purpose

KeyMemory must stay useful when a user has many project memories. CRUD tests are not enough; release checks need a repeatable budget for bulk ingest, search, context packing, dreaming, and health reporting.

## Command

```bash
pnpm build
pnpm perf:memory
```

`pnpm release:check` runs this command after build and eval.

## Fixture

The perf script creates a fresh temporary database and writes 300 synthetic project memories across nested project paths such as `Perf/Project5/Area0`.

It then verifies:

- bulk ingest completes within budget
- hybrid search returns results and search p95 stays within budget
- agent context pack returns scoped project context within budget
- dream cycle completes within budget
- health report completes within budget

## Default Budgets

| Metric | Budget |
| --- | ---: |
| ingest | 12000 ms |
| search p95 | 900 ms |
| context pack | 1800 ms |
| dream cycle | 15000 ms |
| health report | 1200 ms |
| total run | 32000 ms |

## Overrides

Use environment variables for local stress runs:

```bash
KEYMEMORY_PERF_COUNT=1000 pnpm perf:memory
KEYMEMORY_PERF_SEARCH_P95_MS=1500 pnpm perf:memory
```

Supported knobs:

- `KEYMEMORY_PERF_COUNT`
- `KEYMEMORY_PERF_INGEST_MS`
- `KEYMEMORY_PERF_SEARCH_P95_MS`
- `KEYMEMORY_PERF_CONTEXT_MS`
- `KEYMEMORY_PERF_DREAM_MS`
- `KEYMEMORY_PERF_HEALTH_MS`
- `KEYMEMORY_PERF_TOTAL_MS`

## Release Blocker

Any default budget failure blocks release. If a budget is intentionally changed, update this document and the release readiness doc in the same change.
