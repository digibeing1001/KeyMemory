# 时间记忆、可信更新与可解释检索

KeyMemory 把“什么时候写入”与“什么时候为真”分开处理：

- `createdAt` / `updatedAt` 是系统记录时间，用于审计版本和写入历史。
- `validFrom` / `validTo` 是事实有效时间；`validFrom` 包含，`validTo` 不包含。
- 没有 `validTo` 表示事实当前仍有效。旧数据缺少 `validFrom` 时回退到 `createdAt`。

这不是删除历史。新事实取代旧事实时，旧事实仍保留，只是结束有效期并建立 `supersedes` 关系。Agent 默认只看到当前有效事实；审计或历史问题可以显式回看。

## 为什么要这样做

长期记忆系统最危险的失败不是“找不到”，而是把已经过期的旧事实和当前事实一起交给 Agent。以下研究和开源实践共同指向这个问题：

- [LongMemEval](https://arxiv.org/abs/2410.10813) 把时间推理、知识更新和拒答列为五项核心能力，并报告时间感知查询扩展可显著改善时间问题的召回。
- [MemoryAgentBench](https://arxiv.org/abs/2507.05257) 把准确检索、测试时学习、长程理解和选择性遗忘作为四项独立能力，说明只测 CRUD 或静态召回是不够的。
- [Graphiti](https://github.com/getzep/graphiti) 为事实关系维护有效期窗口和 episode provenance，避免动态事实被静态图覆盖。
- [Mem0](https://arxiv.org/abs/2504.19413) 表明动态抽取、整合、检索和图关系需要同时考虑质量与运行开销。
- [A-MEM](https://arxiv.org/abs/2502.12110) 强调新记忆应推动旧记忆的结构与上下文演化，而不是只追加文本。
- [LangGraph memory](https://docs.langchain.com/oss/python/concepts/memory) 区分线程内短期状态和跨会话长期记忆，并强调 namespace、写入时机和后台整理的取舍。

## 写入有效期

MCP：

```json
{
  "name": "memory_create",
  "arguments": {
    "title": "当前发布窗口",
    "content": "Release window is Friday 16:00 UTC.",
    "projectPath": "KeyMemory/Release",
    "validFrom": "2026-07-01T00:00:00Z",
    "confidence": 0.9
  }
}
```

CLI：

```bash
keymemory create \
  --title "当前发布窗口" \
  --content "Release window is Friday 16:00 UTC. [[KeyMemory/Release]]" \
  --layer long \
  --valid-from "2026-07-01T00:00:00Z" \
  --confidence 0.9
```

时间戳会规范化为 UTC ISO 8601。`validTo` 必须晚于 `validFrom`；非法窗口直接拒绝写入。

## 可信地取代旧事实

先创建新事实，再使用 `memory_supersede`。工具会：

1. 通过当前 adapter 验证新旧记忆都在 Agent 可见的 `agent_space` 中。
2. 把新事实的 `validFrom` 对齐到生效时间。
3. 把旧事实的 `validTo` 关闭到同一时刻。
4. 建立 `new -> old` 的 `supersedes` 关系并保留原因。
5. 保留两个版本，支持当前检索、历史检索和审计检索。

```json
{
  "name": "memory_supersede",
  "arguments": {
    "sourceId": "<new-memory-id>",
    "targetId": "<old-memory-id>",
    "effectiveAt": "2026-07-10T09:00:00Z",
    "reason": "User corrected the release window"
  }
}
```

CLI 等价命令：

```bash
keymemory supersede <new-id> <old-id> \
  --effective-at "2026-07-10T09:00:00Z" \
  --reason "User corrected the release window"
```

普通 `memory_relate(..., relationType="supersedes")` 仍可用于已有关系迁移；需要完整时间闭环时应使用 `memory_supersede`。

## 当前、历史与审计检索

默认检索使用当前时间，只返回有效事实并隐藏被取代项。

```json
{ "name": "memory_search", "arguments": { "query": "release window" } }
```

历史回看：

```json
{
  "name": "memory_search",
  "arguments": {
    "query": "release window",
    "asOf": "2026-07-05T00:00:00Z"
  }
}
```

完整审计需要同时打开两个逃生开关：

```json
{
  "name": "memory_search",
  "arguments": {
    "query": "release window",
    "includeExpired": true,
    "includeSuperseded": true
  }
}
```

`memory_context_pack` 和 `memory_list` 同样支持 `asOf` / `includeExpired`；Context Pack 还支持 `includeSuperseded`。

## 置信度不是装饰字段

- 显式用户/人工写入默认 `confidence=1.0`。
- `memory_auto_remember` 根据 SelfCheck 准入分校准置信度，并封顶为 `0.95`，避免 Agent 自己推断出的内容与用户确认事实拥有相同权重。
- 导入或程序写入可显式提供 `confidence`；超出 `0..1` 的值会被拒绝。
- 检索仍允许 `minConfidence` 过滤，混合排名会给更高置信度小幅加权，但不会让置信度覆盖语义相关性。

## 可解释混合检索

`memory_search(explain=true)` 为每条混合结果增加 `scoreBreakdown`：

- 全文排名与 RRF 贡献
- 语义排名与 RRF 贡献
- 命中次数加权
- 置信度加权
- 长期/实体层加权
- 最终分数

解释默认关闭，避免普通 Agent 调用增加不必要的上下文体积。

## 当前边界

- 这是“有效时间 + 系统写入时间”的轻量实现，还不是完整的双时间数据库查询语言。
- 系统不会仅凭关键词自动断言两条记忆矛盾；高影响更新需要显式 `memory_supersede` 或经过 Dream/人工复核的关系判断。
- `includeExpired` 和 `includeSuperseded` 是审计能力，不应作为普通 Agent 的默认选项。
- 自动置信度是准入证据强度，不是统计意义上的事实正确概率。
