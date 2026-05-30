# KeyMemory

KeyMemory is a local-first memory layer for coding and work agents. It connects to tools such as Claude Code, Hermes, OpenClaw, Codex, and other MCP-compatible agents, then stores project memory that the agent can retrieve during long-running work.

It is designed for users who already work with agents every day and need the agent to remember project decisions, preferences, constraints, tasks, procedures, and old context without mixing unrelated projects together.

## What It Does

- Stores agent-user interaction memory in a local SQLite database.
- Organizes memories into a nested project tree.
- Lets agents retrieve a compact context pack before doing project work.
- Runs a "dream" consolidation cycle to merge duplicates, connect related memories, supersede stale guidance, and suggest project reorganization.
- Imports existing local memories from Codex, Claude Code, Hermes, OpenClaw, Cursor, Gemini, Mem0/OpenMemory-style folders, Markdown, JSON, JSONL/NDJSON, and plain text.
- Creates safety backups before write imports and destructive restore operations.
- Redacts common secrets before storage, search indexing, embeddings, and versions.
- Runs on Windows, Linux, macOS, and Windows WSL.

## Current Release Model

KeyMemory is currently distributed from source through this repository. The root package is intentionally `private: true`; do not install it as a published npm package yet.

Recommended flow:

```bash
git clone https://github.com/digibeing1001/KeyMemory.git
cd KeyMemory
pnpm setup
keymemory doctor
```

Requirements:

- Node.js 20 or newer
- pnpm
- Git

## First Run

Use onboarding first. It previews old memories, estimates the import result, and prints agent config snippets without writing anything.

```bash
keymemory onboard
```

If the preview looks right, apply the migration:

```bash
keymemory onboard --yes --run-dream --agent-target all
```

This will:

- discover old local memory sources
- create a portable backup before writing
- import and normalize old memories
- infer project paths and memory kinds
- optionally run dream consolidation
- print config snippets for supported agents

Useful options:

```bash
keymemory onboard --root <workspace>
keymemory onboard --no-home
keymemory onboard --agent-target codex
keymemory onboard --agent-target claude-code
keymemory onboard --agent-target hermes
keymemory onboard --agent-target openclaw
```

## Start The UI

```bash
keymemory dashboard
```

Open:

```text
http://127.0.0.1:3210
```

The UI includes:

- memory editor
- project tree
- search
- tag cloud
- dream reports and scheduler
- migration import page
- project organization suggestions
- recycle bin

By default the server binds only to `127.0.0.1`. To expose it to a LAN or public host, set `KEYMEMORY_API_KEY` first. Protected REST and HTTP MCP routes then require:

```text
Authorization: Bearer <key>
```

or:

```text
x-api-key: <key>
```

Browser CORS for non-loopback origins must be explicitly allowed through `KEYMEMORY_ALLOWED_ORIGINS`.

## Connect Agents

Generate config snippets:

```bash
keymemory agent-config all
keymemory agent-config codex --format compact
keymemory agent-config openclaw --format json
```

Supported targets:

- `generic`: any MCP-compatible agent
- `claude-desktop`
- `claude-code`
- `hermes`
- `openclaw`
- `codex`

Use the launcher path from the generated snippet:

```text
bin/keymemory-mcp.js
```

The launcher checks build output, writes logs to `~/.keymemory/logs/mcp.log`, and keeps MCP stdout clean for JSON-RPC.

After connecting, ask the agent to call:

- `memory_context_pack` before long-running project work
- `memory_auto_remember` after important decisions, user preferences, or project updates

Main MCP tools:

| Tool | Purpose |
| --- | --- |
| `memory_create` | Create a memory. |
| `memory_search` | Search memory with project, descendant, kind, and superseded filters. |
| `memory_context_pack` | Build a compact grouped context pack for an agent. |
| `memory_auto_remember` | Evaluate and store important conversation content. |
| `memory_migration_discover` | Discover old local memory sources. |
| `memory_migration_import` | Import and reorganize old memory files or folders. |
| `memory_backup_create` | Create a portable backup before migration or dream consolidation. |
| `memory_backup_inspect` | Inspect backup structure and checksums. |
| `memory_backup_restore_dry_run` | Verify backup restore readiness without writing data. |
| `memory_relate` | Link memories with relations such as `relates_to` or `supersedes`. |
| `memory_related` | List memories related to a given memory. |
| `memory_project_suggestions` | List dream-created project organization suggestions. |
| `memory_project_suggestion_accept` | Accept a project organization suggestion. |
| `memory_project_suggestion_reject` | Reject a project organization suggestion. |

## One-Click Migration

Discover local memory sources:

```bash
keymemory migrate-discover
```

Preview an import:

```bash
keymemory migrate <file-or-directory> --dry-run
```

Import one path:

```bash
keymemory migrate <file-or-directory> --source codex --run-dream
```

Import discovered sources:

```bash
keymemory migrate-auto --run-dream
```

Supported formats:

- `.json`
- `.jsonl`
- `.ndjson`
- `.md`
- `.markdown`
- `.txt`

When old memories do not contain explicit project markers, KeyMemory tries to route them from:

- structured metadata such as `workspace`, `cwd`, `repoPath`, or `projectPath`
- discovered source defaults such as `Workspaces/<workspace>/Claude Code`
- relative folder paths such as `Agent Writer Dashboard/Frontend`

## Project Memory

Every memory belongs to a project. Projects can be nested.

You can route a memory explicitly:

```text
[[KeyMemory/Release/Migration]]
```

Or with a natural-language project hint:

```text
项目路径: KeyMemory/Release/Migration
```

Project-scoped retrieval includes descendants by default, so an agent working inside `KeyMemory/Release` can retrieve memories from `KeyMemory/Release/Migration`.

## Dream Consolidation

Dream cycles keep memory usable as it grows.

They can:

- merge duplicate memories
- archive stale or flash memories
- create `supersedes` links when new guidance replaces old guidance
- create `relates_to` links between related memories
- suggest project-tree reorganization
- produce reports that can be rolled back

Run manually:

```bash
keymemory dream
```

Configure the scheduler:

```bash
keymemory scheduler
keymemory scheduler --cron "15 4 * * *"
keymemory scheduler --disable
keymemory scheduler --enable
```

Only daily 5-field cron values are accepted:

```text
M H * * *
```

## Backup And Restore

Create a portable backup:

```bash
keymemory backup-create ./keymemory-backup.json
```

Inspect it:

```bash
keymemory backup-inspect ./keymemory-backup.json
```

Verify restore readiness without writing:

```bash
keymemory backup-restore ./keymemory-backup.json --dry-run
```

Restore with replace:

```bash
keymemory backup-restore ./keymemory-backup.json --replace
```

`--replace` creates a pre-restore backup first, then restores transactionally and rebuilds FTS.

## Common Commands

```bash
keymemory doctor
keymemory dashboard
keymemory onboard
keymemory context "release checklist" --project "KeyMemory/Release"
keymemory search "user preference" --kind preference
keymemory relate <sourceId> <targetId> --type supersedes
keymemory related <sourceId> --type supersedes
keymemory backup-create ./keymemory-backup.json
keymemory scheduler
keymemory update
```

Developer and release checks:

```bash
pnpm typecheck
pnpm build
pnpm smoke
pnpm smoke:mcp
pnpm smoke:launchers
pnpm eval:memory
pnpm perf:memory
pnpm release:check
```

## Release Quality

The release gate is:

```bash
pnpm release:check
```

It verifies:

- TypeScript typecheck
- production build
- doctor capability smoke
- long-term memory eval
- performance budget
- fresh database smoke
- stdio MCP smoke
- launcher smoke
- migration, backup, relation, scheduler, auth, and project-organization coverage

Current verified gate: `pnpm release:check` passed on 2026-05-31.

Known non-blocker: `keymemory doctor` may warn when `KEYMEMORY_MCP_CONFIG` is not set. That only means it could not inspect an external agent config file; the local MCP launcher still works.

## Documentation

- [Migration Guide](MIGRATION_GUIDE.md)
- [Agent Configuration](docs/agent-configuration.md)
- [Agent Context Pack](docs/agent-context-pack.md)
- [Backup And Recovery](docs/backup-and-recovery.md)
- [Memory Relations](docs/memory-relations.md)
- [Privacy And Safety](docs/privacy-and-safety.md)
- [Performance](docs/performance.md)
- [Release Readiness](docs/release-readiness.md)
- [Product Release Audit](docs/product-release-audit.md)
- [Research And Product Upgrade](docs/research-and-product-upgrade.md)

## License

MIT
