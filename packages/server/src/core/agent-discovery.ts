import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  buildAgentConfigSnippet,
  buildMemoryOperatingRules,
  buildUniversalOnboardingPrompt,
  resolveProjectRoot,
  type AgentConfigTarget,
} from './agent-config.js';

export interface AgentIntegrationStatus {
  id: Exclude<AgentConfigTarget, 'generic'>;
  label: string;
  detected: boolean;
  connected: boolean;
  automatic: boolean;
  recommendedMode: 'cli' | 'mcp';
  evidence: string[];
  configPathHints: string[];
  snippet: string;
  notes: string[];
}

export interface AgentConnectResult {
  success: boolean;
  agentId: AgentIntegrationStatus['id'];
  mode: 'cli' | 'mcp';
  changed: boolean;
  files: string[];
  backups: string[];
  restartRequired: boolean;
  message: string;
}

export interface AgentConnectOptions {
  projectRoot?: string;
  homeDir?: string;
  appDataDir?: string;
  localAppDataDir?: string;
}

export interface AgentDiscoveryReport {
  scannedAt: string;
  projectRoot: string;
  detectedCount: number;
  connectedCount: number;
  agents: AgentIntegrationStatus[];
  operatingRules: string;
  onboardingPrompt: string;
}

interface DetectionSpec {
  id: AgentIntegrationStatus['id'];
  label: string;
  recommendedMode: 'cli' | 'mcp';
  installMarkers: string[];
  connectionFiles: string[];
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
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.local', 'share'), ...parts);
}

function exists(candidate: string): boolean {
  try {
    return fs.existsSync(candidate);
  } catch {
    return false;
  }
}

function mentionsKeyMemory(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > 2_000_000) return false;
    return /keymemory/i.test(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
}

function connectPaths(target: AgentIntegrationStatus['id'], options: AgentConnectOptions = {}): {
  configPath?: string;
  instructionsPath?: string;
} {
  const home = options.homeDir ?? os.homedir();
  const appData = options.appDataDir ?? (process.platform === 'win32'
    ? process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'));
  const localAppData = options.localAppDataDir ?? (process.platform === 'win32'
    ? process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
    : appData);
  const firstExisting = (items: string[], fallback: string): string => items.find(exists) ?? fallback;

  switch (target) {
    case 'claude-desktop':
      return { configPath: path.join(appData, 'Claude', 'claude_desktop_config.json') };
    case 'claude-code':
      return { instructionsPath: path.join(home, '.claude', 'CLAUDE.md') };
    case 'workbuddy':
      return {
        configPath: firstExisting([
          path.join(home, '.workbuddy', 'connectors', 'default', 'mcp.json'),
          path.join(home, '.workbuddy', 'mcp.json'),
        ], path.join(home, '.workbuddy', 'connectors', 'default', 'mcp.json')),
        instructionsPath: path.join(home, '.workbuddy', 'KEYMEMORY_INSTRUCTIONS.md'),
      };
    case 'trae':
      return {
        configPath: firstExisting([
          path.join(home, '.trae', 'mcp.json'),
          path.join(appData, 'Trae', 'User', 'settings.json'),
          path.join(appData, 'Trae CN', 'User', 'settings.json'),
          path.join(localAppData, 'Trae', 'User', 'settings.json'),
        ], path.join(home, '.trae', 'mcp.json')),
        instructionsPath: path.join(home, '.trae', 'KEYMEMORY_INSTRUCTIONS.md'),
      };
    case 'hermes':
      return { instructionsPath: path.join(home, '.hermes', 'CLAUDE.md') };
    case 'openclaw':
      return {
        configPath: firstExisting([
          path.join(home, '.openclaw', 'openclaw.json'),
          path.join(home, '.openclaw', 'config.json'),
          path.join(home, '.config', 'openclaw', 'config.json'),
        ], path.join(home, '.openclaw', 'openclaw.json')),
        instructionsPath: path.join(home, '.openclaw', 'MEMORY_INSTRUCTIONS.md'),
      };
    case 'codex':
      return { instructionsPath: path.join(home, '.codex', 'instructions.md') };
    case 'opencode':
      return {
        configPath: firstExisting([
          path.join(home, '.opencode', 'config.json'),
          path.join(home, '.config', 'opencode', 'config.json'),
        ], path.join(home, '.opencode', 'config.json')),
        instructionsPath: path.join(home, '.opencode', 'KEYMEMORY_INSTRUCTIONS.md'),
      };
  }
}

function mergeConfig(current: unknown, addition: unknown): unknown {
  if (Array.isArray(current) && Array.isArray(addition)) {
    return [...current, ...addition.filter(item => !current.some(existing => JSON.stringify(existing) === JSON.stringify(item)))];
  }
  if (current && addition && typeof current === 'object' && typeof addition === 'object' && !Array.isArray(current) && !Array.isArray(addition)) {
    const output: Record<string, unknown> = { ...(current as Record<string, unknown>) };
    for (const [key, value] of Object.entries(addition as Record<string, unknown>)) {
      output[key] = key in output ? mergeConfig(output[key], value) : value;
    }
    return output;
  }
  return addition;
}

function backupAndWrite(filePath: string, content: string): { changed: boolean; backup?: string } {
  const before = exists(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  if (before === content) return { changed: false };

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let backup: string | undefined;
  if (exists(filePath)) {
    const stamp = new Date().toISOString().replace(/[-:.]/g, '');
    backup = `${filePath}.keymemory-${stamp}.bak`;
    fs.copyFileSync(filePath, backup);
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return { changed: true, backup };
}

function upsertManagedInstructions(before: string, rules: string): string {
  const start = '<!-- KEYMEMORY:START -->';
  const end = '<!-- KEYMEMORY:END -->';
  const block = `${start}\n${rules.trim()}\n${end}`;
  const pattern = /<!-- KEYMEMORY:START -->[\s\S]*?<!-- KEYMEMORY:END -->/;
  if (pattern.test(before)) return `${before.replace(pattern, block).trimEnd()}\n`;
  return `${before.trimEnd()}${before.trim() ? '\n\n' : ''}${block}\n`;
}

export function connectAgentIntegration(
  target: AgentIntegrationStatus['id'],
  options: AgentConnectOptions = {},
): AgentConnectResult {
  if (!specs().some(spec => spec.id === target)) throw new Error(`Unsupported Agent integration: ${target}`);

  const projectRoot = resolveProjectRoot(options.projectRoot);
  const mode = target === 'claude-code' || target === 'hermes' || target === 'codex' ? 'cli' : 'mcp';
  const snippet = buildAgentConfigSnippet(target, mode, projectRoot);
  const paths = connectPaths(target, options);
  const files: string[] = [];
  const backups: string[] = [];
  let changed = false;

  if (paths.configPath) {
    let current: unknown = {};
    if (exists(paths.configPath)) {
      try {
        current = JSON.parse(fs.readFileSync(paths.configPath, 'utf8'));
      } catch {
        throw new Error(`Cannot auto-connect because ${paths.configPath} is not valid JSON. It was left unchanged.`);
      }
    }
    let addition: unknown;
    try {
      addition = JSON.parse(snippet.snippet);
    } catch {
      throw new Error(`The generated ${target} configuration is not valid JSON.`);
    }
    const next = `${JSON.stringify(mergeConfig(current, addition), null, 2)}\n`;
    const written = backupAndWrite(paths.configPath, next);
    files.push(paths.configPath);
    if (written.backup) backups.push(written.backup);
    changed ||= written.changed;
  }

  if (paths.instructionsPath) {
    const before = exists(paths.instructionsPath) ? fs.readFileSync(paths.instructionsPath, 'utf8') : '';
    const rules = mode === 'cli' ? snippet.snippet : buildMemoryOperatingRules('mcp');
    const written = backupAndWrite(paths.instructionsPath, upsertManagedInstructions(before, rules));
    files.push(paths.instructionsPath);
    if (written.backup) backups.push(written.backup);
    changed ||= written.changed;
  }

  return {
    success: true,
    agentId: target,
    mode,
    changed,
    files,
    backups,
    restartRequired: mode === 'mcp',
    message: changed
      ? `KeyMemory was connected to ${snippet.label}. Existing settings were preserved.`
      : `${snippet.label} already has the current KeyMemory configuration.`,
  };
}

function specs(): DetectionSpec[] {
  return [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      recommendedMode: 'mcp',
      installMarkers: [appDataPath('Claude'), appDataPath('Claude', 'claude_desktop_config.json')],
      connectionFiles: [appDataPath('Claude', 'claude_desktop_config.json')],
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      recommendedMode: 'cli',
      installMarkers: [homePath('.claude')],
      connectionFiles: [homePath('.claude', 'settings.json'), homePath('.claude', 'CLAUDE.md'), homePath('CLAUDE.md')],
    },
    {
      id: 'workbuddy',
      label: 'WorkBuddy',
      recommendedMode: 'mcp',
      installMarkers: [homePath('.workbuddy'), localAppDataPath('WorkBuddy'), appDataPath('WorkBuddy')],
      connectionFiles: [
        homePath('.workbuddy', 'connectors', 'default', 'mcp.json'),
        homePath('.workbuddy', 'mcp.json'),
        homePath('.workbuddy', 'settings.json'),
      ],
    },
    {
      id: 'trae',
      label: 'TRAE / TRAE Work',
      recommendedMode: 'mcp',
      installMarkers: [homePath('.trae'), appDataPath('Trae'), appDataPath('Trae CN'), localAppDataPath('Trae')],
      connectionFiles: [
        homePath('.trae', 'mcp.json'),
        homePath('.trae', 'agent.json'),
        appDataPath('Trae', 'User', 'settings.json'),
        appDataPath('Trae CN', 'User', 'settings.json'),
      ],
    },
    {
      id: 'hermes',
      label: 'Hermes',
      recommendedMode: 'cli',
      installMarkers: [homePath('.hermes'), localAppDataPath('hermes'), appDataPath('hermes')],
      connectionFiles: [
        homePath('.hermes', 'config.yaml'),
        homePath('.hermes', 'CLAUDE.md'),
        localAppDataPath('hermes', 'config.yaml'),
        appDataPath('hermes', 'config.yaml'),
      ],
    },
    {
      id: 'openclaw',
      label: 'OpenClaw',
      recommendedMode: 'mcp',
      installMarkers: [homePath('.openclaw'), homePath('.config', 'openclaw')],
      connectionFiles: [
        homePath('.openclaw', 'openclaw.json'),
        homePath('.openclaw', 'config.json'),
        homePath('.openclaw', 'MEMORY_INSTRUCTIONS.md'),
        homePath('.config', 'openclaw', 'config.json'),
      ],
    },
    {
      id: 'codex',
      label: 'Codex',
      recommendedMode: 'cli',
      installMarkers: [homePath('.codex')],
      connectionFiles: [homePath('.codex', 'config.toml'), homePath('.codex', 'instructions.md')],
    },
    {
      id: 'opencode',
      label: 'OpenCode',
      recommendedMode: 'mcp',
      installMarkers: [homePath('.opencode'), homePath('.config', 'opencode')],
      connectionFiles: [homePath('.opencode', 'config.json'), homePath('.config', 'opencode', 'config.json')],
    },
  ];
}

export function discoverAgentIntegrations(root?: string): AgentDiscoveryReport {
  const projectRoot = resolveProjectRoot(root);
  const agents = specs().map((spec): AgentIntegrationStatus => {
    const evidence = [...spec.installMarkers, ...spec.connectionFiles]
      .filter((candidate, index, items) => items.indexOf(candidate) === index && exists(candidate));
    const snippet = buildAgentConfigSnippet(spec.id, spec.recommendedMode, projectRoot);
    return {
      id: spec.id,
      label: spec.label,
      detected: spec.installMarkers.some(exists),
      connected: spec.connectionFiles.some(mentionsKeyMemory),
      automatic: true,
      recommendedMode: spec.recommendedMode,
      evidence,
      configPathHints: snippet.configPathHints,
      snippet: snippet.snippet,
      notes: snippet.notes,
    };
  });

  return {
    scannedAt: new Date().toISOString(),
    projectRoot,
    detectedCount: agents.filter(agent => agent.detected).length,
    connectedCount: agents.filter(agent => agent.connected).length,
    agents,
    operatingRules: buildMemoryOperatingRules('mcp'),
    onboardingPrompt: buildUniversalOnboardingPrompt(projectRoot),
  };
}
