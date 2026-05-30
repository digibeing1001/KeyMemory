# Memory Relations

KeyMemory stores memory-to-memory links in `memory_relations`. This table is separate from the entity knowledge graph table `relations`, so agent memories can supersede, reference, or reinforce one another without polluting entity edges.

## Relation Types

- `relates_to`: loose association found by content/title overlap or agent action.
- `supersedes`: source memory replaces or updates target memory. Dream consolidation writes this when duplicate or old guidance is merged into a keeper memory.
- `derived_from`: source memory was synthesized from target memory.
- `part_of`: source memory is a child/detail of target memory.
- `references`: source memory explicitly points at target memory.

Each relation has `strength` from `0` to `1` and optional `reason` provenance. Dream-created reasons use `dream:<reportId>:<phase>`, which lets rollback remove only the links created by that dream report.

## Interfaces

CLI:

```bash
keymemory relate <sourceId> <targetId> --type supersedes --reason "new policy replaces old policy"
keymemory related <sourceId> --type supersedes
```

REST:

```http
POST /api/memories/:id/relate
GET /api/memories/:id/related?type=supersedes
```

MCP:

- `memory_relate`
- `memory_related`

## Dream Behavior

When Dream light/semantic/deep phases merge duplicate or semantically overlapping memories, KeyMemory archives the weaker memory and writes `keeper --supersedes--> archived memory`. This preserves why old guidance vanished from active search while still letting an agent explain lineage, inspect replaced memories, or recover during rollback.

During REM analysis, memories that share meaningful hot tags are linked with `relates_to` instead of merged. System tags such as `kind:*`, `scope:*`, `project:*`, and `sensitivity:*` are ignored to avoid noisy edges.

`rollbackDream(reportId)` restores snapshots and deletes dream-created `memory_relations` with reason prefix `dream:<reportId>:`. Manual relations are untouched.

## Context Pack Behavior

`memory_context_pack` suppresses active memories that are targets of active `supersedes` relations and promotes the superseding memory instead. Selected items include compact lineage notes, so agents can see that newer guidance replaced older guidance without receiving the old body as primary context.

It also expands through active `relates_to`, `derived_from`, `references`, and `part_of` links. This lets a directly relevant memory pull in supporting evidence, related decisions, or procedural context even when the related memory lives outside the selected project subtree.

## Search Behavior

`memory_search`, `keymemory search`, REST search, and REST context injection suppress active memories that are targets of active `supersedes` relations by default. Use `includeSuperseded` in MCP/REST or `--include-superseded` in CLI when an audit or rollback workflow needs to inspect replaced memories.

## Backup

Portable backups include `memory_relations` by default. Restore order inserts memories before `memory_relations`, and replace restore rebuilds FTS after all memory rows return.
