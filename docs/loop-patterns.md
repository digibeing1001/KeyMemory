# KeyMemory Loop Patterns

本文件把 7 个常用 loop pattern 落成可直接复制的 KeyMemory 配方。每个 pattern 的 cadence、token 预算、early-exit 与字段均为明确数值，不允许抽象描述。

## 校准基准

| 数据 | 说明 |
| --- | --- |
| 单次 attempt token 成本（noop/report/action） | 每个 pattern 的 noop/report/action 三档 token 成本 |
| 每日 token 上限 | `suggested_daily_cap`，单 run 建议 tokenBudget 不超过此值 |
| 是否允许 early-exit | `early_exit_required`，true 表示无工作即 noop 退出 |
| L1/L2/L3 attempt 分布 | `realisticMix` 比例表 |
| Circuit breaker 阈值 | stagnation=3 / no-progress=5 / max-iterations=10 |

## realisticMix（attempt 分布，精确比例）

| Level | early_exit | noop | report | action |
| --- | --- | --- | --- | --- |
| L1 | true | 0.90 | 0.10 | 0.00 |
| L1 | false | 0.60 | 0.40 | 0.00 |
| L2 | true | 0.85 | 0.10 | 0.05 |
| L2 | false | 0.50 | 0.30 | 0.20 |
| L3 | (忽略) | 0.40 | 0.35 | 0.25 |

> L3 不区分 early_exit：成熟 loop 的 action 占比固定 0.25。

## 7 个 Pattern 配方

### 1. pr-babysitter

| 字段 | 值 |
| --- | --- |
| 用途 | 持续盯一个 PR 直到合并或关闭 |
| cadence | 每 15–30 分钟一次 checkpoint |
| early_exit | true（PR 已合并/关闭即 noop 退出） |
| noop | 3 000 |
| report | 80 000 |
| action | 250 000 |
| suggested_daily_cap | 2 000 000 |
| 建议 tokenBudget | 2 000 000（= daily_cap，单 run 不超过单日上限） |
| 建议 maxIterations | 10（默认）；盯单 PR 很少需要超过 10 次 attempt |
| attemptOutcome 约定 | PR 无变化→`noop`；有更新需总结→`success`；检查失败→`failure`+error |

### 2. daily-triage

| 字段 | 值 |
| --- | --- |
| 用途 | 每日扫描 issue/pr 队列做分流 |
| cadence | 每日 1 次，单次 run 内 3–5 个 checkpoint |
| early_exit | false（必须扫完全量） |
| noop | 5 000 |
| report | 50 000 |
| action | 200 000 |
| suggested_daily_cap | 100 000 |
| 建议 tokenBudget | 100 000 |
| 建议 maxIterations | 10（默认） |
| attemptOutcome 约定 | 无新项→`noop`；完成分流→`success`；工具调用失败→`failure`+error |

### 3. ci-sweeper

| 字段 | 值 |
| --- | --- |
| 用途 | 扫描最近失败的 CI run 并尝试修复 |
| cadence | 每 1–2 小时一次 |
| early_exit | true（无失败 CI 即 noop 退出） |
| noop | 5 000 |
| report | 50 000 |
| action | 200 000 |
| suggested_daily_cap | 1 000 000 |
| 建议 tokenBudget | 1 000 000 |
| 建议 maxIterations | 10（默认） |
| attemptOutcome 约定 | 无失败→`noop`；修复提交→`success`；修复失败→`failure`+error |

### 4. post-merge-cleanup

| 字段 | 值 |
| --- | --- |
| 用途 | 合并后清理分支、更新 changelog、触发下游 |
| cadence | 每次合并触发，单 run 2–4 个 checkpoint |
| early_exit | false（必须完成全流程） |
| noop | 5 000 |
| report | 40 000 |
| action | 150 000 |
| suggested_daily_cap | 200 000 |
| 建议 tokenBudget | 200 000 |
| 建议 maxIterations | 10（默认） |
| attemptOutcome 约定 | 每步完成→`success`；步骤失败→`failure`+error |

### 5. dependency-sweeper

| 字段 | 值 |
| --- | --- |
| 用途 | 扫描依赖更新并验证兼容性 |
| cadence | 每日或每周一次 |
| early_exit | true（无可用更新即 noop 退出） |
| noop | 5 000 |
| report | 60 000 |
| action | 300 000 |
| suggested_daily_cap | 500 000 |
| 建议 tokenBudget | 500 000 |
| 建议 maxIterations | 10（默认） |
| attemptOutcome 约定 | 无更新→`noop`；验证通过→`success`；兼容性失败→`failure`+error |

### 6. changelog-drafter

| 字段 | 值 |
| --- | --- |
| 用途 | 从近期合并 PR 草拟 changelog |
| cadence | 每次发布前触发 |
| early_exit | false（必须覆盖全量 PR） |
| noop | 5 000 |
| report | 35 000 |
| action | 80 000 |
| suggested_daily_cap | 100 000 |
| 建议 tokenBudget | 100 000 |
| 建议 maxIterations | 10（默认） |
| attemptOutcome 约定 | 草拟完成→`success`；生成失败→`failure`+error |

### 7. issue-triage

| 字段 | 值 |
| --- | --- |
| 用途 | 对新 issue 做标签/分配/回复 |
| cadence | 每 30–60 分钟一次 |
| early_exit | false（必须处理全量新 issue） |
| noop | 3 000 |
| report | 30 000 |
| action | 60 000 |
| suggested_daily_cap | 80 000 |
| 建议 tokenBudget | 80 000 |
| 建议 maxIterations | 10（默认） |
| attemptOutcome 约定 | 无新 issue→`noop`；处理完成→`success`；分类失败→`failure`+error |

## 落地到 KeyMemory 的字段映射

启动一个 pattern run 时，`memory_loop_start` 传：

```json
{
  "objective": "pr-babysitter: monitor PR #1234 until merged",
  "project": "Product/Payments",
  "agentId": "hermes:pr-babysitter",
  "idempotencyKey": "pr-babysitter:pr-1234:2026-07-03",
  "leaseOwner": "gateway-a:worker-3",
  "leaseTtlSeconds": 120,
  "tokenBudget": 2000000,
  "costUsdBudget": 5.0,
  "maxItems": 8,
  "maxChars": 4000
}
```

每次 `memory_loop_checkpoint` 必须传：

| 字段 | 说明 |
| --- | --- |
| `tokenUsage` | 本次 attempt 实际消耗的 token 数（累加到 `run.tokenUsed`） |
| `attemptOutcome` | `success` / `failure` / `noop`（决定 `consecutiveFailures` 重置/递增/不变） |
| `error` | 当 `attemptOutcome=failure` 时必传，用于生成 `errorSignature` 做 stagnation 检测 |

`memory_loop_context` 返回的 `data.circuitBreaker` 始终包含当前快照，调用方应在每次恢复时检查 `triggered` 字段。

## Circuit breaker 触发条件（精确阈值）

| 条件 | 阈值 | 比较运算 | 来源 |
| --- | --- | --- | --- |
| stagnation | 连续相同 errorSignature ≥ 3 | `>=` | `stagnationThreshold` |
| no-progress | 连续 failure ≥ 5 | `>=` | `noProgressThreshold` |
| token-budget | `tokenUsed >= tokenBudget` | `>=` | `CircuitBreakerConfig.tokenBudget` |
| max-iterations | `checkpointVersion >= 10` | `>=` | `maxIterations` |

触发顺序：stagnation → no-progress → token-budget → max-iterations（前一个命中即返回，不再检查后续）。

触发后行为：observation `status` 降级为 `warning`，`summary` 追加 reason，`nextActions` 追加升级建议，`data.circuitBreaker.triggered=true`。run 不会被强制终止——由调用方决定升级、重试还是 `memory_loop_finish`。
