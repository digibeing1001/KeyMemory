# Project Organization

KeyMemory treats the project tree as part of memory quality. Dream consolidation can detect projects that share entities, concepts, tools, or people, then create `project_suggestions` records instead of silently moving the tree.

## CLI

List suggestions:

```bash
keymemory project-suggestions
keymemory project-suggestions --status pending
```

Accept one suggestion and optionally choose the new parent folder name:

```bash
keymemory project-suggestion-accept <suggestionId> --name "Agent Memory Cluster"
```

Reject a suggestion:

```bash
keymemory project-suggestion-reject <suggestionId>
```

Accepting a suggestion creates the parent project if needed and moves the suggested projects under it. Existing child projects and their memories keep working because descendant paths are cascaded.

## REST

```text
GET  /api/project-suggestions?status=pending
POST /api/project-suggestions/:id/accept
POST /api/project-suggestions/:id/reject
```

The accept body may include:

```json
{ "customName": "Agent Memory Cluster" }
```

## Web UI

Open the KeyMemory UI and choose `Organize` in the sidebar. The page lists pending, accepted, and rejected project suggestions created by dream consolidation.

For pending suggestions, users can edit the proposed parent project name, accept the suggestion, or reject it. Accepting refreshes the project tree and keeps existing memories available through the moved child projects.

## MCP

Agents can inspect and apply project organization suggestions through:

- `memory_project_suggestions`
- `memory_project_suggestion_accept`
- `memory_project_suggestion_reject`

These tools close the loop between dream-time project clustering and agent-visible project-tree maintenance.

## Release Coverage

`pnpm smoke` creates two projects with a shared concept, runs a dream cycle, verifies a pending project suggestion, accepts it, and confirms a context pack can retrieve both moved child projects through the new parent.

`pnpm smoke:mcp` verifies the MCP project suggestion tools are exposed and callable.
