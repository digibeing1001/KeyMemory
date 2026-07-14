import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');

function run(command) {
  console.log(`\n[release-check] ${command}`);
  execSync(command, { cwd: root, stdio: 'inherit' });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.join(root, filePath), 'utf8'));
}

function assertFile(filePath, pattern, reason) {
  const absolute = path.join(root, filePath);
  if (!fs.existsSync(absolute)) throw new Error(`missing ${filePath}`);
  const content = fs.readFileSync(absolute, 'utf8');
  if (pattern && !pattern.test(content)) {
    throw new Error(`${filePath} missing ${reason}`);
  }
}

function auditManifest() {
  const pkg = readJson('package.json');
  const scripts = pkg.scripts ?? {};
  for (const scriptName of ['typecheck', 'build', 'eval:memory', 'perf:memory', 'smoke', 'smoke:mcp', 'smoke:agent-connect', 'smoke:loop', 'smoke:launchers', 'release:check']) {
    if (!scripts[scriptName]) throw new Error(`package.json missing script: ${scriptName}`);
  }
}

function auditReleaseArtifacts() {
  assertFile('scripts/smoke-keymemory.mjs', /migrate-auto/, 'one-click migration smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /onboard[\s\S]*onboarding preview[\s\S]*onboarding apply[\s\S]*onboardBackup[\s\S]*onboardAgentConfigs/, 'first-run onboarding smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /agent-export\.jsonl[\s\S]*JSONL imported memory[\s\S]*jsonlSearchResults/, 'JSONL migration smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /--dry-run[\s\S]*dryRunPersisted/, 'migration dry-run smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /source-path migration[\s\S]*Agent Writer Dashboard\/Frontend[\s\S]*sourcePathProjectRouted[\s\S]*discoveredDefaultProjectRouted/, 'migration source-path project routing smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /workspaceHermesDir[\s\S]*workspaceOpenClawDir[\s\S]*expectedHermesProject[\s\S]*expectedOpenClawProject/, 'Hermes and OpenClaw one-click migration discovery coverage');
  assertFile('scripts/smoke-keymemory.mjs', /项目路径:[\s\S]*Natural Routing/, 'natural-language project routing smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /contextPack/, 'agent context pack smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /sensitivity:redacted/, 'privacy redaction smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /secret-set[\s\S]*secret-get[\s\S]*tool_secrets/, 'tool credential secret storage smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /backup-create[\s\S]*backup-restore[\s\S]*--dry-run[\s\S]*--replace/, 'backup, dry-run restore, and replace restore smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /relate[\s\S]*supersedes[\s\S]*dreamRelationMerged[\s\S]*backupMemoryRelations/, 'memory relation and dream supersedes smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /relationContext[\s\S]*Relations:[\s\S]*older guidance should be marked superseded/, 'relation-aware context pack smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /default search to suppress superseded target[\s\S]*--include-superseded/, 'search superseded suppression smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /injectContext[\s\S]*context inject to suppress superseded target[\s\S]*includeSuperseded context inject/, 'legacy context injection superseded suppression smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /assertSafeServerBinding[\s\S]*public host binding to require KEYMEMORY_API_KEY[\s\S]*protected REST route to reject missing API key[\s\S]*HTTP MCP route to accept x-api-key[\s\S]*isCorsOriginAllowed[\s\S]*apiKeyAuthAccepted/, 'local-first server binding, API key auth, and CORS smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /REST migration import to create safety backup before write[\s\S]*restMigrationBackupCreated/, 'REST and Web migration safety backup smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /HTTP MCP backup create[\s\S]*HTTP MCP backup dry-run readiness[\s\S]*httpMcpBackupDryRun/, 'HTTP MCP backup smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /memory_search schema[\s\S]*projectId[\s\S]*memoryKind[\s\S]*HTTP MCP memory_search to honor projectId and memoryKind filters[\s\S]*httpMcpProjectSearchScoped/, 'HTTP MCP project and kind search smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /relation expansion should pull linked context/, 'relation expansion context smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /dream REM phase to create relates_to association[\s\S]*dreamAssociations/, 'dream association relation smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /project-suggestions[\s\S]*project-suggestion-accept[\s\S]*projectSuggestionContextItems/, 'dream project suggestion CLI coverage');
  assertFile('scripts/smoke-keymemory.mjs', /getSchedulerConfig[\s\S]*invalid dream cron to be rejected[\s\S]*schedulerNextRun/, 'dream scheduler validation smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /scheduler[\s\S]*--cron[\s\S]*scheduler CLI to reject invalid dream cron[\s\S]*schedulerCliNextRun/, 'dream scheduler CLI smoke coverage');
  assertFile('scripts/smoke-keymemory.mjs', /bin\/keymemory\.js[\s\S]*context/, 'top-level keymemory CLI passthrough smoke coverage');
  assertFile('scripts/smoke-launchers.mjs', /keymemory\.cmd[\s\S]*path\.join\(root, 'bin', 'keymemory'\)[\s\S]*keymemory-mcp\.js[\s\S]*MCP launcher polluted stdout[\s\S]*mcpLauncherLoggedToStderr/, 'cross-platform launcher smoke coverage');
  assertFile('bin/install.js', /POSIX_LAUNCHERS[\s\S]*keymemory-mcp[\s\S]*keymemory-ui-wsl[\s\S]*chmodSync/, 'POSIX launcher executable setup');
  assertFile('scripts/smoke-keymemory.mjs', /agent-config[\s\S]*claude-code[\s\S]*mcp__keymemory__\*[\s\S]*openClawAgentConfig[\s\S]*agentConfigTargets/, 'agent config generator smoke coverage');
  assertFile('packages/server/src/cli.ts', /command\('onboard'\)[\s\S]*--yes[\s\S]*createBackupFile[\s\S]*buildAgentConfigSnippets/, 'onboarding command safety and agent config flow');
  assertFile('bin/keymemory-doctor.js', /migration dry-run[\s\S]*memory relation[\s\S]*dream scheduler[\s\S]*agent config generator/, 'doctor production capability smoke coverage');
  assertFile('scripts/eval-memory.mjs', /relation-aware context[\s\S]*search suppresses superseded[\s\S]*relation expansion context[\s\S]*natural project routing[\s\S]*temporal knowledge update current view[\s\S]*temporal historical recall[\s\S]*selective forgetting validity filter[\s\S]*retrieval score explanation[\s\S]*abstain missing project/, 'long-term memory eval coverage');
  assertFile('scripts/perf-memory.mjs', /KEYMEMORY_PERF_COUNT[\s\S]*searchP95Ms[\s\S]*runDreamCycle[\s\S]*contextItems/, 'memory performance budget coverage');
  assertFile('scripts/smoke-mcp.mjs', /keymemory_secret_set[\s\S]*keymemory_secret_get[\s\S]*memory_context_pack[\s\S]*memory_relate[\s\S]*memory_related[\s\S]*memory_supersede[\s\S]*memory_migration_import[\s\S]*memory_backup_create[\s\S]*memory_backup_restore_dry_run[\s\S]*memory_project_suggestions[\s\S]*includeSuperseded[\s\S]*backupDryRun[\s\S]*projectSuggestionsListed/, 'MCP context, temporal supersession, migration, backup, secret, and project suggestion smoke coverage');
  assertFile('scripts/smoke-mcp.mjs', /memory_supersede[\s\S]*scoreBreakdown[\s\S]*asOf/, 'MCP explainable current and historical retrieval coverage');
  assertFile('scripts/smoke-loop-harness.mjs', /memory_loop_start[\s\S]*IDEMPOTENCY_CONFLICT[\s\S]*VERSION_CONFLICT[\s\S]*LEASE_CONFLICT[\s\S]*memory_loop_finish[\s\S]*RUN_TERMINAL/, 'durable Loop harness contract coverage');
  assertFile('packages/server/src/core/loop-harness.ts', /keymemory\.loop-observation\.v1[\s\S]*loop_checkpoints[\s\S]*VERSION_CONFLICT[\s\S]*redactSensitiveValue/, 'Loop observation, checkpoint, concurrency, and privacy implementation');
  assertFile('packages/server/src/db/sqlite.ts', /journal_mode = WAL[\s\S]*busy_timeout = 5000[\s\S]*loop_runs[\s\S]*loop_checkpoints[\s\S]*loop_events/, 'SQLite Loop concurrency and persistence schema');
  assertFile('packages/server/src/core/backup.ts', /loop_runs[\s\S]*loop_checkpoints[\s\S]*loop_events[\s\S]*tokenize='trigram'/, 'Loop disaster recovery and current FTS tokenizer');
  assertFile('packages/server/src/core/context-pack.ts', /getPendingTodosForContext\(undefined, pack\.projectId\)/, 'project-scoped pending review context');
  assertFile('packages/web/src/components/ProjectSuggestionsView.tsx', /listProjectSuggestions[\s\S]*acceptProjectSuggestion[\s\S]*rejectProjectSuggestion/, 'Web project suggestion review actions');
  assertFile('packages/web/src/App.tsx', /ProjectSuggestionsView[\s\S]*organize/, 'Web project organization route');
  assertFile('packages/web/src/components/Sidebar.tsx', /organize[\s\S]*GitMerge/, 'Web project organization sidebar entry');
  assertFile('packages/server/src/core/agent-discovery.ts', /workbuddy[\s\S]*trae[\s\S]*availableModes[\s\S]*buildKeyMemorySkill[\s\S]*buildUniversalOnboardingPrompt/, 'local Agent discovery, MCP CLI Skill connection, and onboarding prompt');
  assertFile('packages/server/src/core/agent-config.ts', /keymemory_connection_status[\s\S]*工作过程、踩坑与成功经验[\s\S]*用户画像、偏好与使用习惯[\s\S]*用户最近正在做的所有事情[\s\S]*配置检测 \/ 读取验证 \/ 写入验证[\s\S]*buildKeyMemorySkill/, 'Chinese automatic shared-memory operating rules and verification protocol');
  assertFile('packages/server/src/api/rest.ts', /integrations\/discover[\s\S]*discoverAgentIntegrations/, 'Agent integration discovery API');
  assertFile('scripts/smoke-agent-connect.mjs', /preservedExistingConfig[\s\S]*backupCreated[\s\S]*idempotentReplay[\s\S]*invalidJsonProtected[\s\S]*onboardingPromptExplicit[\s\S]*installerBatchMode[\s\S]*skillModeInstalled[\s\S]*undetectedTargetSupported/, 'safe one-click Agent integration smoke coverage');
  assertFile('packages/server/src/api/rest.ts', /integrations\/:agentId\/connect[\s\S]*confirm[\s\S]*mode[\s\S]*connectAgentIntegration/, 'confirmed multi-mode Agent integration API');
  assertFile('packages/web/src/components/IntegrationView.tsx', /serviceNeedsRestart[\s\S]*selectedMode[\s\S]*检测接入状态[\s\S]*配置检测[\s\S]*读取验证[\s\S]*写入验证/, 'working multi-mode Agent integration and verification UI');
  assertFile('packages/web/src/components/UserGuide.tsx', /(?=[\s\S]*欢迎使用 KeyMemory)(?=[\s\S]*自动连接)(?=[\s\S]*命令连接)(?=[\s\S]*规则包连接)(?=[\s\S]*确认真的连接成功)/, 'plain Chinese first-run guide');
  assertFile('packages/web/src/App.tsx', /(?=[\s\S]*keymemory_onboarding_completed_v1)(?=[\s\S]*使用说明)(?=[\s\S]*UserGuide)/, 'first-run onboarding and persistent help entry');
  assertFile('bin/install.js', /keymemory-ui\.js[\s\S]*--open[\s\S]*--onboarding/, 'post-install Web UI launch');
  assertFile('docs/中文使用说明.md', /(?=[\s\S]*第一次安装)(?=[\s\S]*自动连接)(?=[\s\S]*怎样判断是否真的连接成功)(?=[\s\S]*工作过程)(?=[\s\S]*用户偏好)(?=[\s\S]*最近正在做的事情)/, 'plain Chinese user manual');
  assertFile('docs/agent-context-pack.md', /context\/inject[\s\S]*memory_context_pack[\s\S]*superseded[\s\S]*relates_to[\s\S]*memoryKind/, 'agent context pack docs');
  assertFile('docs/loop-harness.md', /memory_loop_start[\s\S]*memory_loop_context[\s\S]*VERSION_CONFLICT[\s\S]*memory_loop_finish/, 'Loop harness integration docs');
  assertFile('docs/memory-relations.md', /memory_relations[\s\S]*supersedes[\s\S]*memory_relate/, 'memory relation docs');
  assertFile('docs/temporal-memory.md', /LongMemEval[\s\S]*MemoryAgentBench[\s\S]*validFrom[\s\S]*memory_supersede[\s\S]*asOf[\s\S]*scoreBreakdown/, 'research-backed temporal memory and explainable retrieval docs');
  assertFile('docs/project-organization.md', /project-suggestions[\s\S]*project-suggestion-accept[\s\S]*Web UI[\s\S]*memory_project_suggestions/, 'project organization suggestion docs');
  assertFile('docs/memory-eval.md', /LongMemEval[\s\S]*pnpm eval:memory/, 'memory eval docs');
  assertFile('docs/performance.md', /pnpm perf:memory[\s\S]*search p95[\s\S]*dream cycle/, 'performance budget docs');
  assertFile('docs/privacy-and-safety.md', /Default Redaction[\s\S]*Tool Credential Storage[\s\S]*privacyRedactedCount/, 'privacy and safety docs');
  assertFile('docs/privacy-and-safety.md', /Local-First Server Safety[\s\S]*KEYMEMORY_API_KEY[\s\S]*Authorization: Bearer[\s\S]*KEYMEMORY_ALLOWED_ORIGINS/, 'local-first server safety docs');
  assertFile('docs/backup-and-recovery.md', /backup-create[\s\S]*backup-restore .*--dry-run[\s\S]*backup-restore .*--replace[\s\S]*memory_backup_create[\s\S]*memory_backup_restore_dry_run/, 'backup and recovery docs');
  assertFile('docs/backup-and-recovery.md', /Migration Safety[\s\S]*createBackupBeforeImport[\s\S]*Web UI/, 'REST and Web migration backup docs');
  assertFile('docs/backup-and-recovery.md', /memory_relations/, 'memory relation backup docs');
  assertFile('docs/agent-configuration.md', /agent-config all[\s\S]*claude-desktop[\s\S]*mcp__keymemory__\*[\s\S]*openclaw[\s\S]*codex/, 'agent configuration docs');
  assertFile('MIGRATION_GUIDE.md', /migrate-auto --run-dream[\s\S]*Hermes[\s\S]*OpenClaw/, 'one-click migration docs');
  assertFile('MIGRATION_GUIDE.md', /Source-path project routing[\s\S]*Agent Writer Dashboard\/Frontend/, 'source-path project routing docs');
  assertFile('MIGRATION_GUIDE.md', /jsonl[\s\S]*ndjson/, 'JSONL migration docs');
  assertFile('MIGRATION_GUIDE.md', /--dry-run[\s\S]*without writing memories/, 'migration dry-run docs');
  assertFile('README.md', /memory_migration_discover[\s\S]*memory_backup_create[\s\S]*memory_relate[\s\S]*memory_supersede/, 'MCP migration, backup, relation, and temporal supersession tool docs');
  assertFile('README.md', /keymemory onboard[\s\S]*--yes[\s\S]*--run-dream/, 'first-run onboarding docs');
  assertFile('docs/product-release-audit.md', /Agent memory substrate[\s\S]*One-click migration[\s\S]*Production safety[\s\S]*pnpm release:check/, 'product release audit coverage');
  assertFile('.github/workflows/ci.yml', /windows-latest[\s\S]*ubuntu-latest[\s\S]*macos-latest/, 'cross-platform CI matrix');
}

auditManifest();
auditReleaseArtifacts();

run('pnpm typecheck');
run('pnpm build');
run('pnpm smoke:agent-connect');
run('node bin/keymemory-doctor.js');
run('pnpm eval:memory');
run('pnpm perf:memory');
run('pnpm smoke');
run('pnpm smoke:mcp');
run('pnpm smoke:loop');
run('pnpm smoke:launchers');

console.log('\n[release-check] ok');
