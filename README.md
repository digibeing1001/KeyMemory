# KeyMemory

KeyMemory 是一个以项目为骨架的本地记忆系统。它不是简单给记忆打标签，而是让记忆挂在项目树上：当你在内容里提到 `[[项目名称]]`，系统会自动归类；项目逐渐变多后，它也会根据共享实体给出聚类和合并建议。

当前推荐的分发方式是 **git clone 源码仓库分发**。KeyMemory 由 Server、Web UI、本地模型、Windows/WSL 启动脚本和 Agent 配置脚本组成，完整仓库形态最稳定。暂不推荐把 `packages/server` 当作独立 npm 包安装或发布。

## 快速开始

### 环境要求

- Node.js 20 或更高版本
- pnpm
- Git

如果还没有 pnpm：

```bash
npm install -g pnpm
```

### 安装

```bash
git clone https://github.com/digibeing1001/KeyMemory.git
cd KeyMemory
pnpm setup
```

安装完成后，重新打开终端即可使用 `keymemory update` 和 `keymemory dashboard`。
如果 MCP 工具不可用，先运行 `keymemory doctor` 检查路径、构建产物和服务状态。

Windows 用户也可以直接运行：

```bat
setup-hermes.bat
keymemory dashboard
```

### 启动 Web UI

```bash
keymemory dashboard
```

启动后访问：

```text
http://127.0.0.1:3210
```

首次启动如果还没有构建产物，`keymemory dashboard` 会自动执行构建。

## MCP 配置

推荐使用稳定启动器配置 MCP，避免直接指向 `packages/server/dist/mcp-server.js`。启动器会检查构建产物、记录启动日志，并避免 MCP stdout 被日志污染。

```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": ["C:/path/to/KeyMemory/bin/keymemory-mcp.js"]
    }
  }
}
```

MCP 启动日志默认写入 `~/.keymemory/logs/mcp.log`。若工具不可用，运行 `keymemory doctor`。

## 常用命令

```bash
pnpm build                 # 构建 shared/server/web
keymemory dashboard        # 启动 Web UI
keymemory doctor           # 诊断 MCP/Web UI 配置和健康状态
pnpm start:mcp             # 只启动 MCP 服务
keymemory update           # 从 GitHub 拉取更新并重新构建
pnpm install-memory        # 安装默认记忆系统配置
```

Windows 批处理入口：

```text
setup-hermes.bat           # 生成 Claude Desktop/Hermes 配置
start-hermes.bat           # 启动 Hermes 相关服务
start-ui.bat               # 旧入口：前台启动 Web UI（推荐 keymemory dashboard）
start-ui-background.bat    # 旧入口：后台启动 Web UI（推荐 keymemory dashboard）
update-keymemory.bat       # 旧入口：git pull 后重新构建（推荐 keymemory update）
install-default-memory.bat # 设置默认记忆系统
```

## 核心能力

### 项目树

所有记忆都挂在项目下。项目支持多层级结构，像文件夹一样组织，但会根据记忆中的实体和项目关系给出整理建议。

```text
未分类
├── 前端重构
│   ├── 组件库升级
│   └── 性能优化
├── 团队管理
│   └── 新人培养
└── 知识库
    └── React 最佳实践
```

- 写记忆时可用 `[[项目名称]]` 语法指定归属
- 没有指定项目的记忆会自动归入“未分类”
- Web UI 左侧项目树可按项目和子项目筛选记忆

### 梦境周期

系统会定期执行整理流程：

| 阶段 | 作用 |
| --- | --- |
| Light | 扫描近期记忆，合并重复内容 |
| REM | 分析主题频率，补全缺失标签 |
| Deep | 评分、升级高质量记忆，归档过期内容 |
| Semantic | 根据语义相似度关联和合并相关记忆 |
| Project Clustering | 根据项目间共享实体建议项目归并 |

整理操作会保留快照，便于回滚。

### 混合搜索

KeyMemory 使用 SQLite FTS5 全文搜索和本地 ONNX 语义嵌入，并通过 RRF 做融合排序。即使语义模型加载失败，全文搜索仍然可用。

## Agent 工具

| 工具 | 用途 |
| --- | --- |
| `memory_create` | 写入一条记忆，可用 `[[项目]]` 语法指定归属 |
| `memory_search` | 混合搜索相关记忆 |
| `memory_read` | 读取一条记忆的完整内容 |
| `memory_list` | 列出最近记忆 |
| `memory_update` | 更新已有记忆 |
| `memory_delete` | 删除记忆 |
| `memory_auto_remember` | 根据对话内容自动评估并记录 |
| `memory_import` | 批量导入外部记忆 |

## 分发说明

本仓库当前按源码分发维护：

- 根目录 `package.json` 是 workspace 入口，保持 `private: true`
- `packages/server` 是 workspace 内部包，不作为独立 npm 包发布
- Web UI 产物位于 `packages/web/dist`
- 本地模型位于 `packages/server/models`
- 用户数据默认写入用户主目录下的 KeyMemory 数据目录，不写入仓库

如果未来要做 npm 分发，建议另做一个轻量安装器或 CLI 包，让它负责 clone/download release，而不是直接发布当前 monorepo 内部包。

## 技术栈

- 前端：React + Vite + Tailwind
- 后端：Fastify + better-sqlite3
- 嵌入：ONNX Runtime + all-MiniLM-L6-v2
- 搜索：SQLite FTS5 + 向量语义搜索
- 协议：MCP

## License

MIT
