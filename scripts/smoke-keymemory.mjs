import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';

const root = path.resolve(import.meta.dirname, '..');
const serverRequire = createRequire(path.join(root, 'packages/server/package.json'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-smoke-'));
const sampleFile = path.join(dataDir, 'sample-memory.md');
const dryRunFile = path.join(dataDir, 'dry-run-memory.md');
const restBackupMigrationFile = path.join(dataDir, 'rest-backup-migration.md');
const legacyDir = path.join(dataDir, 'legacy-memory');
const sourceRoutingDir = path.join(dataDir, 'source-routing');
const sourceRoutingNestedDir = path.join(sourceRoutingDir, 'Agent Writer Dashboard', 'Frontend');
const onboardDir = path.join(dataDir, 'onboard-workspace');
const jsonlFile = path.join(legacyDir, 'agent-export.jsonl');
const cursorRulesDir = path.join(dataDir, '.cursor', 'rules');
const workspaceClaudeDir = path.join(dataDir, '.claude');
const workspaceHermesDir = path.join(dataDir, '.hermes', 'memories');
const workspaceOpenClawDir = path.join(dataDir, '.openclaw', 'memories');
const onboardCursorRulesDir = path.join(onboardDir, '.cursor', 'rules');

fs.mkdirSync(legacyDir, { recursive: true });
fs.mkdirSync(sourceRoutingNestedDir, { recursive: true });
fs.mkdirSync(cursorRulesDir, { recursive: true });
fs.mkdirSync(workspaceClaudeDir, { recursive: true });
fs.mkdirSync(workspaceHermesDir, { recursive: true });
fs.mkdirSync(workspaceOpenClawDir, { recursive: true });
fs.mkdirSync(onboardCursorRulesDir, { recursive: true });

fs.writeFileSync(sampleFile, [
  '# 用户偏好',
  '用户偏好简洁中文交付，项目 [[KeyMemory/发布/迁移]] 需要一键导入旧记忆。',
  '',
  '---',
  '',
  '# 项目决策',
  '[[KeyMemory/发布/迁移]] 决定把 KeyMemory 做成 Agent 底层记忆产品，必须支持 Windows、Linux、macOS、WSL。',
].join('\n'), 'utf8');

fs.writeFileSync(dryRunFile, [
  '# Dry run sentinel',
  '[[KeyMemory/Migration/DryRun]] dry-run sentinel should not persist into the database.',
].join('\n'), 'utf8');

fs.writeFileSync(restBackupMigrationFile, [
  '# REST migration backup sentinel',
  'Preference: REST migration should create a safety backup before writing [[REST/Migration/Backup]].',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(sourceRoutingNestedDir, 'memory.md'), [
  '# Source path routing',
  'Preference: source-path migration should classify this memory under the Agent Writer Dashboard frontend project without bracket syntax.',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(workspaceClaudeDir, 'memory.md'), [
  '# Claude workspace memory',
  'Preference: discovered workspace memories without project markers should use the discovered source default project.',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(workspaceHermesDir, 'memory.md'), [
  '# Hermes workspace memory',
  'Preference: Hermes workspace memories should be found by one-click migration and routed to the Hermes workspace project.',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(workspaceOpenClawDir, 'memory.md'), [
  '# OpenClaw workspace memory',
  'Preference: OpenClaw workspace memories should be found by one-click migration and routed to the OpenClaw workspace project.',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(legacyDir, 'notes.md'), [
  '# 老记忆',
  '[[Legacy/Product]] 用户以前把长期偏好存在 Markdown 文件。',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(legacyDir, 'memories.json'), JSON.stringify({
  memories: [
    {
      title: 'JSON preference',
      content: 'Preference: imported JSON memory should be normalized into project [[Legacy/JSON]].',
      tags: 'legacy,json',
    },
  ],
}, null, 2), 'utf8');

fs.writeFileSync(jsonlFile, [
  JSON.stringify({
    title: 'JSONL preference',
    content: 'Preference: JSONL imported memory should route to [[Legacy/JSONL]].',
    tags: ['legacy', 'jsonl'],
  }),
  JSON.stringify({
    type: 'event_msg',
    event_msg: 'Decision: JSONL event_msg migration should become KeyMemory memory under [[Legacy/JSONL]].',
  }),
  JSON.stringify({
    payload: {
      title: 'JSONL payload memory',
      content: 'Task: payload jsonl migration should normalize project [[Legacy/JSONL/Payload]].',
    },
  }),
  'not-json-line',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(dataDir, 'AGENTS.md'), [
  '# AGENTS',
  '全局默认：KeyMemory 迁移测试记忆，项目 [[Workspace/Agents]]。',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(cursorRulesDir, 'memory.md'), [
  '# Cursor Rule',
  'Cursor 旧规则迁移到 [[Workspace/Cursor]]。',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(onboardDir, 'AGENTS.md'), [
  '# Onboard AGENTS',
  'Preference: KeyMemory onboard should preview and import old memories into [[Onboard/Workspace]].',
].join('\n'), 'utf8');

fs.writeFileSync(path.join(onboardCursorRulesDir, 'memory.md'), [
  '# Onboard Cursor Rule',
  'Decision: KeyMemory onboard should generate agent config snippets after migration for [[Onboard/Cursor]].',
].join('\n'), 'utf8');

async function run(args) {
  const stdout = execFileSync('node', ['packages/server/dist/cli.js', '--format', 'json', '--data-dir', dataDir, ...args], {
    cwd: root,
    env: { ...process.env, KEYMEMORY_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

async function runWrapper(args) {
  const stdout = execFileSync('node', ['bin/keymemory.js', '--format', 'json', '--data-dir', dataDir, ...args], {
    cwd: root,
    env: { ...process.env, KEYMEMORY_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

await run(['create', '--title', '自动项目树测试', '--content', '[[KeyMemory/Agent Memory/Project Tree]] 自动创建父子项目。', '--layer', 'long']);
await run(['create', '--title', '自然语言归项测试', '--content', '项目路径: KeyMemory/Agent Memory/Natural Routing\nDecision: no bracket syntax should still create nested project folders.', '--layer', 'long']);
const secretMemory = await run([
  'create',
  '--title',
  '安全脱敏测试',
  '--content',
  '[[KeyMemory/Security]] OPENAI_API_KEY=sk-1234567890abcdefghijklmnopqrstuv should never be stored in plain text.',
  '--layer',
  'long',
  '--metadata',
  '{"secret":"github_pat_1234567890abcdefghijklmnopqrstuv"}',
]);
if (JSON.stringify(secretMemory).includes('sk-1234567890abcdefghijklmnopqrstuv')) {
  throw new Error('expected API key to be redacted from stored memory');
}
if (JSON.stringify(secretMemory).includes('github_pat_1234567890abcdefghijklmnopqrstuv')) {
  throw new Error('expected metadata token to be redacted from stored memory');
}
if (!secretMemory.tags?.includes('sensitivity:redacted') || !secretMemory.metadata?.privacy?.redacted) {
  throw new Error(`expected redaction metadata, got ${JSON.stringify(secretMemory)}`);
}
const toolSecretValue = 'cli-tool-secret-1234567890';
const toolSecret = await run(['secret-set', 'hermes', 'api_key', '--value', toolSecretValue, '--metadata', '{"provider":"smoke"}']);
if (toolSecret.value || toolSecret.tool !== 'hermes' || toolSecret.name !== 'api_key') {
  throw new Error(`expected secret-set to return credential metadata without plaintext, got ${JSON.stringify(toolSecret)}`);
}
const toolSecretList = await run(['secret-list', 'hermes']);
if (!Array.isArray(toolSecretList) || toolSecretList.length !== 1 || JSON.stringify(toolSecretList).includes(toolSecretValue)) {
  throw new Error(`expected secret-list to omit plaintext values, got ${JSON.stringify(toolSecretList)}`);
}
const toolSecretRead = await run(['secret-get', 'hermes', 'api_key']);
if (toolSecretRead.value !== toolSecretValue) {
  throw new Error('expected secret-get to decrypt and round-trip the stored credential');
}

const migrated = await run(['migrate', sampleFile, '--source', 'smoke-test', '--run-dream']);
if (migrated.imported !== 2 || migrated.files !== 1) {
  throw new Error(`expected 2 imported memories from one file, got ${JSON.stringify(migrated)}`);
}

const migratedAgain = await run(['migrate', sampleFile, '--source', 'smoke-test']);
if (migratedAgain.skipped !== 2) {
  throw new Error(`expected duplicate migration to skip 2 memories, got ${JSON.stringify(migratedAgain)}`);
}

const dryRunMigration = await run(['migrate', dryRunFile, '--source', 'dry-run-smoke', '--dry-run', '--run-dream']);
if (!dryRunMigration.dryRun || dryRunMigration.imported !== 1 || dryRunMigration.files !== 1 || dryRunMigration.dreamReportId) {
  throw new Error(`expected dry-run migration to preview one memory without dream, got ${JSON.stringify(dryRunMigration)}`);
}
const afterDryRunExport = await run(['export']);
if (JSON.stringify(afterDryRunExport).includes('dry-run sentinel should not persist')) {
  throw new Error(`expected dry-run migration to write no memories, got ${JSON.stringify(afterDryRunExport)}`);
}

const migratedDir = await run(['migrate', legacyDir, '--source', 'legacy-dir', '--default-project-path', 'Legacy/Default']);
if (migratedDir.imported !== 5 || migratedDir.files !== 3) {
  throw new Error(`expected 5 imported memories from directory with JSONL, got ${JSON.stringify(migratedDir)}`);
}

const sourceRouted = await run(['migrate', sourceRoutingDir, '--source', 'source-routing']);
if (
  sourceRouted.imported !== 1 ||
  !sourceRouted.projectPaths.includes('Agent Writer Dashboard/Frontend')
) {
  throw new Error(`expected source path project routing, got ${JSON.stringify(sourceRouted)}`);
}
const sourceRoutedContext = await run(['context', 'source-path migration', '--project', 'Agent Writer Dashboard/Frontend', '--max-items', '3']);
if (!sourceRoutedContext.markdown.includes('without bracket syntax')) {
  throw new Error(`expected source-routed memory in context pack, got ${JSON.stringify(sourceRoutedContext)}`);
}

const jsonlSearch = await run(['search', 'JSONL imported memory', '--limit', '5']);
if (!Array.isArray(jsonlSearch) || jsonlSearch.length === 0) {
  throw new Error('expected JSONL migration search results');
}

const discovered = await run(['migrate-discover', '--no-home', '--root', dataDir]);
if (
  !Array.isArray(discovered) ||
  discovered.length < 4 ||
  !discovered.some(item => item.source === 'hermes') ||
  !discovered.some(item => item.source === 'openclaw')
) {
  throw new Error(`expected workspace migration sources, got ${JSON.stringify(discovered)}`);
}

const autoMigrated = await run(['migrate-auto', '--no-home', '--root', dataDir, '--min-confidence', '0.6']);
const expectedDiscoveredDefaultProject = `Workspaces/${path.basename(dataDir)}/Claude Code`;
const expectedHermesProject = `Workspaces/${path.basename(dataDir)}/Hermes`;
const expectedOpenClawProject = `Workspaces/${path.basename(dataDir)}/OpenClaw`;
if (
  autoMigrated.imported < 5 ||
  !autoMigrated.projectPaths.includes(expectedDiscoveredDefaultProject) ||
  !autoMigrated.projectPaths.includes(expectedHermesProject) ||
  !autoMigrated.projectPaths.includes(expectedOpenClawProject)
) {
  throw new Error(`expected one-click migration to import workspace sources, got ${JSON.stringify(autoMigrated)}`);
}

const onboardPreview = await run(['onboard', '--no-home', '--root', onboardDir, '--min-confidence', '0.6', '--agent-target', 'codex']);
if (
  onboardPreview.mode !== 'preview' ||
  onboardPreview.writeEnabled ||
  !onboardPreview.migration?.dryRun ||
  onboardPreview.migration.imported < 2 ||
  onboardPreview.backup ||
  !onboardPreview.agentConfigs?.some(item => item.target === 'codex')
) {
  throw new Error(`expected onboarding preview with dry-run migration and Codex config, got ${JSON.stringify(onboardPreview)}`);
}
const afterOnboardPreviewExport = await run(['export']);
if (JSON.stringify(afterOnboardPreviewExport).includes('KeyMemory onboard should preview and import old memories')) {
  throw new Error(`expected onboarding preview to write no memories, got ${JSON.stringify(afterOnboardPreviewExport)}`);
}

const onboardApplied = await run(['onboard', '--no-home', '--root', onboardDir, '--min-confidence', '0.6', '--yes', '--run-dream', '--agent-target', 'all']);
if (
  onboardApplied.mode !== 'applied' ||
  !onboardApplied.writeEnabled ||
  onboardApplied.migration.imported < 2 ||
  !onboardApplied.backup?.valid ||
  !onboardApplied.agentConfigs?.some(item => item.target === 'codex') ||
  !onboardApplied.agentConfigs?.some(item => item.target === 'openclaw') ||
  !onboardApplied.scheduler?.nextDreamRunAt
) {
  throw new Error(`expected onboarding apply to migrate memories, create backup, and print agent configs, got ${JSON.stringify(onboardApplied)}`);
}
const onboardSearch = await run(['search', 'KeyMemory onboard should preview and import old memories', '--limit', '5', '--kind', 'preference']);
if (!Array.isArray(onboardSearch) || onboardSearch.length === 0) {
  throw new Error(`expected onboarded memories to be searchable, got ${JSON.stringify(onboardSearch)}`);
}

const search = await run(['search', '一键导入旧记忆', '--limit', '5', '--kind', 'preference']);
if (!Array.isArray(search) || search.length === 0) throw new Error('expected search results');

const contextPack = await run(['context', '一键导入旧记忆', '--project', 'KeyMemory/发布', '--max-items', '6', '--max-chars', '4000']);
if (contextPack.totalItems < 2) throw new Error(`expected context pack items, got ${JSON.stringify(contextPack)}`);
if (!contextPack.markdown.includes('User Preferences') || !contextPack.markdown.includes('Decisions')) {
  throw new Error(`expected grouped context pack markdown, got ${contextPack.markdown}`);
}
const naturalProjectPack = await run(['context', 'bracket syntax', '--project', 'KeyMemory/Agent Memory/Natural Routing', '--max-items', '3']);
if (!naturalProjectPack.markdown.includes('no bracket syntax')) {
  throw new Error(`expected natural-language project routing context, got ${naturalProjectPack.markdown}`);
}

const relationSource = await run(['create', '--title', '新版记忆关系源', '--content', '[[KeyMemory/Relations]] Decision: new guidance supersedes older guidance.', '--layer', 'long']);
const relationTarget = await run(['create', '--title', '旧版记忆关系目标', '--content', '[[KeyMemory/Relations]] Decision: older guidance should be marked superseded.', '--layer', 'long']);
const manualRelation = await run(['relate', relationSource.id, relationTarget.id, '--type', 'supersedes', '--reason', 'smoke manual relation']);
if (manualRelation.relationType !== 'supersedes') {
  throw new Error(`expected manual supersedes relation, got ${JSON.stringify(manualRelation)}`);
}
const manualRelated = await run(['related', relationSource.id, '--type', 'supersedes']);
if (!manualRelated.some(item => item.memoryId === relationTarget.id)) {
  throw new Error(`expected related command to return target memory, got ${JSON.stringify(manualRelated)}`);
}
const defaultRelationSearch = await run(['search', 'older guidance', '--limit', '5']);
if (defaultRelationSearch.some(item => item.memory.id === relationTarget.id)) {
  throw new Error(`expected default search to suppress superseded target, got ${JSON.stringify(defaultRelationSearch)}`);
}
const inclusiveRelationSearch = await run(['search', 'older guidance', '--limit', '5', '--include-superseded']);
if (!inclusiveRelationSearch.some(item => item.memory.id === relationTarget.id)) {
  throw new Error(`expected include-superseded search to return target, got ${JSON.stringify(inclusiveRelationSearch)}`);
}
const relationEvidence = await run([
  'create',
  '--title',
  '关系扩展外部依据',
  '--content',
  '[[KeyMemory/External Evidence]] Evidence: relation expansion should pull linked context even outside the selected project subtree.',
  '--layer',
  'long',
]);
await run(['relate', relationSource.id, relationEvidence.id, '--type', 'relates_to', '--strength', '0.9', '--reason', 'smoke relation expansion']);
const relationContext = await run(['context', 'new guidance older guidance', '--project', 'KeyMemory/Relations', '--max-items', '4', '--max-chars', '2500']);
if (!relationContext.markdown.includes('supersedes') || !relationContext.markdown.includes('Relations:')) {
  throw new Error(`expected context pack to include relation lineage, got ${relationContext.markdown}`);
}
if (!relationContext.markdown.includes('relation expansion should pull linked context')) {
  throw new Error(`expected context pack to include related external evidence, got ${relationContext.markdown}`);
}
if (relationContext.markdown.includes('older guidance should be marked superseded')) {
  throw new Error(`expected context pack to suppress superseded memory body, got ${relationContext.markdown}`);
}

const dreamRelationContent = '[[KeyMemory/Dream/Relations]] Dream supersede duplicate content body shared marker alpha beta.';
const dreamA = await run(['create', '--title', '梦境关系重复 A', '--content', dreamRelationContent, '--layer', 'flash', '--tags', 'dream-rel,duplicate']);
const dreamB = await run(['create', '--title', '梦境关系重复 B', '--content', dreamRelationContent, '--layer', 'flash', '--tags', 'dream-rel,duplicate']);
const dreamAssocA = await run(['create', '--title', '梦境标签关联 A', '--content', '[[KeyMemory/Dream/Association]] Procedure: dream tag association should connect related planning notes.', '--layer', 'short', '--tags', 'dream-assoc-topic,assoc-a']);
const dreamAssocB = await run(['create', '--title', '梦境标签关联 B', '--content', '[[KeyMemory/Dream/Association]] Evidence: related planning notes should strengthen each other without merging.', '--layer', 'short', '--tags', 'dream-assoc-topic,assoc-b']);
const projectClusterA = await run(['create', '--title', 'Dream project cluster Alpha', '--content', '[[Dream/ProjectCluster/Alpha]] Decision: shared project clustering alpha note references #agentmemorycluster.', '--layer', 'long']);
const projectClusterB = await run(['create', '--title', 'Dream project cluster Beta', '--content', '[[Dream/ProjectCluster/Beta]] Decision: shared project clustering beta note references #agentmemorycluster.', '--layer', 'long']);
const dreamRelationReport = await run(['dream', '--run']);
if (dreamRelationReport.status !== 'completed') {
  throw new Error(`expected dream relation report to complete, got ${JSON.stringify(dreamRelationReport)}`);
}
const dreamRelatedA = await run(['related', dreamA.id, '--type', 'supersedes']);
const dreamRelatedB = await run(['related', dreamB.id, '--type', 'supersedes']);
const dreamRelationFound = [...dreamRelatedA, ...dreamRelatedB].some(item => item.memoryId === dreamA.id || item.memoryId === dreamB.id);
if (!dreamRelationFound) {
  throw new Error(`expected dream merge to create supersedes relation, got ${JSON.stringify({ dreamRelatedA, dreamRelatedB })}`);
}
const dreamAssocRelated = await run(['related', dreamAssocA.id, '--type', 'relates_to']);
if (!dreamAssocRelated.some(item => item.memoryId === dreamAssocB.id)) {
  throw new Error(`expected dream REM phase to create relates_to association, got ${JSON.stringify(dreamAssocRelated)}`);
}
const remSession = dreamRelationReport.sessions.find(session => session.phase === 'rem');
if (!remSession || remSession.signals.relationsCreated < 1) {
  throw new Error(`expected dream REM relation signal, got ${JSON.stringify(dreamRelationReport.sessions)}`);
}
const pendingProjectSuggestions = await run(['project-suggestions', '--status', 'pending']);
if (pendingProjectSuggestions.length !== 0) {
  throw new Error(`expected mailbox architecture to stop dream project-folder suggestions, got ${JSON.stringify(pendingProjectSuggestions)}`);
}
const clusteredProjectContext = await run(['context', 'shared project clustering', '--project', 'Dream/ProjectCluster', '--max-items', '4']);
if (clusteredProjectContext.totalItems < 2 || !clusteredProjectContext.markdown.includes('agentmemorycluster')) {
  throw new Error(`expected flattened source hints to preserve legacy project-scoped context without creating folders, got ${JSON.stringify(clusteredProjectContext)}`);
}

const health = await run(['health']);
if (typeof health.score !== 'number') throw new Error('expected health score');
if (health.privacyRedactedCount < 1) throw new Error(`expected privacy redaction count, got ${JSON.stringify(health)}`);

const backupFile = path.join(dataDir, 'keymemory-backup.json');
const httpMcpBackupFile = path.join(dataDir, 'http-mcp-backup.json');
const backup = await run(['backup-create', backupFile]);
if (!backup.valid || backup.counts.memories < 1 || backup.counts.projects < 1) {
  throw new Error(`expected valid backup with memories and projects, got ${JSON.stringify(backup)}`);
}
if (!Object.prototype.hasOwnProperty.call(backup.counts, 'memory_relations')) {
  throw new Error(`expected backup to include memory_relations, got ${JSON.stringify(backup.counts)}`);
}
if (backup.includedTables.includes('tool_secrets') || JSON.stringify(backup).includes(toolSecretValue)) {
  throw new Error(`expected normal backup to omit encrypted tool secrets and plaintext values, got ${JSON.stringify(backup)}`);
}

const inspectedBackup = await run(['backup-inspect', backupFile]);
if (!inspectedBackup.valid || inspectedBackup.counts.memories !== backup.counts.memories) {
  throw new Error(`expected backup inspection to match create summary, got ${JSON.stringify(inspectedBackup)}`);
}

const restoreDryRun = await run(['backup-restore', backupFile, '--dry-run']);
if (!restoreDryRun.valid || !restoreDryRun.dryRun || !restoreDryRun.wouldRestore) {
  throw new Error(`expected dry-run restore readiness, got ${JSON.stringify(restoreDryRun)}`);
}

await run([
  'create',
  '--title',
  '恢复替换后应消失',
  '--content',
  '[[Restore/Sentinel]] post-backup sentinel should disappear after replace restore.',
  '--layer',
  'long',
]);
const restored = await run(['backup-restore', backupFile, '--replace']);
if (!restored.valid || !restored.restored || !restored.preRestoreBackupPath || !fs.existsSync(restored.preRestoreBackupPath)) {
  throw new Error(`expected replace restore with safety backup, got ${JSON.stringify(restored)}`);
}
const sentinelSearch = await run(['search', 'post-backup sentinel', '--limit', '3']);
if (Array.isArray(sentinelSearch) && sentinelSearch.length > 0) {
  throw new Error(`expected post-backup sentinel to be removed by restore, got ${JSON.stringify(sentinelSearch)}`);
}

process.env.KEYMEMORY_DATA_DIR = dataDir;
const { initDatabase, closeDatabase } = await import('../packages/server/dist/db/sqlite.js');
const { injectContext } = await import('../packages/server/dist/core/health.js');
const { assertSafeServerBinding, isCorsOriginAllowed, isApiRequestAuthorized } = await import('../packages/server/dist/core/security.js');
const { getSchedulerConfig, updateSchedulerConfig } = await import('../packages/server/dist/core/scheduler.js');
initDatabase();
let injectedDefault = [];
let injectedInclusive = [];
let schedulerConfig = null;
let invalidSchedulerRejected = false;
try {
  schedulerConfig = getSchedulerConfig();
  if (!schedulerConfig.nextDreamRunAt) {
    throw new Error(`expected scheduler config to expose nextDreamRunAt, got ${JSON.stringify(schedulerConfig)}`);
  }
  schedulerConfig = updateSchedulerConfig({ dreamingCron: '15 4 * * *' });
  if (schedulerConfig.dreamingCron !== '15 4 * * *' || !schedulerConfig.nextDreamRunAt) {
    throw new Error(`expected valid dream cron update with next run, got ${JSON.stringify(schedulerConfig)}`);
  }
  try {
    updateSchedulerConfig({ dreamingCron: 'bad cron' });
  } catch {
    invalidSchedulerRejected = true;
  }
  if (!invalidSchedulerRejected) {
    throw new Error('expected invalid dream cron to be rejected');
  }

  injectedDefault = await injectContext({ query: 'older guidance', limit: 5 });
  if (injectedDefault.some(item => item.id === relationTarget.id)) {
    throw new Error(`expected context inject to suppress superseded target, got ${JSON.stringify(injectedDefault)}`);
  }
  injectedInclusive = await injectContext({ query: 'older guidance', limit: 5, includeSuperseded: true });
  if (!injectedInclusive.some(item => item.id === relationTarget.id)) {
    throw new Error(`expected includeSuperseded context inject to return target, got ${JSON.stringify(injectedInclusive)}`);
  }
} finally {
  closeDatabase();
}

const schedulerCliStatus = await run(['scheduler']);
if (!schedulerCliStatus.nextDreamRunAt) {
  throw new Error(`expected scheduler CLI to show nextDreamRunAt, got ${JSON.stringify(schedulerCliStatus)}`);
}
const schedulerCliUpdated = await run(['scheduler', '--cron', '20 5 * * *', '--disable']);
if (
  schedulerCliUpdated.dreamingCron !== '20 5 * * *' ||
  schedulerCliUpdated.dreamingEnabled !== false ||
  schedulerCliUpdated.nextDreamRunAt !== null
) {
  throw new Error(`expected scheduler CLI to update cron and disable next run, got ${JSON.stringify(schedulerCliUpdated)}`);
}
let schedulerCliRejected = false;
try {
  await run(['scheduler', '--cron', 'bad cron']);
} catch {
  schedulerCliRejected = true;
}
if (!schedulerCliRejected) {
  throw new Error('expected scheduler CLI to reject invalid dream cron');
}
const schedulerCliEnabled = await run(['scheduler', '--enable']);
if (!schedulerCliEnabled.dreamingEnabled || !schedulerCliEnabled.nextDreamRunAt) {
  throw new Error(`expected scheduler CLI to re-enable next run, got ${JSON.stringify(schedulerCliEnabled)}`);
}

const originalApiKey = process.env.KEYMEMORY_API_KEY;
const originalAllowedOrigins = process.env.KEYMEMORY_ALLOWED_ORIGINS;
let publicHostRejected = false;
let apiKeyAuthRejected = false;
let apiKeyAuthAccepted = false;
let mcpApiKeyRejected = false;
let httpMcpProjectSearchScoped = false;
let restMigrationBackupCreated = false;
try {
  delete process.env.KEYMEMORY_API_KEY;
  delete process.env.KEYMEMORY_ALLOWED_ORIGINS;
  assertSafeServerBinding('127.0.0.1');
  try {
    assertSafeServerBinding('0.0.0.0');
  } catch {
    publicHostRejected = true;
  }
  if (!publicHostRejected) {
    throw new Error('expected public host binding to require KEYMEMORY_API_KEY');
  }
  if (!isCorsOriginAllowed('http://127.0.0.1:5173') || !isCorsOriginAllowed('http://localhost:5173')) {
    throw new Error('expected loopback browser origins to be allowed');
  }
  if (isCorsOriginAllowed('https://example.com')) {
    throw new Error('expected unconfigured public browser origin to be rejected');
  }
  process.env.KEYMEMORY_API_KEY = 'smoke-secret';
  assertSafeServerBinding('0.0.0.0');
  if (!isApiRequestAuthorized({ authorization: 'Bearer smoke-secret' }) || !isApiRequestAuthorized({ 'x-api-key': 'smoke-secret' })) {
    throw new Error('expected bearer and x-api-key auth to be accepted');
  }
  if (isApiRequestAuthorized({ authorization: 'Bearer wrong-secret' })) {
    throw new Error('expected wrong bearer auth to be rejected');
  }
  const Fastify = serverRequire('fastify');
  const { registerRoutes } = await import('../packages/server/dist/api/rest.js');
  const { registerMCPRoutes } = await import('../packages/server/dist/api/mcp.js');
  initDatabase();
  const authApp = Fastify({ logger: false });
  registerRoutes(authApp);
  registerMCPRoutes(authApp);
  try {
    const publicHealth = await authApp.inject({ method: 'GET', url: '/api/health' });
    if (publicHealth.statusCode !== 200) {
      throw new Error(`expected /api/health to remain public, got ${publicHealth.statusCode}`);
    }
    const rejectedApi = await authApp.inject({ method: 'GET', url: '/api/health/report' });
    apiKeyAuthRejected = rejectedApi.statusCode === 401;
    if (!apiKeyAuthRejected) {
      throw new Error(`expected protected REST route to reject missing API key, got ${rejectedApi.statusCode}`);
    }
    const acceptedApi = await authApp.inject({
      method: 'GET',
      url: '/api/health/report',
      headers: { authorization: 'Bearer smoke-secret' },
    });
    apiKeyAuthAccepted = acceptedApi.statusCode === 200;
    if (!apiKeyAuthAccepted) {
      throw new Error(`expected protected REST route to accept bearer API key, got ${acceptedApi.statusCode}`);
    }
    const restMigrationWithBackup = await authApp.inject({
      method: 'POST',
      url: '/api/migration/import-path',
      headers: { authorization: 'Bearer smoke-secret' },
      payload: {
        path: restBackupMigrationFile,
        source: 'rest-backup-smoke',
        format: 'markdown',
        dryRun: false,
        runDream: false,
        createBackupBeforeImport: true,
      },
    });
    const restMigrationResult = restMigrationWithBackup.json();
    if (
      restMigrationWithBackup.statusCode !== 200 ||
      restMigrationResult.imported !== 1 ||
      !restMigrationResult.backup?.valid ||
      !fs.existsSync(restMigrationResult.backup.filePath)
    ) {
      throw new Error(`expected REST migration import to create safety backup before write, got ${restMigrationWithBackup.body}`);
    }
    restMigrationBackupCreated = true;
    const rejectedMcp = await authApp.inject({
      method: 'POST',
      url: '/mcp',
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    mcpApiKeyRejected = rejectedMcp.statusCode === 401;
    if (!mcpApiKeyRejected) {
      throw new Error(`expected HTTP MCP route to reject missing API key, got ${rejectedMcp.statusCode}`);
    }
    const acceptedMcp = await authApp.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'x-api-key': 'smoke-secret' },
      payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    if (acceptedMcp.statusCode !== 200) {
      throw new Error(`expected HTTP MCP route to accept x-api-key, got ${acceptedMcp.statusCode}`);
    }
    const httpMcpTools = acceptedMcp.json().result.tools.map(tool => tool.name);
    for (const required of ['keymemory', 'keymemory_create', 'keymemory_search', 'keymemory_context_pack', 'memory_backup_create', 'memory_backup_inspect', 'memory_backup_restore_dry_run']) {
      if (!httpMcpTools.includes(required)) {
        throw new Error(`expected HTTP MCP tools/list to include ${required}`);
      }
    }
    const httpMcpSearchTool = acceptedMcp.json().result.tools.find(tool => tool.name === 'keymemory_search');
    if (
      !httpMcpSearchTool?.inputSchema?.properties?.projectPath ||
      !httpMcpSearchTool?.inputSchema?.properties?.includeDescendants ||
      !httpMcpSearchTool?.inputSchema?.properties?.memoryKind
    ) {
      throw new Error(`expected HTTP MCP memory_search schema to expose source-path and kind filters, got ${JSON.stringify(httpMcpSearchTool)}`);
    }
    const scopedNeedle = 'httpmcp scopedsearchneedle preference';
    const httpMcpScopedCreate = await authApp.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer smoke-secret' },
      payload: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'keymemory_create',
          arguments: {
            title: 'HTTP MCP scoped preference',
            content: `Preference: ${scopedNeedle} should only appear in scoped project search.`,
            layer: 'long',
            projectPath: 'HTTP/MCP/SearchScoped',
          },
        },
      },
    });
    const httpMcpOtherCreate = await authApp.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer smoke-secret' },
      payload: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'keymemory',
          arguments: {
            title: 'HTTP MCP other preference',
            content: `Preference: ${scopedNeedle} should not appear in scoped project search.`,
            layer: 'long',
            projectPath: 'HTTP/MCP/Other',
          },
        },
      },
    });
    const httpMcpScopedMemory = JSON.parse(httpMcpScopedCreate.json().result.content[0].text);
    const httpMcpOtherMemory = JSON.parse(httpMcpOtherCreate.json().result.content[0].text);
    const httpMcpScopedSearch = await authApp.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer smoke-secret' },
      payload: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'keymemory_search',
          arguments: {
            query: scopedNeedle,
            projectPath: 'HTTP/MCP/SearchScoped',
            includeDescendants: false,
            memoryKind: 'preference',
            limit: 10,
          },
        },
      },
    });
    const httpMcpScopedResults = JSON.parse(httpMcpScopedSearch.json().result.content[0].text);
    if (
      httpMcpScopedSearch.statusCode !== 200 ||
      !Array.isArray(httpMcpScopedResults) ||
      !httpMcpScopedResults.some(item => item.memory?.id === httpMcpScopedMemory.id) ||
      httpMcpScopedResults.some(item => item.memory?.id === httpMcpOtherMemory.id) ||
      httpMcpScopedResults.some(item => item.memory?.metadata?.sourceProjectPath !== 'HTTP/MCP/SearchScoped')
    ) {
      throw new Error(`expected HTTP MCP memory_search to honor projectPath and memoryKind filters, got ${JSON.stringify(httpMcpScopedResults)}`);
    }
    httpMcpProjectSearchScoped = true;
    const httpMcpBackup = await authApp.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer smoke-secret' },
      payload: {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'memory_backup_create', arguments: { filePath: httpMcpBackupFile } },
      },
    });
    const httpMcpBackupResult = JSON.parse(httpMcpBackup.json().result.content[0].text);
    if (httpMcpBackup.statusCode !== 200 || !httpMcpBackupResult.valid || !fs.existsSync(httpMcpBackupFile)) {
      throw new Error(`expected HTTP MCP backup create to write valid backup, got ${httpMcpBackup.body}`);
    }
    const httpMcpDryRun = await authApp.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: 'Bearer smoke-secret' },
      payload: {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'memory_backup_restore_dry_run', arguments: { filePath: httpMcpBackupFile } },
      },
    });
    const httpMcpDryRunResult = JSON.parse(httpMcpDryRun.json().result.content[0].text);
    if (httpMcpDryRun.statusCode !== 200 || !httpMcpDryRunResult.valid || !httpMcpDryRunResult.wouldRestore) {
      throw new Error(`expected HTTP MCP backup dry-run readiness, got ${httpMcpDryRun.body}`);
    }
  } finally {
    await authApp.close();
    closeDatabase();
  }
  process.env.KEYMEMORY_ALLOWED_ORIGINS = 'https://trusted.example';
  if (!isCorsOriginAllowed('https://trusted.example')) {
    throw new Error('expected configured browser origin to be allowed');
  }
} finally {
  if (originalApiKey === undefined) {
    delete process.env.KEYMEMORY_API_KEY;
  } else {
    process.env.KEYMEMORY_API_KEY = originalApiKey;
  }
  if (originalAllowedOrigins === undefined) {
    delete process.env.KEYMEMORY_ALLOWED_ORIGINS;
  } else {
    process.env.KEYMEMORY_ALLOWED_ORIGINS = originalAllowedOrigins;
  }
}

const wrapperContext = await runWrapper(['context', '一键导入旧记忆', '--project', 'KeyMemory/发布', '--max-items', '3']);
if (wrapperContext.totalItems < 1) {
  throw new Error(`expected top-level keymemory wrapper to pass context command through, got ${JSON.stringify(wrapperContext)}`);
}

const agentConfigs = await run(['agent-config', 'all']);
const codexAgentConfig = Array.isArray(agentConfigs) ? agentConfigs.find(item => item.target === 'codex') : null;
const claudeCodeAgentConfig = Array.isArray(agentConfigs) ? agentConfigs.find(item => item.target === 'claude-code') : null;
const hermesAgentConfig = Array.isArray(agentConfigs) ? agentConfigs.find(item => item.target === 'hermes') : null;
const openClawAgentConfig = Array.isArray(agentConfigs) ? agentConfigs.find(item => item.target === 'openclaw') : null;
if (codexAgentConfig?.mode !== 'cli' || !codexAgentConfig.snippet?.includes('KeyMemory - CLI Mode')) {
  throw new Error(`expected agent-config all to use Codex CLI mode by default, got ${JSON.stringify(agentConfigs)}`);
}
if (claudeCodeAgentConfig?.mode !== 'cli' || hermesAgentConfig?.mode !== 'cli') {
  throw new Error(`expected Claude Code and Hermes to use CLI mode by default, got ${JSON.stringify(agentConfigs)}`);
}

const codexMcpAgentConfig = await run(['agent-config', 'codex', '--mode', 'mcp']);
const claudeCodeMcpAgentConfig = await run(['agent-config', 'claude-code', '--mode', 'mcp']);
const hermesMcpAgentConfig = await run(['agent-config', 'hermes', '--mode', 'mcp']);
if (!codexMcpAgentConfig?.snippet?.includes('[mcp_servers.keymemory]') || !codexMcpAgentConfig.snippet.includes('default_tools_approval_mode = "approve"')) {
  throw new Error(`expected explicit Codex MCP config to pre-approve local memory tools, got ${JSON.stringify(codexMcpAgentConfig)}`);
}
if (!claudeCodeMcpAgentConfig?.snippet?.includes('"mcp__keymemory__*"')) {
  throw new Error(`expected explicit Claude Code MCP config to allow native memory tools, got ${JSON.stringify(claudeCodeMcpAgentConfig)}`);
}
if (!hermesMcpAgentConfig?.snippet?.includes('"mcp_servers"') || !hermesMcpAgentConfig.snippet.includes('"supports_parallel_tool_calls": true')) {
  throw new Error(`expected explicit Hermes MCP config to include native MCP server settings, got ${JSON.stringify(hermesMcpAgentConfig)}`);
}
if (!hermesMcpAgentConfig.snippet.includes('"keymemory_secret_get"')) {
  throw new Error(`expected explicit Hermes MCP config to include secret credential tools, got ${JSON.stringify(hermesMcpAgentConfig)}`);
}
if (!openClawAgentConfig?.snippet?.includes('"provider": "keymemory"')) {
  throw new Error(`expected agent-config all to include OpenClaw memory provider, got ${JSON.stringify(agentConfigs)}`);
}
if (!openClawAgentConfig.snippet.includes('"mcp__keymemory__*"') || !openClawAgentConfig.snippet.includes('"autoApprove": true')) {
  throw new Error(`expected OpenClaw KeyMemory config to auto-approve native memory tools, got ${JSON.stringify(openClawAgentConfig)}`);
}
const wrapperAgentConfig = await runWrapper(['agent-config', 'generic']);
if (!wrapperAgentConfig.snippet?.includes('keymemory-mcp.js')) {
  throw new Error(`expected top-level wrapper to pass agent-config through, got ${JSON.stringify(wrapperAgentConfig)}`);
}

console.log(JSON.stringify({
  ok: true,
  dataDir,
  migrated: migrated.imported,
  skippedDuplicates: migratedAgain.skipped,
  dryRunImported: dryRunMigration.imported,
  dryRunPersisted: false,
  directoryImported: migratedDir.imported,
  sourcePathProjectRouted: sourceRouted.projectPaths.includes('Agent Writer Dashboard/Frontend'),
  discoveredDefaultProjectRouted: autoMigrated.projectPaths.includes(expectedDiscoveredDefaultProject),
  jsonlSearchResults: jsonlSearch.length,
  discovered: discovered.length,
  autoImported: autoMigrated.imported,
  onboardPreviewImported: onboardPreview.migration.imported,
  onboardAppliedImported: onboardApplied.migration.imported,
  onboardBackup: Boolean(onboardApplied.backup?.valid),
  onboardAgentConfigs: onboardApplied.agentConfigs.length,
  searchResults: search.length,
  contextItems: contextPack.totalItems,
  naturalProjectItems: naturalProjectPack.totalItems,
  manualRelations: manualRelated.length,
  defaultSearchResults: defaultRelationSearch.length,
  inclusiveSearchResults: inclusiveRelationSearch.length,
  relationContextItems: relationContext.totalItems,
  dreamAssociations: dreamAssocRelated.length,
  dreamRelationMerged: dreamRelationReport.merged,
  projectSuggestionsPending: pendingProjectSuggestions.length,
  flattenedSourceContextItems: clusteredProjectContext.totalItems,
  healthScore: health.score,
  privacyRedacted: health.privacyRedactedCount,
  backupTables: backup.includedTables.length,
  backupMemoryRelations: backup.counts.memory_relations,
  backupMemories: backup.counts.memories,
  restorePreBackup: Boolean(restored.preRestoreBackupPath),
  injectedDefault: injectedDefault.length,
  injectedInclusive: injectedInclusive.length,
  schedulerNextRun: Boolean(schedulerConfig?.nextDreamRunAt),
  invalidSchedulerRejected,
  schedulerCliRejected,
  schedulerCliNextRun: Boolean(schedulerCliEnabled?.nextDreamRunAt),
  publicHostRejected,
  apiKeyAuthRejected,
  apiKeyAuthAccepted,
  restMigrationBackupCreated,
  mcpApiKeyRejected,
  httpMcpProjectSearchScoped,
  httpMcpBackupDryRun: fs.existsSync(httpMcpBackupFile),
  wrapperContextItems: wrapperContext.totalItems,
  agentConfigTargets: agentConfigs.length,
}, null, 2));
