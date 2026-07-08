# Constraint Governance

Use this skill when changing memory storage, processing, MCP tools, or loop behavior.

## Rules

- Check `.loop/constraints.json` before editing.
- Preserve adapter isolation boundaries.
- Keep tool schemas narrow and deterministic.
- Keep error observations actionable with retryability, next actions, and stop conditions.
- Add or update verification coverage for any new failure mode.

