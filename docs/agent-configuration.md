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
- `claude-code`: project MCP JSON snippet plus `permissions.allow = ["mcp__keymemory__*"]`.
- `hermes`: Hermes `mcp_servers.keymemory` config plus native-memory usage notes.
- `openclaw`: JSON snippet with `mcpServers.keymemory`, `memory.provider = keymemory`, `permissions.allow`, and `allowedTools`.
- `codex`: TOML snippet for Codex `~/.codex/config.toml`.

## Native Memory Permissions

KeyMemory is a native durable memory backend. Read and write tools should be treated like memory access, not like arbitrary external tool use.

- Claude Code: keep `"mcp__keymemory__*"` in `permissions.allow`.
- Codex: keep `default_tools_approval_mode = "approve"` inside `[mcp_servers.keymemory]`.
- OpenClaw: keep `memory.provider = "keymemory"` and allow `"mcp__keymemory__*"` through `permissions.allow` or `allowedTools`.
- Hermes: keep the `mcp_servers.keymemory` entry enabled and include the `keymemory_*` tools; when the host supports MCP permissions, allow `"mcp__keymemory__*"`.

The MCP tools also advertise annotations: lookup-only memory tools are marked read-only, stateful context and loop tools are not marked as pure read-only when they renew leases or update handoff/activity state, ordinary memory writes are local and non-open-world, and destructive deletes are marked separately.

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
7. Ask the agent to call `keymemory_context_pack` before project work and `keymemory_auto_remember` after important exchanges.

For host configs that support tool permissions, keep the KeyMemory allow pattern in place. KeyMemory only writes to the local durable memory store, so native memory reads and writes should not ask for approval in every new agent window.

## Tool Naming

KeyMemory now exposes `keymemory_*` tool names so agents can distinguish the configured KeyMemory default tool from their own local Memory files:

- `keymemory_create`: save durable memory in KeyMemory.
- `keymemory_search`: recall durable memory from KeyMemory.
- `keymemory_context_pack`: build a compact project/task context pack.
- `keymemory_auto_remember`: evaluate an exchange and save it when useful.

The older `memory_*` tool names still work as compatibility aliases, but host agents should prefer `keymemory_*` when both are available.

For large old-memory imports, run `keymemory migrate <path> --dry-run` before writing data.
