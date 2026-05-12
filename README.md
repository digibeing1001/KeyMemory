# KeyMemory

为 AI Agent 打造的五层记忆系统。让 Hermes、OpenClaw 等 Agent 拥有真正可用的长期记忆。

## 为什么需要 KeyMemory？

AI Agent 最大的痛点之一就是「记不住」。每次对话从零开始，用户说过的话、做过的决定、积累的经验都无法保留。KeyMemory 用五层记忆模型 + 自动衰减 + 混合搜索，为 Agent 提供类似人类记忆的生命周期管理。

## 核心功能

### 🧠 五层记忆模型

| 层级 | 名称 | 用途 | 衰减策略 |
|------|------|------|----------|
| L1 | 闪念 Flash | 临时想法、待整理信息 | 7天未访问自动衰减 |
| L2 | 短期 Short | 近期重要信息 | 30天衰减，命中≥3次可固化 |
| L3 | 长期 Long | 方法论、原则、关键决策 | 永久保留 |
| L4 | 项目 Project | 项目级知识库 | 按项目隔离 |
| L5 | 实体 Entity | 人物、工具、概念的关系图谱 | 永久保留 |

### 🔍 混合搜索引擎

- **全文搜索**：SQLite FTS5，关键词精准匹配
- **语义搜索**：本地 ONNX Runtime 嵌入，无需云端 API
- **RRF 融合**：两种搜索结果智能排序，取长补短

### 🤖 Agent 集成

- **MCP 协议**：标准 Model Context Protocol，Hermes/OpenClaw 直接接入
- **Agent 隔离**：isolated / shared / hybrid / project 四种隔离模式
- **自动记忆**：`autoRemember` API，传入对话内容自动完成评估→提取→记录
- **敏感内容保护**：自动检测密码/密钥等敏感信息，路由到私有空间

### 📊 SelfCheck 自检系统

五维评估模型，自动判断信息是否值得记录：

- 项目相关性（Project Relevance）
- 长期价值（Long-term Value）
- 新颖性（Novelty）
- 用户强调度（User Emphasis）
- 可复用性（Reusability）

### 🔄 Evolution 进化引擎

自动检测并建议处理：
- 重复记忆合并
- 孤立记忆补充关联
- 矛盾断言识别
- 闪念自动归档/提升

### 📜 版本溯源

每条记忆的每次修改都有完整版本记录，支持 diff 对比和回滚。

### 🏥 健康度报告

实时监测记忆库质量：重复率、孤立率、冲突率、衰减率，给出综合健康评分。

## 快速开始

### 环境要求

- Node.js ≥ 18
- pnpm ≥ 8

### 安装

```bash
git clone https://github.com/digibeing1001/KeyMemory.git
cd KeyMemory
pnpm install
pnpm run build
```

### 启动方式

KeyMemory 有两种启动方式，根据你的使用场景选择：

#### 方式一：Agent 自动启动（推荐）

配置好 Agent 后，**Agent 启动时自动拉起 KeyMemory**，无需手动运行任何命令。MCP 服务器启动后，REST API 和 Web 管理界面也会在后台自动启动。

**Claude Desktop / Hermes 配置：**

编辑 `claude_desktop_config.json`（通常在 `~/.claude/` 目录下）：

```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": ["/你的路径/KeyMemory/packages/server/dist/mcp-server.js"],
      "env": {}
    }
  }
}
```

配置完成后，每次启动 Claude Desktop / Hermes，KeyMemory 自动可用：
- ✅ Agent 可直接使用 `memory_search`、`memory_auto_remember` 等工具
- ✅ Web 管理界面自动在 `http://localhost:3100` 可用
- ✅ REST API 自动可用

**OpenClaw 配置：**

在 OpenClaw 的 MCP 配置中添加相同的 server 配置即可。

#### 方式二：手动启动（独立使用）

如果你只想使用 Web 管理界面或 REST API，不通过 Agent：

```bash
pnpm run dev
```

服务运行在 `http://localhost:3100`，Web 管理界面自动可用。

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 3100 | 服务端口 |
| `KEYMEMORY_API_KEY` | - | 可选，设置后所有 API 请求需携带 Bearer Token |
| `KEYMEMORY_DB_PATH` | ./data/keymemory.db | SQLite 数据库路径 |

## 使用方法

### Web 管理界面

启动服务后访问 `http://localhost:3100`，即可使用 Web 界面管理记忆：

1. **左侧层级导航**：按层级筛选记忆
2. **中间记忆列表**：浏览和搜索记忆
3. **右侧编辑器**：查看/编辑/创建记忆

### REST API

```bash
# 创建记忆
curl -X POST http://localhost:3100/api/memories \
  -H "Content-Type: application/json" \
  -d '{
    "title": "React 性能优化原则",
    "content": "使用 useMemo 缓存计算结果，避免在渲染路径中创建新对象...",
    "layer": "long",
    "project": "frontend"
  }'

# 搜索记忆
curl "http://localhost:3100/api/memories/search?q=React+性能&limit=10"

# 自动记忆（Agent 最常用）
curl -X POST http://localhost:3100/api/auto-remember \
  -H "Content-Type: application/json" \
  -d '{
    "content": "用户偏好深色主题，所有新项目默认使用 dark mode",
    "agentId": "hermes",
    "currentProject": "frontend"
  }'

# 获取层级统计
curl http://localhost:3100/api/layers/stats

# 健康度报告
curl http://localhost:3100/api/health/report

# 数据备份
curl -X POST http://localhost:3100/api/backup
```

### MCP 协议（Agent 接入）

KeyMemory 实现了标准 MCP 协议，Agent 可通过 `POST /mcp` 端点接入：

**可用工具：**

| 工具 | 说明 |
|------|------|
| `memory_create` | 创建记忆 |
| `memory_search` | 混合搜索记忆 |
| `memory_read` | 读取单条记忆 |
| `memory_update` | 更新记忆 |
| `memory_delete` | 删除记忆 |
| `memory_auto_remember` | 自动记忆（推荐） |

**可用资源：**

| URI | 说明 |
|-----|------|
| `keymemory://stats` | 记忆统计信息 |

**可用提示模板：**

| 名称 | 说明 |
|------|------|
| `memory_context` | 注入相关记忆到对话上下文 |

**Agent 隔离模式：**

通过请求头 `x-agent-type` 指定 Agent 类型（`hermes` / `openclaw`），系统自动应用对应的隔离策略。

#### Hermes 接入示例

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "memory_auto_remember",
    "arguments": {
      "content": "用户决定使用 PostgreSQL 作为主数据库",
      "agentId": "hermes"
    }
  }
}
```

### Agent 路由决策

```bash
# 查询内容应该存储到哪个空间
curl -X POST http://localhost:3100/api/agent/route \
  -H "Content-Type: application/json" \
  -d '{
    "content": "数据库密码是 abc123",
    "layer": "long",
    "agentId": "hermes",
    "isolationMode": "hybrid"
  }'
# → 自动路由到私有空间（检测到敏感内容）
```

## 项目结构

```
KeyMemory/
├── packages/
│   ├── shared/          # 共享类型和常量
│   │   └── src/
│   │       ├── types.ts     # TypeScript 类型定义
│   │       └── constants.ts # 层级配置、阈值、权重
│   ├── server/          # 后端服务
│   │   ├── mcp-server.ts    # MCP stdio 服务器（Agent 自动启动入口）
│   │   └── src/
│   │       ├── api/         # REST + MCP 路由
│   │       ├── core/        # 核心业务逻辑
│   │       │   ├── atom.ts      # 记忆 CRUD
│   │       │   ├── auto.ts      # 自动记忆
│   │       │   ├── layer.ts     # 层级管理
│   │       │   ├── query.ts     # 混合搜索
│   │       │   ├── forgetting.ts # 衰减与遗忘
│   │       │   ├── evolution.ts  # 进化引擎
│   │       │   ├── provenance.ts # 版本溯源
│   │       │   └── health.ts     # 健康度
│   │       ├── adapters/    # Agent 适配器
│   │       │   ├── base.ts      # 路由决策 + 隔离
│   │       │   ├── hermes.ts    # Hermes 适配器
│   │       │   └── openclaw.ts  # OpenClaw 适配器
│   │       ├── selfcheck/   # SelfCheck 评估器
│   │       ├── graph/       # 实体图谱
│   │       ├── embed/       # ONNX 嵌入引擎
│   │       └── db/          # SQLite + mapper
│   └── web/              # 前端管理界面
│       └── src/
│           ├── components/  # UI 组件
│           ├── views/       # 页面视图
│           ├── hooks/       # 自定义 Hook
│           └── lib/         # API 客户端
├── presets/
│   └── hermes/           # Hermes 预设配置
└── pnpm-workspace.yaml
```

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React + TypeScript + Vite + Tailwind CSS |
| 后端 | Fastify + TypeScript + better-sqlite3 |
| 搜索 | SQLite FTS5 + ONNX Runtime (all-MiniLM-L6-v2) |
| 协议 | MCP (Model Context Protocol) |
| 构建 | pnpm workspace + monorepo |

## License

MIT
