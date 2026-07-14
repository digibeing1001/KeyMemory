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

The `agent-config` generator still prints snippets without writing files. For a simpler path, open **Agent integrations** in the Web UI and choose **Connect in one click**. KeyMemory uses an allowlisted path for the selected detected Agent, merges only the KeyMemory fields, preserves existing MCP servers and rules, and creates a timestamped backup before changing an existing file. Invalid JSON is rejected and left unchanged.

## Targets

- `generic`: JSON snippet for any MCP-compatible agent.
- `claude-desktop`: JSON snippet for Claude Desktop `mcpServers`.
- `claude-code`: project MCP JSON snippet plus `permissions.allow = ["mcp__keymemory__*"]`.
- `workbuddy`: local stdio MCP snippet for WorkBuddy Settings → MCP, plus persistent memory rules under `~/.workbuddy`.
- `trae`: local stdio MCP snippet for TRAE / TRAE Work Settings → MCP, plus custom Agent rules.
- `hermes`: Hermes `mcp_servers.keymemory` config plus native-memory usage notes.
- `openclaw`: JSON snippet with `mcpServers.keymemory`, `memory.provider = keymemory`, `permissions.allow`, and `allowedTools`.
- `codex`: TOML snippet for Codex `~/.codex/config.toml`.
- `opencode`: JSON MCP snippet with persistent KeyMemory permissions.

`pnpm setup` runs the device scan automatically. Re-run `node install-default-memory.js --all` to automatically configure every detected Agent, or open **Agent integrations** in the Web UI to connect one Agent at a time. Claude Code, Hermes, and Codex default to CLI mode, so they do not require MCP configuration; MCP-only hosts receive a merged local stdio configuration. To onboard a future Agent, run `node install-default-memory.js --prompt` and paste the result into that Agent.

## Automatic Memory Policy

Every generated instruction set makes KeyMemory the primary durable memory tool and requires recall at task start plus automatic capture at meaningful transitions:

1. User profile: stable preferences, habits, working/communication style, explicit corrections or criticism, and frequently used tools or patterns.
2. Task state: task name, objective, status, completed key steps, delivery paths, remaining work, blockers, next step, and acceptance criteria.
3. Experience: pitfalls, failed approaches and causes, successful approaches, constraints, and reusable procedures.

Corrections create a new fact and use `keymemory_supersede` to close the old fact's validity window without deleting history. Generated rules also forbid normal memory from storing credentials and require `agent_space` boundaries to be respected.

The prompt also gives the Agent an explicit operating sequence:

1. Recall with `keymemory_context_pack` or `keymemory_search` before planning; use `keymemory_read` when exact content matters.
2. Write or update at meaningful milestones, using a structured body for profile, task-state, or experience memories.
3. Reuse the active task-state memory instead of creating duplicates, and keep returned IDs for later updates or supersession.
4. Skip raw transcripts, disposable chatter, unverified guesses, duplicate facts, and secrets.
5. Verify the configured transport and perform a non-destructive recall check before reporting success.

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

1. Open **Agent integrations**, select a detected Agent, and click **Connect in one click**. The button itself authorizes the allowlisted local config change.
2. Review the changed files and backup paths reported by the UI. Restart MCP-based hosts when requested; CLI-based hosts can use KeyMemory immediately.
3. Run `keymemory doctor` and ask the Agent for a non-destructive context/search query.
4. Use **Manual configuration / advanced** or `keymemory agent-config <target>` only when an Agent version stores configuration at a nonstandard path.
5. For batch setup, run `node install-default-memory.js --all`; for a future unknown Agent, run `node install-default-memory.js --prompt`.

The automatic endpoint requires an explicit `confirm=true`, accepts only detected allowlisted Agent IDs, never accepts an arbitrary destination path, and refuses to replace malformed host JSON.

For host configs that support tool permissions, keep the KeyMemory allow pattern in place. KeyMemory only writes to the local durable memory store, so native memory reads and writes should not ask for approval in every new agent window.

## Tool Naming

KeyMemory now exposes `keymemory_*` tool names so agents can distinguish the configured KeyMemory default tool from their own local Memory files:

- `keymemory_create`: save durable memory in KeyMemory.
- `keymemory_search`: recall durable memory from KeyMemory.
- `keymemory_context_pack`: build a compact project/task context pack.
- `keymemory_auto_remember`: evaluate an exchange and save it when useful.

The older `memory_*` tool names still work as compatibility aliases, but host agents should prefer `keymemory_*` when both are available.

For large old-memory imports, run `keymemory migrate <path> --dry-run` before writing data.
