# KeyMemory Triage Guide

Use this guide to classify review findings before fixing or checkpointing them.

| Severity | Meaning | Required action |
| --- | --- | --- |
| Critical | Can corrupt, expose, or lose user memory or secrets | Stop release, fix, verify, and document recovery |
| High | Breaks agent tool use, loop recovery, isolation, or durable recall | Fix before push |
| Medium | Degrades retrieval quality, UX, or maintainability | Fix in the current cycle when low-risk |
| Low | Cosmetic or documentation-only issue | Batch with nearby cleanup |

## Categories

- `memory-storage`: schema, persistence, backup, migration, or secret routing.
- `memory-processing`: normalization, consolidation, forgetting, embeddings, relations, or project routing.
- `memory-read`: search, context pack, query safety, ranking, isolation, or redaction.
- `mcp-tooling`: tool schema, annotations, result shape, JSON-RPC behavior, or client compatibility.
- `loop-harness`: lease, idempotency, checkpoint, event, budget, or circuit breaker behavior.
- `docs-rules`: unclear operating rules, missing verification, or stale release guidance.

## Recovery Notes

- Reproduce with the smallest smoke or eval script.
- Fix code before prompt wording when behavior can be enforced.
- Add a durable checkpoint when the failure affects autonomous loops.
- Run `node scripts/verify.mjs` before push.

