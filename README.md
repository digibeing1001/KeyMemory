# KeyMemory

> 人类Agent与记忆在同一项目中

KeyMemory 是一个本地优先的 Agent 记忆插件和 MCP 服务。它把具体项目、任务和事件整理成一封封持续回复的工作邮件，让人类和 Agent 在同一个主题里看见背景、进展、决定、问题和下一步；同时保留独立的记忆库，用来保存可以跨事情复用的偏好、规则、事实和经验。

记忆邮箱采用大家熟悉的电子邮箱形态，但不连接 Gmail 或 Outlook，也不会读取任何真实邮件。

![KeyMemory 记忆邮箱](docs/assets/keymemory-mailbox.png)

## 为什么用邮箱承载项目上下文

传统的“项目文件夹”擅长存放文件，却不擅长说明一件事情是怎样一步步发展到今天的。目录名也常常只有“飞书”“前端”“测试”几个字，既不像一项工作，也无法告诉 Agent 应该从哪里接力。

邮箱是大多数人已经熟悉的工作方式：

- 一项具体工作对应一个清楚的邮件主题。
- 新进展继续回复原邮件，不反复建立相似主题。
- 人类可以补充背景、纠正信息、提出问题或确认决定。
- Agent 在执行过程中写回进度、结果、阻碍和下一步。
- “记忆秘书”会从零散记忆中识别具体工作，归入已有主题或建立清楚的新主题；之后去重检查，只在确有新变化时补充摘要邮件。
- 人类和 Agent 读到的是同一份书面上下文，接力不依赖某个聊天窗口。

KeyMemory 不会主动唤醒 Agent。邮件只会留在收件箱中，等 Agent 下一次被调用时主动读取。未调用邮箱能力时，记忆秘书也可以按宿主约定的时间整理，但不会启动任何 Agent。

## 产品结构

### 记忆邮箱：具体工作的完整经过

Web UI 默认进入记忆邮箱，交互结构与常见邮箱一致：写邮件、收件箱、星标、延后、已发送、归档、所有邮件和垃圾箱。

每个邮件主题只代表一个明确的项目、任务或事件。例如：

- 好标题：`飞书文档同步还需要解决权限问题`
- 好标题：`KeyMemory 记忆邮箱进入上线前验收`
- 不合格标题：`飞书`
- 不合格标题：`项目`

邮件正文必须使用自然、通俗、适合人阅读的书面语言。代码、日志、JSON、报错堆栈、硬件输出和内部技术细节会作为折叠附件呈现，不能挤占正文。

### 记忆库：可以跨事情复用的原子信息

偏好、约束、人物、工具、事实、流程和经验仍然作为独立记忆保存。具体项目进展不再依靠一级一级的文件夹归集，而是通过邮件主题串联。

同一条记忆可以同时支持多个邮件主题，系统只建立引用，不复制内容。例如“发布前必须完成回归测试”既可以关联产品发布邮件，也可以关联客户端升级邮件。

### 记忆秘书：整理信息，不代替 Agent

记忆秘书负责：

- 从尚未归集的记忆中识别置信度足够高的具体工作，优先归入已有主题，必要时建立新主题；
- 检查邮件主题关联的记忆是否发生变化；
- 跳过已经写进邮件的重复内容；
- 把新变化整理成人类能直接读懂的工作邮件；
- 把技术证据放进折叠附件；
- 将摘要回复到原主题。

记忆秘书不执行项目任务，也没有唤醒 Agent 的能力。

## Agent 必须遵守的邮箱协议

KeyMemory 会把下面的规则写入 MCP 工具说明、自动生成的 Agent 规则包、接入提示词和 Context Pack。新接入的 Agent 不需要依赖人工口头解释。

1. 开始或恢复一个具体项目、任务、事件时，先调用 `memory_inbox_list` 查找相关主题。
2. 找到主题后，调用 `memory_thread_context` 读取当前情况、最近回复、未完成事项和关联记忆，再制定方案。
3. 只有确认不存在相关主题，而且事情明确需要持续跟进时，才调用 `memory_thread_create`。
4. 同一件事情只能有一个主题；后续变化调用 `memory_thread_reply` 写回原邮件。
5. 回复应说明有意义的进展、结果、阻碍、决定、问题或下一步，不能只写“已完成”“处理中”。
6. 标题与正文使用自然的书面语言，不使用 AI 模板话，不把代码、日志或结构化数据直接塞进正文。
7. 通用偏好、规则、事实和经验继续写入原子记忆；需要成为项目依据时，用 `memory_thread_link_memory` 关联邮件。
8. `memory_mailbox_sync` 只让记忆秘书检查变化，不会唤醒其他 Agent。
9. 严格遵守 `agent_space`，不得把其他 Agent 的私有记忆附加到无权访问的主题。

完整协议见 [记忆邮箱与 Agent 使用协议](docs/mailbox.md)。

事实变化不会破坏历史：每条记忆都有 `validFrom / validTo` 有效期。`memory_supersede` 会在同一时刻启用新事实、关闭旧事实并保留取代原因；普通查询只看当前事实，`asOf` 可回看任意历史时点，`includeExpired + includeSuperseded` 可做完整审计。需要排查排序时，`memory_search(explain=true)` 会返回全文/语义 RRF 与质量加权明细。

### 6. Context Pack：给 Agent 的紧凑上下文包

Agent 做长期任务前最需要的不只是"搜索结果"，而是**按用途分组、有篇幅限制、带来源说明**的上下文包。

`memory_context_pack` 会：

- 按类型分组（偏好 → 约束 → 决策 → 任务 → 流程 → 项目事实 → 关系 → 概念 → 事件 → 原始笔记）。
- 控制总字数和条目数，避免上下文撑爆。
- 在每条记忆下附上简短的来源说明（如"已被 mem-xxx 取代"），让 Agent 知道哪些是最新结论。
- 同时输出结构化 JSON 和 Markdown，可直接作为系统提示或任务上下文注入。

### 7. 梦境整理：记忆越用越干净，而不是越用越乱

记忆库会自然膨胀。KeyMemory 借鉴人脑睡眠周期，把整理分成五个阶段自动完成：

- **浅睡阶段**：去重近期记忆，合并重复项。
- **REM 阶段**（快速眼动期，即做梦期）：分析主题、优化标签，在相关记忆之间建立关联。
- **深睡阶段**：评分升级（把重要的短期记忆提升为长期）、智能合并、归档低价值记忆。
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
keymemory onboard --yes --run-dream --agent-target all   # 确认后真迁移
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

### 启动界面

```bash
keymemory dashboard
```

浏览器会打开 `http://127.0.0.1:3210`。默认首页就是记忆邮箱；记忆库、最近工作集、Agent 接入、关系图、自动整理、迁移和回收站位于左侧导航。

### 接入 Agent

在 Web UI 打开“Agent 接入”，选择自动连接、命令连接或规则包连接。系统会保留宿主已有配置和个人规则，并在修改前创建备份。

也可以生成配置：

```bash
keymemory agent-config all
keymemory agent-config codex --mode skill
keymemory agent-config openclaw --format json
node install-default-memory.js --all
```

接入完成后必须验证三件事：

1. 配置检测：页面能识别宿主配置。
2. 读取验证：Agent 能调用 `keymemory_connection_status` 和 `memory_inbox_list`。
3. 写入验证：Agent 能在一封真实工作邮件中回复，并重新读回。

### 迁移旧记忆

先预览，不写入：

```bash
keymemory onboard
```

确认后执行：

```bash
keymemory onboard --yes --run-dream --agent-target all
```

支持 Markdown、JSON、JSONL、NDJSON 和文本文件。写入前自动创建备份。旧项目文件夹不会被机械转换成邮件；其中的记忆会回到公共记忆池，后续只在出现真实项目、任务或事件时建立合适的邮件主题。

## 邮箱 MCP 工具

| 工具 | 用途 |
| --- | --- |
| `memory_create` | 创建记忆 |
| `memory_search` | 按项目、类型、有效时间搜索；可选返回排序解释 |
| `memory_context_pack` | 生成当前或 `asOf` 历史时点的分组上下文包 |
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
| `memory_supersede` | 可信地取代旧事实：关闭旧有效期、保留历史与原因 |
| `memory_project_suggestions` | 查看自动整理生成的项目整理建议 |
| `memory_project_suggestion_accept` | 接受项目整理建议 |
| `memory_project_suggestion_reject` | 拒绝项目整理建议 |
| `memory_secret_set` / `keymemory_secret_set` | 加密保存工具 API key |
| `memory_secret_get` / `keymemory_secret_get` | 工具需要时解密读取一条凭据 |
| `memory_secret_list` / `keymemory_secret_list` | 列出凭据元数据（不返回明文） |
| `memory_secret_delete` / `keymemory_secret_delete` | 删除一条工具凭据 |

CLI 也提供对应命令：

```bash
keymemory inbox
keymemory thread-read <thread-id>
keymemory thread-context <thread-id>
keymemory thread-reply <thread-id> --content "已完成权限验证，下一步安排灰度测试。"
keymemory mailbox-sync
```

Loop 工程自检：

```bash
node scripts/loop-readiness-audit.mjs                     # 22 项评分，输出 L0/L1/L2/L3 等级
```

迁移相关：

| 工具 | 用途 |
| --- | --- |
| `memory_create` / `memory_auto_remember` | 保存可复用的原子记忆 |
| `memory_search` / `memory_read` | 搜索和精读记忆 |
| `memory_context_pack` | 生成邮箱优先、记忆补充的上下文包 |
| `memory_loop_start` | 启动可恢复的长期任务 |
| `memory_loop_context` | 读取任务断点和新增事件 |
| `memory_loop_checkpoint` | 幂等保存带版本的断点 |
| `memory_loop_finish` | 结束任务并写入最终状态 |
| `memory_migration_discover` / `memory_migration_import` | 发现和导入旧记忆 |
| `memory_backup_create` / `memory_backup_restore_dry_run` | 创建备份和预演恢复 |
| `memory_relate` / `memory_related` | 建立和查看记忆关系 |
| `memory_supersede` | 用新事实取代旧事实并保留历史 |
| `memory_secret_set` / `memory_secret_get` | 加密保存和按需读取工具凭据 |

备份与恢复：

```bash
keymemory backup-create ./keymemory-backup.json
keymemory backup-inspect ./keymemory-backup.json
keymemory backup-restore ./keymemory-backup.json --dry-run
keymemory backup-restore ./keymemory-backup.json --replace
```

梦境调度：

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
pnpm smoke:mailbox
node scripts/verify.mjs
pnpm release:check
```

`node scripts/verify.mjs` 是推送前的基础验证；`pnpm release:check` 会进一步运行跨功能、性能、启动器和发布材料检查。

项目结构：

```text
packages/shared   共享类型
packages/server   SQLite、邮箱核心、MCP、REST、CLI、Agent 接入
packages/web      记忆邮箱与记忆管理界面
scripts           冒烟、评估、性能和发布检查
docs              用户、Agent、隐私、备份与架构文档
```

## 数据与隐私

- 默认数据库：`~/.keymemory/data.db`
- 邮箱、邮件、附件、记忆引用、已读记录和 Loop 断点都进入可校验备份。
- API key、token、私钥和带密码连接串不应写入普通记忆；请使用 `memory_secret_set`。
- 对外监听时必须配置 `KEYMEMORY_API_KEY`，并按需设置 `KEYMEMORY_ALLOWED_ORIGINS`。
- 每个读写操作都遵守 `agent_space`；私有内容不会因为邮件引用而越权共享。

- [迁移指南](MIGRATION_GUIDE.md)
- [Agent 配置](docs/agent-configuration.md)
- [Agent Context Pack](docs/agent-context-pack.md)
- [Loop Harness 接入](docs/loop-harness.md)
- [Loop Patterns 配方](docs/loop-patterns.md)
- [Loop Harness 研究与设计依据](docs/loop-harness-research.md)
- [备份与恢复](docs/backup-and-recovery.md)
- [记忆关系](docs/memory-relations.md)
- [时间记忆、可信更新与可解释检索](docs/temporal-memory.md)
- [隐私与安全](docs/privacy-and-safety.md)
- [性能预算](docs/performance.md)
- [项目命名规范](docs/project-naming-convention.md)
- [发布就绪检查](docs/release-readiness.md)
- [产品发布审计](docs/product-release-audit.md)

### 记忆邮箱版本

- 用记忆邮箱替代面向用户的项目文件夹和项目自动归集入口。
- 将旧项目中的记忆安全打散回公共记忆池，不把旧目录名直接转成邮件标题。
- 建立“一事一主题”的项目、任务、事件线程，以及人类、Agent、记忆秘书三方回复机制。
- 同一条原子记忆可以关联多个邮件主题。
- Agent 默认先读收件箱和线程上下文，再补充检索通用记忆。
- 邮件正文强制面向人类阅读，代码和日志自动转为折叠附件。
- Web UI 默认进入熟悉的邮箱界面，支持搜索、星标、归档、垃圾箱、回复和秘书整理。
- 新增邮箱专项冒烟测试，并把邮箱能力纳入发布检查与备份恢复。

## 许可证

见 [LICENSE](LICENSE)。
