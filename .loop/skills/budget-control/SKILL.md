# Budget Control

Use this skill when a KeyMemory agent loop needs bounded cost, token, or iteration behavior.

## Trigger Conditions

Activate when:
- Starting any loop via `memory_loop_start` that may exceed one checkpoint of work (long-running, multi-phase, or autonomous tasks).
- A loop checkpoint reports `tokenUsage` approaching the configured thresholds (warning at 80%, critical at 95% of `tokenBudget`).
- The circuit breaker emits any of: `circuit-breaker.token-budget`, `circuit-breaker.max-iterations`, `stagnation`, or `no-progress`.
- External model/API calls are involved and cost observability is required (`costUsdBudget`).
- The same error signature has repeated 3 times, or 5 consecutive failures have occurred (see `.loop/budget.json` `escalateWhen`).

## Execution Flow

1. Before loop start, read `.loop/budget.json` for defaults: `tokenBudgetDefault` (120000), `costUsdBudgetDefault` (10 USD), `maxIterations` (10).
2. Pass `tokenBudget` and/or `costUsdBudget` to `memory_loop_start`. Token budget is enforced by the circuit breaker when `tokenUsed >= tokenBudget`; cost budget is tracked for audit.
3. At each `memory_loop_checkpoint`, report `tokenUsage` for the attempt; the harness accumulates it into `run.tokenUsed`.
4. Compare cumulative usage against thresholds: warning at 80%, critical at 95%. On warning, log the condition and propose phase reduction (smaller verified phases).
5. On critical threshold or any stop signal (`stopOn` in `.loop/config.json`: `circuit-breaker-triggered`, version/lease conflicts), checkpoint the reason and escalate — never blindly retry.
6. Before declaring terminal success, run the required gates: `node scripts/verify.mjs` (pre-push) and `pnpm release:check` (release/distributable handoff).
7. Close the run with `memory_loop_finish`. A terminal run must never receive another checkpoint except an idempotent replay.

## Output Format

- Per-checkpoint budget status, included in the checkpoint summary:
  - `tokenUsed` / `tokenBudget` and remaining
  - `costUsdUsed` / `costUsdBudget` when tracked
  - threshold state: `ok` | `warning (>=80%)` | `critical (>=95%)`
- Escalation record when a stop signal fires: circuit-breaker reason string (e.g. `circuit-breaker.token-budget: tokenUsed N >= budget M`), proposed next action (increase budget in the next run or simplify the task), and the checkpoint that captured it.

## Validation Rules

- `tokenBudget` is a positive number set at `memory_loop_start` before any work begins; `costUsdBudget` is non-negative when present.
- Every checkpoint includes `tokenUsage` when the data is available; failed attempts additionally include `attemptOutcome` and `error`.
- Stop signals (`token-budget`, `max-iterations`, `stagnation`, `no-progress`, `escalateWhen` conditions) always produce a logged escalation checkpoint — never silent continuation.
- Verification gates (`node scripts/verify.mjs`; `pnpm release:check` for releases) pass before the loop is marked finished.
- Budget policy statements stay consistent with `docs/loop-budget.md` and `SAFETY-LOOP.md`; if either changes, update this skill in the same change.
