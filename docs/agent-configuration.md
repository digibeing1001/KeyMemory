# Agent Configuration

KeyMemory should be connected through the stable MCP launcher:

```bash
keymemory agent-config all
keymemory agent-config codex --format compact
keymemory agent-config openclaw --format json
```

For first-run setup, use the combined onboarding command:

```bash
keymemory onboard
keymemory onboard --yes --run-dream --agent-target all
```

`onboard` discovers old local memories, previews or applies migration, creates a safety backup before writes, runs dream consolidation when requested, and includes the same Agent config snippets in one response.

The generator prints config snippets without writing files. This keeps setup safe for existing agent configs that may already contain other MCP servers.

## Targets

- `generic`: JSON snippet for any MCP-compatible agent.
- `claude-desktop`: JSON snippet for Claude Desktop `mcpServers`.
- `claude-code`: project MCP JSON snippet for Claude Code-style setups.
- `hermes`: Claude Desktop-compatible MCP config plus Hermes usage notes.
- `openclaw`: JSON snippet with `mcpServers.keymemory` and `memory.provider = keymemory`.
- `codex`: TOML snippet for Codex `~/.codex/config.toml`.

## Why Launcher

Use `bin/keymemory-mcp.js` instead of `packages/server/dist/mcp-server.js`.

The launcher checks build output, writes logs to `~/.keymemory/logs/mcp.log`, and keeps MCP stdout clean for JSON-RPC.

## Safe Install Flow

1. Run `keymemory onboard` for a dry-run preview.
2. Run `keymemory onboard --yes --run-dream --agent-target <target>` when the preview looks right.
3. Or run `keymemory agent-config <target>` if you only need config snippets.
4. Merge the printed snippet into the host agent config.
5. Restart the host agent.
6. Run `keymemory doctor`.
7. Ask the agent to call `memory_context_pack` before project work and `memory_auto_remember` after important exchanges.

For large old-memory imports, run `keymemory migrate <path> --dry-run` before writing data.
