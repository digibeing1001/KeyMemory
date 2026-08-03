import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-agent-connect-'));
const homeDir = path.join(sandbox, 'home');
const appDataDir = path.join(sandbox, 'appdata');
const localAppDataDir = path.join(sandbox, 'localappdata');
fs.mkdirSync(homeDir, { recursive: true });

const { connectAgentIntegration } = await import('../packages/server/dist/core/agent-discovery.js');
const { buildUniversalOnboardingPrompt } = await import('../packages/server/dist/core/agent-config.js');
const options = { projectRoot: root, homeDir, appDataDir, localAppDataDir };

const workBuddyConfig = path.join(homeDir, '.workbuddy', 'connectors', 'default', 'mcp.json');
fs.mkdirSync(path.dirname(workBuddyConfig), { recursive: true });
fs.writeFileSync(workBuddyConfig, JSON.stringify({
  theme: 'existing-user-setting',
  mcpServers: { existing: { command: 'existing-agent' } },
}, null, 2) + '\n');

const connected = connectAgentIntegration('workbuddy', options);
assert.equal(connected.success, true);
assert.equal(connected.changed, true);
assert.equal(connected.mode, 'mcp');
assert.equal(connected.backups.length, 1);
assert.ok(fs.existsSync(connected.backups[0]), 'existing config must be backed up before merge');
const merged = JSON.parse(fs.readFileSync(workBuddyConfig, 'utf8'));
assert.equal(merged.theme, 'existing-user-setting', 'unrelated settings must be preserved');
assert.equal(merged.mcpServers.existing.command, 'existing-agent', 'existing MCP servers must be preserved');
assert.equal(merged.mcpServers.keymemory.command, 'node');
assert.match(merged.mcpServers.keymemory.args[0], /keymemory-mcp\.js$/);
const workBuddyRules = fs.readFileSync(path.join(homeDir, '.workbuddy', 'KEYMEMORY_INSTRUCTIONS.md'), 'utf8');
assert.match(workBuddyRules, /KEYMEMORY:START/);
assert.match(workBuddyRules, /每次工作前必须先读取/);
assert.match(workBuddyRules, /用户最近正在做的所有事情/);

const replay = connectAgentIntegration('workbuddy', options);
assert.equal(replay.changed, false, 'reapplying the same integration must be idempotent');
assert.equal(replay.backups.length, 0, 'idempotent replay must not create backup churn');

const invalidTraeConfig = path.join(homeDir, '.trae', 'mcp.json');
fs.mkdirSync(path.dirname(invalidTraeConfig), { recursive: true });
fs.writeFileSync(invalidTraeConfig, '{ invalid json', 'utf8');
assert.throws(
  () => connectAgentIntegration('trae', options),
  /not valid JSON.*left unchanged/,
  'invalid host configs must never be overwritten',
);
assert.equal(fs.readFileSync(invalidTraeConfig, 'utf8'), '{ invalid json');

const codex = connectAgentIntegration('codex', options);
assert.equal(codex.mode, 'cli');
assert.equal(codex.restartRequired, false);
const codexRules = fs.readFileSync(path.join(homeDir, '.codex', 'instructions.md'), 'utf8');
assert.match(codexRules, /keymemory context/);
assert.match(codexRules, /用户画像/);
assert.match(codexRules, /踩坑与成功经验/);

const skill = connectAgentIntegration('opencode', { ...options, mode: 'skill' });
assert.equal(skill.mode, 'skill');
assert.equal(skill.restartRequired, true);
const skillPath = path.join(homeDir, '.config', 'opencode', 'skills', 'keymemory', 'SKILL.md');
assert.ok(fs.existsSync(skillPath), 'Skill mode must install SKILL.md even when the Agent was not detected');
assert.match(fs.readFileSync(skillPath, 'utf8'), /最近正在做的所有事情/);
assert.match(fs.readFileSync(skillPath, 'utf8'), /keymemory_connection_status/);

const prompt = buildUniversalOnboardingPrompt(root);
for (const required of [
  '# 请把当前 Agent 接入 KeyMemory',
  '工作过程、踩坑与成功经验',
  '用户画像、偏好与使用习惯',
  '用户最近正在做的所有事情',
  '配置检测 / 读取验证 / 写入验证',
  'keymemory_connection_status',
  'keymemory_context_pack',
  'keymemory_create',
  'keymemory_update',
  'keymemory_supersede',
]) {
  assert.ok(prompt.includes(required), `onboarding prompt must include: ${required}`);
}

const installerHome = path.join(sandbox, 'installer-home');
const installerConfig = path.join(installerHome, '.workbuddy', 'connectors', 'default', 'mcp.json');
fs.mkdirSync(path.dirname(installerConfig), { recursive: true });
fs.writeFileSync(installerConfig, JSON.stringify({ mcpServers: { existing: { command: 'keep-me' } } }, null, 2) + '\n');
const installer = spawnSync(process.execPath, [
  path.join(root, 'install-default-memory.js'),
  '--agent=workbuddy',
  '--mode=mcp',
  '--yes',
], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    HOME: installerHome,
    USERPROFILE: installerHome,
    APPDATA: path.join(installerHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(installerHome, 'AppData', 'Local'),
  },
});
assert.equal(installer.status, 0, `batch installer failed: ${installer.stderr || installer.stdout}`);
const installerMerged = JSON.parse(fs.readFileSync(installerConfig, 'utf8'));
assert.equal(installerMerged.mcpServers.existing.command, 'keep-me');
assert.equal(installerMerged.mcpServers.keymemory.command, 'node');
assert.ok(fs.existsSync(path.join(installerHome, '.workbuddy', 'KEYMEMORY_INSTRUCTIONS.md')));

const installerSkillHome = path.join(sandbox, 'installer-skill-home');
const skillInstaller = spawnSync(process.execPath, [
  path.join(root, 'install-default-memory.js'),
  '--agent=opencode',
  '--mode=skill',
  '--yes',
], {
  cwd: root,
  encoding: 'utf8',
  env: {
    ...process.env,
    HOME: installerSkillHome,
    USERPROFILE: installerSkillHome,
    APPDATA: path.join(installerSkillHome, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(installerSkillHome, 'AppData', 'Local'),
  },
});
assert.equal(skillInstaller.status, 0, `Skill installer failed: ${skillInstaller.stderr || skillInstaller.stdout}`);
assert.ok(fs.existsSync(path.join(installerSkillHome, '.config', 'opencode', 'skills', 'keymemory', 'SKILL.md')));
const installerSkillInstructions = fs.readFileSync(path.join(installerSkillHome, '.opencode', 'KEYMEMORY_INSTRUCTIONS.md'), 'utf8');
assert.match(installerSkillInstructions, /KEYMEMORY:START/);
assert.match(installerSkillInstructions, /每次开始任务前读取并遵守/);

/* 真实 MCP stdio 握手探针：接入配置写出的启动命令必须能真正连通 KeyMemory */
const { runMcpProbe } = await import('../packages/server/dist/core/connection-verify.js');
const probeEnv = { KEYMEMORY_DATA_DIR: path.join(sandbox, 'probe-data'), KEYMEMORY_DB_PATH: path.join(sandbox, 'probe-data', 'data.db') };
const probe = await runMcpProbe({
  transport: 'mcp',
  command: process.execPath,
  args: [path.join(root, 'bin', 'keymemory-mcp.js')],
  env: probeEnv,
}, 90000, false);
assert.equal(probe.read.passed, true, `MCP handshake probe failed: ${JSON.stringify(probe.read.failure)}`);
assert.ok(probe.read.evidence.some(item => item.includes('status: connected')), 'handshake probe must surface the real connection receipt');
assert.equal(probe.write.skipped, true, 'smoke must not run the write probe unless explicitly allowed');

console.log(JSON.stringify({
  ok: true,
  sandbox,
  preservedExistingConfig: true,
  backupCreated: true,
  idempotentReplay: true,
  invalidJsonProtected: true,
  cliInstructionsWritten: true,
  onboardingPromptExplicit: true,
  installerBatchMode: true,
  skillModeInstalled: true,
  undetectedTargetSupported: true,
  mcpHandshakeProbe: true,
}, null, 2));
