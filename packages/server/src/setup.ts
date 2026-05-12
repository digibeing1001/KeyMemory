#!/usr/bin/env node
/**
 * KeyMemory MCP 安装器
 * 自动配置 Claude Desktop
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔧 KeyMemory MCP 安装器');
console.log('=======================');

const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const mcpServerPath = path.join(__dirname, 'mcp-server.js');

console.log(`\n📦 版本: ${packageJson.version}`);
console.log(`📂 MCP 服务: ${mcpServerPath}`);
console.log(`📂 目标配置: ${configPath}`);

// 读取现有配置
let config: { mcpServers?: Record<string, unknown> } = { mcpServers: {} };
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('\n✅ 已读取现有配置');
  } catch (e) {
    console.log('\n⚠️ 现有配置文件损坏，将创建新配置');
  }
}

// 确保 mcpServers 存在
if (!config.mcpServers) {
  config.mcpServers = {};
}

// 添加 KeyMemory 配置
config.mcpServers.keymemory = {
  command: process.execPath,
  args: [mcpServerPath]
};

// 保存配置
const configDir = path.dirname(configPath);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

console.log('\n✅ 安装成功！');
console.log('\n🚀 下一步：');
console.log('1. 重启 Claude Desktop');
console.log('2. 开始使用 KeyMemory！');
console.log('\n📖 使用示例：');
console.log('   - "帮我记住：今天学习了 TypeScript"');
console.log('   - "搜索关于 TypeScript 的记忆"');
console.log('   - "列出所有记忆"');
console.log('\n💡 管理记忆请访问 Web 界面（可选）：');
console.log('   - 运行 pnpm dev:web');
