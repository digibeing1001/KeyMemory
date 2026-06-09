import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export type AgentConfigTarget = 'generic' | 'claude-desktop' | 'claude-code' | 'hermes' | 'openclaw' | 'codex' | 'opencode';
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

const TARGETS: AgentConfigTarget[] = ['generic', 'claude-desktop', 'claude-code', 'hermes', 'openclaw', 'codex', 'opencode'];
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

## Rules

- Always use KeyMemory for durable memory instead of MEMORY.md or local Memory files
- Before relying on user preferences, prior decisions, or previous instructions, run \`keymemory search <query>\`
- After significant exchanges, run \`keymemory auto-remember -c "<summary>"\` to capture durable value
- Do not create or update MEMORY.md files for memory purposes
- KeyMemory provides hybrid search (full-text + semantic) for better recall
- Memories are organized by layer: flash (temporary), short (recent), long (durable), entity (concepts/people)
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
