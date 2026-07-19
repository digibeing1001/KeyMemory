# Backup and Recovery

KeyMemory 的迁移、梦境整理和记忆邮箱归集都会改变记忆结构。生产使用前，必须能先备份、再验证备份可读，最后再执行高风险操作。

## Portable Backup

创建备份：

```bash
keymemory backup-create ./keymemory-backup.json
```

默认备份包含：

- `projects`
- `memories`
- `entities`
- `relations`
- `memory_relations`
- `memory_entities`
- `versions`
- `selfcheck_logs`
- `evolution_tasks`
- `isolation_rules`
- `consolidation_plans`
- `consolidation_snapshots`
- `dream_reports`
- `dream_signals`
- `project_suggestions`
- `scheduler_config`

默认不包含：

- `memories_fts`: 可由记忆内容重建
- `embeddings`: 体积较大，恢复后运行 `keymemory rebuild-embeddings`
- `query_logs`: 默认省略，避免把用户查询文本带入备份

如需完整嵌入向量：

```bash
keymemory backup-create ./keymemory-backup.json --include-embeddings
```

如需运维查询日志：

```bash
keymemory backup-create ./keymemory-backup.json --include-operational-logs
```

## Verify

检查备份结构、行数和表校验和：

```bash
keymemory backup-inspect ./keymemory-backup.json
keymemory backup-verify ./keymemory-backup.json
```

输出中的 `valid` 必须为 `true`。若 `warnings` 提示 `embeddings omitted`，这是默认行为，恢复后重建向量即可。

## Dry-Run Restore

先做恢复干跑校验：

```bash
keymemory backup-restore ./keymemory-backup.json --dry-run
```

若输出：

```json
{
  "valid": true,
  "dryRun": true,
  "wouldRestore": true
}
```

则说明备份文件满足恢复前置条件。真实恢复仍需另加 `--replace`，避免误覆盖生产记忆库。

## Replace Restore

如需真正恢复，必须显式使用 `--replace`：

```bash
keymemory backup-restore ./keymemory-backup.json --replace
```

执行顺序：

1. 先校验备份格式、行数和 checksum。
2. 自动创建当前库的 pre-restore 安全备份，默认写入 `~/.keymemory/backups/pre-restore-*.json`。
3. 在一个 SQLite transaction 中清空当前数据表并恢复备份内容。
4. 重建 `memories_fts` 全文索引。

可指定 pre-restore 备份位置：

```bash
keymemory backup-restore ./keymemory-backup.json --replace --pre-restore-backup ./before-restore.json
```

恢复成功后，输出会包含：

```json
{
  "valid": true,
  "restored": true,
  "preRestoreBackupPath": "/path/to/pre-restore.json"
}
```

若误恢复，可用 `preRestoreBackupPath` 指向的文件再执行一次 `backup-restore --replace` 回到恢复前状态。

## REST API

```http
POST /api/backup/create-file
POST /api/backup/inspect-file
POST /api/backup/restore
```

## Migration Safety

REST migration endpoints accept `createBackupBeforeImport: true`. When the request is not a dry-run, KeyMemory creates a portable backup before importing and returns it as `backup` in the migration result.

```json
{
  "path": "./old-memory",
  "dryRun": false,
  "createBackupBeforeImport": true
}
```

The Web UI migration view sends this flag for write imports by default. Preview imports still write nothing and do not create a backup.

`/api/backup/restore` 干跑：

```json
{ "filePath": "./keymemory-backup.json", "dryRun": true }
```

真实恢复：

```json
{ "filePath": "./keymemory-backup.json", "replace": true }
```

## MCP Tools

Agents can create and verify backups before migration or dream consolidation:

- `memory_backup_create`
- `memory_backup_inspect`
- `memory_backup_restore_dry_run`

`memory_backup_restore_dry_run` is intentionally validation-only. Destructive replace restore remains a CLI/REST operation so a human can make the final recovery decision.

## Release Gate

`pnpm release:check` 会运行 smoke，覆盖：

- 创建可携 JSON 备份
- 校验备份结构、行数、checksum
- 执行 `backup-restore --dry-run`
- 执行 `backup-restore --replace`，验证自动 pre-restore 备份与 FTS 重建
- MCP backup create, inspect, and dry-run restore tools

任何一项失败，不得发布。
