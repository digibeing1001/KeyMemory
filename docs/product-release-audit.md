# Product Release Audit

Generated: 2026-05-31

This audit maps the original KeyMemory product requirements to implementation evidence and release gates. It is intended as the final pre-release checklist for the current source-distribution release.

## Requirement Coverage

| Requirement | Evidence |
| --- | --- |
| Agent memory substrate for Claude Code, Hermes, OpenClaw, Codex, and generic MCP agents | `keymemory agent-config all`; `docs/agent-configuration.md`; MCP tools in `packages/server/src/mcp-server.ts` and `packages/server/src/api/mcp.ts` |
| Store durable user-agent interaction memory | `memory_create`, `memory_auto_remember`, REST memory endpoints, SQLite schema in `packages/server/src/db/sqlite.ts` |
| Help agents retrieve long-running project context | `memory_context_pack`, `keymemory context`, REST `/api/context/pack`, `docs/agent-context-pack.md` |
| Preserve user preferences, habits, constraints, decisions, tasks, and project facts | `MemoryKind` schema in `packages/shared/src/types.ts`; normalization in `packages/server/src/core/memory-schema.ts`; eval in `scripts/eval-memory.mjs` |
| Keep memory organized by nested projects | project tree in `packages/server/src/core/project.ts`; natural-language and bracket routing in `packages/server/src/core/memory-schema.ts`; Web project tree in `packages/web/src/components/ProjectTree.tsx` |
| Periodic dream consolidation | `packages/server/src/core/dreaming.ts`; scheduler in `packages/server/src/core/scheduler.ts`; Web Dream view; rollback support |
| Link, strengthen, supersede, and retire old memories | `memory_relations` table; `memory_relate`; dream-created `supersedes`; search/context default suppression of superseded memories |
| One-click migration from local memory products and old memory folders | `keymemory onboard`, `keymemory migrate-auto`, Web Migration view, REST/MCP migration tools |
| Migration reorganizes imported memory by KeyMemory rules | import normalization, project routing from metadata/source defaults/source paths, memory kind inference, entity extraction, optional dream cycle |
| Migration supports target-agent ecosystems | discovery covers Codex, Claude Code, Hermes, OpenClaw, Cursor, Gemini, Mem0/OpenMemory, workspace `AGENTS.md`, `.claude/`, `.hermes/`, `.openclaw/`, `.cursor/rules` |
| Production safety | redaction before storage/indexing/embedding/versioning, API-key auth for exposed servers, loopback default binding, portable backups, dry-run restore |
| User control and reversibility | dry-run migration, pre-import backups, dream rollback, recycle bin, archive/decay/delete, backup inspect/restore |
| Cross-platform release | Windows/Linux/macOS CI matrix plus WSL smoke step in `.github/workflows/ci.yml`; launcher smoke for paths with spaces |

## Release Gates

The current release gate is `pnpm release:check`. It runs:

- TypeScript typecheck
- production build
- doctor capability smoke
- deterministic long-term memory eval
- deterministic performance budget
- fresh database smoke
- stdio MCP smoke
- launcher smoke

Latest verified gate: `pnpm release:check` passed on 2026-05-31 with one non-blocking doctor warning about missing optional MCP config inspection.

## Known Non-Blockers

- Source distribution remains the recommended release path; the monorepo root stays `private: true`.
- `keymemory doctor` warns when no external MCP config file is declared through `KEYMEMORY_MCP_CONFIG`; this does not block local MCP launcher use.
- Vite dev UI is for local verification only. Production UI is built into `packages/web/dist` and served by `keymemory dashboard`.
