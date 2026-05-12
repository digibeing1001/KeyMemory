#!/usr/bin/env node
/**
 * KeyMemory Hermes 配置生成器
 * 自动生成 Claude Desktop 配置
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('🔧 KeyMemory Hermes 配置生成器');
console.log('============================');

// 获取配置路径
const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
const projectPath = process.cwd();
const mcpServerPath = path.join(projectPath, 'packages', 'server', 'mcp-server.js');

console.log(`\n📂 项目路径: ${projectPath}`);
console.log(`📂 MCP 服务: ${mcpServerPath}`);
console.log(`📂 目标配置: ${configPath}`);

// 检查 MCP 服务文件
if (!fs.existsSync(mcpServerPath)) {
  console.log('\n❌ 错误：找不到 mcp-server.js');
  console.log('   请先运行: pnpm build');
  process.exit(1);
}

// 读取现有配置或创建新的
let config = {};
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

// 添加或更新 KeyMemory 配置
config.mcpServers.keymemory = {
  command: 'node',
  args: ['packages/server/mcp-server.js'],
  cwd: projectPath.replace(/\\/g, '\\\\')
};

// 保存配置
const configDir = path.dirname(configPath);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

console.log('\n✅ 配置已成功生成！');
console.log('\n📋 配置内容：');
console.log(JSON.stringify(config, null, 2));

console.log('\n🚀 下一步：');
console.log('1. 重启 Claude Desktop');
console.log('2. 运行 start-hermes.bat 启动服务');
console.log('3. 对 Hermes 说："帮我记住..."');
console.log('\n💡 详细使用说明请查看 HERMES_QUICKSTART.md');
