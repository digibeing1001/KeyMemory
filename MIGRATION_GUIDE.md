# KeyMemory 迁移指南

## 一键迁移（新）

KeyMemory 现在支持本机来源发现、文件/目录批量导入、重复导入跳过、导入后梦境整理。

```bash
keymemory migrate-discover
keymemory migrate-auto --run-dream
keymemory migrate <file-or-directory> --source codex --run-dream
keymemory migrate <file-or-directory> --source codex --dry-run
```

首次安装推荐先跑安全预览，再确认写入：

```bash
keymemory onboard
keymemory onboard --yes --run-dream
```

`onboard` 会串联发现旧记忆、迁移预览或导入、写前备份、梦境整理和 Agent 配置片段生成。默认不写入；`--yes` 才会导入，`--run-dream` 才会在导入后整理。

Supported file formats: `json`, `jsonl`, `ndjson`, `md`, `markdown`, and `txt`. `jsonl/ndjson` lines may contain direct memory objects, `{ memories: [...] }`, `{ items: [...] }`, nested `payload`/`data`/`item`, or log-style `event_msg`; invalid/non-memory lines are skipped so a partially corrupt export can still migrate.
Use `--dry-run` before a large import to preview `files`, `total`, `imported`, `skipped`, `failed`, inferred `projectPaths`, and `memoryKinds` without writing memories or running dream consolidation.

### Source-path project routing

When imported memories do not contain `[[Project/Subproject]]` or `projectPath`, KeyMemory now routes them from source evidence before falling back to uncategorized storage:

1. structured metadata such as `projectPath`, `project`, `workspace`, `cwd`, `repoPath`, or `projectRoot`
2. the discovered source default, for example `Workspaces/<workspace>/Claude Code`
3. the relative directory under the imported folder, for example `notes/Agent Writer Dashboard/Frontend/memory.md` becomes project `Agent Writer Dashboard/Frontend`

This keeps one-click migration useful for old local memory folders that never had KeyMemory project markers.

可识别来源包括 Codex、Claude Code、Hermes、OpenClaw、Cursor、Gemini、Mem0/OpenMemory 风格本地目录，以及工作区 `AGENTS.md`、`.claude/`、`.hermes/`、`.openclaw/`、`.cursor/rules`。导入后会自动生成项目树、推断记忆类型、补标签和来源证据。

带 `--run-dream` 时，迁移后的旧记忆会进入梦境整理：重复或被更新的记忆会归档，并写入 `memory_relations` 中的 `supersedes` 关系，便于 Agent 知道哪条新记忆替代了旧记忆。

> 从任何来源迁移记忆到 KeyMemory 的通用指南

---

## 万能迁移模板

无论你的记忆来自哪个系统，都可以用下面这个通用模板。直接复制粘贴给你的 Agent：

```
你是一个记忆迁移助手。请帮我将记忆从 [来源名称] 迁移到 KeyMemory。

步骤：
1. 读取 [来源名称] 中的所有记忆数据
2. 筛选高价值记忆，只保留：
   - 用户偏好和习惯
   - 重要决策和原因
   - 项目关键信息
   - 人物关系和实体信息
   - 技术知识积累
   - 有长期参考价值的事实
3. 排除以下内容：
   - 临时闪念和碎碎念
   - 已过时的待办事项
   - 纯聊天记录（除非包含重要事实）
   - 重复或冗余信息
4. 对每条筛选后的记忆，调用 memory_import 工具：
   {
     "memories": [
       {
         "title": "简洁标题（去掉来源前缀）",
         "content": "完整记忆内容，保留原始细节",
         "tags": ["关键词1", "关键词2"],
         "metadata": {
           "timeline": "原始时间信息",
           "entities": ["涉及的人/组织/项目"],
           "context": "记忆产生的场景或原因",
           "category": "偏好/技术/项目/人际/决策",
           "importance": "high/medium/low"
         },
         "source": "[来源标识]",
         "sourceId": "原始系统中的ID"
       }
     ]
   }
5. layer 可以不指定，系统会自动推断。也可以手动指定：
   - long：长期知识、用户偏好、重要决策
   - project：项目相关信息（附带 project 字段）
   - entity：人物/组织/实体信息
   - short：临时性信息
6. 迁移完成后，输出统计：总条目数、筛选后条目数、各层级分布

重要：
- 标题和内容中不要保留来源系统的前缀标记（如 [NC]、H: 等），系统会自动清理
- 尽量补充 metadata，这对后续搜索精准度至关重要
- 大量数据建议分批导入，每批 20-50 条
```

---

## 常见来源迁移示例

### 从 Notion 数据库迁移

```
请帮我从 Notion 数据库迁移记忆到 KeyMemory。

1. 使用 Notion API 或导出功能获取数据库内容
2. 筛选高价值条目，排除临时笔记和重复内容
3. 对每条记忆调用 memory_import，将 Notion 的属性映射为：
   - Title 属性 → title
   - Content/Description 属性 → content
   - Tags/Category 属性 → tags
   - Created Time → metadata.timeline
   - 其他自定义属性 → metadata 中保留
4. source 设为 "notion"，sourceId 设为 Notion 页面 ID
```

### 从 Obsidian 笔记迁移

```
请帮我从 Obsidian 笔记库迁移记忆到 KeyMemory。

1. 读取 Obsidian vault 中的 Markdown 文件
2. 筛选包含重要信息的笔记（排除 daily notes 中的琐碎内容）
3. 对每条记忆调用 memory_import：
   - 文件名或一级标题 → title
   - 正文内容 → content（保留 Markdown 格式）
   - YAML frontmatter 中的 tags → tags
   - frontmatter 中的其他字段 → metadata
   - 文件创建时间 → metadata.timeline
4. source 设为 "obsidian"，sourceId 设为文件路径
```

### 从 ChatGPT/Claude 对话迁移

```
请帮我从 AI 对话记录中提取重要记忆并导入 KeyMemory。

1. 读取对话记录（JSON 导出或文本格式）
2. 提取用户明确要求记住的信息、重要决策、偏好等
3. 不要保留对话格式，提炼为独立事实
4. 对每条记忆调用 memory_import：
   - 用一句话概括 → title
   - 完整事实描述 → content
   - 对话时间 → metadata.timeline
   - 讨论的主题 → tags
5. source 设为 "chatgpt" 或 "claude"
```

### 从 Excel/CSV 表格迁移

```
请帮我从表格数据迁移记忆到 KeyMemory。

1. 读取 Excel/CSV 文件
2. 每行作为一条记忆，列映射为：
   - 标题列 → title
   - 内容列 → content
   - 分类/标签列 → tags
   - 其他列 → metadata 中以列名为键
3. 调用 memory_import 批量导入
4. source 设为 "excel" 或文件名
```

### 从 JSON/API 迁移

```
请帮我从 [API 名称] 迁移记忆到 KeyMemory。

1. 调用 API 获取数据
2. 将 JSON 字段映射为 KeyMemory 格式
3. 嵌套对象放入 metadata 中保留完整结构
4. 调用 memory_import 批量导入
5. source 设为 API 名称，sourceId 设为原始 ID
```

---

## memory_import 工具参数

```json
{
  "memories": [
    {
      "title": "记忆标题（必填）",
      "content": "记忆完整内容（必填）",
      "layer": "long | short | project | entity | flash（可选，自动推断）",
      "project": "关联项目名（可选）",
      "tags": ["标签1", "标签2"],
      "metadata": {
        "timeline": "时间信息",
        "entities": ["实体1", "实体2"],
        "context": "场景说明",
        "category": "偏好/技术/项目/人际/决策",
        "importance": "high/medium/low",
        "...": "任意其他字段，保留原始系统的信息"
      },
      "source": "来源标识",
      "sourceId": "原始系统ID"
    }
  ],
  "autoLayer": true,
  "stripPrefixes": true
}
```

### 层级说明

| 层级 | 用途 | 保留时长 | 典型内容 |
|------|------|----------|----------|
| `flash` | 临时记忆 | 当前会话 | 临时计算结果、中转信息 |
| `short` | 短期记忆 | 几天 | 待办事项、临时决定 |
| `long` | 长期记忆 | 永久 | 用户偏好、重要决策、知识 |
| `project` | 项目记忆 | 永久 | 技术栈、架构、项目约定 |
| `entity` | 实体记忆 | 永久 | 人物信息、组织、联系方式 |

### 自动层级推断规则

不指定 layer 时，系统根据以下规则自动推断：

| 信号 | 推断层级 |
|------|----------|
| metadata.importance = "high" | long |
| metadata.category = "preference"/"decision" | long |
| metadata.category = "person"/"entity" | entity |
| 内容包含偏好/习惯/联系方式关键词 | entity |
| 内容包含项目/仓库/架构关键词 | project |
| 内容包含临时/待办关键词 | short |
| 内容超过 200 字 | long |
| 其他 | short |

---

## 前缀自动清理

导入时自动清理标题和内容开头的来源前缀，保持内容干净纯粹。

### 清理规则

| 模式 | 示例 | 清理结果 |
|------|------|----------|
| `[xxx]` 方括号标记 | `[NC] 用户偏好` | `用户偏好` |
| `xxx:` 冒号标记 | `Hindsight: 项目信息` | `项目信息` |
| `xxx：` 中文冒号 | `NotionClaw：技术栈` | `技术栈` |
| `xxx -` 破折号标记 | `Obsidian - 笔记` | `笔记` |
| `迁移：xxx` 迁移标记 | `迁移：用户习惯` | `用户习惯` |

### 注意事项

- 前缀只清理开头位置，内容中间的引用文本不受影响
- URL 开头（http/https/ftp/www）不会被误清理
- 清理后标题为空时保留原始标题
- 设置 `stripPrefixes: false` 可关闭自动清理

---

## 迁移最佳实践

1. **先筛选后导入**：不要无差别导入，只迁移有长期价值的记忆
2. **补充 metadata**：这是搜索精准度的关键，尽量保留原始系统的结构化信息
3. **分批导入**：大量数据建议每批 20-50 条，避免超时
4. **验证导入**：导入后用 `memory_search` 抽查几条，确认内容正确
5. **保留来源标识**：设置 source 和 sourceId，方便后续追溯和去重
6. **利用自动推断**：不指定 layer 让系统自动推断，减少手动分类负担
