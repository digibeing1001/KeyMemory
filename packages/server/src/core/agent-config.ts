import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export type AgentConfigTarget = 'generic' | 'claude-desktop' | 'claude-code' | 'hermes' | 'openclaw' | 'codex';

export interface AgentConfigSnippet {
  target: AgentConfigTarget;
  label: string;
  format: 'json' | 'toml' | 'markdown';
  launcherPath: string;
  configPathHints: string[];
  snippet: string;
  notes: string[];
}

const TARGETS: AgentConfigTarget[] = ['generic', 'claude-desktop', 'claude-code', 'hermes', 'openclaw', 'codex'];
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

function genericSnippet(root?: string): AgentConfigSnippet {
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
  };
}

function claudeDesktopSnippet(root?: string): AgentConfigSnippet {
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
      'Tell the agent to prefer keymemory_create, keymemory_search, and keymemory_context_pack over local Memory files.',
    ],
  };
}

function claudeCodeSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'claude-code',
    label: 'Claude Code or project MCP JSON',
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
  };
}

function hermesSnippet(root?: string): AgentConfigSnippet {
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
  };
}

function openClawSnippet(root?: string): AgentConfigSnippet {
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
  };
}

function codexSnippet(root?: string): AgentConfigSnippet {
  const launcher = launcherPath(root);
  return {
    target: 'codex',
    label: 'Codex MCP config',
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
  };
}

export function buildAgentConfigSnippet(target: AgentConfigTarget, root?: string): AgentConfigSnippet {
  switch (target) {
    case 'generic': return genericSnippet(root);
    case 'claude-desktop': return claudeDesktopSnippet(root);
    case 'claude-code': return claudeCodeSnippet(root);
    case 'hermes': return hermesSnippet(root);
    case 'openclaw': return openClawSnippet(root);
    case 'codex': return codexSnippet(root);
  }
}

export function buildAgentConfigSnippets(target: AgentConfigTarget | 'all', root?: string): AgentConfigSnippet[] {
  if (target === 'all') return TARGETS.map(item => buildAgentConfigSnippet(item, root));
  return [buildAgentConfigSnippet(target, root)];
}
