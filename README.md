# KeyMemory

> 给 AI Agent 一颗能记住项目、决策与偏好的长期记忆大脑。
> 本地优先、项目隔离、自动整理、长期任务断点可续。

KeyMemory 是一个面向 AI 编程 Agent 的本地记忆底座。它通过 MCP 协议接入 Claude Code、Claude Desktop、Codex、Hermes、OpenClaw 以及任意 MCP 兼容 Agent，把你在长期协作中产生的项目记忆、决策、约束、流程和旧上下文持久化下来，并在后续任务里把最相关的记忆以紧凑的上下文包重新喂给 Agent。

它不是笔记库，也不是简单的向量数据库。KeyMemory 的目标是：**让 Agent 像一个真正记得你项目的同事一样工作，而不是每次对话都从零开始。**

---

## 为什么需要 KeyMemory

和 AI Agent 协作时，下面这些场景几乎人人都遇到过：

- **每次对话都从零开始**：上个会话聊过的项目约定、架构决策，新会话里 Agent 一无所知。
- **项目记忆混在一起**：A 项目用的技术栈、B 项目的发布流程，全堆在一个 `MEMORY.md` 里，互相串味。
- **旧决策没人管**：上周说"用 SQLite"，这周改成"用 Postgres"，但旧记忆还在，Agent 读到时不知道该信哪条。
- **记忆越积越乱**：闪念、待办、偏好、规则混作一团，找不到、也分不清主次。
- **长期任务断了就废了**：跑了半小时的自动化任务，进程一崩，进度全没，只能从头再来。
- **隐私没底**：API key、token 被随手写进记忆文件，跟着 git 一起传上了 GitHub。

KeyMemory 就是为了系统性地解决这些问题而设计的。

---

## 核心特点

### 1. 本地优先，隐私可控

- 数据默认存在本地 SQLite 数据库，**不出本机、不上云**。单文件即整个记忆库，备份和迁移就是复制一个文件的事。
- 写入、索引、向量化、版本记录、迁移输出**前**会自动脱敏常见密钥与凭证（API key、JWT、私钥、带密码的连接串等），从源头防止凭证误入库。
- 工具用的 API key 等凭据单独加密保存（AES-256-GCM 行业标准加密），和普通记忆彻底隔开——不会被搜索、不会被向量化、不会进自动整理、也不会被带进备份文件。
- Web 服务默认只在本机（`127.0.0.1`）监听；要开放到局域网或公网，必须显式设置访问密钥 `KEYMEMORY_API_KEY`，否则拒绝启动。

### 2. 项目树组织，记忆不再串味

- 每条记忆都属于一个项目，项目可以无限嵌套：`KeyMemory/Release/Migration`。
- 用 `[[项目/子项目]]` 或自然语言 `项目路径: KeyMemory/Release` 自动归类。
- **检索默认包含子项目**：在 `KeyMemory/Release` 下工作时，能读到 `KeyMemory/Release/Migration` 的记忆，但不会反过来泄漏到其他项目。
- 多个 Agent 之间可以选隔离方式：完全隔离（各记各的）/ 完全共享 / 混合（默认私有，标记 `#share` 才共享）/ 按项目隔离。

### 3. SelfCheck 自检：该记的才记，不该记的不打扰

不是每句话都值得记，也不是每句话都要用户手动确认。KeyMemory 用一个五维评分器自动判断该不该记：

| 维度 | 衡量什么 |
| --- | --- |
| 项目相关度 | 与当前项目的语义相关程度 |
| 长期价值 | 是否包含方法论、决策、原则等长期可用内容 |
| 新颖度 | 与近期记忆的重复程度（避免重复记录） |
| 用户强调度 | 用户表达中的强调程度 |
| 可复用性 | 是否是可复用的配置、模板、流程 |

综合得分超过阈值自动记录；处于中间区间建议记录但需确认；低于阈值直接忽略。结果是：**重要信息自动沉淀，日常闲聊不污染记忆库。**

### 4. 记忆分层 + 分类，结构清晰

记忆按生命周期分层，按用途分类：

- **层级**（从短到长）：闪念 → 短期 → 长期 → 实体知识
- **类型**：偏好 / 约束 / 决策 / 任务 / 流程 / 项目事实 / 概念 / 关系 / 事件 / 原始笔记

写入时未指定层级会自动推断（实体→实体层，偏好/规则/决策→长期层，待办/临时→短期层），不需要用户操心。

### 5. 混合检索：全文 + 语义 + 关系图谱

三种检索方式叠加，让 Agent 更容易找到该用的记忆：

- **全文检索**（基于 SQLite FTS5）：按关键词精确匹配。
- **语义检索**（本地模型推理，默认 `all-MiniLM-L6-v2`，不调用外部 API）：按意思找，即使措辞不同也能命中。
- **关系图谱扩展**：通过"相关于 / 衍生自 / 引用 / 属于一部分"等记忆之间的关系，把相关上下文顺着连线一起召回。

另外，当一条新记忆明确取代了旧记忆时（比如新决策覆盖旧决策），旧记忆会从搜索结果里**自动隐去**，新记忆顶上来，避免 Agent 读到过时指令。

### 6. Context Pack：给 Agent 的紧凑上下文包

Agent 做长期任务前最需要的不只是"搜索结果"，而是**按用途分组、有篇幅限制、带来源说明**的上下文包。

`memory_context_pack` 会：

- 按类型分组（偏好 → 约束 → 决策 → 任务 → 流程 → 项目事实 → 关系 → 概念 → 事件 → 原始笔记）。
- 控制总字数和条目数，避免上下文撑爆。
- 在每条记忆下附上简短的来源说明（如"已被 mem-xxx 取代"），让 Agent 知道哪些是最新结论。
- 同时输出结构化 JSON 和 Markdown，可直接作为系统提示或任务上下文注入。

### 7. 自动整理：记忆越用越干净，而不是越用越乱

记忆库会自然膨胀。KeyMemory 借鉴人脑睡眠周期，把整理分成五个阶段自动完成：

- **去重检查**：去重近期记忆，合并重复项。
- **关联补全**：分析主题、优化标签，在相关记忆之间建立关联。
- **长期整理**：评分升级（把重要的短期记忆提升为长期）、智能合并、归档低价值记忆。
- **语义合并**：在语义层面合并意思相近的记忆。
- **项目聚类**：发现共享同一批实体的项目，给出项目树整理建议（比如"这两个项目其实该归到同一个父项目下"）。

每次整理都会：

- 用"取代"关系保留新旧记忆的来龙去脉，可解释、可一键回滚。
- 生成结构化报告，支持按报告 ID 整体撤销。
- 可通过定时任务自动运行（默认每天一次）。

**结果是：记忆库会自己保持健康，而不是越用越像垃圾堆。**

### 8. Loop Harness：长期任务的"断点续传 + 失控熔断"

跑自动化 Agent 任务时，进程崩溃、超时、多个 worker 同时跑是常态。KeyMemory 给长期任务提供完整的"断点续传 + 防互相踩 + 失控自动熔断"能力：

- **任务状态全部入库**：当前目标、所属项目、运行到哪一步、谁在跑，都持久化保存，进程重启不丢。
- **断点带版本号**：每存一个断点版本号自动加一；同一个断点重复保存会被自动去重；存入前先脱敏敏感信息。
- **多 worker 不互相覆盖**：同一时间只有一个 worker 能改某个任务，"锁"过期后自动释放，不会死锁，也不会互相覆盖进度。
- **崩溃后接着跑**：任务产生的每一条事件都按顺序记录，崩溃重启后从上次的位置继续读，不丢不重。
- **统一的结果格式**：成功、警告、错误用同一套结构返回，错误信息里直接告诉你"能不能重试""该用哪个版本号重试"，Agent 不用靠解析自然语言去猜。
- **防止任务失控**：单次写入的内容有上限，跑飞的 worker 不会把数据库撑爆。
- **Token 与成本预算**：每个 run 可设 `tokenBudget` 和 `costUsdBudget`，每次 checkpoint/finish 上报 `tokenUsage` 累加；接近或超出预算时自动告警。
- **Circuit Breaker 自动熔断**：连续相同错误 3 次（停滞）、连续失败 5 次（无进展）、token 用尽、checkpoint 次数达到 10，任一命中即把 observation 降级为 `warning` 并附升级建议，但不会强制终止 run——由调用方决定升级、重试或 `memory_loop_finish`。
- **Loop Readiness 自检**：`pnpm loop:audit` 按 22 项硬编码评分给出 L0/L1/L2/L3 等级，低于 L1（38 分）不应把 autonomous loop 投入生产。

四个工具覆盖一个长期任务的完整生命周期：启动任务 → 读取上下文与进度 → 保存断点 → 结束任务。

### 9. 一键迁移旧记忆

已经在用 `MEMORY.md`、Codex、Claude Code、Hermes、OpenClaw、Cursor、Gemini、Mem0/OpenMemory？KeyMemory 能把它们一次性搬过来：

```bash
keymemory onboard            # 先预览，不写入
keymemory onboard --yes --run-dream --agent-target all   # 确认后真迁移（--run-dream 迁移后自动运行整理）
```

- 支持格式：`.md` / `.markdown` / `.json` / `.jsonl` / `.ndjson` / `.txt`。
- 自动从 `workspace`、`cwd`、`repoPath`、文件相对目录等线索推断项目路径，不用手动归类。
- **写入前自动创建完整备份**；恢复前也会先备份现库，迁移失败可一键回滚。

### 10. 备份与恢复

- 一份备份文件包含记忆、记忆关系、以及长期任务的运行记录和断点，并带校验和防止文件损坏。
- `--dry-run` 可以先验证备份能不能恢复，不写库。
- `--replace` 恢复时会先备份当前库，再整体替换并重建索引，确保恢复过程不出错。

---

## 快速开始

### 环境要求

- Node.js 20+
- pnpm
- Git

### 安装

```bash
git clone https://github.com/digibeing1001/KeyMemory.git
cd KeyMemory
pnpm setup
keymemory doctor
```

### 首次使用：迁移旧记忆

先预览（不写入任何记忆）：

```bash
keymemory onboard
```

确认无误后真迁移：

```bash
keymemory onboard --yes --run-dream --agent-target all
```

它会完成：发现旧记忆来源 → 估算迁移结果 → 写入前备份 → 导入并规范化 → 推断项目路径与类型 → 可选运行自动整理 → 输出 Agent 接入配置片段。

### 启动 Web UI

```bash
keymemory dashboard
```

浏览器打开 `http://127.0.0.1:3210`，包含记忆编辑器、项目树、搜索、标签云、整理报告与调度、迁移导入、项目整理建议、回收站。

### 接入 Agent

生成配置片段：

```bash
keymemory agent-config all
keymemory agent-config claude-code --mode cli      # Claude Code/Codex 推荐 CLI 模式
keymemory agent-config claude-desktop               # Claude Desktop 用 MCP 模式
keymemory agent-config openclaw --format json
```

支持目标：`generic` / `claude-desktop` / `claude-code` / `hermes` / `openclaw` / `codex`。

接入后，建议让 Agent 在长期任务前调用：

- `memory_context_pack` — 读取项目上下文包
- `memory_auto_remember` — 在重要偏好、决策、约束、任务变化后自动记忆
- `memory_loop_start` — 为长期任务建立可恢复的运行记录、断点与上下文

---

## 主要 MCP 工具

| 工具 | 用途 |
| --- | --- |
| `memory_create` | 创建记忆 |
| `memory_search` | 按项目、子项目、类型、是否包含被替代记忆搜索 |
| `memory_context_pack` | 生成分组上下文包 |
| `memory_auto_remember` | 自检评估并保存重要对话内容 |
| `memory_loop_start` | 启动一个长期任务（重复调用同一任务会返回原任务，不会重复创建） |
| `memory_loop_context` | 读取当前断点、新增事件和预算化的记忆上下文 |
| `memory_loop_checkpoint` | 安全保存断点（带版本号和锁，多人/多 worker 不会互相覆盖） |
| `memory_loop_finish` | 结束任务，写入最终断点和事件记录 |
| `memory_migration_discover` | 发现旧记忆来源 |
| `memory_migration_import` | 导入并重组旧记忆 |
| `memory_backup_create` | 迁移或整理前创建备份 |
| `memory_backup_inspect` | 检查备份结构与校验和 |
| `memory_backup_restore_dry_run` | 验证备份是否可恢复 |
| `memory_relate` | 创建记忆之间的关系（相关、取代、衍生、引用等） |
| `memory_related` | 查看相关记忆 |
| `memory_project_suggestions` | 查看自动整理生成的项目整理建议 |
| `memory_project_suggestion_accept` | 接受项目整理建议 |
| `memory_project_suggestion_reject` | 拒绝项目整理建议 |
| `memory_secret_set` / `keymemory_secret_set` | 加密保存工具 API key |
| `memory_secret_get` / `keymemory_secret_get` | 工具需要时解密读取一条凭据 |
| `memory_secret_list` / `keymemory_secret_list` | 列出凭据元数据（不返回明文） |
| `memory_secret_delete` / `keymemory_secret_delete` | 删除一条工具凭据 |

---

## 常用命令

```bash
keymemory doctor                                          # 环境自检
keymemory dashboard                                       # 启动 Web UI
keymemory onboard                                         # 迁移旧记忆
keymemory context "release checklist" --project "KeyMemory/Release"
keymemory search "user preference" --kind preference
keymemory relate <sourceId> <targetId> --type supersedes
keymemory related <sourceId> --type supersedes
keymemory backup-create ./keymemory-backup.json
keymemory scheduler                                       # 查看或修改整理调度
keymemory dream                                           # 手动运行一次自动整理
keymemory update                                          # 更新 KeyMemory
```

Loop 工程自检：

```bash
node scripts/loop-readiness-audit.mjs                     # 22 项评分，输出 L0/L1/L2/L3 等级
```

迁移相关：

```bash
keymemory migrate-discover                                # 发现本机旧记忆
keymemory migrate <file-or-directory> --dry-run           # 预览单个来源
keymemory migrate <file-or-directory> --source codex --run-dream
keymemory migrate-auto --run-dream                        # 导入所有自动发现的来源
```

备份与恢复：

```bash
keymemory backup-create ./keymemory-backup.json
keymemory backup-inspect ./keymemory-backup.json
keymemory backup-restore ./keymemory-backup.json --dry-run
keymemory backup-restore ./keymemory-backup.json --replace
```

整理调度：

```bash
keymemory scheduler
keymemory scheduler --cron "15 4 * * *"
keymemory scheduler --disable
keymemory scheduler --enable
```

---

## 项目记忆写法

每条记忆都属于一个项目，项目可以嵌套。

显式指定：

```text
[[KeyMemory/Release/Migration]]
```

自然语言提示：

```text
项目路径: KeyMemory/Release/Migration
```

项目检索默认包含子项目。Agent 在 `KeyMemory/Release` 下工作时，能读到 `KeyMemory/Release/Migration` 的相关记忆。

---

## 发布质量

发布闸门：

```bash
pnpm release:check
```

验证项：TypeScript 类型检查、生产构建、doctor 冒烟、长期记忆评测、性能预算、fresh database smoke、stdio MCP smoke、Loop 幂等/并发/恢复/脱敏/REST 与 MCP 契约 smoke、Loop circuit breaker（stagnation/no-progress/token-budget）与 success 重置计数 smoke、launcher smoke、迁移/备份/关系/调度/认证/项目整理覆盖。

开发与发布检查：

```bash
pnpm typecheck
pnpm build
pnpm smoke
pnpm smoke:mcp
pnpm smoke:loop
pnpm smoke:launchers
pnpm eval:memory
pnpm perf:memory
pnpm release:check
```

---

## 平台支持

Windows、Linux、macOS、Windows WSL。

---

## 文档

- [迁移指南](MIGRATION_GUIDE.md)
- [Agent 配置](docs/agent-configuration.md)
- [Agent Context Pack](docs/agent-context-pack.md)
- [Loop Harness 接入](docs/loop-harness.md)
- [Loop Patterns 配方](docs/loop-patterns.md)
- [备份与恢复](docs/backup-and-recovery.md)
- [记忆关系](docs/memory-relations.md)
- [隐私与安全](docs/privacy-and-safety.md)
- [性能预算](docs/performance.md)
- [项目命名规范](docs/project-naming-convention.md)
- [发布就绪检查](docs/release-readiness.md)
- [产品发布审计](docs/product-release-audit.md)

---

## License

MIT
