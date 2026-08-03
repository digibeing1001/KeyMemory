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
  'keymemory_connection_status',
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

const MEMORY_OPERATING_RULES = `## KeyMemory 共享记忆强制规则

KeyMemory 是默认、唯一的长期记忆。不要再建立 MEMORY.md 或其他平行记忆文件。

### 每次开始工作前

- 先搜索用户画像、最近正在做的事情、当前任务状态、历史决策、踩坑和成功经验，再制定方案。
- 内容被截断，或需要确认路径、命令、纠正内容和验收标准时，读取完整记忆。
- 在重复失败方案、采用旧偏好、作出重要决定或交接前，再搜索一次。

### 必须写入的三类数据

1. 工作过程与经验：目标、方案、关键步骤、决策、工具、命令、交付位置和验证结果；错误、失败办法、踩坑现象、根因和避免方式；已经验证成功的做法、成功条件、原因和可复用流程。结构：背景 / 目标 / 做过什么 / 踩坑与原因 / 成功做法 / 验证证据 / 可复用规则。
2. 用户画像：用户关注、喜欢、重视、不喜欢和禁止的内容；沟通风格、输出偏好、常用工具、工作和生活习惯、反复出现的选择，以及用户的纠正、批评和认可。结构：偏好信号 / 证据 / 喜欢或重视 / 不喜欢或避免 / 适用范围 / 置信度。
3. 最近事项：用户近期正在工作、学习、研究、计划、等待或尚未完成的所有事情。结构：事项 / 目标 / 当前状态 / 已完成 / 交付位置 / 待办 / 阻塞 / 下一步 / 验收标准 / 最后更新时间。

### 写入与更新时机

- 发现偏好、习惯、纠正、批评或禁忌后立即写入。
- 任务建立、状态变化、完成里程碑、出现或解决阻塞、产生交付物时立即更新。
- 每次形成踩坑结论或验证成功经验后立即沉淀。
- 在任务暂停、结束、交接或会话可能中断前，更新最近事项。

### 数据处理方式

- 写入前先搜索；已有同一记录就更新，不制造重复项。
- 用户纠正旧事实时，保存正确版本并用 keymemory_supersede 让旧版本失效，同时保留历史来源。
- 使用具体标题、最接近的项目、类别标签、来源、时间和置信度。
- 工作过程保存结构化摘要，不保存寒暄、无意义闲聊、原始逐字对话、内部思维过程、未经证实的猜测或重复内容。
- 密码、令牌、私钥和密钥不得写入普通记忆，只能使用专用凭证保存工具。
- 写入后保留返回的记忆 ID；未验证验收标准前不能把任务标为完成。`;

const KEYMEMORY_SKILL = `---
name: keymemory
description: 使用 KeyMemory 读取用户偏好、最近事项和历史经验，并持续写回工作进度、踩坑、成功经验和用户习惯。
---

# KeyMemory 共享记忆

任务涉及用户偏好、近期事项、历史决策、任务续接或经验复用时，必须加载本规则包。

连接顺序：优先使用 keymemory_* 工具；其次使用 keymemory 命令；最后可访问 http://127.0.0.1:3210。三种方式都不可用时必须说明尚未连接。

${MEMORY_OPERATING_RULES}

配置检查时不要制造测试记忆。使用 keymemory_connection_status 和一次只读搜索证明读取链路；在第一个真实工作节点写入任务状态并重新搜索，证明写入链路。`;

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
const flagYes = args.includes('--yes');
const flagPrompt = args.includes('--prompt');
const flagAgent = args.find(a => a.startsWith('--agent='));
const specificAgent = flagAgent ? flagAgent.split('=')[1] : null;
const flagMode = args.find(a => a.startsWith('--mode='));
const installMode = flagMode ? flagMode.split('=')[1] : 'auto'; // 'cli', 'mcp', 'skill', 'auto'

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
    throw new Error(`${filePath} is not valid JSON. KeyMemory left it unchanged; repair the file before retrying automatic setup.`);
  }
}

function backupExisting(filePath) {
  if (!fs.existsSync(filePath)) return;
  const stamp = new Date().toISOString().replace(/[-:.]/g, '');
  fs.copyFileSync(filePath, `${filePath}.keymemory-${stamp}.bak`);
}

function writeTextFile(filePath, content) {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return false;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  backupExisting(filePath);
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

function upsertManagedInstructions(before, rules) {
  const start = '<!-- KEYMEMORY:START -->';
  const end = '<!-- KEYMEMORY:END -->';
  const block = `${start}\n${rules.trim()}\n${end}`;
  const pattern = /<!-- KEYMEMORY:START -->[\s\S]*?<!-- KEYMEMORY:END -->/;
  if (pattern.test(before)) return `${before.replace(pattern, block).trimEnd()}\n`;
  return `${before.trimEnd()}${before.trim() ? '\n\n' : ''}${block}\n`;
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
  if (flagAll || flagYes) return true;
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

async function configureGuidedMcpAgent(label, instructionDir, settingsPath, configPath) {
  console.log(`\nConfiguring ${label}...`);
  console.log('-'.repeat(40));
  const config = readJsonConfig(configPath);
  const beforeJson = JSON.stringify(config, null, 2);
  mergeMcpServer(config);
  const afterJson = JSON.stringify(config, null, 2);
  previewChange(configPath, beforeJson, afterJson);

  const instructionsPath = path.join(instructionDir, 'KEYMEMORY_INSTRUCTIONS.md');
  previewChange(instructionsPath, fs.existsSync(instructionsPath) ? fs.readFileSync(instructionsPath, 'utf8') : '(empty)', MEMORY_OPERATING_RULES);
  if (!(await confirmWrite(`${label} KeyMemory configuration and instructions`))) return;
  writeJsonConfig(configPath, config);
  writeTextFile(instructionsPath, MEMORY_OPERATING_RULES + '\n');
  console.log(`${label} MCP config and memory rules written automatically. Restart the Agent to activate KeyMemory.`);
  console.log(`If this ${label} version ignores ${configPath}, use ${settingsPath} and the printed generic config as a fallback.`);
}

async function configureWorkBuddy() {
  const configPath = [
    homePath('.workbuddy', 'connectors', 'default', 'mcp.json'),
    homePath('.workbuddy', 'mcp.json'),
  ].find(candidate => fs.existsSync(candidate)) ?? homePath('.workbuddy', 'connectors', 'default', 'mcp.json');
  await configureGuidedMcpAgent('WorkBuddy', homePath('.workbuddy'), 'WorkBuddy Settings → MCP → Add MCP Server', configPath);
}

async function configureTrae() {
  const configPath = [
    homePath('.trae', 'mcp.json'),
    appDataPath('Trae', 'User', 'settings.json'),
    appDataPath('Trae CN', 'User', 'settings.json'),
  ].find(candidate => fs.existsSync(candidate)) ?? homePath('.trae', 'mcp.json');
  await configureGuidedMcpAgent('TRAE', homePath('.trae'), 'TRAE Settings → MCP → Add custom server', configPath);
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

  const useCli = mode === 'cli' || mode === 'auto';

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

function skillPathForAgent(agentId) {
  switch (agentId) {
    case 'claude-code': return homePath('.claude', 'skills', 'keymemory', 'SKILL.md');
    case 'hermes': return homePath('.hermes', 'skills', 'keymemory', 'SKILL.md');
    case 'codex': return homePath('.codex', 'skills', 'keymemory', 'SKILL.md');
    case 'openclaw': return homePath('.openclaw', 'skills', 'keymemory', 'SKILL.md');
    case 'opencode': return homePath('.config', 'opencode', 'skills', 'keymemory', 'SKILL.md');
    case 'workbuddy':
    case 'trae':
      return homePath('.agents', 'skills', 'keymemory', 'SKILL.md');
    default:
      return null;
  }
}

function instructionPathForAgent(agentId) {
  switch (agentId) {
    case 'claude-code': return homePath('.claude', 'CLAUDE.md');
    case 'hermes': return homePath('.hermes', 'CLAUDE.md');
    case 'codex': return homePath('.codex', 'instructions.md');
    case 'openclaw': return homePath('.openclaw', 'MEMORY_INSTRUCTIONS.md');
    case 'opencode': return homePath('.opencode', 'KEYMEMORY_INSTRUCTIONS.md');
    case 'workbuddy': return homePath('.workbuddy', 'KEYMEMORY_INSTRUCTIONS.md');
    case 'trae': return homePath('.trae', 'KEYMEMORY_INSTRUCTIONS.md');
    default: return null;
  }
}

async function configureAgent(agent) {
  if (installMode !== 'skill') {
    await agent.configure();
    await runPostInstallSelfCheck(agent);
    return;
  }
  const skillPath = skillPathForAgent(agent.id);
  if (!skillPath) throw new Error(`${agent.label} 不支持规则包连接，请改用自动连接。`);
  if (!await confirmWrite(`${agent.label} KeyMemory Skill`)) return;
  const skillChanged = writeTextFile(skillPath, KEYMEMORY_SKILL);
  const instructionPath = instructionPathForAgent(agent.id);
  if (instructionPath) {
    const before = fs.existsSync(instructionPath) ? fs.readFileSync(instructionPath, 'utf8') : '';
    const instruction = `# KeyMemory 规则包\n\n每次开始任务前读取并遵守 \`${skillPath}\`。如果当前 Agent 支持规则包自动发现，则加载 \`keymemory\`；即使自动发现不可用，也必须遵守该规则包中的读取、写入、查重、纠错和验收要求。`;
    writeTextFile(instructionPath, upsertManagedInstructions(before, instruction));
  }
  console.log(`\n${agent.label} KeyMemory Skill ${skillChanged ? '已写入' : '已是最新'}: ${skillPath}`);
  if (instructionPath) console.log(`持久加载指引: ${instructionPath}`);
  console.log('请重启 Agent，并让它调用 keymemory_connection_status 或执行一次只读搜索来验证连接。');
  await runPostInstallSelfCheck(agent);
}

/**
 * E5：接入后自检。配置写入完成后立即运行真实探针（配置检测 + 读取验证），
 * 不伪造结果：overall=connected 才表示探针真实连通；未通过时逐条展示原因与修复建议。
 * 写入探针默认不执行（避免未经确认写入用户记忆库）。
 */
async function runPostInstallSelfCheck(agent) {
  const { pathToFileURL } = require('node:url');
  try {
    const moduleUrl = pathToFileURL(path.join(projectPath, 'packages', 'server', 'dist', 'core', 'connection-verify.js')).href;
    const { verifyAgentIntegrationAsync } = await import(moduleUrl);
    console.log(`\nSelf-check ${agent.label}: running real probes (config + read)...`);
    const result = await verifyAgentIntegrationAsync(agent.id, { allowWriteProbe: false, timeoutMs: 30000 });
    const stepLine = (label, s) => {
      const state = s.skipped ? 'SKIP ' : s.passed ? 'PASS ' : 'FAIL ';
      const detail = s.detail ? ` — ${s.detail}` : '';
      const fix = !s.passed && !s.skipped && s.failure ? `\n        原因: ${s.failure.reason}\n        修复: ${s.failure.fix}` : '';
      return `  [${state}] ${label}${detail}${fix}`;
    };
    console.log(`Self-check overall: ${result.overall}`);
    console.log(stepLine('配置检测', result.steps.config));
    console.log(stepLine('读取验证', result.steps.read));
    console.log(stepLine('写入验证', result.steps.write));
    if (result.overall === 'connected') {
      console.log('接入自检通过：MCP/CLI 通道已真实连通（写入验证需在真实工作节点完成）。');
    } else {
      console.log('接入自检未完全通过：请按上方 FAIL 项的原因与修复建议处理后，在 Web UI“接入”页重跑三层验证。');
    }
  } catch (err) {
    console.warn(`Self-check unavailable: ${err.message}`);
    console.warn('请先运行 pnpm build，然后在 Web UI“接入”页手动运行三层验证。');
  }
}

function buildFutureAgentPrompt() {
  return `# 请把当前 Agent 接入 KeyMemory

请把 KeyMemory 设置为默认、唯一的长期记忆，并自行完成权限允许的配置。修改前备份原文件，保留已有连接、权限和用户规则，不要让用户手工复制你能够安全写入的内容。

1. 可使用工具连接时，添加名为 keymemory 的本地服务，启动文件为 ${mcpLauncherPath}。
2. 如果不能使用工具连接但可以执行命令，使用 keymemory 命令。
3. 如果当前 Agent 支持规则包，也可以安装 KeyMemory Skill；规则包负责教你何时读取和写入，但实际数据仍通过 KeyMemory 工具、命令或本机服务传输。
4. 把下面规则加入长期指令，不得覆盖无关内容。

${MEMORY_OPERATING_RULES}

## 接入验收

- 工具连接：必须看到 keymemory_connection_status、keymemory_search、keymemory_read、keymemory_create 和 keymemory_update；调用 keymemory_connection_status 后必须返回 status: connected，再完成一次只读搜索。
- 命令连接：运行 keymemory info，再完成一次只读搜索或上下文读取。
- 不要为了测试制造垃圾记忆。在第一个真实工作节点写入任务状态并重新搜索到它，才算写入验证通过。
- 最后报告连接方式、修改文件、备份位置、是否要重启，以及“配置检测 / 读取验证 / 写入验证”三项结果。任何一项未通过都不能宣称接入成功。`;
}

async function main() {
  console.log('KeyMemory default memory installer');
  console.log('='.repeat(40));

  if (flagPrompt) {
    console.log('\n' + buildFutureAgentPrompt());
    rl.close();
    return;
  }

  if (installMode !== 'cli' && installMode !== 'mcp' && installMode !== 'skill' && installMode !== 'auto') {
    console.error(`\nError: Invalid mode "${installMode}". Must be one of: cli, mcp, skill, auto`);
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
    await configureAgent(agent);
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
      await configureAgent(agent);
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
    await configureAgent(installed[selected - 1]);
  } else if (selected === installed.length + 1) {
    printGenericConfig();
  } else if (selected === installed.length + 2) {
    for (const agent of installed) {
      await configureAgent(agent);
    }
    printGenericConfig();
    console.log('\nAll detected agents processed. Complete any guided MCP steps shown above.');
  } else {
    console.log('Exit.');
  }

  rl.close();
}

main();
