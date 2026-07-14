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

The `agent-config` generator still prints snippets without writing files. For the normal path, open **Agent integrations** in the Web UI, choose **Auto / MCP / CLI / Skill**, and select **Connect in one click**. KeyMemory uses an allowlisted path for the selected Agent, merges only KeyMemory fields, preserves existing servers and rules, and creates a timestamped backup before changing an existing file. Invalid JSON is rejected and left unchanged. A known target can be configured proactively even when discovery did not find an install marker.

When KeyMemory runs in WSL and a Windows Agent is selected, the automatic MCP config uses a `wsl.exe` bridge to the stable launcher. For WSL-only Claude Code or Codex installations, the connector keeps the configuration inside the WSL home instead of redirecting it to Windows.

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

`pnpm setup` runs the device scan automatically. Re-run `node install-default-memory.js --all` to automatically configure every detected Agent, or open **Agent integrations** in the Web UI to connect one Agent at a time. Claude Code, Hermes, and Codex default to CLI mode; MCP-capable hosts can use a merged local stdio configuration; Skill-capable hosts can receive a standalone `SKILL.md` plus a persistent instruction that points to it. To onboard a future Agent, run `node install-default-memory.js --prompt` and paste the Chinese result into that Agent.

Examples:

```bash
node install-default-memory.js --agent=workbuddy --mode=mcp --yes
node install-default-memory.js --agent=codex --mode=cli --yes
node install-default-memory.js --agent=opencode --mode=skill --yes
```

## Automatic Memory Policy

Every generated instruction set makes KeyMemory the primary durable memory tool and requires recall at task start plus automatic capture at meaningful transitions:

1. Work process and experience: objectives, key steps, tools, deliveries, validation evidence, pitfalls, failed approaches and causes, successful approaches, constraints, and reusable procedures.
2. User profile: what the user cares about, likes, values, and dislikes; stable preferences, habits, working/communication style, explicit corrections or criticism, and frequently used tools or patterns.
3. Everything the user is doing recently: active or pending work, study, research, life plans, and personal projects, including status, completed steps, delivery paths, remaining work, blockers, next step, and acceptance criteria.

Corrections create a new fact and use `keymemory_supersede` to close the old fact's validity window without deleting history. Generated rules also forbid normal memory from storing credentials and require `agent_space` boundaries to be respected.

The prompt also gives the Agent an explicit operating sequence:

1. Recall with `keymemory_context_pack` or `keymemory_search` before planning; use `keymemory_read` when exact content matters.
2. Write or update at meaningful milestones, using a structured body for profile, task-state, or experience memories.
3. Reuse the active task-state memory instead of creating duplicates, and keep returned IDs for later updates or supersession.
4. Skip raw transcripts, disposable chatter, unverified guesses, duplicate facts, and secrets.
5. Verify three separate states before reporting success: configuration was written, read access is live, and the first meaningful write can be retrieved.

## Connection Verification

Configuration discovery is deliberately not presented as proof of a live connection:

1. The Web UI rescan confirms that an allowlisted configuration or instruction exists.
2. The Agent calls the read-only `keymemory_connection_status` tool. A live KeyMemory server returns `status: connected`, capability flags, and the visible Agent spaces. It then runs one read-only search or context request.
3. At the first real milestone, the Agent writes a meaningful task update and retrieves it. No junk test memory is required.

The generated Chinese prompt requires the Agent to report **configuration / read / write** separately. A missing tool, ordinary prose answer, or config file alone is not accepted as proof.

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

1. Open **Agent integrations**, select an Agent, choose Auto/MCP/CLI/Skill, and click **Connect in one click**. The button itself authorizes the allowlisted local config change.
2. Review the changed files and backup paths reported by the UI. Restart MCP- and Skill-based hosts when requested; CLI-based hosts can use KeyMemory immediately.
3. Ask the Agent to call `keymemory_connection_status` and perform one non-destructive context/search query.
4. Complete write verification at the first real work milestone, then use **Detect connection status** in the UI to rescan the configuration layer.
5. Use **Manual configuration / advanced** or `keymemory agent-config <target>` only when an Agent version stores configuration at a nonstandard path.
6. For batch setup, run `node install-default-memory.js --all`; for a future unknown Agent, run `node install-default-memory.js --prompt`.

The automatic endpoint requires an explicit `confirm=true`, accepts only allowlisted Agent IDs and modes, never accepts an arbitrary destination path, and refuses to replace malformed host JSON.

For host configs that support tool permissions, keep the KeyMemory allow pattern in place. KeyMemory only writes to the local durable memory store, so native memory reads and writes should not ask for approval in every new agent window.

## Tool Naming

KeyMemory now exposes `keymemory_*` tool names so agents can distinguish the configured KeyMemory default tool from their own local Memory files:

- `keymemory_create`: save durable memory in KeyMemory.
- `keymemory_search`: recall durable memory from KeyMemory.
- `keymemory_context_pack`: build a compact project/task context pack.
- `keymemory_auto_remember`: evaluate an exchange and save it when useful.
- `keymemory_connection_status`: return a read-only live connection receipt without creating a memory.

The older `memory_*` tool names still work as compatibility aliases, but host agents should prefer `keymemory_*` when both are available.

For large old-memory imports, run `keymemory migrate <path> --dry-run` before writing data.
