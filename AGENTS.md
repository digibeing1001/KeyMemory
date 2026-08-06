# KeyMemory Agent Operating Rules

This repository implements a local-first memory plugin and MCP server for agents. Treat the rules below as the repo-level contract for automated work.

## Memory Access

- Use KeyMemory MCP tools or repository APIs for durable memory operations; do not create ad hoc `MEMORY.md`, hidden memory folders, or flat-file substitutes.
- Never store secrets in normal memories. Use `memory_secret_set` for tool credentials.
- Respect `agent_space` boundaries on every read, write, relation, context pack, and loop reference. New code must go through the adapter layer unless a lower-level function is explicitly documented as internal-only.
- Context retrieval may update telemetry, hit counts, leases, or handoff state. Do not label a tool as read-only when it mutates user-visible workflow state.

## Loop Harness

- Long-running or autonomous work must start with `memory_loop_start`, persist progress with `memory_loop_checkpoint`, resume with `memory_loop_context`, and close with `memory_loop_finish`.
- Every checkpoint needs an idempotency key, expected version, lease owner, compact summary, next actions, artifacts when available, and memory refs only after accessibility validation.
- Stop or escalate when the circuit breaker reports stagnation, no progress, token budget exhaustion, or max iterations.

## Verification

- After each edit, run `node scripts/verify.mjs` to confirm the change does not break existing functionality.
- Before completing a task, run `node scripts/verify.mjs` and confirm all checks pass.
- Before pushing, run `node scripts/verify.mjs`.
- For release readiness, run `pnpm release:check`.
- If a verification step fails, checkpoint the failure context before retrying or changing strategy.

