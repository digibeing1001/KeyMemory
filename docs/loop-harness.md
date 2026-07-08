# KeyMemory Loop Harness

## 定位

Loop 工程不应只把 KeyMemory 当成搜索接口。一次长期运行需要同时具备：

- 可恢复的权威工作状态；
- 有项目边界和预算的长期记忆上下文；
- 可增量消费的运行事件；
- 多 worker 下不会相互覆盖的并发协议；
- 超时、重试和进程崩溃后仍可继续的稳定游标。

KeyMemory 为此提供四个 MCP 工具和对应 REST API。它不负责替代 Loop 自身的规划器或工具执行器。

## 数据模型

| 模型 | 作用 | 写入规则 |
| --- | --- | --- |
| `loop_runs` | 目标、项目、状态、租约、trace 和当前游标 | `memory_loop_start` 创建，checkpoint/finish 推进 |
| `loop_checkpoints` | 可恢复的权威工作状态 | 版本单调递增，幂等键去重，写前脱敏 |
| `loop_events` | 追加式可观测事件 | 与 checkpoint 在同一事务提交 |
| `memories` | 经验证、可跨运行复用的长期知识 | 继续使用 `memory_create` 或 `memory_auto_remember` |

Checkpoint 不会自动晋升为长期记忆。Loop 应先验证事实，再写入 `memories`，并把返回的 memory ID 放入 checkpoint 的 `memoryRefs`。这能阻止 agent 的临时推断直接污染长期记忆。

## MCP 生命周期

### 1. 启动

```json
{
  "name": "memory_loop_start",
  "arguments": {
    "objective": "完成支付模块发布并验证回滚",
    "project": "Product/Payments",
    "agentId": "hermes:release-agent",
    "idempotencyKey": "session-42:turn-7:start",
    "leaseOwner": "gateway-a:worker-3",
    "leaseTtlSeconds": 120,
    "maxItems": 12,
    "maxChars": 6000
  }
}
```

`project` 与 `projectId` 必须且只能提供一个，防止无边界或歧义检索造成跨项目上下文泄漏。同一幂等键和相同载荷会返回原 run；载荷不同则返回 `IDEMPOTENCY_CONFLICT`。

### 2. 恢复上下文

```json
{
  "name": "memory_loop_context",
  "arguments": {
    "runId": "<run-id>",
    "leaseOwner": "gateway-a:worker-3",
    "afterSequence": 8,
    "maxEvents": 50
  }
}
```

返回内容包括当前 run、最新 checkpoint、增量事件、Context Pack、内容指纹和新游标。检索查询会组合当前目标、phase、checkpoint 摘要和下一步，而不是只重复初始目标。

### 3. 保存断点

```json
{
  "name": "memory_loop_checkpoint",
  "arguments": {
    "runId": "<run-id>",
    "expectedVersion": 3,
    "idempotencyKey": "session-42:turn-7:checkpoint:verify",
    "leaseOwner": "gateway-a:worker-3",
    "phase": "verify",
    "summary": "构建完成，正在执行发布门禁",
    "state": { "build": "passed", "tests": "running" },
    "nextActions": ["运行 release:check", "验证回滚包"],
    "artifacts": ["dist/server.js"],
    "memoryRefs": ["<validated-memory-id>"]
  }
}
```

`expectedVersion` 必须取自上一个返回游标。版本落后时返回可重试的 `VERSION_CONFLICT`；调用方应重新读取 context、合并状态，再使用新版本重试。有效租约属于其他 worker 时返回 `LEASE_CONFLICT`。

### 4. 结束

```json
{
  "name": "memory_loop_finish",
  "arguments": {
    "runId": "<run-id>",
    "expectedVersion": 4,
    "idempotencyKey": "session-42:turn-7:finish",
    "leaseOwner": "gateway-a:worker-3",
    "status": "completed",
    "summary": "发布和回滚验证均通过",
    "artifacts": ["release-report.json"]
  }
}
```

终态包括 `completed`、`failed`、`cancelled`。终态之后不能再写 checkpoint，但允许只读审计。

## Observation Envelope

所有 Loop 工具返回同一内部协议：

```json
{
  "schemaVersion": "keymemory.loop-observation.v1",
  "status": "success",
  "summary": "Saved checkpoint 4 for loop run ...",
  "nextActions": ["Run release checks"],
  "artifacts": ["dist/server.js"],
  "data": {
    "run": {},
    "checkpoint": {},
    "events": [],
    "contextPack": {},
    "contextFingerprint": "sha256"
  },
  "cursor": { "checkpointVersion": 4, "eventSequence": 5 }
}
```

错误仍使用同一 envelope，并增加 `error.code`、`retryable`、`expectedVersion` 和 `actualVersion`。Loop 不需要解析自由文本来决定是否重试。

运行目标、摘要、state 和数组字段都有服务端载荷上限；超限返回 HTTP `413` / `LIMIT_EXCEEDED`，避免失控 worker 造成无界数据库增长。

## REST API

| Method | Path |
| --- | --- |
| `POST` | `/api/loop/runs` |
| `POST` | `/api/loop/runs/:runId/context` |
| `POST` | `/api/loop/runs/:runId/checkpoints` |
| `POST` | `/api/loop/runs/:runId/finish` |

非 loopback 部署继续受 `KEYMEMORY_API_KEY` 和现有 CORS 规则保护。

## Hermes 建议映射

- `agentId`: 稳定角色，如 `hermes:<profile>`。
- `leaseOwner`: 进程/worker/session 组合，重启后应变化。
- `idempotencyKey`: session、turn、phase 的确定性组合，重试时保持不变。
- `traceId`: 使用 KeyMemory 返回值关联 Hermes session trace。
- `memoryRefs`: 只引用已经通过 `memory_create` 或 `memory_auto_remember` 验证写入的记忆。
- phase 边界、外部副作用前、等待用户前、压缩上下文前必须 checkpoint。

SQLite WAL 适合同机并发读和单 writer，不应把数据库放在网络文件系统上。多主机部署应在 KeyMemory 服务层汇聚写入，而不是共享数据库文件。

Portable backup 默认包含 `loop_runs`、`loop_checkpoints` 和 `loop_events`，因此进行中的运行可以随记忆库一起灾备。Checkpoint 和 event 在写入前已经脱敏；`query_logs` 仍按现有隐私策略默认省略。

## 验证

```bash
pnpm typecheck
pnpm build
pnpm smoke:loop
pnpm release:check
```

`smoke:loop` 覆盖 MCP 工具注册与执行、REST 生命周期、幂等重放、幂等冲突、版本冲突、租约冲突、事件游标、敏感状态脱敏、memory 引用、终态保护、token 预算累加、circuit breaker（stagnation / no-progress / token-budget）与 success 重置计数。

## Circuit Breaker 与 Token 预算

KeyMemory 在 `loop_runs` 表上新增 6 列用于 loop 成本可观测性与熔断：

| 列 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `token_budget` | INTEGER | NULL | 单 run 累计 token 硬上限（可选，由 `memory_loop_start` 设置） |
| `token_used` | INTEGER | 0 | 累计已用 token（每次 checkpoint/finish 的 `tokenUsage` 累加） |
| `cost_usd_budget` | REAL | NULL | 美元硬上限（可选，仅审计观测，当前不作为熔断条件） |
| `cost_usd_used` | REAL | 0 | 累计已用美元 |
| `consecutive_failures` | INTEGER | 0 | 连续失败计数（success 重置 0，failure +1，noop 不变） |
| `last_error_signature` | TEXT | NULL | 最后一次 failure 的归一化错误签名 |

### Circuit breaker 阈值

| 条件 | 阈值 | 比较运算 | 触发优先级 |
| --- | --- | --- | --- |
| stagnation | 连续相同 `errorSignature` ≥ 3 | `>=` | 1（最高） |
| no-progress | `consecutiveFailures` ≥ 5 | `>=` | 2 |
| token-budget | `tokenUsed >= tokenBudget` | `>=` | 3 |
| max-iterations | `checkpointVersion >= 10` | `>=` | 4（最低） |

前一个命中即返回，不再检查后续。触发后 observation `status` 降级为 `warning`，但不强制终止 run——调用方决定升级、重试或 `memory_loop_finish`。

### errorSignature 归一化（7 步）

1. 取第一个非空行
2. ISO 时间戳 → `<ts>`
3. 十六进制地址（`0x...`）→ `<addr>`
4. 路径折叠为 basename（取最后一段）
5. 移除 `:line:col` 后缀
6. 任何剩余数字 → `#`
7. 多空格折叠为单空格，并 trim

> 注意：仅数字不同的错误会归一为相同签名。做 no-progress 测试时必须用结构不同的错误文本。

### Observation 中的 circuitBreaker 字段

`memory_loop_context` 和 `memory_loop_checkpoint` 返回的 `data.circuitBreaker` 始终包含：

```json
{
  "triggered": false,
  "reason": null,
  "nextActions": [],
  "consecutiveFailures": 0,
  "tokenUsed": 600,
  "tokenBudget": 1000,
  "checkpointVersion": 1,
  "maxIterations": 10
}
```

调用方应在每次恢复时检查 `triggered`，并在 `triggered=true` 时按 `nextActions` 升级或中止。

## Loop Readiness 准入等级

22 项评分与 L1/L2/L3 等级阈值。所有分值与阈值为硬编码，不允许调整。

### 等级阈值

| 等级 | 最低总分 | 附加硬性条件 |
| --- | --- | --- |
| L1 | 38 | `stateFile.present` |
| L2 | 58 | `triage.present` |
| L3 | 78 | `verifier.present` + `stateFile.present` + costReady + hasRealActivity |

costReady = `budgetDoc.present` + `runLog.present` + `loopMdBudget.present`（三者皆需 present）。
hasRealActivity = `loopActivity.present`。

### 22 项评分项（分值不可调整）

| # | 检查项 | 分值 |
| --- | --- | --- |
| 1 | base | 10 |
| 2 | stateFile | 18 |
| 3 | triage | 14 |
| 4 | loopConfig | 9 |
| 5 | agentsMd | 9 |
| 6 | skillsTwoPlus | 14 |
| 7 | skillsOne | 7 |
| 8 | verifier | 14 |
| 9 | safetyLoopMd | 4 |
| 10 | safetyDoc | 4 |
| 11 | github | 6 |
| 12 | githubWorkflows | 4 |
| 13 | mcp | 3 |
| 14 | worktree | 3 |
| 15 | registry | 2 |
| 16 | budgetDoc | 3 |
| 17 | runLog | 3 |
| 18 | loopMdBudget | 2 |
| 19 | budgetSkill | 2 |
| 20 | constraintsFile | 4 |
| 21 | constraintsSkill | 2 |
| 22 | loopActivity | 6 |

总分上限 = 136（`skillsOne` 与 `skillsTwoPlus` 互斥）。运行 `pnpm loop:audit` 可得到当前仓库的逐项得分与最终等级。

> KeyMemory 自身不强制要求达到某个等级才能使用 loop 工具。等级用于自检：低于 L1（38 分）的仓库不应把 autonomous loop 投入生产；低于 L2（58 分）不应启用 action 类 pattern；低于 L3（78 分）不应启用多 worker 并发 loop。

## Anti-patterns 检查清单

依据 `docs/anti-patterns.md`（10 条设计期反模式）与 `docs/loop-design-checklist.md`（5 条停止信号）。以下为逐条检查项，每条必须能用"是/否"回答。

### 设计期反模式（10 条）

1. **是否在 loop 内做不可逆外部副作用前没有 checkpoint？** 是→违规。
2. **是否用自由文本而非 observation envelope 传递状态？** 是→违规。
3. **是否让多个 worker 共享同一 leaseOwner？** 是→违规。
4. **是否在终态 run 上继续写 checkpoint？** 是→违规。
5. **是否把未经 `memory_create` 验证的推断直接放进 `memoryRefs`？** 是→违规。
6. **是否在 loop 内做无 tokenBudget 的长期运行？** 是→违规。
7. **是否忽略 circuit breaker warning 继续推进？** 是→违规。
8. **是否用同一个 idempotencyKey 传不同载荷？** 是→违规。
9. **是否让 checkpoint state 超过 256 KB 序列化上限？** 是→违规。
10. **是否在 loop 中依赖跨项目上下文泄漏？** 是→违规。

### 停止信号（5 条，命中任一即应中止 run）

1. circuit breaker `triggered=true` 且升级路径不可行。
2. 连续 3 次 checkpoint 的 `summary` 内容完全相同（语义停滞）。
3. `tokenUsed` 超过 `tokenBudget` 的 90% 且剩余工作量大。
4. `checkpointVersion` 达到 8（距 maxIterations=10 仅剩 2 次余量）。
5. lease 连续被其他 worker 抢占超过 3 次（并发冲突不可调和）。
