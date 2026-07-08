# Budget Control

Use this skill when a KeyMemory agent loop needs bounded cost, token, or iteration behavior.

## Rules

- Set `tokenBudget` or `costUsdBudget` before long-running work.
- Report `tokenUsage` at each checkpoint when available.
- Treat token-budget, no-progress, stagnation, and max-iterations warnings as stop-or-escalate signals.
- Prefer smaller verified phases over large unchecked runs.

