#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const projectPath = process.cwd();
const mcpLauncherPath = path.join(projectPath, 'bin', 'keymemory-mcp.js');
const mcpServerPath = path.join(projectPath, 'packages', 'server', 'dist', 'mcp-server.js');

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

const MEMORY_OPERATING_RULES = `## Shared-memory operating rules

KeyMemory is the primary durable memory system. Do not create a parallel MEMORY.md, hidden memory folder, or flat-file memory store when KeyMemory is available.

### Recall before acting

- At the beginning of a new task or resumed session, use keymemory_context_pack or keymemory_search to recall the user profile, current task state, prior decisions, blockers, acceptance criteria, and relevant lessons.
- Search again before relying on a preference, repeating a previously failed approach, or making a decision that may have changed.
- Respect agent_space boundaries. Shared memories may be reused across Agents; private memories stay private.

### Automatically capture durable value

After a meaningful exchange, checkpoint, correction, or task transition, call keymemory_auto_remember or keymemory_create with a compact, evidence-based summary. Capture:

1. User profile: stable preferences, habits, working and communication style, explicit corrections or criticism, and frequently used tools or patterns. Do not store raw transcripts by default.
2. Task state: task name, objective, current status, completed key steps, delivery locations, remaining work, blockers, expected next step, and acceptance criteria.
3. Experience: pitfalls, failed approaches and why they failed, successful approaches and why they worked, and reusable constraints or procedures.

### Quality and correction

- Store facts, not guesses. Include source/provenance and confidence when known.
- When the user corrects an existing fact, create the corrected memory and use keymemory_supersede to retire the old fact without deleting its history.
- Prefer one structured memory over a transcript dump or near-duplicates.
- Never store credentials in normal memory. Use memory_secret_set for tool credentials.
- Do not mark a task complete until its acceptance criteria are verified.`;

const CLAUDE_MD_MCP_CONTENT = `# KeyMemory - Default Memory System

KeyMemory is the primary memory system. Follow these rules:

## Memory Operations

- Use the KeyMemory MCP server named \`keymemory\` for all durable memory operations
- Prefer \`keymemory_create\` to store new memories instead of writing to MEMORY.md
- Prefer \`keymemory_search\` or \`keymemory_context_pack\` to recall relevant context
- Prefer \`keymemory_auto_remember\` for automatic memory capture after significant exchanges
- Use \`keymemory_read\`, \`keymemory_update\`, and \`keymemory_delete\` for direct memory maintenance
- The legacy \`memory_*\` tool names are compatibility aliases only; do not choose local file memory when KeyMemory tools are available

## Important Notes

- MEMORY.md is NO LONGER the primary memory store
- Do not create or update MEMORY.md files for memory purposes
- All memory should go through KeyMemory MCP tools for structured, searchable storage
- KeyMemory provides hybrid search (full-text + semantic) for better recall
- Memories are automatically organized by layer (flash, short, long, entity)

${MEMORY_OPERATING_RULES}
`;

const CLAUDE_MD_CLI_CONTENT = `# KeyMemory - CLI Mode

KeyMemory is the primary memory system. Use the \`keymemory\` CLI for all memory operations instead of MEMORY.md or local Memory files.

## Core Commands

- **Create memory**: \`keymemory create -t "title" -c "content" -l long\`
- **Search memory**: \`keymemory search "query" --limit 10\`
- **Read memory**: \`keymemory read <id>\`
- **Update memory**: \`keymemory update <id> -t "new title" -c "new content"\`
- **Delete memory**: \`keymemory delete <id>\`
- **List memories**: \`keymemory list --limit 20\`
- **Context pack**: \`keymemory context "current task" --project "project/name" --max-items 12\`
- **Auto-remember**: \`keymemory auto-remember -c "content to evaluate"\`

## Rules

- Always use KeyMemory for durable memory instead of MEMORY.md or local Memory files
- Before relying on user preferences, prior decisions, or previous instructions, run \`keymemory search <query>\`
- After significant exchanges, run \`keymemory auto-remember -c "<summary>"\` to capture durable value
- Do not create or update MEMORY.md files for memory purposes
- KeyMemory provides hybrid search (full-text + semantic) for better recall
- Memories are organized by layer: flash (temporary), short (recent), long (durable), entity (concepts/people)

${MEMORY_OPERATING_RULES.replace(/keymemory_context_pack or keymemory_search/g, 'keymemory context or keymemory search').replace(/keymemory_auto_remember or keymemory_create/g, 'keymemory auto-remember or keymemory create').replace(/keymemory_supersede/g, 'keymemory supersede')}
`;

const OPENCLAW_MD_CONTENT = `# KeyMemory - OpenClaw Memory Instructions

KeyMemory is the primary memory system for OpenClaw.

## Memory Operations

- Use the KeyMemory MCP server named \`keymemory\` for all durable memory operations
- Prefer \`keymemory_create\` to store new memories instead of writing to flat files
- Prefer \`keymemory_search\` or \`keymemory_context_pack\` to recall relevant context
- Prefer \`keymemory_auto_remember\` for automatic memory capture after significant exchanges
- Use \`keymemory_read\`, \`keymemory_update\`, and \`keymemory_delete\` for direct memory maintenance
- The legacy \`memory_*\` tool names are compatibility aliases only; do not choose local file memory when KeyMemory tools are available

## Important Notes

- Flat-file memory stores are NO LONGER the primary memory system
- All memory should go through KeyMemory MCP tools for structured, searchable storage
- KeyMemory provides hybrid search (full-text + semantic) for better recall
- Memories are automatically organized by layer (flash, short, long, entity)

${MEMORY_OPERATING_RULES}
`;

const args = process.argv.slice(2);
const flagAll = args.includes('--all');
const flagPrompt = args.includes('--prompt');
const flagAgent = args.find(a => a.startsWith('--agent='));
const specificAgent = flagAgent ? flagAgent.split('=')[1] : null;
const flagMode = args.find(a => a.startsWith('--mode='));
const installMode = flagMode ? flagMode.split('=')[1] : 'auto'; // 'cli', 'mcp', 'auto'

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

function appDataPath(...parts) {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? homePath('AppData', 'Roaming'), ...parts);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.config'), ...parts);
}

function localAppDataPath(...parts) {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? homePath('AppData', 'Local'), ...parts);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.config'), ...parts);
}

function getMcpServerConfig(extra = {}) {
  return {
    command: 'node',
    args: [mcpLauncherPath],
    ...extra,
  };
}

function getNativeMemoryConfig() {
  return {
    provider: 'keymemory',
    primary: true,
    defaultTool: 'keymemory',
    autoApprove: true,
  };
}

function addUnique(array, value) {
  if (!array.includes(value)) array.push(value);
}

function ensureObject(parent, key) {
  if (!parent[key] || typeof parent[key] !== 'object' || Array.isArray(parent[key])) parent[key] = {};
  return parent[key];
}

function ensureArray(parent, key) {
  if (!Array.isArray(parent[key])) parent[key] = [];
  return parent[key];
}

function readJsonConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    console.warn(`Warning: ${filePath} is not valid JSON; a new JSON config will be written.`);
    return {};
  }
}

function backupExisting(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  fs.copyFileSync(filePath, `${filePath}.keymemory-${stamp}.bak`);
}

function writeTextFile(filePath, content) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  backupExisting(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJsonConfig(filePath, config) {
  writeTextFile(filePath, JSON.stringify(config, null, 2) + '\n');
}

function previewChange(label, before, after) {
  console.log(`\n${label} preview:`);
  console.log('--- Before ---');
  console.log(before.length > 400 ? `${before.slice(0, 400)}\n...` : before);
  console.log('--- After ---');
  console.log(after.length > 400 ? `${after.slice(0, 400)}\n...` : after);
}

async function confirmWrite(label) {
  if (flagAll) return true;
  const confirm = await question(`\nWrite ${label}? (y/N) `);
  return confirm.trim().toLowerCase() === 'y';
}

function mergeMcpServer(config, extra = {}) {
  const mcpServers = ensureObject(config, 'mcpServers');
  mcpServers.keymemory = getMcpServerConfig(extra);
}

function mergeKeyMemoryPermissions(config) {
  const permissions = ensureObject(config, 'permissions');
  const allow = ensureArray(permissions, 'allow');
  addUnique(allow, KEYMEMORY_MCP_PERMISSION);
}

function mergeOpenClawNativeMemory(config) {
  mergeMcpServer(config, { enabled: true });
  config.memory = {
    ...ensureObject(config, 'memory'),
    ...getNativeMemoryConfig(),
  };
  mergeKeyMemoryPermissions(config);
  const allowedTools = ensureArray(config, 'allowedTools');
  addUnique(allowedTools, KEYMEMORY_MCP_PERMISSION);
  config.keymemory = {
    ...ensureObject(config, 'keymemory'),
    nativeMemory: true,
    autoApprove: true,
    approvedToolPatterns: KEYMEMORY_HOST_TOOL_PATTERNS,
  };
}

function getClaudeDesktopConfigPath() {
  return appDataPath('Claude', 'claude_desktop_config.json');
}

function getClaudeCodeSettingsPath() {
  return homePath('.claude', 'settings.json');
}

function getCodexConfigPath() {
  return homePath('.codex', 'config.toml');
}

function getHermesConfigPaths() {
  return [
    homePath('.hermes', 'config.yaml'),
    localAppDataPath('hermes', 'config.yaml'),
    appDataPath('hermes', 'config.yaml'),
  ];
}

function getOpenClawConfigCandidates() {
  return [
    homePath('.openclaw', 'openclaw.json'),
    homePath('.openclaw', 'config.json'),
    homePath('.config', 'openclaw', 'config.json'),
  ];
}

function getOpenClawConfigPath() {
  const existing = getOpenClawConfigCandidates().find(filePath => fs.existsSync(filePath));
  return existing ?? homePath('.openclaw', 'openclaw.json');
}

function getWorkBuddyPaths() {
  return [
    homePath('.workbuddy'),
    localAppDataPath('WorkBuddy'),
    appDataPath('WorkBuddy'),
  ];
}

function getTraePaths() {
  return [
    homePath('.trae'),
    localAppDataPath('Trae'),
    appDataPath('Trae'),
    appDataPath('Trae CN'),
  ];
}

function detectClaudeDesktop() {
  return fs.existsSync(path.dirname(getClaudeDesktopConfigPath())) || fs.existsSync(getClaudeDesktopConfigPath());
}

function detectClaudeCode() {
  return fs.existsSync(homePath('.claude')) || fs.existsSync(getClaudeCodeSettingsPath());
}

function detectCodex() {
  return fs.existsSync(homePath('.codex')) || fs.existsSync(getCodexConfigPath());
}

function detectWorkBuddy() {
  return getWorkBuddyPaths().some(filePath => fs.existsSync(filePath));
}

function detectTrae() {
  return getTraePaths().some(filePath => fs.existsSync(filePath));
}

function detectHermes() {
  return getHermesConfigPaths().some(filePath => fs.existsSync(filePath));
}

function detectOpenClaw() {
  return getOpenClawConfigCandidates().some(filePath => fs.existsSync(filePath));
}

async function configureClaudeDesktop() {
  console.log('\nConfiguring Claude Desktop MCP...');
  console.log('-'.repeat(40));

  const configPath = getClaudeDesktopConfigPath();
  const config = readJsonConfig(configPath);
  const beforeJson = JSON.stringify(config, null, 2);

  mergeMcpServer(config);

  const afterJson = JSON.stringify(config, null, 2);
  previewChange(configPath, beforeJson, afterJson);
  if (!(await confirmWrite('Claude Desktop config'))) return;

  writeJsonConfig(configPath, config);
  console.log('Claude Desktop MCP config written.');
}

async function configureGuidedMcpAgent(label, instructionDir, settingsPath) {
  console.log(`\nConfiguring ${label}...`);
  console.log('-'.repeat(40));
  console.log(`Open ${settingsPath} and add this local stdio MCP server:`);
  console.log(JSON.stringify({ mcpServers: { keymemory: getMcpServerConfig() } }, null, 2));

  const instructionsPath = path.join(instructionDir, 'KEYMEMORY_INSTRUCTIONS.md');
  previewChange(instructionsPath, fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, 'utf8') : '(empty)', MEMORY_OPERATING_RULES);
  if (!(await confirmWrite(`${label} KeyMemory instructions`))) return;
  writeTextFile(instructionsPath, MEMORY_OPERATING_RULES + '\n');
  console.log(`${label} memory rules written. Finish the MCP connection in ${settingsPath}, then restart the Agent.`);
}

async function configureWorkBuddy() {
  await configureGuidedMcpAgent('WorkBuddy', homePath('.workbuddy'), 'WorkBuddy Settings → MCP → Add MCP Server');
}

async function configureTrae() {
  await configureGuidedMcpAgent('TRAE', homePath('.trae'), 'TRAE Settings → MCP → Add custom server');
}

async function configureClaudeCode(mode = installMode) {
  console.log('\nConfiguring Claude Code...');
  console.log('-'.repeat(40));

  const useCli = mode === 'cli' || (mode === 'auto' && detectClaudeCode());

  if (useCli) {
    console.log('Mode: CLI (no MCP server needed)');
    await appendClaudeInstructions(true);
    return;
  }

  console.log('Mode: MCP');
  const configPath = getClaudeCodeSettingsPath();
  const config = readJsonConfig(configPath);
  const beforeJson = JSON.stringify(config, null, 2);

  mergeMcpServer(config);
  mergeKeyMemoryPermissions(config);

  const afterJson = JSON.stringify(config, null, 2);
  previewChange(configPath, beforeJson, afterJson);
  if (!(await confirmWrite('Claude Code settings'))) return;

  writeJsonConfig(configPath, config);
  console.log(`Claude Code now allows ${KEYMEMORY_MCP_PERMISSION} without per-session prompts.`);

  await appendClaudeInstructions(false);
}

function hermesKeymemoryBlock() {
  return [
    '  keymemory:',
    '    command: node',
    '    args:',
    `      - ${JSON.stringify(mcpLauncherPath)}`,
    '    enabled: true',
    '    timeout: 120',
    '    connect_timeout: 60',
    '    supports_parallel_tool_calls: true',
    '    tools:',
    '      include:',
    ...KEYMEMORY_TOOL_INCLUDE.map(tool => `        - ${tool}`),
  ].join('\n');
}

function findYamlTopLevelSection(lines, sectionName) {
  const start = lines.findIndex(line => line.trim() === `${sectionName}:` && !line.startsWith(' '));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { start, end };
}

function upsertHermesYaml(content) {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.length > 0 ? normalized.split('\n') : [];
  const blockLines = hermesKeymemoryBlock().split('\n');
  const section = findYamlTopLevelSection(lines, 'mcp_servers');

  if (!section) {
    const prefix = normalized.trimEnd();
    return `${prefix}${prefix ? '\n\n' : ''}mcp_servers:\n${hermesKeymemoryBlock()}\n`;
  }

  let keyStart = -1;
  for (let i = section.start + 1; i < section.end; i += 1) {
    if (/^  keymemory:\s*(?:#.*)?$/.test(lines[i])) {
      keyStart = i;
      break;
    }
  }

  if (keyStart === -1) {
    lines.splice(section.start + 1, 0, ...blockLines);
    return `${lines.join('\n').replace(/\s+$/, '')}\n`;
  }

  let keyEnd = section.end;
  for (let i = keyStart + 1; i < section.end; i += 1) {
    if (/^  [A-Za-z0-9_-]+:\s*(?:#.*)?$/.test(lines[i])) {
      keyEnd = i;
      break;
    }
  }

  lines.splice(keyStart, keyEnd - keyStart, ...blockLines);
  return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

async function configureHermes(mode = installMode) {
  console.log('\nConfiguring Hermes...');
  console.log('-'.repeat(40));

  const useCli = mode === 'cli' || (mode === 'auto' && detectClaudeDesktop() === false);

  if (useCli) {
    console.log('Mode: CLI (no MCP server needed)');
    const instructionsPath = homePath('.hermes', 'CLAUDE.md');
    const before = fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, 'utf8') : '';
    if (before.includes('KeyMemory - CLI Mode')) {
      console.log('Hermes CLAUDE.md already contains KeyMemory CLI instructions.');
      return;
    }
    const after = before + (before ? '\n\n' : '') + CLAUDE_MD_CLI_CONTENT;
    previewChange(instructionsPath, before || '(empty)', after);
    if (!(await confirmWrite('Hermes CLAUDE.md'))) return;
    writeTextFile(instructionsPath, after);
    console.log('Hermes CLAUDE.md updated with CLI instructions.');
    return;
  }

  console.log('Mode: MCP');
  const existingHermesPath = getHermesConfigPaths().find(filePath => fs.existsSync(filePath));
  const hermesConfigPath = existingHermesPath ?? homePath('.hermes', 'config.yaml');
  const before = fs.existsSync(hermesConfigPath) ? fs.readFileSync(hermesConfigPath, 'utf8') : '';
  const after = upsertHermesYaml(before);

  previewChange(hermesConfigPath, before || '{}', after);
  if (await confirmWrite('Hermes config.yaml')) {
    writeTextFile(hermesConfigPath, after);
    console.log('Hermes KeyMemory MCP server config written.');
  }

  if (detectClaudeDesktop()) {
    console.log('\nClaude Desktop is installed; updating its MCP config for Hermes-compatible launches too.');
    await configureClaudeDesktop();
  }

  await appendClaudeInstructions();
}

function upsertTomlKey(section, key, valueLine) {
  const keyPattern = new RegExp(`^${key}\\s*=`, 'm');
  const index = section.findIndex(line => keyPattern.test(line));
  if (index === -1) {
    section.push(valueLine);
  } else {
    section[index] = valueLine;
  }
}

function upsertCodexToml(content) {
  const launcherArg = JSON.stringify(mcpLauncherPath);
  const blockLines = [
    '[mcp_servers.keymemory]',
    'default_tools_approval_mode = "approve"',
    'command = "node"',
    `args = [${launcherArg}]`,
  ];
  const normalized = content.replace(/\r\n/g, '\n');
  if (!/^\[mcp_servers\.keymemory\]\s*$/m.test(normalized)) {
    const prefix = normalized.trimEnd();
    return `${prefix}${prefix ? '\n\n' : ''}${blockLines.join('\n')}\n`;
  }

  const lines = normalized.split('\n');
  const start = lines.findIndex(line => line.trim() === '[mcp_servers.keymemory]');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\[.+\]\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }

  const section = lines.slice(start, end);
  upsertTomlKey(section, 'default_tools_approval_mode', 'default_tools_approval_mode = "approve"');
  upsertTomlKey(section, 'command', 'command = "node"');
  upsertTomlKey(section, 'args', `args = [${launcherArg}]`);
  lines.splice(start, end - start, ...section);
  return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

async function configureCodex(mode = installMode) {
  console.log('\nConfiguring Codex...');
  console.log('-'.repeat(40));

  const useCli = mode === 'cli' || mode === 'auto';

  if (useCli) {
    console.log('Mode: CLI (no MCP server needed)');
    const instructionsPath = homePath('.codex', 'instructions.md');
    const before = fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, 'utf8') : '';
    if (before.includes('KeyMemory - CLI Mode')) {
      console.log('Codex instructions.md already contains KeyMemory CLI instructions.');
      return;
    }
    const after = before + (before ? '\n\n' : '') + CLAUDE_MD_CLI_CONTENT;
    previewChange(instructionsPath, before || '(empty)', after);
    if (!(await confirmWrite('Codex instructions.md'))) return;
    writeTextFile(instructionsPath, after);
    console.log('Codex instructions.md updated with CLI instructions.');
    return;
  }

  console.log('Mode: MCP');
  const configPath = getCodexConfigPath();
  const before = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : '';
  const after = upsertCodexToml(before);

  previewChange(configPath, before || '{}', after);
  if (!(await confirmWrite('Codex config.toml'))) return;

  writeTextFile(configPath, after);
  console.log('Codex now pre-approves the KeyMemory MCP server.');
}

async function configureOpenClaw() {
  console.log('\nConfiguring OpenClaw...');
  console.log('-'.repeat(40));

  const configPath = getOpenClawConfigPath();
  const config = readJsonConfig(configPath);
  const beforeJson = JSON.stringify(config, null, 2);

  mergeOpenClawNativeMemory(config);

  const afterJson = JSON.stringify(config, null, 2);
  previewChange(configPath, beforeJson, afterJson);
  if (!(await confirmWrite('OpenClaw config'))) return;

  writeJsonConfig(configPath, config);
  console.log(`OpenClaw now treats KeyMemory as native memory and allows ${KEYMEMORY_MCP_PERMISSION}.`);

  const openclawMdPath = homePath('.openclaw', 'MEMORY_INSTRUCTIONS.md');
  writeTextFile(openclawMdPath, OPENCLAW_MD_CONTENT);
  console.log('OpenClaw memory instructions written.');
}

async function appendClaudeInstructions(cliMode = false) {
  const claudeMdPath = homePath('CLAUDE.md');
  const content = cliMode ? CLAUDE_MD_CLI_CONTENT : CLAUDE_MD_MCP_CONTENT;
  const marker = cliMode ? 'KeyMemory - CLI Mode' : 'KeyMemory - Default Memory System';

  let existingClaudeMd = '';
  if (fs.existsSync(claudeMdPath)) {
    existingClaudeMd = fs.readFileSync(claudeMdPath, 'utf8');
    if (existingClaudeMd.includes(marker)) {
      console.log(`CLAUDE.md already contains KeyMemory ${cliMode ? 'CLI' : 'MCP'} instructions.`);
      return;
    }
    // Remove old KeyMemory section if present
    if (existingClaudeMd.includes('KeyMemory - Default Memory System') || existingClaudeMd.includes('KeyMemory - CLI Mode')) {
      existingClaudeMd = existingClaudeMd
        .replace(/# KeyMemory - (?:Default Memory System|CLI Mode)[\s\S]*?(?=\n# |\n## |$)/, '')
        .trim();
    }
  }

  const keymemorySection = `${existingClaudeMd ? '\n\n' : ''}${content}`;
  previewChange(claudeMdPath, existingClaudeMd || '(empty)', existingClaudeMd + keymemorySection);
  if (!(await confirmWrite('CLAUDE.md instructions'))) return;

  writeTextFile(claudeMdPath, existingClaudeMd + keymemorySection);
  console.log(`CLAUDE.md updated with ${cliMode ? 'CLI' : 'MCP'} instructions.`);
}

function printGenericConfig() {
  console.log('\nGeneric MCP config:');
  console.log('-'.repeat(40));
  const genericConfig = {
    mcpServers: {
      keymemory: getMcpServerConfig(),
    },
    permissions: {
      allow: [KEYMEMORY_MCP_PERMISSION],
    },
  };
  console.log(JSON.stringify(genericConfig, null, 2));
}

function detectOpenCode() {
  return fs.existsSync(homePath('.opencode')) || fs.existsSync(homePath('.config', 'opencode'));
}

async function configureOpenCode() {
  console.log('\nConfiguring OpenCode...');
  console.log('-'.repeat(40));

  const configPath = homePath('.opencode', 'config.json');
  const config = readJsonConfig(configPath);
  const beforeJson = JSON.stringify(config, null, 2);

  mergeMcpServer(config);
  mergeKeyMemoryPermissions(config);

  const afterJson = JSON.stringify(config, null, 2);
  previewChange(configPath, beforeJson, afterJson);
  if (!(await confirmWrite('OpenCode config'))) return;

  writeJsonConfig(configPath, config);
  console.log(`OpenCode now allows ${KEYMEMORY_MCP_PERMISSION} without per-session prompts.`);
}

const agentInstallers = [
  { id: 'claude-desktop', label: 'Claude Desktop', detect: detectClaudeDesktop, configure: configureClaudeDesktop },
  { id: 'claude-code', label: 'Claude Code', detect: detectClaudeCode, configure: configureClaudeCode },
  { id: 'workbuddy', label: 'WorkBuddy', detect: detectWorkBuddy, configure: configureWorkBuddy },
  { id: 'trae', label: 'TRAE / TRAE Work', detect: detectTrae, configure: configureTrae },
  { id: 'hermes', label: 'Hermes', detect: detectHermes, configure: configureHermes },
  { id: 'openclaw', label: 'OpenClaw', detect: detectOpenClaw, configure: configureOpenClaw },
  { id: 'codex', label: 'Codex', detect: detectCodex, configure: configureCodex },
  { id: 'opencode', label: 'OpenCode', detect: detectOpenCode, configure: configureOpenCode },
];

function buildFutureAgentPrompt() {
  return `Connect yourself to KeyMemory as your default durable memory system.

1. Detect whether you support MCP. If yes, add a local stdio MCP server named "keymemory" with command "node" and args ${JSON.stringify([mcpLauncherPath])}. Preserve all existing MCP servers and user rules.
2. If MCP is unavailable but shell commands are allowed, use the "keymemory" CLI instead.
3. Verify the connection by listing available KeyMemory tools or running "keymemory info".
4. Add the operating rules below to your persistent Agent instructions. Do not overwrite unrelated instructions.

${MEMORY_OPERATING_RULES}`;
}

async function main() {
  console.log('KeyMemory default memory installer');
  console.log('='.repeat(40));

  if (flagPrompt) {
    console.log('\n' + buildFutureAgentPrompt());
    rl.close();
    return;
  }

  if (installMode !== 'cli' && installMode !== 'mcp' && installMode !== 'auto') {
    console.error(`\nError: Invalid mode "${installMode}". Must be one of: cli, mcp, auto`);
    process.exit(1);
  }

  if (!fs.existsSync(mcpLauncherPath)) {
    console.error(`\nError: MCP launcher not found at ${mcpLauncherPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(mcpServerPath)) {
    console.warn(`\nWarning: MCP build output was not found at ${mcpServerPath}. Config will still use the launcher; run pnpm build before starting agents.`);
  }

  console.log(`\nProject path: ${projectPath}`);
  console.log(`MCP launcher: ${mcpLauncherPath}`);
  console.log(`MCP service: ${mcpServerPath}`);
  console.log(`Install mode: ${installMode}`);
  console.log(`Native memory allow pattern: ${KEYMEMORY_MCP_PERMISSION}`);
  console.log('Future Agent prompt: node install-default-memory.js --prompt');

  const detected = agentInstallers.map(agent => ({ ...agent, installed: agent.detect() }));

  console.log('\nDetected agents:');
  for (const agent of detected) {
    console.log(`  ${agent.label.padEnd(15)} ${agent.installed ? 'installed' : 'not detected'}`);
  }

  if (specificAgent) {
    const agent = detected.find(item => item.id === specificAgent);
    if (!agent) {
      console.error(`\nUnsupported agent: ${specificAgent}`);
      printGenericConfig();
      rl.close();
      return;
    }
    await agent.configure();
    printGenericConfig();
    rl.close();
    return;
  }

  const installed = detected.filter(agent => agent.installed);
  if (installed.length === 0) {
    console.log('\nNo installed agents were detected.');
    printGenericConfig();
    rl.close();
    return;
  }

  if (flagAll) {
    for (const agent of installed) {
      await agent.configure();
    }
    printGenericConfig();
    console.log('\nAll detected agents processed. Complete any guided MCP steps shown above.');
    rl.close();
    return;
  }

  console.log('\nChoose an agent to configure:');
  installed.forEach((agent, index) => {
    console.log(`  ${index + 1}. ${agent.label}`);
  });
  console.log(`  ${installed.length + 1}. Show generic MCP config`);
  console.log(`  ${installed.length + 2}. Configure all detected agents`);
  console.log('  0. Exit');

  const choice = await question(`\nEnter option (0-${installed.length + 2}): `);
  const selected = Number(choice.trim());

  if (selected >= 1 && selected <= installed.length) {
    await installed[selected - 1].configure();
  } else if (selected === installed.length + 1) {
    printGenericConfig();
  } else if (selected === installed.length + 2) {
    for (const agent of installed) {
      await agent.configure();
    }
    printGenericConfig();
    console.log('\nAll detected agents processed. Complete any guided MCP steps shown above.');
  } else {
    console.log('Exit.');
  }

  rl.close();
}

main();
