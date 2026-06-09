# KeyMemory Agent 接入指南

## 快速启动

```bash
# 安装依赖并构建
pnpm install
pnpm -r build

# 启动 MCP 服务器（MCP 模式）
pnpm start:mcp

# 或查看 CLI 命令帮助（CLI 模式）
npx keymemory --help
```

---

## 模式选择

KeyMemory 支持两种接入模式：

| 模式 | 适用 Agent | 权限确认 | 说明 |
|------|-----------|---------|------|
| **CLI 模式** | Claude Code, Codex | 首次允许后免确认 | Agent 直接执行 `keymemory` 命令 |
| **MCP 模式** | Claude Desktop, Hermes, OpenClaw, OpenCode | 取决于客户端 | 通过 MCP 协议通信 |

**推荐**：Claude Code 和 Codex 使用 CLI 模式，Claude Desktop 使用 MCP 模式。

---

## 方式零：CLI 模式（推荐用于 Claude Code / Codex）

### 为什么用 CLI 模式？

- **零权限干扰**：首次执行时选择"Always allow"，之后不再弹窗确认
- **更直接**：无 MCP 协议开销，直接操作数据库
- **更简单**：无需配置 MCP server

### 一键配置

```bash
# Claude Code 自动配置为 CLI 模式
pnpm install-memory -- --agent=claude-code --mode=cli

# Codex 自动配置为 CLI 模式
pnpm install-memory -- --agent=codex --mode=cli

# 查看 CLI 配置内容
npx keymemory agent-config claude-code --mode cli
```

### 手动配置

将以下内容添加到项目的 `.claude/CLAUDE.md` 或 `.claude/CLAUDE.mdc`：

```markdown
# KeyMemory - CLI Mode

KeyMemory is the primary memory system. Use the `keymemory` CLI for all memory operations instead of MEMORY.md or local Memory files.

## Core Commands

- Create memory: `keymemory create -t "title" -c "content" -l long`
- Search memory: `keymemory search "query" --limit 10`
- Read memory: `keymemory read <id>`
- Update memory: `keymemory update <id> -t "new title" -c "new content"`
- Delete memory: `keymemory delete <id>`
- List memories: `keymemory list --limit 20`
- Context pack: `keymemory context "current task" --project "project/name" --max-items 12`
- Auto-remember: `keymemory auto-remember -c "content to evaluate"`

## Rules

- Always use KeyMemory for durable memory instead of MEMORY.md or local Memory files
- Before relying on user preferences, prior decisions, or previous instructions, run `keymemory search <query>`
- After significant exchanges, run `keymemory auto-remember -c "<summary>"` to capture durable value
- Do not create or update MEMORY.md files for memory purposes
```

### 首次使用

Claude Code 首次执行 `keymemory` 命令时会请求 Bash 权限：
1. 选择 **"Always allow"**（始终允许）
2. 此后所有 `keymemory` 命令自动执行，无需确认

---

## 方式一：作为 MCP 服务器接入（适用于 Claude Desktop / Hermes / OpenClaw / OpenCode）

### 1. 配置到 Claude Desktop

编辑配置文件（Windows）：
```
%APPDATA%\Claude\claude_desktop_config.json
```

或使用我们提供的模板：
```bash
cp claude_desktop_config.json %APPDATA%\Claude\
```

配置内容：
```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": [
        "packages/server/dist/mcp-server.js"
      ],
    }
  }
}
```

### 2. 可用的 MCP 工具

| 工具名 | 说明 |
|--------|------|
| `memory_create` | 创建新记忆 |
| `memory_search` | 搜索记忆（全文+语义混合） |
| `memory_read` | 读取特定记忆 |
| `memory_delete` | 删除记忆 |

示例使用：
```
> 帮我记住这个：TS 项目配置要设置 "strict": true
[MCP] 调用 memory_create...
```

---

## 方式二：通过 REST API 接入

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/memories` | `POST` | 创建记忆 |
| `/api/memories` | `GET` | 列出记忆 |
| `/api/memories/search` | `GET` | 搜索记忆 |
| `/api/memories/:id` | `GET` | 获取详情 |
| `/api/memories/:id` | `PUT` | 更新记忆 |
| `/api/context/inject` | `POST` | 上下文注入 |
| `/api/health/report` | `GET` | 健康度报告 |

### API 客户端示例

```typescript
// 在你的 Agent 代码中
const KEYMEMORY_BASE = 'http://127.0.0.1:3210/api';

// 搜索相关记忆
async function searchMemories(query: string) {
  const res = await fetch(`${KEYMEMORY_BASE}/memories/search?q=${encodeURIComponent(query)}`);
  return await res.json();
}

// 存储新记忆
async function storeMemory(title: string, content: string, layer = 'long') {
  const res = await fetch(`${KEYMEMORY_BASE}/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, content, layer }),
  });
  return await res.json();
}

// 上下文注入
async function injectContext(project?: string, query?: string) {
  const res = await fetch(`${KEYMEMORY_BASE}/context/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project, query, limit: 5 }),
  });
  return await res.json();
}
```

---

## 方式三：Hermes 直接适配

### 使用 Hermes Adapter

```typescript
import { hermesAdapter, buildHermesSystemPrompt } from '@keymemory/server';

// 1. 写入记忆
await hermesAdapter.write({
  title: '项目配置规范',
  content: '所有 TypeScript 项目必须开启 strict 模式',
  layer: 'long',
});

// 2. 搜索记忆
const memories = await hermesAdapter.search('TS 配置', { limit: 3 });

// 3. 构建系统提示词
const systemPrompt = buildHermesSystemPrompt(memories);
console.log(systemPrompt);
```

### 与 Hermes 对话集成

```typescript
// 在 Hermes 的对话处理器中
import { hermesAdapter, injectContext } from '@keymemory/server';

async function handleUserQuery(userQuery: string) {
  // 1. 搜索相关记忆
  const memories = await hermesAdapter.search(userQuery);

  // 2. 注入到系统提示
  const context = injectContext({ query: userQuery });

  // 3. 构建完整提示
  const systemPrompt = [
    'You are Hermes, an AI assistant.',
    'Use the following KeyMemory context:',
    await buildHermesSystemPrompt(await context),
  ].join('\n\n');

  // 4. 调用 LLM
  const response = await callLLM(systemPrompt + '\n\n' + userQuery);

  // 5. 可选：自动记录重要决策
  if (shouldRecord(response)) {
    await hermesAdapter.write({
      title: '决策记录',
      content: response,
      layer: 'short',
    });
  }

  return response;
}
```

---

## 方式四：Claude Code .claude/ 同步

```typescript
import { syncToClaudeMd, syncFromClaudeMd } from '@keymemory/server';

// 1. 将 KeyMemory 同步到 .claude/CLAUDE.md
await syncToClaudeMd();

// 2. 从 CLAUDE.md 读取（可选）
const content = await syncFromClaudeMd();
```

---

## 多 Agent 隔离配置

> **重要**：KeyMemory 的隔离机制完全兼容原有记忆插件，不会互相干扰！

### 兼容性保证

- 默认使用 `global` 空间，与无 Agent 场景的记忆保持一致
- 各 Agent 的记忆互不干扰，每个 Agent 有自己的私有空间
- 只有标记为共享的内容才会被其他 Agent 看到

| 模式 | 说明 |
|------|------|
| `isolated` | 完全隔离，每个 Agent 独立空间 |
| `shared` | 完全共享，所有 Agent 共用 |
| `hybrid` | 混合模式（默认），默认私有，标记 `#share` 才共享 |
| `project` | 项目隔离，不同项目分开 |

### Agent 空间结构

```
KeyMemory 数据库
├── global 空间（无 Agent 场景、共享内容）
├── agent:hermes（Hermes 私有空间）
├── agent:alice（另一个 Agent 的私有空间）
└── project:keymemory（项目空间）
```

### 使用示例：不会影响其他插件

```typescript
import { createHermesAdapter } from '@keymemory/server';

// 为 Hermes 创建独立的 Adapter
const hermes = createHermesAdapter({ 
  agentId: 'hermes',
  isolationMode: 'hybrid' // 默认模式
});

// 写入的记忆只在 Hermes 空间
await hermes.write({
  title: '仅 Hermes 可见',
  content: '这个记忆其他 Agent 看不到',
  layer: 'short'
});

// 搜索时也只返回 Hermes 有权访问的记忆
const results = await hermes.search('关键词');
```

### 与无 Agent 场景兼容

```typescript
// 原始无 Agent 用法（直接调用 atom）
import { createMemory, searchHybrid } from '@keymemory/server';

// 这种方式会使用 global 空间，不受 Agent 影响
const mem = createMemory({ title: '旧插件使用', content: 'global 空间' });
```

### 自定义路由规则

```typescript
import { routeMemory, createAgentContext } from '@keymemory/server';

const ctx = createAgentContext('hermes', 'hybrid');

const decision = routeMemory(
  '这是一段敏感内容，包含 API 密钥',
  'short',
  ctx,
  [
    { pattern: '\\[SHARE\\]', targetSpace: 'global', priority: 100 },
    { pattern: '项目配置', targetSpace: 'project:my-project', priority: 50 },
  ]
);

console.log(decision);
// {
//   targetSpace: 'agent:hermes',
//   confidence: 1.0,
//   needsConfirmation: false,
//   reason: 'sensitive content detected'
// }
```

---

## Self-check 集成

```typescript
import { evaluate } from '@keymemory/server';

// 对话结束后评估是否需要记录
const checkResult = await evaluate(
  conversationHistory,
  {
    currentProject: 'KeyMemory',
    conversationRound: 15,
  }
);

if (checkResult.action === 'auto_record') {
  // 自动记录
} else if (checkResult.action === 'suggest') {
  // 提示用户确认记录
}
```

---

## 启动命令汇总

| 命令 | 说明 |
|------|------|
| `pnpm start:mcp` | 启动 MCP 服务器 |
| `pnpm dev:server` | 开发模式（带热重载） |
| `pnpm dev:web` | 启动 Web UI |
| `pnpm dev` | 前后端同时启动 |

---

## 设置 KeyMemory 为默认记忆系统

### 为什么使用 KeyMemory 替代 MEMORY.md？

KeyMemory 用结构化、可搜索的记忆系统替代传统的 MEMORY.md 平面文件：

- **结构化存储**：记忆按层级（flash/short/long/project/entity）自动分类，而非堆积在单一文件中
- **混合搜索**：全文搜索 + 语义搜索，比手动翻阅 MEMORY.md 更精准
- **自动记忆**：`memory_auto_remember` 通过 SelfCheck 评估自动捕获重要信息
- **多 Agent 隔离**：各 Agent 拥有独立记忆空间，互不干扰
- **遗忘与演化**：自动衰减过期记忆，保持记忆库健康

### 一键安装

```bash
# 自动检测并配置所有 Agent（智能选择 CLI/MCP 模式）
pnpm install-memory -- --all

# 指定 Agent 并强制使用 CLI 模式
pnpm install-memory -- --agent=claude-code --mode=cli

# 指定 Agent 并强制使用 MCP 模式
pnpm install-memory -- --agent=claude-desktop --mode=mcp

# 查看支持的 Agent 列表
pnpm install-memory -- --agent=claude-code --list
```

Windows 用户可双击 `install-default-memory.bat` 运行。

**模式说明**：
- `--mode=auto`（默认）：根据 Agent 能力自动选择最佳模式
- `--mode=cli`：使用 CLI 模式（Claude Code、Codex 推荐）
- `--mode=mcp`：使用 MCP 模式（Claude Desktop 必需）

### 安装器做了什么？

1. **配置 MCP 服务器**：将 KeyMemory MCP 服务写入 Agent 的配置文件
2. **写入 Agent 指令**：为每个 Agent 生成使用 KeyMemory 的指令文件
3. **显示变更预览**：写入前展示 before/after 配置供确认

### 手动设置

#### Hermes (Claude Desktop)

1. 编辑 `%APPDATA%\Claude\claude_desktop_config.json`，添加 MCP 服务器：

```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": ["<KeyMemory项目路径>/packages/server/dist/mcp-server.js"]
    }
  }
}
```

2. 在用户主目录创建或编辑 `CLAUDE.md`，添加以下内容：

```markdown
# KeyMemory - Default Memory System

- Use `memory_create` to store new memories instead of writing to MEMORY.md
- Use `memory_search` at the start of every conversation to recall relevant context
- Use `memory_auto_remember` for automatic memory capture after significant exchanges
- MEMORY.md is NO LONGER the primary memory store
```

#### OpenClaw

1. 编辑 `~/.openclaw/config.json`，添加 MCP 服务器和记忆配置：

```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": ["<KeyMemory项目路径>/packages/server/dist/mcp-server.js"]
    }
  },
  "memory": {
    "provider": "keymemory",
    "primary": true
  }
}
```

2. 创建 `~/.openclaw/MEMORY_INSTRUCTIONS.md`，写入 KeyMemory 使用指令。

#### 通用 MCP 兼容 Agent

将以下 JSON 粘贴到 Agent 的 MCP 配置文件中：

```json
{
  "mcpServers": {
    "keymemory": {
      "command": "node",
      "args": ["<KeyMemory项目路径>/packages/server/dist/mcp-server.js"]
    }
  }
}
```

### 可用的 MCP 工具

| 工具 | 用途 |
|------|------|
| `memory_create` | 创建新记忆（替代写入 MEMORY.md） |
| `memory_search` | 搜索记忆（全文+语义混合搜索） |
| `memory_read` | 按 ID 读取特定记忆 |
| `memory_delete` | 删除记忆 |
| `memory_auto_remember` | 自动评估并记录记忆 |

---

## 下一步

1. 先启动服务器：`pnpm start:mcp`
2. 访问 Web UI 创建一些测试记忆：`http://localhost:5173`
3. 配置到你的 Agent 工具
