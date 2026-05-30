# KeyMemory Privacy And Safety

Generated: 2026-05-30

## Default Redaction

KeyMemory redacts obvious credentials before writing memories to SQLite, FTS, entity extraction, embeddings, versions, or migration output.

Covered patterns include:

- labeled secrets such as `password=...`, `api_key=...`, `token=...`
- environment-style secrets such as `OPENAI_API_KEY=...`
- OpenAI / Anthropic-style API keys
- GitHub tokens
- AWS access key IDs
- JWTs
- private key PEM blocks
- connection strings with embedded passwords

When redaction happens, the memory receives:

- tag: `sensitivity:redacted`
- metadata: `privacy.redacted = true`
- metadata: `privacy.findings[]`

## Scope

The redaction path is centralized in `normalizeMemoryInput` and `normalizeMemoryUpdate`, so it covers:

- CLI create/update/import/migration
- REST create/update/batch import/migration
- MCP create/import/migration tools
- adapter writes from Claude Code, Hermes, OpenClaw, and Codex-style clients

## Health Signal

`getHealthReport()` exposes `privacyRedactedCount`, which counts active memories where sensitive material was detected and redacted.

## Local-First Server Safety

KeyMemory binds the REST/Web server to `127.0.0.1` by default. Binding to a non-loopback host such as `0.0.0.0` is refused unless `KEYMEMORY_API_KEY` is set.

When `KEYMEMORY_API_KEY` is set:

- `/api/health` stays public for lightweight liveness checks
- other `/api/*` routes require `Authorization: Bearer <KEYMEMORY_API_KEY>` or `x-api-key: <KEYMEMORY_API_KEY>`
- HTTP MCP at `/mcp` requires the same API key
- the Web UI prompts for the key after a 401 and keeps it in browser session storage

Browser CORS is local-first too:

- requests without a browser `Origin` header are allowed
- `localhost`, `127.x.x.x`, and `::1` origins are allowed for local UI/dev tooling
- public browser origins are rejected unless listed in `KEYMEMORY_ALLOWED_ORIGINS`
- `KEYMEMORY_ALLOWED_ORIGINS` accepts a comma-separated list, for example `https://trusted.example`

## Limits

Redaction is pattern-based. It prevents common accidental leaks, but it is not a data-loss-prevention engine. Production deployments should still:

- keep the SQLite data directory private to the local user
- avoid importing unknown third-party exports without review
- use OS filesystem permissions and disk encryption
- avoid logging raw user content in external systems
