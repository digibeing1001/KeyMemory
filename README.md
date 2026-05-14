# KeyMemory

为 AI Agent 打造的五层记忆系统。让 Hermes、OpenClaw 等 Agent 拥有真正可用的长期记忆。

## 为什么需要 KeyMemory？

AI Agent 最大的痛点之一就是「记不住」。每次对话从零开始，用户说过的话、做过的决定、积累的经验都无法保留。KeyMemory 用五层记忆模型 + 自动衰减 + 混合搜索，为 Agent 提供类似人类记忆的生命周期管理。

## 核心特性

### 🧠 五层记忆模型

| 层级 | 名称 | 用途 | 衰减策略 |
|------|------|------|----------|
| L1 | 闪念 Flash | 临时想法、待整理信息 | 7天未访问自动衰减 |
| L2 | 短期 Short | 近期重要信息 | 30天衰减，命中≥3次可固化 |
| L3 | 长期 Long | 方法论、原则、关键决策 | 永久保留 |
| L4 | 项目 Project | 项目级知识库 | 按项目隔离 |
| L5 | 实体 Entity | 人物、工具、概念的关系图谱 | 永久保留 |

### 🔍 内置语义搜索引擎

- **内置 ONNX 模型**：all-MiniLM-L6-v2（FP32），开箱即用，无需联网下载
- **全文搜索**：SQLite FTS5，关键词精准匹配
- **语义搜索**：本地 ONNX Runtime 嵌入，无需云端 API
- **RRF 融合**：两种搜索结果智能排序，取长补短
- **结构化增强**：标签、来源、元数据参与搜索排序，信息越完整搜索越精准

### 🏷️ 结构化记忆

每条记忆支持丰富的结构化信息，帮助 Agent 精准命中目标：

- **tags**：关键词标签，分类和检索
- **source**：记忆来源标识（conversation / notionclaw / obsidian 等）
- **sourceId**：原始系统中的 ID
- **metadata**：结构化元数据（时间线、实体、场景、分类、重要程度等）

### 🔄 通用迁移工具

`memory_import` 支持从任何来源批量导入记忆：

- 自动清理标题/内容中的来源前缀（`[NC]`、`H:`、`迁移：`等）
- autoLayer 模式：不指定层级时自动根据内容推断
- 支持任意 metadata 结构，保留原始系统的丰富信息
- 适配 Notion、Obsidian、ChatGPT、Excel、JSON/API 等多种来源

### 🤖 Agent 集成

- **MCP 协议**：标准 Model Context Protocol，Hermes/OpenClaw 直接接入
- **Agent 隔离**：isolated / shared / hybrid / project 四种隔离模式
- **自动记忆**：`autoRemember` API，传入对话内容自动完成评估→提取→记录
- **默认记忆系统**：一键设为 Agent 的首选记忆系统，替代 MEMORY.md

### 📊 SelfCheck 自检系统

五维评估模型，自动判断信息是否值得记录：

- 项目相关性（Project Relevance）
- 长期价值（Long-term Value）
- 新颖性（Novelty）
- 用户强调度（User Emphasis）
- 可复用性（Reusability）

### 🔄 Evolution 进化引擎

自动检测并建议处理：重复记忆合并、孤立记忆补充关联、矛盾断言识别、闪念自动归档/提升

### 📜 版本溯源

每条记忆的每次修改都有完整版本记录，支持 diff 对比和回滚。

### 🏥 健康度报告

实时监测记忆库质量：重复率、孤立率、冲突率、衰减率，给出综合健康评分。

## 快速开始

### 环境要求

- Node.js ≥ 20
- pnpm ≥ 8

### 安装

```bash
git clone https://github.com/digibeing1001/KeyMemory.git
cd KeyMemory
pnpm install
pnpm build
```

> 构建完成后，内置的 all-MiniLM-L6-v2 语义模型即可使用，无需额外下载。

### 启动方式

#### 方式一：Agent 自动启动（推荐）

配置好 Agent 后，Agent 启动时自动拉起 KeyMemory，无需手动运行任何命令。MCP 服务器启动后，REST API 和 Web 管理界面也会在后台自动启动。

**Claude Desktop / Hermes 配置：**

编辑 `claude_desktop_config.json`（Windows: `%APPDATA%\Claude\claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": ["/你的路径/KeyMemory/packages/server/dist/mcp-server.js"]
    }
  }
}
```

配置完成后，每次启动 Claude Desktop / Hermes，KeyMemory 自动可用：
- ✅ Agent 可直接使用 `memory_search`、`memory_auto_remember` 等工具
- ✅ Web 管理界面自动在 `http://127.0.0.1:3210` 可用
- ✅ REST API 自动可用

**OpenClaw 配置：**

在 OpenClaw 的 MCP 配置中添加相同的 server 配置即可。

#### 方式二：一键启动 Web UI

```bash
# Windows
start-ui.bat

# 或手动启动
node start-ui.js
```

启动后访问 `http://localhost:5173`（开发模式）或 `http://127.0.0.1:3210`（MCP 内置模式）。

#### 方式三：手动启动

```bash
pnpm run dev
```

### 一键设为默认记忆系统

将 KeyMemory 设为 Agent 的首选记忆系统，替代传统的 MEMORY.md：

```bash
# Windows
install-default-memory.bat

# 或手动运行
node install-default-memory.js --all
```

此脚本会：
1. 自动检测已安装的 Agent（Hermes / OpenClaw）
2. 写入 MCP 配置
3. 写入 CLAUDE.md 记忆使用指令

### 增量更新

已安装的用户无需重新下载，直接拉取增量更新：

```bash
# Windows
update-keymemory.bat

# 或手动运行
node update-keymemory.js
```

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `KEYMEMORY_API_KEY` | - | 可选，设置后所有 API 请求需携带 Bearer Token |

## 使用方法

### MCP 工具（Agent 接入）

KeyMemory 实现了标准 MCP 协议，提供以下工具：

| 工具 | 说明 |
|------|------|
| `memory_create` | 创建记忆（支持 tags/metadata/source 结构化信息） |
| `memory_search` | 混合搜索记忆（全文+语义，结果包含标签和元数据） |
| `memory_read` | 读取单条记忆的完整内容 |
| `memory_list` | 列出最近记忆，可按层级筛选 |
| `memory_delete` | 删除记忆 |
| `memory_auto_remember` | 自动记忆（SelfCheck 评估 + 自动层级选择） |
| `memory_import` | 批量导入记忆（通用迁移，支持前缀清理和自动层级推断） |

**可用资源：**

| URI | 说明 |
|-----|------|
| `keymemory://stats` | 记忆统计信息 |

**可用提示模板：**

| 名称 | 说明 |
|------|------|
| `memory_context` | 注入相关记忆到对话上下文 |

### Web 管理界面

启动服务后访问 `http://127.0.0.1:3210`，即可使用 Web 界面管理记忆：

1. **左侧层级导航**：按层级筛选记忆，查看各层级数量
2. **中间记忆列表**：浏览和搜索记忆，显示标签和来源
3. **右侧编辑器**：查看/编辑/创建记忆，支持 Markdown 渲染

### REST API

```bash
# 创建记忆
curl -X POST http://127.0.0.1:3210/api/memories \
  -H "Content-Type: application/json" \
  -d '{
    "title": "React 性能优化原则",
    "content": "使用 useMemo 缓存计算结果，避免在渲染路径中创建新对象...",
    "layer": "long",
    "project": "frontend",
    "tags": ["react", "性能优化"],
    "source": "conversation"
  }'

# 搜索记忆（混合搜索）
curl "http://127.0.0.1:3210/api/memories/search?q=React+性能&limit=10"

# 自动记忆（Agent 最常用）
curl -X POST http://127.0.0.1:3210/api/auto-remember \
  -H "Content-Type: application/json" \
  -d '{
    "content": "用户偏好深色主题，所有新项目默认使用 dark mode",
    "agentId": "hermes",
    "currentProject": "frontend"
  }'

# 获取层级统计
curl http://127.0.0.1:3210/api/layers/stats

# 健康度报告
curl http://127.0.0.1:3210/api/health/report

# 数据备份
curl -X POST http://127.0.0.1:3210/api/backup
```

## 项目结构

```
KeyMemory/
├── packages/
│   ├── shared/            # 共享类型和常量
│   │   └── src/
│   │       ├── types.ts       # TypeScript 类型定义
│   │       └── constants.ts   # 层级配置、阈值、权重
│   ├── server/            # 后端服务
│   │   ├── models/            # 内置 ONNX 模型（all-MiniLM-L6-v2）
│   │   └── src/
│   │       ├── mcp-server.ts  # MCP stdio 服务器（Agent 启动入口）
│   │       ├── api/           # REST + MCP HTTP 路由
│   │       ├── core/          # 核心业务逻辑
│   │       │   ├── atom.ts        # 记忆 CRUD
│   │       │   ├── auto.ts        # 自动记忆
│   │       │   ├── layer.ts       # 层级管理
│   │       │   ├── query.ts       # 混合搜索 + 嵌入管理
│   │       │   ├── forgetting.ts  # 衰减与遗忘
│   │       │   ├── evolution.ts   # 进化引擎
│   │       │   ├── provenance.ts  # 版本溯源
│   │       │   ├── compression.ts # 记忆压缩
│   │       │   └── health.ts      # 健康度
│   │       ├── embed/          # ONNX 嵌入引擎
│   │       │   └── onnx.ts        # BERT WordPiece + ONNX 推理
│   │       ├── adapters/       # Agent 适配器
│   │       ├── selfcheck/      # SelfCheck 评估器
│   │       ├── graph/          # 实体图谱
│   │       └── db/             # SQLite + mapper
│   └── web/                # 前端管理界面
│       └── src/
│           ├── components/    # UI 组件
│           ├── views/         # 页面视图
│           ├── hooks/         # 自定义 Hook
│   ├── scripts/
│   │   └── download-model.js   # 模型下载脚本（含镜像支持）
│   ├── setup-hermes.js         # Hermes 一键配置
│   ├── start-ui.js             # Web UI 一键启动
│   ├── update-keymemory.js     # 增量更新
│   ├── install-default-memory.js  # 设为默认记忆系统
│   └── pnpm-workspace.yaml
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 后端 | Fastify + TypeScript + better-sqlite3 |
| 搜索 | SQLite FTS5 + ONNX Runtime (all-MiniLM-L6-v2) |
| 嵌入 | BERT WordPiece Tokenizer + Mean Pooling + L2 归一化 |
| 协议 | MCP (Model Context Protocol) |
| 构建 | pnpm workspace + monorepo |

## License

MIT
