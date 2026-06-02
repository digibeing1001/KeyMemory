#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');

const projectPath = process.cwd();
const mcpLauncherPath = path.join(projectPath, 'bin', 'keymemory-mcp.js');
const mcpServerPath = path.join(projectPath, 'packages', 'server', 'dist', 'mcp-server.js');

const CLAUDE_MD_CONTENT = `# KeyMemory - Default Memory System

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
`;

const args = process.argv.slice(2);
const flagAll = args.includes('--all');
const flagAgent = args.find(a => a.startsWith('--agent='));
const specificAgent = flagAgent ? flagAgent.split('=')[1] : null;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function getMcpServerConfig() {
  return {
    command: 'node',
    args: [mcpLauncherPath],
  };
}

function detectHermes() {
  const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  const appDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude');
  return fs.existsSync(appDir) || fs.existsSync(configPath);
}

function detectOpenClaw() {
  const configPaths = [
    path.join(os.homedir(), '.openclaw', 'config.json'),
    path.join(os.homedir(), '.config', 'openclaw', 'config.json'),
  ];
  return configPaths.some(p => fs.existsSync(p));
}

function getOpenClawConfigPath() {
  const candidates = [
    path.join(os.homedir(), '.openclaw', 'config.json'),
    path.join(os.homedir(), '.config', 'openclaw', 'config.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(os.homedir(), '.openclaw', 'config.json');
}

async function configureHermes() {
  console.log('\n🤖 配置 Hermes (Claude Desktop)...');
  console.log('─'.repeat(40));

  const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('✅ 已读取现有配置');
    } catch (e) {
      console.log('⚠️ 现有配置文件损坏，将创建新配置');
    }
  }

  const beforeJson = JSON.stringify(config, null, 2);

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  const existingKeymemory = config.mcpServers.keymemory;
  config.mcpServers.keymemory = getMcpServerConfig();

  const afterJson = JSON.stringify(config, null, 2);

  console.log('\n📋 配置变更预览：');
  console.log('--- Before ---');
  console.log(beforeJson.length > 200 ? beforeJson.slice(0, 200) + '\n  ...' : beforeJson);
  console.log('--- After ---');
  console.log(afterJson.length > 200 ? afterJson.slice(0, 200) + '\n  ...' : afterJson);

  if (!flagAll) {
    const confirm = await question('\n确认写入 Hermes 配置？(y/N) ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('⏭️ 跳过 Hermes 配置');
      return;
    }
  }

  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, afterJson, 'utf8');
  console.log('✅ Hermes MCP 配置已写入');

  const claudeMdPath = path.join(os.homedir(), 'CLAUDE.md');
  let existingClaudeMd = '';
  if (fs.existsSync(claudeMdPath)) {
    existingClaudeMd = fs.readFileSync(claudeMdPath, 'utf8');
    if (existingClaudeMd.includes('KeyMemory - Default Memory System')) {
      console.log('✅ CLAUDE.md 已包含 KeyMemory 指令，跳过');
      return;
    }
  }

  const keymemorySection = '\n\n' + CLAUDE_MD_CONTENT;
  const newClaudeMd = existingClaudeMd + keymemorySection;

  console.log('\n📋 CLAUDE.md 变更预览：');
  console.log('--- 新增内容 ---');
  console.log(keymemorySection.trim());

  if (!flagAll) {
    const confirmMd = await question('\n确认写入 CLAUDE.md？(y/N) ');
    if (confirmMd.toLowerCase() !== 'y') {
      console.log('⏭️ 跳过 CLAUDE.md 写入');
      return;
    }
  }

  fs.writeFileSync(claudeMdPath, newClaudeMd, 'utf8');
  console.log('✅ CLAUDE.md 已更新');
}

async function configureOpenClaw() {
  console.log('\n🦞 配置 OpenClaw...');
  console.log('─'.repeat(40));

  const configPath = getOpenClawConfigPath();
  let config = {};

  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('✅ 已读取现有 OpenClaw 配置');
    } catch (e) {
      console.log('⚠️ 现有配置文件损坏，将创建新配置');
    }
  }

  const beforeJson = JSON.stringify(config, null, 2);

  if (!config.mcpServers) {
    config.mcpServers = {};
  }

  config.mcpServers.keymemory = getMcpServerConfig();

  if (!config.memory) {
    config.memory = {};
  }
  config.memory.provider = 'keymemory';
  config.memory.primary = true;
  config.memory.defaultTool = 'keymemory';

  const afterJson = JSON.stringify(config, null, 2);

  console.log('\n📋 配置变更预览：');
  console.log('--- Before ---');
  console.log(beforeJson.length > 200 ? beforeJson.slice(0, 200) + '\n  ...' : beforeJson);
  console.log('--- After ---');
  console.log(afterJson.length > 200 ? afterJson.slice(0, 200) + '\n  ...' : afterJson);

  if (!flagAll) {
    const confirm = await question('\n确认写入 OpenClaw 配置？(y/N) ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('⏭️ 跳过 OpenClaw 配置');
      return;
    }
  }

  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, afterJson, 'utf8');
  console.log('✅ OpenClaw MCP 配置已写入');

  const openclawMdPath = path.join(os.homedir(), '.openclaw', 'MEMORY_INSTRUCTIONS.md');
  const openclawMdContent = `# KeyMemory - OpenClaw Memory Instructions

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
`;

  const openclawDir = path.dirname(openclawMdPath);
  if (!fs.existsSync(openclawDir)) {
    fs.mkdirSync(openclawDir, { recursive: true });
  }

  fs.writeFileSync(openclawMdPath, openclawMdContent, 'utf8');
  console.log('✅ OpenClaw 记忆指令已写入');
}

function printGenericConfig() {
  console.log('\n📋 通用 MCP 配置（可粘贴到任何 MCP 兼容 Agent 的配置文件中）：');
  console.log('─'.repeat(40));
  const genericConfig = {
    mcpServers: {
      keymemory: getMcpServerConfig(),
    },
  };
  console.log(JSON.stringify(genericConfig, null, 2));
}

async function main() {
  console.log('🧠 KeyMemory 默认记忆系统安装器');
  console.log('='.repeat(40));

  if (!fs.existsSync(mcpLauncherPath)) {
    console.log('\n❌ 错误：找不到 MCP 启动器');
    process.exit(1);
  }

  if (!fs.existsSync(mcpServerPath)) {
    console.log('\n⚠️  找不到 MCP 构建产物。配置仍会写入启动器，但请运行: pnpm build');
  }

  console.log(`\n📂 项目路径: ${projectPath}`);
  console.log(`📂 MCP 启动器: ${mcpLauncherPath}`);
  console.log(`📂 MCP 服务: ${mcpServerPath}`);

  const detected = [];

  const hermesInstalled = detectHermes();
  const openclawInstalled = detectOpenClaw();

  console.log('\n🔍 检测已安装的 Agent：');
  console.log(`   Hermes (Claude Desktop): ${hermesInstalled ? '✅ 已安装' : '❌ 未检测到'}`);
  console.log(`   OpenClaw:                ${openclawInstalled ? '✅ 已安装' : '❌ 未检测到'}`);

  if (hermesInstalled) detected.push('hermes');
  if (openclawInstalled) detected.push('openclaw');

  if (detected.length === 0) {
    console.log('\n⚠️ 未检测到任何已安装的 Agent');
    printGenericConfig();
    rl.close();
    return;
  }

  if (specificAgent) {
    if (specificAgent === 'hermes' && hermesInstalled) {
      await configureHermes();
    } else if (specificAgent === 'openclaw' && openclawInstalled) {
      await configureOpenClaw();
    } else {
      console.log(`\n❌ 未检测到 Agent: ${specificAgent}`);
    }
    printGenericConfig();
    rl.close();
    return;
  }

  if (flagAll) {
    if (hermesInstalled) await configureHermes();
    if (openclawInstalled) await configureOpenClaw();
    printGenericConfig();
    console.log('\n🎉 所有检测到的 Agent 已配置完成！');
    rl.close();
    return;
  }

  console.log('\n请选择要配置的 Agent：');
  if (hermesInstalled) console.log('  1. Hermes (Claude Desktop)');
  if (openclawInstalled) console.log('  2. OpenClaw');
  console.log('  3. 显示通用 MCP 配置');
  console.log('  4. 全部配置');
  console.log('  0. 退出');

  const choice = await question('\n请输入选项 (0-4): ');

  switch (choice.trim()) {
    case '1':
      if (hermesInstalled) await configureHermes();
      break;
    case '2':
      if (openclawInstalled) await configureOpenClaw();
      break;
    case '3':
      printGenericConfig();
      break;
    case '4':
      if (hermesInstalled) await configureHermes();
      if (openclawInstalled) await configureOpenClaw();
      printGenericConfig();
      console.log('\n🎉 所有检测到的 Agent 已配置完成！');
      break;
    default:
      console.log('👋 退出');
      break;
  }

  rl.close();
}

main();
