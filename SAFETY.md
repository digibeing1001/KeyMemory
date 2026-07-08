# KeyMemory Safety Policy

KeyMemory is local-first memory infrastructure for agents. Safety means preserving user data, keeping secrets out of indexed memory, and making risky operations reversible.

## Data Safety

- Create a backup before migrations, restore operations, dream consolidation, or bulk maintenance.
- Use dry-run modes before importing or restoring when the operation touches existing user data.
- Never overwrite host-agent data silently. Install and update flows must preserve by default or ask for an explicit overwrite decision.

## Secret Handling

- Do not save API keys, passwords, tokens, or credentials with `memory_create`, `memory_import`, or ordinary backups.
- Use `memory_secret_set`, `memory_secret_get`, `memory_secret_list`, and `memory_secret_delete` for credentials.
- Search logs, context packs, checkpoints, and loop events must redact known secret patterns.

## Server Safety

- Public host bindings require API key protection.
- CORS origins must be explicit when exposing the REST or Web UI surface.
- MCP tools must advertise accurate annotations for destructive and open-world behavior.

## Recovery

- Failed migrations and restores must leave enough backup metadata to inspect, verify, and roll back.
- Loop failures must include root-cause hints, retry guidance, and a clear stop condition.

