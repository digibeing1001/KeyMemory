# KeyMemory

AI Agent 的长期记忆层。

不是聊天记录的堆砌，而是让 Agent 真正记住你说过的话、做过的决定、积累的经验。

## 是什么

KeyMemory 是一个本地运行的记忆系统，通过 MCP 协议接入 Claude、Hermes、OpenClaw 等 Agent。它用五层模型管理信息生命周期，配合语义搜索，让 Agent 在每次对话时都能拿到真正相关的上下文。

## 五层记忆

| 层级 | 名称 | 保留策略 |
|------|------|----------|
| L1 | 闪念 Flash | 7 天无访问则衰减 |
| L2 | 短期 Short | 30 天衰减，命中 3 次升级为长期 |
| L3 | 长期 Long | 永久保留 |
| L4 | 项目 Project | 按项目隔离，项目存续期间保留 |
| L5 | 实体 Entity | 人物、工具、概念的关系图谱，永久保留 |

## 核心能力

- **混合搜索** — SQLite FTS5 全文 + ONNX 语义嵌入，RRF 融合排序
- **自动记忆** — Agent 传入对话内容，SelfCheck 自动评估是否值得记录、该放哪一层
- **自动衰减** — 闪念和短期记忆按访问频率自然遗忘，长期记忆不受影响
- **版本溯源** — 每条记忆的每次修改都有完整历史，支持 diff 和回滚
- **健康监测** — 实时报告重复率、孤立率、冲突率

## 一分钟启动

```bash
# 克隆
git clone https://github.com/digibeing1001/KeyMemory.git
cd KeyMemory

# 安装 & 构建
pnpm install
pnpm build

# 配置 MCP（Claude Desktop / Hermes / OpenClaw）
# 编辑你的 mcpServers 配置，添加：
#   "keymemory": {
#     "command": "node",
#     "args": ["./packages/server/dist/mcp-server.js"]
#   }
# 之后 Agent 启动时自动拉起，Web UI 在 3210 端口可用
```

## Agent 如何使用

Agent 通过 MCP 工具与 KeyMemory 交互：

| 工具 | 用途 |
|------|------|
| `memory_create` | 写入一条记忆 |
| `memory_search` | 搜索相关记忆 |
| `memory_read` | 读取单条完整内容 |
| `memory_auto_remember` | 传入对话，自动评估并记录 |
| `memory_import` | 批量导入（支持 Notion/Obsidian/JSON 等） |

Agent 启动后自动可用，无需手动操作。

## 技术栈

- **前端**：React + Vite + Tailwind
- **后端**：Fastify + better-sqlite3
- **嵌入**：ONNX Runtime + all-MiniLM-L6-v2（内置，无需下载）
- **搜索**：SQLite FTS5 + 向量语义搜索
- **协议**：MCP (Model Context Protocol)

## License

MIT
