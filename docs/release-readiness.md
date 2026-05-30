# KeyMemory Release Readiness

Generated: 2026-05-30

## Supported Targets

- Windows PowerShell / CMD
- Linux shell
- macOS shell
- Windows WSL

## Required Gates

Run before every release:

```bash
pnpm install --frozen-lockfile
pnpm release:check
```

`release:check` verifies:

- TypeScript typecheck
- production build for shared/server/web packages
- local-first server safety: default loopback binding, public binding requires `KEYMEMORY_API_KEY`, REST/MCP routes enforce that key, and browser CORS rejects unconfigured public origins
- `keymemory doctor` capability smoke on a temp database, including project routing, context pack, migration dry-run/import, memory relations, dream scheduler, agent config, backup, and dry-run restore
- deterministic long-term memory eval
- deterministic memory performance budget for 300 project memories, including ingest, search p95, context pack, dream cycle, and health report
- fresh-database core smoke
- stdio MCP smoke, including migration discovery/import tools
- stdio MCP smoke, including memory relation tools `memory_relate` and `memory_related`
- stdio MCP smoke, including backup tools `memory_backup_create`, `memory_backup_inspect`, and `memory_backup_restore_dry_run`
- HTTP MCP smoke, including `memory_search` project scope and `memoryKind` filter parity with stdio MCP
- agent context pack smoke, including grouped project-scoped retrieval
- agent context pack smoke, including superseded-memory suppression and relation lineage notes
- agent context pack smoke, including relation expansion through explicit memory links
- legacy context injection smoke, including superseded-memory suppression and explicit include-superseded audit behavior
- memory eval, including preference recall, natural-language project routing, project isolation, kind filters, budget caps, privacy, and abstention
- memory eval, including default search suppression for superseded memories and explicit include-superseded audit behavior
- privacy smoke, including default credential redaction before storage
- API-key auth smoke, including public `/api/health`, protected REST routes, protected HTTP MCP, bearer auth, and `x-api-key`
- one-click migration coverage for file, directory, JSONL/NDJSON, dry-run preview, duplicate skip, discovery, auto import, dream, search, and health
- one-click migration discovery for workspace Claude Code, Hermes, OpenClaw, Cursor rules, and AGENTS.md sources
- migration project routing from metadata, discovered source defaults, and source directory paths when old memories have no explicit project marker
- REST/Web migration write imports create a safety backup before changing data
- portable backup, dry-run restore, replace restore, automatic pre-restore backup, and FTS rebuild coverage
- memory relation smoke for manual `supersedes`, dream-created `supersedes`, and backup inclusion of `memory_relations`
- dream REM smoke for tag-driven `relates_to` associations without merging memories
- dream project clustering smoke for creating, listing, and accepting project organization suggestions
- Web UI includes an `Organize` review surface for listing, accepting, and rejecting dream-created project suggestions
- dream scheduler smoke for validated daily cron config and visible next-run time
- dream scheduler CLI smoke for `keymemory scheduler`, cron updates, disable/enable, and invalid cron rejection
- top-level `keymemory` CLI passthrough for server commands such as `context`
- launcher smoke for the platform wrapper (`bin/keymemory` or `keymemory.cmd`) and the MCP launcher (`bin/keymemory-mcp.js`) on paths with spaces
- POSIX setup smoke/static gate ensuring `pnpm setup` marks `bin/keymemory`, `bin/keymemory-mcp`, `bin/keymemory-ui`, and `bin/keymemory-ui-wsl` executable after clone
- `keymemory agent-config` smoke for generic MCP, Claude Desktop, Claude Code, Hermes, OpenClaw, and Codex snippets
- `keymemory onboard` smoke for first-run dry-run preview, write-confirmed migration, pre-import backup, dream option, and Agent config snippets
- release artifacts and docs exist

## CI Matrix

`.github/workflows/ci.yml` runs `pnpm release:check` on:

- `windows-latest`
- `ubuntu-latest`
- `macos-latest`

It also includes a Windows WSL smoke step. The WSL step runs only when the hosted runner has a ready WSL distro with Node and pnpm installed; otherwise it records a skip instead of failing unrelated CI.

## Manual Cross-Platform Smoke

On each target OS:

```bash
pnpm install --frozen-lockfile
pnpm release:check
node bin/keymemory.js doctor
node bin/keymemory.js dashboard
```

For WSL:

```bash
pwd
node --version
pnpm --version
pnpm release:check
node bin/keymemory-ui.js
```

If the repo is under `/mnt/c/`, KeyMemory warns because WSL and Windows may share the same home/data folder. Prefer cloning under the Linux home directory.

## Release Blockers

- `pnpm release:check` fails on any supported OS.
- `keymemory doctor` cannot validate project-tree write, agent context pack, migration, memory relations, dream scheduler, agent config, portable backup, and dry-run restore on a temp database.
- `pnpm eval:memory` scores below 1.0 or reports failed cases.
- `pnpm perf:memory` exceeds default performance budgets for ingest, search p95, context pack, dream cycle, health report, or total runtime.
- MCP `tools/list` does not include `memory_migration_discover` and `memory_migration_import`.
- MCP `tools/list` does not include `memory_context_pack`.
- MCP `tools/list` does not include `memory_relate` and `memory_related`.
- MCP `tools/list` does not include backup safety tools `memory_backup_create`, `memory_backup_inspect`, and `memory_backup_restore_dry_run`.
- `keymemory agent-config all` does not include launcher-based snippets for Claude/Hermes/OpenClaw/Codex.
- platform launchers fail to pass `--data-dir`, cannot run `onboard` from a path with spaces, or `bin/keymemory-mcp.js` writes non-JSON text to MCP stdout.
- `pnpm setup` on Linux/macOS/WSL leaves POSIX launcher files non-executable after adding `bin` to `PATH`.
- `keymemory onboard` writes memories without `--yes`, skips backup before confirmed migration, or fails to include Agent config snippets.
- `keymemory context` cannot return grouped preferences/decisions for a fresh project smoke dataset.
- `keymemory context` returns superseded old memory bodies instead of the newer superseding memory with relation lineage.
- `/api/context/inject` or `injectContext()` returns superseded memories by default, or cannot include them explicitly for audit.
- `keymemory search` or MCP `memory_search` returns superseded memories by default, or cannot include them explicitly for audit.
- HTTP MCP `memory_search` ignores `projectId`, `includeDescendants`, or `memoryKind`, causing one agent/project to retrieve another project's migrated memory.
- `keymemory context` cannot pull in explicitly related supporting memories from `relates_to`, `derived_from`, `references`, or `part_of` relations.
- Dream merge archives duplicate memories without creating a `supersedes` relation in `memory_relations`.
- Dream REM finds shared meaningful hot tags but does not create `relates_to` relations.
- Dream project clustering creates hidden suggestions that cannot be listed or accepted through CLI/MCP/Web UI.
- Web UI project organization view cannot accept or reject a pending suggestion, or accepting does not refresh the project tree.
- Dream scheduler accepts invalid cron values, hides the next scheduled run, or can loop immediately on malformed schedules.
- `keymemory scheduler` cannot show/update the dream schedule, disable/enable scheduled dreams, or reject invalid cron values.
- explicit natural-language project hints such as `项目路径: A/B/C` do not create nested project folders.
- A fake API key or token appears in stored memory content, metadata, FTS-backed search, or smoke output.
- REST/Web server binds to a non-loopback host without `KEYMEMORY_API_KEY`.
- Protected REST or HTTP MCP routes accept requests without `Authorization: Bearer <key>` or `x-api-key`.
- Browser CORS allows unconfigured public origins.
- Fresh database smoke cannot create, migrate, dream, search, and report health.
- REST migration source discovery or path import fails.
- One-click migration cannot discover workspace `.hermes/` or `.openclaw/` old-memory folders.
- Migration import cannot infer project paths from old-memory metadata, discovered source defaults, or source directory hierarchy.
- REST/Web migration write imports fail to return a valid safety backup before importing.
- JSONL/NDJSON memory exports are skipped by directory migration or cannot be normalized into searchable memories.
- `keymemory migrate --dry-run` writes memories, runs dream consolidation, or fails to report preview counts.
- `keymemory backup-create`, `keymemory backup-inspect`, `keymemory backup-restore --dry-run`, or `keymemory backup-restore --replace` fails.
- Web UI build does not include migration view.
- WSL launch path silently mixes Windows and Linux data directories.
