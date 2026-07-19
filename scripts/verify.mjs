import { execSync } from 'node:child_process';

const pnpm = 'pnpm --config.verify-deps-before-run=false';
const commands = [
  `${pnpm} typecheck`,
  `${pnpm} build`,
  `${pnpm} smoke:agent-connect`,
  `${pnpm} eval:memory`,
  `${pnpm} smoke:mcp`,
  `${pnpm} smoke:loop`,
  `${pnpm} smoke:mailbox`,
  `${pnpm} smoke:llm`,
  `${pnpm} loop:audit`,
];

for (const command of commands) {
  console.log(`\n[verify] ${command}`);
  execSync(command, { stdio: 'inherit' });
}

console.log('\n[verify] ok');
