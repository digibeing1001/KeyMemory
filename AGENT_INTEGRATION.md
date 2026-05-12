# KeyMemory Agent 接入指南

## 快速启动

```bash
# 安装依赖并构建
pnpm install
pnpm -r build

# 启动 MCP 服务器
pnpm start:mcp
```

---

## 方式一：作为 MCP 服务器接入（推荐）

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
        "packages/server/mcp-server.js"
      ],
      "cwd": "c:\\Users\\zexin\\Desktop\\KeyMemory"
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

## 下一步

1. 先启动服务器：`pnpm start:mcp`
2. 访问 Web UI 创建一些测试记忆：`http://localhost:5173`
3. 配置到你的 Agent 工具
