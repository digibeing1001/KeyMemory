# KeyMemory

KeyMemory 是一个本地优先的 Agent 记忆底座。它可以接入 Claude Code、Hermes、OpenClaw、Codex 以及其他 MCP 兼容 Agent，用来保存用户与 Agent 长期协作时产生的项目记忆，并在后续任务中把关键上下文重新提供给 Agent。

它不是一个简单的笔记库。KeyMemory 的核心目标是：让 Agent 记住项目、决策、偏好、约束、流程、任务和旧上下文，同时避免不同项目的记忆混在一起。

## 核心能力

- 本地 SQLite 存储，默认数据不出本机。
- 以项目树组织记忆，项目下还能继续创建子项目。
- 支持 `[[项目/子项目]]` 和自然语言项目提示自动归类。
- 为 Agent 生成紧凑的 `memory_context_pack`，适合长期项目上下文注入。
- 支持梦境整理：合并重复记忆、关联相关记忆、替换过时记忆、归档低价值记忆，并提出项目整理建议。
- 支持一键迁移旧记忆：Codex、Claude Code、Hermes、OpenClaw、Cursor、Gemini、Mem0/OpenMemory 风格目录，以及 Markdown、JSON、JSONL/NDJSON、纯文本文件。
- 写入式迁移前自动创建可携备份；恢复前也会先备份现库。
- 写入、索引、嵌入、版本记录前会脱敏常见密钥和凭证。
- 支持 Windows、Linux、macOS、Windows WSL。

## 当前分发方式

当前推荐从 GitHub 源码仓库安装。仓库根包保持 `private: true`，暂不作为公开 npm 包发布。

```bash
git clone https://github.com/digibeing1001/KeyMemory.git
cd KeyMemory
pnpm setup
keymemory doctor
```

环境要求：

- Node.js 20 或更高版本
- pnpm
- Git

## 首次使用

先运行预览，不写入任何记忆：

```bash
keymemory onboard
```

预览确认无误后，再执行真实迁移：

```bash
keymemory onboard --yes --run-dream --agent-target all
```

它会完成：

- 发现旧记忆来源
- 估算迁移结果
- 写入前创建备份
- 导入并规范化旧记忆
- 推断项目路径和记忆类型
- 可选运行梦境整理
- 输出 Agent 接入配置片段

常用选项：

```bash
keymemory onboard --root <workspace>
keymemory onboard --no-home
keymemory onboard --agent-target codex
keymemory onboard --agent-target claude-code
keymemory onboard --agent-target hermes
keymemory onboard --agent-target openclaw
```

## 启动 Web UI

```bash
keymemory dashboard
```

浏览器打开：

```text
http://127.0.0.1:3210
```

Web UI 包含：

- 记忆编辑器
- 项目树
- 搜索
- 标签云
- 梦境报告与调度
- 迁移导入
- 项目整理建议
- 回收站

默认只监听 `127.0.0.1`。如果要开放到局域网或公网，必须先设置：

```bash
KEYMEMORY_API_KEY=<your-key>
```

受保护的 REST / HTTP MCP 请求需要携带：

```text
Authorization: Bearer <key>
```

或：

```text
x-api-key: <key>
```

浏览器跨域访问还需要显式设置 `KEYMEMORY_ALLOWED_ORIGINS`。

## 接入 Agent

生成配置片段：

```bash
keymemory agent-config all
keymemory agent-config codex --format compact
keymemory agent-config openclaw --format json
```

支持目标：

- `generic`：任意 MCP 兼容 Agent
- `claude-desktop`
- `claude-code`
- `hermes`
- `openclaw`
- `codex`

推荐使用生成结果里的启动器路径：

```text
bin/keymemory-mcp.js
```

启动器会检查构建产物，把日志写到 `~/.keymemory/logs/mcp.log`，并保持 MCP stdout 干净，避免污染 JSON-RPC。

接入后，建议让 Agent 在长期任务前调用：

- `memory_context_pack`：读取项目上下文包
- `memory_auto_remember`：在重要偏好、决策、约束、任务变化后自动记忆

主要 MCP 工具：

| 工具 | 用途 |
| --- | --- |
| `memory_create` | 创建记忆 |
| `memory_search` | 按项目、子项目、类型、是否包含被替代记忆搜索 |
| `memory_context_pack` | 生成分组上下文包 |
| `memory_auto_remember` | 评估并保存重要对话内容 |
| `memory_migration_discover` | 发现旧记忆来源 |
| `memory_migration_import` | 导入并重组旧记忆 |
| `memory_backup_create` | 迁移或梦境前创建备份 |
| `memory_backup_inspect` | 检查备份结构与 checksum |
| `memory_backup_restore_dry_run` | 验证备份是否可恢复 |
| `memory_relate` | 创建 `relates_to`、`supersedes` 等记忆关系 |
| `memory_related` | 查看相关记忆 |
| `memory_project_suggestions` | 查看梦境生成的项目整理建议 |
| `memory_project_suggestion_accept` | 接受项目整理建议 |
| `memory_project_suggestion_reject` | 拒绝项目整理建议 |

## 一键迁移旧记忆

发现本机旧记忆：

```bash
keymemory migrate-discover
```

预览单个文件或目录：

```bash
keymemory migrate <file-or-directory> --dry-run
```

导入单个文件或目录：

```bash
keymemory migrate <file-or-directory> --source codex --run-dream
```

导入自动发现的来源：

```bash
keymemory migrate-auto --run-dream
```

支持格式：

- `.json`
- `.jsonl`
- `.ndjson`
- `.md`
- `.markdown`
- `.txt`

如果旧记忆没有写明项目，KeyMemory 会尝试从这些信息推断：

- `workspace`、`cwd`、`repoPath`、`projectPath` 等结构化字段
- 发现来源默认路径，例如 `Workspaces/<workspace>/Claude Code`
- 文件相对目录，例如 `Agent Writer Dashboard/Frontend`

## 项目记忆

每条记忆都属于一个项目。项目可以嵌套。

显式指定项目：

```text
[[KeyMemory/Release/Migration]]
```

自然语言提示：

```text
项目路径: KeyMemory/Release/Migration
```

项目检索默认包含子项目。因此 Agent 在 `KeyMemory/Release` 下工作时，也能读到 `KeyMemory/Release/Migration` 的相关记忆。

## 梦境整理

梦境用于定期整理越来越多、越来越杂的记忆。

它可以：

- 合并重复记忆
- 归档过期或低价值闪念
- 在新记忆替代旧记忆时创建 `supersedes` 关系
- 在相关记忆之间创建 `relates_to` 关系
- 给出项目树整理建议
- 生成可回滚报告

手动运行：

```bash
keymemory dream
```

查看或修改调度：

```bash
keymemory scheduler
keymemory scheduler --cron "15 4 * * *"
keymemory scheduler --disable
keymemory scheduler --enable
```

当前只接受每日 5 字段 cron：

```text
M H * * *
```

## 备份与恢复

创建备份：

```bash
keymemory backup-create ./keymemory-backup.json
```

检查备份：

```bash
keymemory backup-inspect ./keymemory-backup.json
```

仅验证恢复，不写入：

```bash
keymemory backup-restore ./keymemory-backup.json --dry-run
```

替换恢复：

```bash
keymemory backup-restore ./keymemory-backup.json --replace
```

`--replace` 会先创建 pre-restore 备份，再事务式恢复并重建 FTS。

## 常用命令

```bash
keymemory doctor
keymemory dashboard
keymemory onboard
keymemory context "release checklist" --project "KeyMemory/Release"
keymemory search "user preference" --kind preference
keymemory relate <sourceId> <targetId> --type supersedes
keymemory related <sourceId> --type supersedes
keymemory backup-create ./keymemory-backup.json
keymemory scheduler
keymemory update
```

开发与发布检查：

```bash
pnpm typecheck
pnpm build
pnpm smoke
pnpm smoke:mcp
pnpm smoke:launchers
pnpm eval:memory
pnpm perf:memory
pnpm release:check
```

## 发布质量

发布闸门：

```bash
pnpm release:check
```

它会验证：

- TypeScript 类型检查
- 生产构建
- doctor 能力冒烟
- 长期记忆评测
- 性能预算
- fresh database smoke
- stdio MCP smoke
- launcher smoke
- 迁移、备份、关系、调度、认证、项目整理覆盖

当前已验证：`pnpm release:check` 于 2026-05-31 通过。

已知非阻塞项：`keymemory doctor` 在未设置 `KEYMEMORY_MCP_CONFIG` 时会提示 warning。这只表示它无法检查外部 Agent 配置文件，不影响本地 MCP launcher 使用。

## 文档

- [迁移指南](MIGRATION_GUIDE.md)
- [Agent 配置](docs/agent-configuration.md)
- [Agent Context Pack](docs/agent-context-pack.md)
- [备份与恢复](docs/backup-and-recovery.md)
- [记忆关系](docs/memory-relations.md)
- [隐私与安全](docs/privacy-and-safety.md)
- [性能预算](docs/performance.md)
- [发布就绪检查](docs/release-readiness.md)
- [产品发布审计](docs/product-release-audit.md)
- [研究与产品升级](docs/research-and-product-upgrade.md)

## License

MIT
