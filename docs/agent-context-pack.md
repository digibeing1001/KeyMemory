# KeyMemory Agent Context Pack

Generated: 2026-05-30

## Purpose

Agents need a compact memory packet before doing long-running work. Raw search results are not enough: preferences, rules, decisions, tasks, procedures, and project facts should be grouped and ordered so the agent can act on them.

## Interfaces

CLI:

```bash
keymemory context "release checklist" --project "KeyMemory/发布" --max-items 12 --max-chars 6000
keymemory context "release checklist" --project "KeyMemory/发布" --markdown
```

REST:

```http
POST /api/context/pack
POST /api/context/inject
```

MCP:

```text
memory_context_pack
```

Prompt:

```text
memory_context
```

## Behavior

- Resolves `project` or `projectId`.
- Includes descendant projects by default.
- Uses hybrid retrieval for the current query.
- HTTP MCP `memory_search` exposes the same project scope, descendant, kind, and superseded filters for lighter agent lookups.
- Adds recent scoped project memories so stable preferences and constraints are present even when the query wording differs.
- Suppresses memories that are actively superseded by newer memories, then promotes the superseding memory into the pack.
- Legacy context injection also suppresses superseded memories by default; pass `includeSuperseded: true` only for audit or rollback flows.
- Expands from selected memories through strong `relates_to`, `derived_from`, `references`, and `part_of` links, so supporting context can follow explicit memory relationships even when wording differs.
- Adds compact relation lineage such as `supersedes`, `relates_to`, `derived_from`, and `references` under each selected item.
- Groups output by `memoryKind`: preferences, constraints, decisions, tasks, procedures, project facts, relationships, concepts, events, raw notes.
- Applies an approximate character budget and item cap.
- Emits both structured JSON and markdown.

## Agent Use

Call this before:

- starting a coding task
- writing a PRD or project document
- making tradeoff decisions
- generating user-facing output
- resuming an old project

Use the markdown field as the system/task context. Use item IDs for follow-up reads when exact details are needed.
