#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

console.log('🔧 KeyMemory Hermes 配置生成器');
console.log('============================');

const projectPath = process.cwd();
const modelDir = path.join(projectPath, 'packages', 'server', 'models');
const modelFile = path.join(modelDir, 'all-MiniLM-L6-v2.onnx');
const tokenizerFile = path.join(modelDir, 'tokenizer.json');

const modelReady = fs.existsSync(modelFile) && fs.existsSync(tokenizerFile);
if (!modelReady) {
  console.log('\n📥 检测到嵌入模型未内置，正在下载...');
  try {
    execSync('node ' + path.join(projectPath, 'scripts', 'download-model.js'), {
      cwd: projectPath,
      stdio: 'inherit',
    });
  } catch (e) {
    console.log('\n⚠️  模型下载失败，程序将在首次启动时自动下载。');
    console.log('   你也可以稍后手动运行: pnpm download-model');
  }
} else {
  console.log('\n✅ 嵌入模型已内置');
}

const configPath = path.join(os.homedir(), 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
const mcpLauncherPath = path.join(projectPath, 'bin', 'keymemory-mcp.js');
const mcpServerPath = path.join(projectPath, 'packages', 'server', 'dist', 'mcp-server.js');

console.log(`\n📂 项目路径: ${projectPath}`);
console.log(`📂 MCP 启动器: ${mcpLauncherPath}`);
console.log(`📂 MCP 服务: ${mcpServerPath}`);
console.log(`📂 目标配置: ${configPath}`);

if (!fs.existsSync(mcpLauncherPath)) {
  console.log('\n❌ 错误：找不到 keymemory-mcp.js');
  process.exit(1);
}

if (!fs.existsSync(mcpServerPath)) {
  console.log('\n⚠️  找不到 mcp-server.js。配置仍会写入启动器，但请运行: pnpm build');
}

let config = {};
if (fs.existsSync(configPath)) {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('\n✅ 已读取现有配置');
  } catch (e) {
    console.log('\n⚠️ 现有配置文件损坏，将创建新配置');
  }
}

if (!config.mcpServers) {
  config.mcpServers = {};
}

config.mcpServers.keymemory = {
  command: 'node',
  args: [mcpLauncherPath],
};

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
console.log('2. 如需 Web UI，运行 keymemory dashboard');
console.log('3. 如需排查，运行 keymemory doctor');
console.log('4. 对 Hermes 说："帮我记住..."');
console.log('\n💡 详细使用说明请查看 HERMES_QUICKSTART.md');
