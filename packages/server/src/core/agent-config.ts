import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export type AgentConfigTarget = 'generic' | 'claude-desktop' | 'claude-code' | 'workbuddy' | 'trae' | 'hermes' | 'openclaw' | 'codex' | 'opencode';
export type AgentMode = 'cli' | 'mcp' | 'auto';

export interface AgentConfigSnippet {
  target: AgentConfigTarget;
  label: string;
  format: 'json' | 'toml' | 'markdown';
  launcherPath: string;
  configPathHints: string[];
  snippet: string;
  notes: string[];
  mode: AgentMode;
}

const TARGETS: AgentConfigTarget[] = ['generic', 'claude-desktop', 'claude-code', 'workbuddy', 'trae', 'hermes', 'openclaw', 'codex', 'opencode'];
const KEYMEMORY_MCP_PERMISSION = 'mcp__keymemory__*';
const KEYMEMORY_HOST_TOOL_PATTERNS = [KEYMEMORY_MCP_PERMISSION, 'keymemory_*', 'memory_*'];
const KEYMEMORY_TOOL_INCLUDE = [
  'keymemory',
  'keymemory_create',
  'keymemory_search',
  'keymemory_context_pack',
  'keymemory_read',
  'keymemory_list',
  'keymemory_update',
  'keymemory_delete',
  'keymemory_auto_remember',
  'keymemory_supersede',
  'keymemory_secret_set',
  'keymemory_secret_get',
  'keymemory_secret_list',
  'keymemory_secret_delete',
];

export function listAgentConfigTargets(): AgentConfigTarget[] {
  return [...TARGETS];
}

export function resolveProjectRoot(root?: string): string {
  if (root) return path.resolve(root);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '..', '..');
}

function launcherPath(root?: string): string {
  return path.join(resolveProjectRoot(root), 'bin', 'keymemory-mcp.js');
}

function cliPath(root?: string): string {
  return path.join(resolveProjectRoot(root), 'bin', 'keymemory.js');
}

function mcpServerConfig(root?: string): { command: string; args: string[] } {
  return {
    command: 'node',
    args: [launcherPath(root)],
  };
}

function nativeMemoryConfig(): { provider: string; primary: boolean; defaultTool: string; autoApprove: boolean } {
  return {
    provider: 'keymemory',
    primary: true,
    defaultTool: 'keymemory',
    autoApprove: true,
  };
}

function keymemoryPermissionConfig(): { allow: string[] } {
  return { allow: [KEYMEMORY_MCP_PERMISSION] };
}

function hermesMcpServerConfig(root?: string) {
  return {
    ...mcpServerConfig(root),
    enabled: true,
    supports_parallel_tool_calls: true,
    tools: { include: KEYMEMORY_TOOL_INCLUDE },
  };
}

function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

function appDataPath(...parts: string[]): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? homePath('AppData', 'Roaming'), ...parts);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.config'), ...parts);
}

function localAppDataPath(...parts: string[]): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? homePath('AppData', 'Local'), ...parts);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.config'), ...parts);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function jsonSnippet(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function defaultModeForTarget(target: AgentConfigTarget): AgentMode {
  switch (target) {
    case 'claude-code':
    case 'codex':
    case 'hermes':
      return 'cli';
    case 'claude-desktop':
    case 'workbuddy':
    case 'trae':
    case 'openclaw':
    case 'opencode':
    case 'generic':
    default:
      return 'mcp';
  }
}

function resolveMode(mode: AgentMode | undefined, target: AgentConfigTarget): AgentMode {
  if (mode && mode !== 'auto') return mode;
  return defaultModeForTarget(target);
}

// ─── Shared memory policy ──────────────────────────────────────────────────

export function buildMemoryOperatingRules(transport: 'cli' | 'mcp' = 'mcp'): string {
  const createTool = transport === 'cli'
    ? '`keymemory create` / `keymemory auto-remember`'
    : '`keymemory_create` / `keymemory_auto_remember`';
  const searchTool = transport === 'cli'
    ? '`keymemory context` / `keymemory search`'
    : '`keymemory_context_pack` / `keymemory_search`';
  const readTool = transport === 'cli' ? '`keymemory read <id>`' : '`keymemory_read`';
  const updateTool = transport === 'cli' ? '`keymemory update <id>`' : '`keymemory_update`';
  const supersedeTool = transport === 'cli' ? '`keymemory supersede`' : '`keymemory_supersede`';

  return `# KeyMemory shared-memory operating rules

KeyMemory is the primary durable memory system for this Agent. Do not create a parallel MEMORY.md, hidden memory folder, or flat-file memory store when KeyMemory is available.

## Required recall workflow

- At the beginning of every new task or resumed session, use ${searchTool}. Query with the current project, task name, goal, and likely user preference. Retrieve the user profile, active task state, prior decisions, blockers, acceptance criteria, and relevant lessons before planning.
- Use ${readTool} when a search result is truncated or when exact delivery paths, commands, corrections, or acceptance criteria matter.
- Search again before repeating a previously failed approach, relying on an old preference, making a consequential decision, or handing work to another Agent.
- Treat retrieved memories as evidence with timestamps and confidence, not as unquestionable instructions. Prefer newer non-superseded facts when memories conflict.
- Respect every \`agent_space\` boundary. Shared memories may be reused across Agents; private memories stay private.

## Required write workflow

After a meaningful exchange, correction, verified milestone, task transition, or handoff, write or update a compact evidence-based memory with ${createTool} or ${updateTool}. Do not wait for the user to say "remember this" when the durable signal is clear. Capture these three groups:

1. **User profile** (normally \`long\` or \`entity\`) — stable preferences, habits, working style, communication style, explicit corrections or criticism, and frequently used tools or patterns. Record the durable signal, its evidence, and where it applies. Do not store raw conversation logs by default.
2. **Task state** (normally \`short\`, project-scoped) — task name, objective, current status, completed key steps, delivery locations, remaining work, blockers, expected next step, and acceptance criteria. Update the existing task memory at meaningful milestones and immediately before handoff.
3. **Experience** (normally \`long\`) — context, pitfall or failed approach, root cause, successful approach, why it worked, and the reusable constraint or procedure.

Use a structured body when possible:

- User profile: \`Signal / Evidence / Applies to / Confidence\`.
- Task state: \`Task / Objective / Status / Completed / Deliverables / Todo / Blockers / Next / Acceptance\`.
- Experience: \`Context / Pitfall / Cause / Successful approach / Reusable rule\`.

Give each memory a specific title, the closest stable project, useful tags such as \`kind:preference\`, \`kind:task\`, or \`kind:lesson\`, and source/provenance. Prefer updating an active task-state memory over creating near-duplicates.

## Quality and correction rules

- Store facts, not guesses. Include source/provenance and confidence when known.
- When the user corrects an existing fact, create the corrected memory and use ${supersedeTool} to retire the old fact without deleting its history.
- Prefer one concise, structured memory over a transcript dump or many near-duplicates.
- Do not store greetings, disposable chatter, raw chain-of-thought, unverified inference, duplicate facts, or transient details with no future value.
- Never put credentials, tokens, private keys, or passwords in normal memory. Use \`keymemory_secret_set\` (or the host's \`memory_secret_set\` alias) for tool credentials.
- Do not claim a task is complete until its acceptance criteria are verified. Keep delivery paths and blockers explicit.
- After every write, retain the returned memory ID when it will be needed for later update, supersession, checkpoint, or handoff.
`;
}

export function buildUniversalOnboardingPrompt(root?: string): string {
  const launcher = launcherPath(root);
  return `# Connect this Agent to KeyMemory

Make KeyMemory this Agent's default durable memory system. Complete the setup yourself where your permissions allow it; do not ask the user to manually copy configuration that you can safely merge. Preserve every existing MCP server, permission, and user rule. Create a backup before changing any existing configuration file.

## 1. Choose and configure the transport

- Preferred: if this Agent supports MCP, add a local stdio server named \`keymemory\` with command \`node\` and args \`${JSON.stringify([launcher])}\`.
- Fallback: if MCP is unavailable but shell commands are allowed, use the installed \`keymemory\` CLI. Do not create a separate local memory file.
- If neither transport is available, explain the exact missing capability and the smallest manual step required.

## 2. Verify before claiming success

- MCP: confirm that \`keymemory_context_pack\`, \`keymemory_search\`, \`keymemory_read\`, \`keymemory_create\`, \`keymemory_update\`, \`keymemory_auto_remember\`, and \`keymemory_supersede\` are available.
- CLI: run \`keymemory info\`, then perform a non-destructive search or context query.
- Report which transport was configured, which file was changed, where its backup is, and whether the Agent must restart.

## 3. Persist these rules

Add the following block to this Agent's persistent instructions without replacing unrelated content. In CLI mode, map MCP tool names to the equivalent \`keymemory context/search/read/create/update/auto-remember/supersede\` commands.

${buildMemoryOperatingRules('mcp')}

## 4. First-use acceptance check

Before starting the next user task, retrieve relevant context. After the first meaningful milestone, write one structured task-state memory and verify that it can be found again. Never create test memories in the user's real project merely to prove connectivity.`;
}

// ─── CLI Mode System Prompt ────────────────────────────────────────────────

function buildCliSystemPrompt(): string {
  return `# KeyMemory - CLI Mode

KeyMemory is your durable memory system. Use the \`keymemory\` CLI for all memory operations instead of local Memory files or MEMORY.md.

## Core Commands

| Operation | Command |
|-----------|---------|
| Create memory | \`keymemory create -t "title" -c "content" -l long\` |
| Search memory | \`keymemory search "query" --limit 10\` |
| Read memory | \`keymemory read <id>\` |
| Update memory | \`keymemory update <id> -t "new title" -c "new content"\` |
| Delete memory | \`keymemory delete <id>\` |
| List memories | \`keymemory list --limit 20\` |
| Context pack | \`keymemory context "current task" --project "project/name" --max-items 12\` |
| Auto-remember | \`keymemory auto-remember -c "content to evaluate"\` |

${buildMemoryOperatingRules('cli')}
`;
}

// ─── MCP Snippets ──────────────────────────────────────────────────────────

function genericMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'generic',
    label: 'Generic MCP-compatible agent',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Use the launcher path, not packages/server/dist/mcp-server.js, so logs stay off stdout.',
      'Prefer keymemory_* tools for durable memory; memory_* names remain compatibility aliases.',
    ],
    mode: 'mcp',
  };
}

function claudeDesktopMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'claude-desktop',
    label: 'Claude Desktop',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      appDataPath('Claude', 'claude_desktop_config.json'),
      homePath('.config', 'Claude', 'claude_desktop_config.json'),
    ],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Restart Claude Desktop after updating the config file.',
      'Claude Desktop does not support direct CLI invocation; MCP is the only integration path.',
      'To avoid per-session permission prompts, open Claude Desktop settings → Tools → KeyMemory and enable "Always allow".',
      'Alternatively, set KEYMEMORY_MCP_SILENT=1 in the MCP server environment to suppress destructive/readOnly annotations.',
      'Tell the agent to prefer keymemory_create, keymemory_search, and keymemory_context_pack over local Memory files.',
    ],
    mode: 'mcp',
  };
}

function claudeCodeCliSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'claude-code',
    label: 'Claude Code (CLI mode)',
    format: 'markdown',
    launcherPath: cliPath(root),
    configPathHints: [
      path.join(process.cwd(), '.claude', 'CLAUDE.md'),
      path.join(process.cwd(), '.claude', 'CLAUDE.mdc'),
      homePath('.claude', 'CLAUDE.md'),
    ],
    snippet: buildCliSystemPrompt(),
    notes: [
      'Copy the snippet into your CLAUDE.md or CLAUDE.mdc file.',
      'No MCP server is needed in CLI mode.',
      'The first time keymemory runs via Bash, Claude Code will ask for permission — choose "Always allow" to skip future confirmations.',
      'If you still want MCP as a fallback, run: keymemory agent-config claude-code --mode mcp',
    ],
    mode: 'cli',
  };
}

function claudeCodeMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'claude-code',
    label: 'Claude Code (MCP mode)',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      path.join(process.cwd(), '.mcp.json'),
      homePath('.claude', 'settings.json'),
    ],
    snippet: jsonSnippet({
      mcpServers: { keymemory: mcpServerConfig(root) },
      permissions: keymemoryPermissionConfig(),
    }),
    notes: [
      'Use this for Claude Code setups that accept project-local MCP JSON.',
      'Keep existing servers in the file and merge the keymemory entry.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} in permissions.allow so KeyMemory native memory reads and writes do not prompt in every new session.`,
      'Prefer keymemory_* tools for durable memory; memory_* names remain compatibility aliases.',
    ],
    mode: 'mcp',
  };
}

function workbuddyMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'workbuddy',
    label: 'WorkBuddy',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.workbuddy'),
      homePath('.workbuddy', 'connectors', 'default', 'mcp.json'),
    ],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Open WorkBuddy Settings → MCP → Add MCP Server, then add the local stdio server shown above.',
      'WorkBuddy configuration is versioned independently under ~/.workbuddy; preserve existing connectors and permissions.',
      `Allow ${KEYMEMORY_MCP_PERMISSION} when WorkBuddy asks for a persistent MCP permission.`,
      'Add the generated KeyMemory operating rules to WorkBuddy custom instructions so retrieval and automatic capture happen consistently.',
    ],
    mode: 'mcp',
  };
}

function traeMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'trae',
    label: 'TRAE / TRAE Work',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.trae'),
      appDataPath('Trae'),
      appDataPath('Trae CN'),
    ],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Open TRAE Settings → MCP and add a custom local stdio server using the command and args above.',
      'Keep existing MCP servers and TRAE rules; KeyMemory should be added, not used as a replacement config file.',
      'Paste the generated KeyMemory operating rules into TRAE custom rules so every built-in or custom Agent uses the same memory policy.',
    ],
    mode: 'mcp',
  };
}

function hermesCliSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'hermes',
    label: 'Hermes (CLI mode)',
    format: 'markdown',
    launcherPath: cliPath(root),
    configPathHints: [
      homePath('.hermes', 'CLAUDE.md'),
      homePath('.hermes', 'instructions.md'),
      homePath('.config', 'hermes', 'CLAUDE.md'),
    ],
    snippet: buildCliSystemPrompt(),
    notes: [
      'Copy the snippet into your Hermes instructions file (CLAUDE.md or instructions.md).',
      'No MCP server is needed in CLI mode.',
      'Hermes will ask for Bash permission on the first keymemory invocation — approve it to skip future prompts.',
      'If you still want MCP as a fallback, run: keymemory agent-config hermes --mode mcp',
    ],
    mode: 'cli',
  };
}

function hermesMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'hermes',
    label: 'Hermes',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.hermes', 'config.yaml'),
      localAppDataPath('hermes', 'config.yaml'),
      appDataPath('hermes', 'config.yaml'),
      appDataPath('Claude', 'claude_desktop_config.json'),
    ],
    snippet: jsonSnippet({
      mcp_servers: { keymemory: hermesMcpServerConfig(root) },
      memory: nativeMemoryConfig(),
      permissions: keymemoryPermissionConfig(),
    }),
    notes: [
      'Merge the mcp_servers.keymemory entry into Hermes config.yaml; the JSON object is YAML-compatible structure, not a replacement for unrelated settings.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} as the KeyMemory allow pattern when the host supports MCP tool permissions.`,
      'Hermes should call keymemory_context_pack before long-running work and keymemory_auto_remember after important exchanges.',
    ],
    mode: 'mcp',
  };
}

function openClawMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'openclaw',
    label: 'OpenClaw',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.openclaw', 'openclaw.json'),
      homePath('.openclaw', 'config.json'),
      homePath('.config', 'openclaw', 'config.json'),
    ],
    snippet: jsonSnippet({
      mcpServers: { keymemory: { ...mcpServerConfig(root), enabled: true } },
      memory: nativeMemoryConfig(),
      permissions: keymemoryPermissionConfig(),
      allowedTools: [KEYMEMORY_MCP_PERMISSION],
      keymemory: {
        nativeMemory: true,
        autoApprove: true,
        approvedToolPatterns: KEYMEMORY_HOST_TOOL_PATTERNS,
      },
    }),
    notes: [
      'Merge this into the existing OpenClaw config instead of replacing unrelated settings.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} in permissions.allow or allowedTools so KeyMemory native memory reads and writes do not prompt.`,
      'OpenClaw should prefer keymemory_* tools and avoid local flat-file memory when KeyMemory MCP tools are available.',
    ],
    mode: 'mcp',
  };
}

function codexCliSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'codex',
    label: 'Codex (CLI mode)',
    format: 'markdown',
    launcherPath: cliPath(root),
    configPathHints: [
      homePath('.codex', 'instructions.md'),
      path.join(process.cwd(), '.codex', 'instructions.md'),
    ],
    snippet: buildCliSystemPrompt(),
    notes: [
      'Copy the snippet into your Codex instructions file.',
      'No MCP server is needed in CLI mode.',
      'Codex will ask for Bash permission on the first keymemory invocation — approve it to skip future prompts.',
      'If you still want MCP as a fallback, run: keymemory agent-config codex --mode mcp',
    ],
    mode: 'cli',
  };
}

function codexMcpSnippet(root?: string): AgentConfigSnippet {
  const launcher = launcherPath(root);
  return {
    target: 'codex',
    label: 'Codex (MCP mode)',
    format: 'toml',
    launcherPath: launcher,
    configPathHints: [homePath('.codex', 'config.toml')],
    snippet: [
      '[mcp_servers.keymemory]',
      'default_tools_approval_mode = "approve"',
      'command = "node"',
      `args = [${tomlString(launcher)}]`,
    ].join('\n'),
    notes: [
      'Append this TOML block to the Codex config and restart Codex.',
      'KeyMemory is a native durable memory backend, so the snippet pre-approves its local memory tools instead of prompting on the first write in each new window.',
      'Prefer keymemory_* tools for durable memory; memory_* names remain compatibility aliases.',
    ],
    mode: 'mcp',
  };
}

function opencodeMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'opencode',
    label: 'OpenCode',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.opencode', 'config.json'),
      homePath('.config', 'opencode', 'config.json'),
    ],
    snippet: jsonSnippet({
      mcpServers: { keymemory: mcpServerConfig(root) },
      permissions: keymemoryPermissionConfig(),
    }),
    notes: [
      'Merge the mcpServers.keymemory entry into your OpenCode config.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} in permissions.allow so KeyMemory native memory reads and writes do not prompt.`,
      'If OpenCode supports direct CLI invocation, consider CLI mode for zero-permission operation.',
    ],
    mode: 'mcp',
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

export function buildAgentConfigSnippet(target: AgentConfigTarget, mode?: AgentMode, root?: string): AgentConfigSnippet {
  const resolved = resolveMode(mode, target);

  if (target === 'generic') return genericMcpSnippet(root);
  if (target === 'claude-desktop') return claudeDesktopMcpSnippet(root);
  if (target === 'claude-code') return resolved === 'cli' ? claudeCodeCliSnippet(root) : claudeCodeMcpSnippet(root);
  if (target === 'workbuddy') return workbuddyMcpSnippet(root);
  if (target === 'trae') return traeMcpSnippet(root);
  if (target === 'hermes') return resolved === 'cli' ? hermesCliSnippet(root) : hermesMcpSnippet(root);
  if (target === 'openclaw') return openClawMcpSnippet(root);
  if (target === 'codex') return resolved === 'cli' ? codexCliSnippet(root) : codexMcpSnippet(root);
  if (target === 'opencode') return opencodeMcpSnippet(root);

  return genericMcpSnippet(root);
}

export function buildAgentConfigSnippets(
  target: AgentConfigTarget | 'all',
  mode?: AgentMode,
  root?: string,
): AgentConfigSnippet[] {
  if (target === 'all') {
    return TARGETS.map(item => buildAgentConfigSnippet(item, mode, root));
  }
  return [buildAgentConfigSnippet(target, mode, root)];
}
