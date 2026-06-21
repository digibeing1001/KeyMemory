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

`smoke:loop` 覆盖 MCP 工具注册与执行、REST 生命周期、幂等重放、幂等冲突、版本冲突、租约冲突、事件游标、敏感状态脱敏、memory 引用和终态保护。
