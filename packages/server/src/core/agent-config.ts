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

function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

function appDataPath(...parts: string[]): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? homePath('AppData', 'Roaming'), ...parts);
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
    notes: ['Use the launcher path, not packages/server/dist/mcp-server.js, so logs stay off stdout.'],
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
    notes: ['Restart Claude Desktop after updating the config file.'],
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
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Use this for Claude Code setups that accept project-local MCP JSON.',
      'Keep existing servers in the file and merge the keymemory entry.',
    ],
  };
}

function hermesSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'hermes',
    label: 'Hermes via Claude Desktop MCP',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [appDataPath('Claude', 'claude_desktop_config.json')],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: ['Hermes should call memory_context_pack before long-running work and memory_auto_remember after important exchanges.'],
  };
}

function openClawSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'openclaw',
    label: 'OpenClaw',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.openclaw', 'config.json'),
      homePath('.config', 'openclaw', 'config.json'),
    ],
    snippet: jsonSnippet({
      mcpServers: { keymemory: mcpServerConfig(root) },
      memory: { provider: 'keymemory', primary: true },
    }),
    notes: ['Merge this into the existing OpenClaw config instead of replacing unrelated settings.'],
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
      'command = "node"',
      `args = [${tomlString(launcher)}]`,
    ].join('\n'),
    notes: ['Append this TOML block to the Codex config and restart Codex.'],
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
