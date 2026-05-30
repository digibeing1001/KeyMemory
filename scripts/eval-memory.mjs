import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const root = path.resolve(import.meta.dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'keymemory-eval-'));

function run(args) {
  const stdout = execFileSync('node', ['packages/server/dist/cli.js', '--format', 'json', '--data-dir', dataDir, ...args], {
    cwd: root,
    env: { ...process.env, KEYMEMORY_DATA_DIR: dataDir },
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

function create(title, content, projectPath, layer = 'long') {
  return run(['create', '--title', title, '--content', content, '--layer', layer, '--project-path', projectPath]);
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
