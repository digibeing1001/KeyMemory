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
  recommendedMode: 'cli' | 'mcp';
  evidence: string[];
  configPathHints: string[];
  snippet: string;
  notes: string[];
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
