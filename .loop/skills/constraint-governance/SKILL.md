---
name: constraint-governance
description: >-
  Constraint governance for memory storage, processing, MCP tools, and loop
  behavior changes. Use when editing adapter boundaries, tool schemas,
  loop control logic, agent_space, or loop configuration files.
trigger:
  - Editing memory adapter, storage layer, or processing pipeline code under packages/server
  - Modifying MCP tool schemas or adding/removing tools
  - Changing loop control logic or circuit breaker behavior
  - Adding, removing, or moving agent_space boundaries
  - Editing .loop/constraints.json, .loop/config.json, or .loop/budget.json
  - Changing any user-facing search/query path that touches FTS
---

# Constraint Governance

Use this skill when changing memory storage, processing, MCP tools, or loop behavior.

## Trigger Conditions

Activate when:
- Editing memory adapter, storage layer, or processing pipeline code under `packages/server`.
- Modifying MCP tool schemas (`packages/server/src/core/mcp-tools.ts`) or adding/removing tools.
- Changing loop control logic or circuit breaker behavior (`packages/server/src/core/loop-harness.ts`).
- Adding, removing, or moving `agent_space` boundaries.
- Editing `.loop/constraints.json`, `.loop/config.json`, or `.loop/budget.json`.
- Changing any user-facing search/query path that touches FTS (full-text search).

## Execution Flow

1. Before editing, read `.loop/constraints.json` and identify which registered constraints apply. Current constraint IDs: `adapter-boundary`, `mcp-result-shape`, `fts-free-text`, `loop-recovery`.
2. Map the change to affected adapter isolation boundaries: agent-facing read, write, relation, and delete operations must enforce adapter visibility before touching lower-level memory APIs; new code goes through the adapter layer unless the lower-level function is documented as internal-only.
3. For MCP tool changes, keep input schemas narrow and deterministic, and preserve the result shape: parseable by legacy text clients AND exposing `structuredContent` for schema-aware agents.
4. For search-path changes, ensure user free text is never interpolated as raw FTS query syntax (`fts-free-text`).
5. For loop/error-path changes, ensure error observations include retryability, next actions, and version/lease details when available (`loop-recovery`).
6. Add or update verification coverage (smoke/verify scripts under `scripts/`) for any new failure mode introduced.
7. After the change, run `pnpm typecheck`; before push run `node scripts/verify.mjs`; for releases run `pnpm release:check`.
8. If a constraint itself changes semantics, update its entry in `.loop/constraints.json` in the same change.

## Output Format

- Updated `.loop/constraints.json` entries if any boundary or rule changed (fields: `id`, `severity`, `rule`; keep `schemaVersion`).
- A short change note in the commit/PR description listing: affected constraint IDs, adapter boundaries touched, and the verification added or updated.
- Verification evidence: `pnpm typecheck` result, `node scripts/verify.mjs` result (and `pnpm release:check` result for releases).

## Validation Rules

- `.loop/constraints.json` was read before any boundary-affecting edit; all constraints with `severity: high` that apply remain satisfied after the change.
- Adapter isolation boundaries remain intact: no new code path bypasses the adapter layer without an internal-only documentation marker.
- MCP tool results remain dual-format (legacy text + `structuredContent`); tool schemas did not widen beyond what the change requires.
- All new code paths have error handling with actionable observations (retryability, next actions, stop conditions).
- Every new failure mode has at least one verification case (smoke or verify script).
- `pnpm typecheck` passes without errors; `node scripts/verify.mjs` passes before push.
- A tool is never labeled read-only when it mutates user-visible workflow state (telemetry, hit counts, leases, handoff state).
