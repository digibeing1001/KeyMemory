# Loop Budget Policy

KeyMemory loops use budgets to prevent unbounded autonomous work.

## Defaults

- `maxIterations`: 10 checkpoints.
- `tokenBudgetDefault`: 120000 tokens for substantial local work.
- `costUsdBudgetDefault`: 10 USD when external model calls are involved.
- `leaseTtlSeconds`: 120 seconds unless a worker needs a shorter lease.

## Enforcement

- Token budget is enforced by the loop circuit breaker when `tokenUsed >= tokenBudget`.
- Cost budget is tracked for audit and should be enforced by the caller when external APIs report cost.
- Three identical failure signatures trigger stagnation.
- Five consecutive failures trigger no-progress.

## Required Gates

Run `node scripts/verify.mjs` before push. Run `pnpm release:check` before a release or distributable handoff.

