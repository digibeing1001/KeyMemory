# Autonomous Loop Safety Contract

Use this contract for any automated KeyMemory maintenance, coding, or release loop.

## Required Sequence

1. Start with `memory_loop_start`.
2. Read current state with `memory_loop_context`.
3. Persist each meaningful phase boundary with `memory_loop_checkpoint`.
4. Run verification before terminal success.
5. Close with `memory_loop_finish`.

## Checkpoint Requirements

- Include `expectedVersion` from the last cursor.
- Include a caller-generated `idempotencyKey`.
- Include `leaseOwner` and renew leases before long operations.
- Include `phase`, `summary`, `nextActions`, `artifacts`, and validated `memoryRefs` when available.
- Include `attemptOutcome`, `tokenUsage`, and `error` on failed attempts.

## Stop Conditions

- Version conflict: call `memory_loop_context`, merge the latest state, then retry with a new idempotency key.
- Lease conflict: wait, acquire after expiry, or abort.
- Circuit breaker triggered: checkpoint the reason and escalate rather than blindly retrying.
- Terminal run: never write another checkpoint except an idempotent replay.

