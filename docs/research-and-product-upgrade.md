# KeyMemory Research And Product Upgrade

Generated: 2026-05-30

## 2026-06-08 Follow-Up Research

This follow-up focused on what makes an agent memory plugin trustworthy enough for daily coding-agent use: durable recall, auditable writes, reversible consolidation, and a UI that explains why a memory is safe or risky for agents to reuse.

### Current OSS Signals

GitHub counts were checked on 2026-06-08.

- mem0 (`mem0ai/mem0`, 58k+ stars): productizes memory as a universal layer for agents. Useful lesson: memory quality is a product surface, not just a storage concern. https://github.com/mem0ai/mem0
- Graphiti (`getzep/graphiti`, 27k+ stars): emphasizes temporal knowledge graphs and changing facts. Useful lesson: related memories should often become graph edges before they become destructive merges. https://github.com/getzep/graphiti
- Letta/MemGPT (`letta-ai/letta`, 23k+ stars): treats stateful agents as systems with explicit memory management. Useful lesson: agent read/write paths should be shared, validated, and host-agnostic. https://github.com/letta-ai/letta
- supermemory (`supermemoryai/supermemory`, 26k+ stars): frames memory as user-facing infrastructure across apps. Useful lesson: users need simple, inspectable controls for what the system remembers. https://github.com/supermemoryai/supermemory
- Cognee (`topoteretes/cognee`, 17k+ stars): combines memory, knowledge graphs, and data pipelines. Useful lesson: memory ingestion and later organization need stable provenance. https://github.com/topoteretes/cognee
- Hindsight (`vectorize-io/hindsight`, 15k+ stars): focuses on agent memory that learns from past work. Useful lesson: memory systems need feedback signals and quality gates before long-term promotion. https://github.com/vectorize-io/hindsight
- OpenMemory (`CaviraOSS/OpenMemory`, 4k+ stars): validates the local persistent memory store direction for desktop agent tools. Useful lesson: local-first privacy remains a strong differentiator. https://github.com/CaviraOSS/OpenMemory
- MemoryOS (`BAI-LAB/MemoryOS`): frames memory as an operating layer with activation and consolidation. Useful lesson: Dream should behave like an auditable maintenance pass, not a magical cleanup button. https://github.com/BAI-LAB/MemoryOS

### Paper Signals

- Generative Agents shows that retrieval, reflection, and planning become stronger together. KeyMemory implication: Dream should generate explicit maintenance signals and user-review items, not silent rewrites. https://arxiv.org/abs/2304.03442
- MemGPT/Letta motivates virtual context management and separation between limited active context and larger archival memory. KeyMemory implication: the MCP execution layer should be stable and consistent across stdio and HTTP so agents get the same semantics. https://arxiv.org/abs/2310.08560
- Reflexion shows value in storing lessons from prior attempts. KeyMemory implication: low-confidence or sparse memories should stay visible as seeds until confirmed, rather than being prematurely promoted. https://arxiv.org/abs/2303.11366
- MemoryBank highlights long-term user memory with forgetting and updating. KeyMemory implication: every durable memory needs freshness, confidence, source, and project-routing signals. https://arxiv.org/abs/2305.10250

### Product Choices Landed In This Pass

- Added shared memory quality analysis so server logic and Web UI can reason about source evidence, project routing, memory kind, domain tags, confidence, decay, and stale short-lived memories in one place.
- Added Web memory insight panels in the memory detail drawer and Dream preview drawer, making "why this memory needs attention" visible before an agent or user acts on it.
- Consolidated HTTP MCP and stdio MCP tool execution behind one validated executor, reducing drift between agent connection paths and hardening read/write input checks.
- Made agent writes accept the full `CreateMemoryInput` shape through adapters, preserving `projectPath`, `metadata`, `sourceId`, and other routing/provenance fields instead of narrowing writes too early.
- Made Dream promotion quality-gated: short-term memories now need recall signals and a minimum quality score before moving to long-term memory.
- Made Dream semantic organization conservative: high semantic similarity now creates `relates_to` links instead of archiving related memories as if they were duplicates.
- Hardened Dream duplicate handling with text/title checks, operational-tag filtering, safe JSON parsing, and broader rollback snapshots including project identifiers.

### Next Research-Backed Priorities

1. Add temporal validity windows and contradiction handling so KeyMemory can represent changed facts without only relying on supersession.
2. Add a small recall-quality eval for Dream output: duplicate false positives, promotion precision, rollback fidelity, and context-pack usefulness.
3. Surface relation provenance in the UI so users can see whether a link came from Dream, import, manual action, or agent write.
4. Add "confirm before long-term" workflows for memories with low confidence or missing source evidence.
5. Track agent write health per host app, including last successful read/write, validation errors, and permissions/isolation mode.

## Product Direction

KeyMemory should become a project-native memory substrate for coding and work agents. The core job is not "save notes"; it is to let agents recover durable context across months of project work, while keeping memory organized, current, and safe to use.

## Market Scan

- Mem0 positions itself as a universal, self-improving memory layer for LLM applications: https://docs.mem0.ai/introduction
- Zep/Graphiti emphasizes temporal knowledge graphs, episodic ingestion, hybrid semantic/full-text/graph search, and changing facts over time: https://help.getzep.com/graphiti/getting-started/overview
- Letta/MemGPT uses stateful agents and explicit memory blocks/context management: https://docs.letta.com/guides/core-concepts/stateful-agents
- LangGraph memory separates semantic, episodic, and procedural memory: https://docs.langchain.com/oss/python/concepts/memory
- OpenAI ChatGPT memory sets mainstream expectations around preferences, saved memories, user control, history, and automatic memory management: https://help.openai.com/en/articles/8590148-memory-faq

## Paper Support

- MemGPT, "Towards LLMs as Operating Systems" (arXiv:2310.08560): motivates hierarchical memory and virtual context management. https://arxiv.org/abs/2310.08560
- Generative Agents (arXiv:2304.03442): shows memory retrieval plus reflection and planning as a useful agent architecture. https://arxiv.org/abs/2304.03442
- Mem0 (arXiv:2504.19413): supports dynamic extraction, consolidation, retrieval, and graph memory for production agents. https://arxiv.org/abs/2504.19413
- A-MEM (arXiv:2502.12110): argues fixed memory structures are too rigid; agentic memory should dynamically organize itself. https://arxiv.org/abs/2502.12110
- LongMemEval (arXiv:2410.10813): evaluates extraction, multi-session reasoning, temporal reasoning, knowledge updates, and abstention. https://arxiv.org/abs/2410.10813

## Design Principles

1. Project graph first: every memory should land in a project tree, and project folders can be auto-created from content.
2. Typed memories: preferences, decisions, tasks, procedures, constraints, events, relationships, concepts, and raw notes need different behavior.
3. Evidence and time: memories need source, import provenance, validity time, confidence, and version history.
4. Retrieval should be scoped: agents need project subtree search, memory-kind filters, full-text and semantic fusion, plus quality boosts.
5. Dreaming must be reversible: offline consolidation should merge, archive, promote, connect, and suggest, with snapshots and rollback.
6. Migration is a first-class onboarding path: users already have local memory stores, Markdown notes, or JSON exports.
7. Production data safety: migration, dream consolidation, and schema upgrades need portable backup plus restore-readiness verification.
8. Cross-platform release: Windows, Linux, macOS, and WSL must share the same Node-based flow, with shell scripts as convenience only.

## Implemented In This Upgrade

- Added normalized memory kind metadata and `kind:*` tags for every new memory.
- Added automatic project path creation from `projectPath`, `[[Project/Subproject]]`, and explicit natural-language hints such as `项目路径: Project/Subproject`.
- Added project subtree search by default for project-scoped retrieval.
- Added search filters for memory kind and small ranking boosts for confidence, hits, and durable layers.
- Added one-click migration from JSON, JSONL/NDJSON, Markdown, or plain text through CLI/API, with normalization, entity extraction, embedding, and optional dream cycle.
- Added cross-platform migration source discovery for Codex, Claude Code, Hermes, OpenClaw, Cursor, Gemini, Mem0/OpenMemory-style local stores, and workspace agent instruction folders.
- Added directory migration, duplicate-source skipping through `source/sourceId`, and MCP migration tools so agents can discover and import old memory without leaving their host product.
- Added migration project routing from source metadata, discovered source defaults, and relative directory paths so old unmarked memories can still be reorganized into a nested project tree.
- Added dry-run migration previews across CLI, REST, MCP, and Web UI so users can inspect counts, target projects, kinds, duplicates, and errors before writing old memories.
- Added REST/Web migration safety backups so UI-triggered write imports create a portable backup before changing data.
- Added privacy redaction before storage, indexing, embedding, versioning, and migration output; redacted memories carry `sensitivity:redacted` and `metadata.privacy`.
- Added Agent Context Pack retrieval so agents receive grouped preferences, constraints, decisions, tasks, procedures, and project facts within a fixed budget.
- Made Agent Context Pack relation-aware so superseded memories are suppressed and newer replacement memories carry compact lineage notes.
- Made direct memory search relation-aware so active superseded memories are hidden by default, with explicit `includeSuperseded` audit escape hatches.
- Kept HTTP MCP `memory_search` in parity with stdio MCP and direct search for `projectId`, `includeDescendants`, `memoryKind`, and `includeSuperseded` filters.
- Made legacy context injection relation-aware so older agent integrations do not bypass superseded-memory suppression.
- Hardened local-first server defaults: REST/Web binds to loopback by default, public binding requires `KEYMEMORY_API_KEY`, protected REST/HTTP MCP routes enforce the key, and browser CORS rejects unconfigured public origins.
- Added Web UI API-key unlock support for deployments that expose KeyMemory beyond loopback.
- Added a deterministic memory performance budget covering bulk ingest, search p95, agent context packing, dream cycle, and health report on a 300-memory nested-project fixture.
- Added relation expansion in Agent Context Pack so selected memories can pull in linked supporting memories across explicit `relates_to`, `derived_from`, `references`, and `part_of` edges.
- Added a deterministic long-term memory eval harness inspired by LongMemEval to test project-scoped recall, grouping, isolation, abstention, budget control, and privacy.
- Added portable JSON backup, checksum inspection, dry-run restore validation, and explicit replace restore with automatic pre-restore safety backup.
- Added MCP backup create, inspect, and dry-run restore tools so agents can take a safety snapshot before one-click migration or dream consolidation.
- Added dedicated `memory_relations` for memory-to-memory lineage, including `supersedes` links created by dream merges and rollback-safe provenance.
- Added Dream REM association links so shared meaningful hot tags create `relates_to` edges without forcing a merge.
- Exposed dream project-clustering suggestions through CLI and MCP so agents can list, accept, or reject project-tree reorganization proposals.
- Hardened dream scheduling with daily cron validation and visible `nextDreamRunAt` so malformed schedules cannot trigger immediate retry loops.
- Added `keymemory scheduler` so headless users can inspect, update, disable, and re-enable dream scheduling from CLI.
- Added top-level `keymemory` CLI passthrough and expanded doctor capability smoke so installed users can verify context packs, migration, memory relations, dream scheduling, agent config generation, backup, and restore readiness from the launcher.
- Added `keymemory agent-config` snippets for generic MCP, Claude Desktop, Claude Code, Hermes, OpenClaw, and Codex so users can connect KeyMemory without hand-authoring launcher paths.
- Added `keymemory onboard` as a first-run path that combines old-memory discovery, dry-run preview, confirmed migration, pre-import backup, optional dream consolidation, and Agent config snippets.
- Fixed old `memories.project` dependency in health, self-check, compression, and migration handling.

## Migration Interfaces

- CLI discovery: `keymemory migrate-discover`
- CLI one-click import: `keymemory migrate-auto --run-dream`
- CLI path import: `keymemory migrate <file-or-directory> --source codex --run-dream`
- CLI dry-run preview: `keymemory migrate <file-or-directory> --source codex --dry-run`
- REST discovery: `GET /api/migration/sources`
- REST path import: `POST /api/migration/import-path`
- REST one-click import: `POST /api/migration/import-discovered`
- MCP tools: `memory_migration_discover`, `memory_migration_import`
- Agent context: CLI `keymemory context`, REST `POST /api/context/pack`, MCP `memory_context_pack`; see `docs/agent-context-pack.md`.
- Memory eval: `pnpm eval:memory`; see `docs/memory-eval.md`.
- Backup safety: CLI `keymemory backup-create`, `keymemory backup-inspect`, `keymemory backup-restore --dry-run`, `keymemory backup-restore --replace`; REST `POST /api/backup/create-file`, `POST /api/backup/inspect-file`, `POST /api/backup/restore`; MCP `memory_backup_create`, `memory_backup_inspect`, `memory_backup_restore_dry_run`; see `docs/backup-and-recovery.md`.
- Memory relations: CLI `keymemory relate`, `keymemory related`; REST `POST /api/memories/:id/relate`, `GET /api/memories/:id/related`; MCP `memory_relate`, `memory_related`; see `docs/memory-relations.md`.
- Release gate: `pnpm release:check` plus `.github/workflows/ci.yml` matrix on Windows, Linux, and macOS. See `docs/release-readiness.md`.
- Agent configuration: `keymemory agent-config all`; see `docs/agent-configuration.md`.
- First-run onboarding: `keymemory onboard` for safe preview, then `keymemory onboard --yes --run-dream`.
- Dream scheduler: `keymemory scheduler`, `keymemory scheduler --cron "15 4 * * *"`, `keymemory scheduler --disable`, `keymemory scheduler --enable`.
- Privacy gate: see `docs/privacy-and-safety.md`; smoke verifies obvious API keys and tokens are not stored in plaintext.
- HTTP auth gate: smoke verifies public health, protected REST, protected HTTP MCP, bearer auth, and `x-api-key`.

## Release Gate

- `pnpm typecheck`
- `pnpm build`
- fresh database smoke test for create/search/migrate/dream
- stdio MCP smoke test for agent migration and backup tools
- HTTP MCP smoke test for project-scoped and kind-filtered `memory_search`
- privacy redaction smoke test for create/migration paths
- API-key auth smoke test for REST and HTTP MCP routes
- agent context pack smoke test for grouped project-scoped retrieval
- long-term memory eval for recall, grouping, isolation, privacy, budget, and abstention
- backup create/inspect/dry-run restore/replace restore smoke test
- memory relation smoke for manual `supersedes`, dream-created `supersedes`, MCP relation tools, and backup inclusion
- doctor capability smoke for context, migration, relations, scheduler, agent config, backup, restore, and top-level `keymemory` CLI passthrough smoke
- first-run onboarding smoke for dry-run preview, confirmed migration, safety backup, dream option, and Agent config snippets
- REST/Web migration safety backup smoke for write imports
- migration source-path/default project routing smoke for unmarked old memories
- dream project-clustering smoke for CLI list/accept and context retrieval through the new parent project
- launcher smoke for `bin/keymemory` / `keymemory.cmd` passthrough, MCP launcher stdout cleanliness, and onboarding under paths with spaces
- POSIX setup hardening so `pnpm setup` marks command launchers executable on Linux, macOS, and WSL
- natural-language project routing smoke and eval coverage
- Windows PowerShell, WSL, Linux, and macOS launch-path smoke tests
- migration test against JSON, JSONL/NDJSON, Markdown, plain text, and dry-run preview samples
- rollback test for dream reports
- CLI dream scheduler test for show/update/disable/enable and invalid cron rejection
