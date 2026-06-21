# Loop Harness Research And Design Basis

Updated: 2026-06-21

## Research Question

KeyMemory needs to serve a long-running Loop engine, not merely answer memory searches. The design question is therefore: which state must be durable and authoritative, how should it be retrieved under a context budget, and what execution contract lets a worker resume safely after retries, process crashes, context compression, or concurrent ownership changes?

## Papers

| Work | Relevant result | KeyMemory consequence |
| --- | --- | --- |
| [MemGPT](https://arxiv.org/abs/2310.08560) | Virtual context management moves information across memory tiers instead of treating the prompt as the whole memory system. | Keep durable memories separate from bounded Context Packs and restorable working state. |
| [Generative Agents](https://arxiv.org/abs/2304.03442) | Observation, reflection, retrieval, and planning each contribute to long-running behavior. | Store append-only observations separately from checkpoints and promoted long-term memory. |
| [Reflexion](https://arxiv.org/abs/2303.11366) | Episodic feedback can improve later trials without model weight updates. | Preserve outcome events and explicit checkpoint summaries so a later learning layer can induce validated reflections. |
| [Voyager](https://arxiv.org/abs/2305.16291) | Environment feedback, execution errors, self-verification, and a reusable skill library support lifelong improvement. | Events need stable names/severity; reusable procedures belong in durable memory, not raw run state. |
| [SWE-agent](https://arxiv.org/abs/2405.15793) | Agent-computer interface design materially changes agent success. | Expose four narrow typed tools and structured recovery errors rather than one catch-all Loop endpoint. |
| [AIOS](https://arxiv.org/abs/2403.16971) | Scheduling, context, memory, storage, and access control are kernel-level agent services. | Add worker leases and explicit context budgets at the substrate layer. |
| [Agent Workflow Memory](https://arxiv.org/abs/2409.07429) | Selectively retrieved reusable workflows improve long-horizon success and reduce steps. | Link checkpoints to validated procedure memories with `memoryRefs`; do not promote every trajectory automatically. |
| [LongMemEval](https://arxiv.org/abs/2410.10813) | Long-term memory quality depends on indexing, retrieval, reading, temporal reasoning, updates, and abstention. | Preserve timestamps, suppress superseded memories, scope by project, expose fingerprints, and keep a no-result state explicit. |
| [LedgerAgent](https://arxiv.org/abs/2606.20529) | An explicit task-state ledger reduces stale or missing state and supports policy checks before actions. This is a recent preprint, so it is supporting rather than sole evidence. | Treat the checkpoint as authoritative structured state independent of prompt reconstruction. |

## Production Frameworks

| Project | Practice used here |
| --- | --- |
| [LangGraph](https://github.com/langchain-ai/langgraph) | Durable execution, checkpoints, threads, interrupts, and explicit state transitions for long-running agents. |
| [Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript) | Durable workflow identity, replay-safe operations, retries, and separation of orchestration state from side effects. |
| [OpenAI Agents SDK](https://github.com/openai/openai-agents-python) | A small agent loop combined with sessions, guardrails, handoffs, and tracing. |
| [Letta](https://github.com/letta-ai/letta) | Stateful agents with bounded in-context memory and external persistent memory. |
| [AutoGen](https://github.com/microsoft/autogen) | Event-driven agent workflows and explicit runtime messages. |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Closed learning loop, session search, context compression, resumable sessions, memory nudges, and production regression coverage around stuck loops and session races. |
| [OpenTelemetry Logs Data Model](https://opentelemetry.io/docs/specs/otel/logs/data-model/) | Timestamp, trace/span correlation, severity, event name, body, and structured attributes. |
| [SQLite WAL](https://www.sqlite.org/wal.html) | Concurrent readers with one writer, atomic commits, and local-machine constraints. |

## Adopted Architecture

1. `LoopRun` is durable identity and ownership, not a prompt transcript.
2. `LoopCheckpoint` is versioned authoritative working state.
3. `LoopEvent` is an append-only observation and trace stream.
4. `Memory` is validated reusable knowledge across runs.
5. `ContextPack` is a bounded, derived view and can always be rebuilt.
6. Mutations require deterministic idempotency keys.
7. Optimistic versions prevent lost updates; leases prevent simultaneous active workers.
8. Checkpoint, event, and run cursor advance in one SQLite transaction.
9. Structured error codes define retry and stop behavior.
10. Secrets are redacted before run state, checkpoints, event bodies, or attributes are persisted.

## Deliberate Non-Goals

- KeyMemory does not choose the next tool or replace the Loop planner.
- It does not automatically turn every checkpoint into long-term memory.
- It does not claim exactly-once external side effects; callers must use their own idempotency keys with external systems.
- It does not support shared SQLite files across hosts. A network service should serialize multi-host writes.
- It does not yet induce reusable workflows automatically. The `memoryRefs` link is the stable foundation for a later, evaluated promotion pipeline.

## Evaluation Gates

The current contract test checks state recovery and consistency properties. Future Loop-level evaluation should additionally measure task completion, retries per successful task, stale-context rate, checkpoint recovery success, context-pack precision/recall, and cost per completed run. LongMemEval-style update and abstention cases should remain part of memory quality evaluation rather than being replaced by operational smoke tests.
