# KeyMemory Project Rules

## Code Change Auto-Push Rule

All code changes made in this project MUST be automatically committed and pushed to the GitHub repository after modification.

- **Repository**: `digibeing1001/KeyMemory` (origin: https://github.com/digibeing1001/KeyMemory.git)
- **Scope**: Applies to ALL code file changes (source code, config, scripts, etc.)
- **Action**: After making any code change, always run `git add`, `git commit`, and `git push` to sync to GitHub
- **Commit message**: Use conventional commits format (e.g., `feat:`, `fix:`, `chore:`, `refactor:`)

## Development Conventions

- Build command: `pnpm build`
- Type check: `pnpm typecheck`
- Lint: `pnpm lint`
- CLI test: `node packages/server/dist/cli.js --help`
