import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-eval-'));
const { confidenceFromSelfCheck } = await import('../packages/server/dist/core/auto.js');

function run(args) {
  const stdout = execFileSync('node', ['packages/server/dist/cli.js', '--format', 'json', '--data-dir', dataDir, ...args], {
    cwd: root,
    env: { ...process.env, KEYMEMORY_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

function create(title, content, projectPath, layer = 'long', extra = []) {
  return run(['create', '--title', title, '--content', content, '--layer', layer, '--project-path', projectPath, ...extra]);
}

function context(query, project, extra = []) {
  return run(['context', query, '--project', project, '--max-items', '16', '--max-chars', '8000', ...extra]);
}

const cases = [];

function check(name, condition, evidence) {
  cases.push({ name, passed: Boolean(condition), evidence });
}

create(
  'User delivery preference',
  'Preference: user prefers concise Chinese project delivery notes and dislikes marketing-style hero pages. [[EvalApp/Product]]',
  'EvalApp/Product'
);
const searchDecision = create(
  'Search architecture decision',
  'Decision: EvalApp memory retrieval uses SQLite FTS5 plus local ONNX embeddings, fused with RRF. [[EvalApp/Product/Backend]]',
  'EvalApp/Product/Backend'
);
const retrievalEvidence = create(
  'Retrieval evaluation evidence',
  'Evidence: release retrieval quality should be judged with relation expansion coverage. [[EvalApp/Research/Evidence]]',
  'EvalApp/Research/Evidence'
);
run(['relate', searchDecision.id, retrievalEvidence.id, '--type', 'relates_to', '--strength', '0.9', '--reason', 'eval relation expansion']);
create(
  'Release task',
  'Task: before release, run pnpm release:check and inspect context-pack coverage. [[EvalApp/Product/Release]]',
  'EvalApp/Product/Release',
  'short'
);
create(
  'Frontend constraint',
  'Constraint: EvalApp UI must keep operational screens dense and avoid oversized landing-page heroes. [[EvalApp/Product/Frontend]]',
  'EvalApp/Product/Frontend'
);
create(
  'Other project note',
  'Decision: OtherApp uses a separate cloud-only vector store and should not appear in EvalApp context. [[OtherApp/Backend]]',
  'OtherApp/Backend'
);
create(
  'Secret test',
  '[[EvalApp/Product/Security]] OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456 should be redacted before any context pack.',
  'EvalApp/Product/Security'
);
const oldPolicy = create(
  'Previous context policy',
  'Decision: obsolete context pack v1 should be used for release preparation. [[EvalApp/Product]]',
  'EvalApp/Product'
);
const newPolicy = create(
  'Current context policy',
  'Decision: use relation-aware context pack v2 for release preparation. [[EvalApp/Product]]',
  'EvalApp/Product'
);
run(['relate', newPolicy.id, oldPolicy.id, '--type', 'supersedes', '--reason', 'eval relation-aware context']);
run([
  'create',
  '--title',
  'Natural project routing',
  '--content',
  '项目路径: EvalApp/Product/Natural Routing\nDecision: natural-language project routing should create nested folders without bracket syntax.',
  '--layer',
  'long',
]);

const oldBilling = create(
  'Previous billing cadence',
  'Decision: EvalApp billing plan uses monthly invoicing. [[EvalApp/Temporal]]',
  'EvalApp/Temporal',
  'long',
  ['--valid-from', '2026-01-01T00:00:00.000Z']
);
const newBilling = create(
  'Current billing cadence',
  'Decision: EvalApp billing plan uses annual invoicing. [[EvalApp/Temporal]]',
  'EvalApp/Temporal',
  'long',
  ['--valid-from', '2026-02-01T00:00:00.000Z']
);
const supersession = run([
  'supersede',
  newBilling.id,
  oldBilling.id,
  '--effective-at',
  '2026-02-01T00:00:00.000Z',
  '--reason',
  'user corrected billing cadence',
]);
const expiredProcedure = create(
  'Retired FTP deployment',
  'Procedure: EvalApp retired deployment path used FTP artifact upload. [[EvalApp/Temporal]]',
  'EvalApp/Temporal',
  'short',
  ['--valid-from', '2025-01-01T00:00:00.000Z', '--valid-to', '2025-02-01T00:00:00.000Z']
);
const calibratedEvidence = create(
  'Imported confidence evidence',
  'Evidence: this imported claim has partial source support. [[EvalApp/Temporal]]',
  'EvalApp/Temporal',
  'short',
  ['--confidence', '0.64']
);

const pack = context('prepare release and retrieval architecture', 'EvalApp/Product');
const markdown = pack.markdown;
check('preference recall', markdown.includes('concise Chinese'), markdown);
check('descendant project recall', markdown.includes('SQLite FTS5') && markdown.includes('EvalApp/Product/Backend'), markdown);
check('decision grouping', markdown.includes('## Decisions') && markdown.includes('RRF'), markdown);
check('task grouping', markdown.includes('## Open Tasks') && markdown.includes('pnpm release:check'), markdown);
check('constraint grouping', markdown.includes('## Constraints And Rules') && markdown.includes('avoid oversized'), markdown);
check('project isolation', !markdown.includes('cloud-only vector store'), markdown);
check('privacy in context', !markdown.includes('sk-abcdefghijklmnopqrstuvwxyz123456') && markdown.includes('[REDACTED]'), markdown);
check(
  'relation-aware context',
  markdown.includes('relation-aware context pack v2') && markdown.includes('supersedes') && !markdown.includes('obsolete context pack v1'),
  markdown
);
const defaultSearch = run(['search', 'context pack release preparation', '--limit', '8']);
const inclusiveSearch = run(['search', 'context pack release preparation', '--limit', '8', '--include-superseded']);
check(
  'search suppresses superseded',
  defaultSearch.some(item => item.memory.id === newPolicy.id)
    && !defaultSearch.some(item => item.memory.id === oldPolicy.id)
    && inclusiveSearch.some(item => item.memory.id === oldPolicy.id),
  JSON.stringify({ defaultSearch, inclusiveSearch }, null, 2)
);

const backendPack = context('SQLite FTS5 retrieval architecture', 'EvalApp/Product/Backend', ['--max-items', '4']);
check(
  'relation expansion context',
  backendPack.markdown.includes('relation expansion coverage') && backendPack.markdown.includes('relates_to'),
  backendPack.markdown
);

const naturalProjectPack = context('natural-language project routing', 'EvalApp/Product/Natural Routing');
check(
  'natural project routing',
  naturalProjectPack.markdown.includes('without bracket syntax') && naturalProjectPack.project === 'EvalApp/Product/Natural Routing',
  naturalProjectPack.markdown
);

const currentBilling = run(['search', 'EvalApp billing plan invoicing', '--limit', '8']);
const historicalBilling = run([
  'search',
  'EvalApp billing plan invoicing',
  '--limit',
  '8',
  '--as-of',
  '2026-01-15T00:00:00.000Z',
]);
const billingAudit = run([
  'search',
  'EvalApp billing plan invoicing',
  '--limit',
  '8',
  '--include-superseded',
  '--include-expired',
]);
check(
  'temporal knowledge update current view',
  currentBilling.some(item => item.memory.id === newBilling.id)
    && !currentBilling.some(item => item.memory.id === oldBilling.id)
    && supersession.target.validTo === '2026-02-01T00:00:00.000Z',
  JSON.stringify({ currentBilling, supersession }, null, 2)
);
check(
  'temporal historical recall',
  historicalBilling.some(item => item.memory.id === oldBilling.id)
    && !historicalBilling.some(item => item.memory.id === newBilling.id),
  JSON.stringify(historicalBilling, null, 2)
);
check(
  'temporal audit escape hatch',
  billingAudit.some(item => item.memory.id === oldBilling.id)
    && billingAudit.some(item => item.memory.id === newBilling.id),
  JSON.stringify(billingAudit, null, 2)
);

const currentTemporalPack = context('EvalApp billing plan invoicing', 'EvalApp/Temporal');
const historicalTemporalPack = context(
  'EvalApp billing plan invoicing',
  'EvalApp/Temporal',
  ['--as-of', '2026-01-15T00:00:00.000Z']
);
check(
  'time-aware context pack',
  currentTemporalPack.markdown.includes('annual invoicing')
    && !currentTemporalPack.markdown.includes('monthly invoicing')
    && historicalTemporalPack.markdown.includes('monthly invoicing')
    && !historicalTemporalPack.markdown.includes('annual invoicing'),
  JSON.stringify({ current: currentTemporalPack.markdown, historical: historicalTemporalPack.markdown }, null, 2)
);

const expiredDefault = run(['search', 'retired deployment FTP artifact', '--limit', '8']);
const expiredAudit = run(['search', 'retired deployment FTP artifact', '--limit', '8', '--include-expired']);
check(
  'selective forgetting validity filter',
  !expiredDefault.some(item => item.memory.id === expiredProcedure.id)
    && expiredAudit.some(item => item.memory.id === expiredProcedure.id),
  JSON.stringify({ expiredDefault, expiredAudit }, null, 2)
);

const explained = run(['search', 'EvalApp billing plan invoicing', '--limit', '2', '--explain']);
check(
  'retrieval score explanation',
  explained.length > 0
    && explained.every(item => item.scoreBreakdown)
    && explained.every(item => Math.abs(item.score - item.scoreBreakdown.finalScore) < 1e-7),
  JSON.stringify(explained, null, 2)
);
check(
  'evidence confidence persistence',
  run(['read', calibratedEvidence.id]).confidence === 0.64,
  JSON.stringify(run(['read', calibratedEvidence.id]), null, 2)
);
check(
  'auto-memory confidence calibration',
  confidenceFromSelfCheck(0.8) === 0.87
    && confidenceFromSelfCheck(1) === 0.95
    && confidenceFromSelfCheck(0.8) < 1,
  JSON.stringify({ score08: confidenceFromSelfCheck(0.8), score10: confidenceFromSelfCheck(1) })
);

const preferenceOnly = context('delivery style', 'EvalApp/Product', ['--kinds', 'preference']);
check(
  'kind filter',
  preferenceOnly.sections.length === 1 && preferenceOnly.sections[0].kind === 'preference',
  preferenceOnly.markdown
);

const smallPack = context('prepare release and retrieval architecture', 'EvalApp/Product', ['--max-items', '2', '--max-chars', '1000']);
check('budget cap', smallPack.totalItems <= 2 && smallPack.usedChars <= 1000, smallPack.markdown);

const missing = context('release architecture', 'MissingProject');
check('abstain missing project', missing.totalItems === 0 && missing.markdown.includes('No relevant memories found'), missing.markdown);

const passed = cases.filter(item => item.passed).length;
const failed = cases.filter(item => !item.passed);
const result = {
  ok: failed.length === 0,
  dataDir,
  score: Number((passed / cases.length).toFixed(3)),
  passed,
  total: cases.length,
  failed,
};

console.log(JSON.stringify(result, null, 2));

if (failed.length > 0) {
  process.exit(1);
}
