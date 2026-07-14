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
assert.match(workBuddyRules, /Required recall workflow/);
assert.match(workBuddyRules, /Task \/ Objective \/ Status \/ Completed/);

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
assert.match(codexRules, /User profile/);
assert.match(codexRules, /Experience/);

const prompt = buildUniversalOnboardingPrompt(root);
for (const required of [
  'keymemory_context_pack',
  'keymemory_create',
  'keymemory_update',
  'keymemory_supersede',
  'Preserve every existing MCP server',
  'Task / Objective / Status / Completed / Deliverables / Todo / Blockers / Next / Acceptance',
  'First-use acceptance check',
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
}, null, 2));
