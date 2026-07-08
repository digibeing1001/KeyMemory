import { execSync } from 'node:child_process';

const commands = [
  'pnpm typecheck',
  'pnpm build',
  'pnpm eval:memory',
  'pnpm smoke:mcp',
  'pnpm smoke:loop',
  'pnpm loop:audit',
];

for (const command of commands) {
  console.log(`\n[verify] ${command}`);
  execSync(command, { stdio: 'inherit' });
}

console.log('\n[verify] ok');

