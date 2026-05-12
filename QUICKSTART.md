# KeyMemory Agent 接入快速入门

## 🚀 5分钟开始使用

### 1. 前置条件

- Node.js 20+
- pnpm (或 npm/yarn)

### 2. 安装并启动

```bash
cd c:\Users\zexin\Desktop\KeyMemory
pnpm install
pnpm build
```

### 3. 接入方式选择

| 方式 | 适用场景 | 复杂度 |
|------|---------|--------|
| **MCP 服务器 (推荐)** | Claude Desktop, Cursor 等支持 MCP 的工具 | ⭐ |
| **REST API** | 任何支持 HTTP 的 Agent 或应用 | ⭐⭐ |
| **Hermes Adapter** | 自定义 Hermes 集成 | ⭐⭐⭐ |

---

## 方式一：MCP 服务器（推荐）

### 配置到 Claude Desktop

1. 复制配置到 Claude 配置目录：
```bash
# Windows
copy claude_desktop_config.json %APPDATA%\Claude\claude_desktop_config.json

# macOS/Linux
cp claude_desktop_config.json ~/.config/Claude/
```

2. 重启 Claude Desktop，KeyMemory 就会自动加载！

### MCP 可用工具

| 工具 | 示例 |
|------|------|
| `memory_create` | "帮我记住这个：TS 项目需要设置 strict 模式" |
| `memory_search` | "搜索之前关于 TypeScript 配置的记忆" |
| `memory_read` | "读取记忆 id: abc123" |
| `memory_list` | "列出所有长期记忆" |

---

## 方式二：REST API 接入

### 启动服务器

```bash
pnpm dev:server
# 或者生产模式
pnpm --filter @keymemory/server start
```

### API 文档

- 健康检查：`GET http://127.0.0.1:3210/api/health`
- 创建记忆：`POST http://127.0.0.1:3210/api/memories`
- 搜索记忆：`GET http://127.0.0.1:3210/api/memories/search?q=关键词`

### Python 集成示例

```python
import requests

KEYMEMORY_BASE = "http://127.0.0.1:3210/api"

def store_memory(title, content, layer="long"):
    return requests.post(
        f"{KEYMEMORY_BASE}/memories",
        json={"title": title, "content": content, "layer": layer}
    ).json()

def search_memory(query, limit=5):
    return requests.get(
        f"{KEYMEMORY_BASE}/memories/search",
        params={"q": query, "limit": limit}
    ).json()
```

### Node.js 集成示例

```typescript
const KEYMEMORY_BASE = "http://127.0.0.1:3210/api";

async function injectContext(query?: string, project?: string) {
  const res = await fetch(`${KEYMEMORY_BASE}/context/inject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, project, limit: 5 }),
  });
  return await res.json();
}
```

---

## 方式三：直接使用 Adapters

### Hermes 集成

```typescript
import { hermesAdapter, buildHermesSystemPrompt, injectContext } from '@keymemory/server';

// 1. 写入记忆
await hermesAdapter.write({
  title: '项目配置',
  content: '所有 TypeScript 项目必须开启 strict 模式',
  layer: 'long',
  project: 'KeyMemory',
});

// 2. 搜索相关记忆
const memories = await hermesAdapter.search('TypeScript 配置');

// 3. 注入到 Hermes 对话
const systemPrompt = [
  'You are Hermes, an AI assistant.',
  'Use the following KeyMemory context:',
  buildHermesSystemPrompt(await injectContext({ query: 'TS 配置' })),
].join('\n\n');
```

---

## 启动命令汇总

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 前后端同时启动（含热重载） |
| `pnpm dev:server` | 只启动后端 API |
| `pnpm dev:web` | 只启动前端 UI |
| `pnpm start:mcp` | 启动 MCP 服务器（stdio 模式） |
| `pnpm build` | 构建所有包 |

---

## 下一步

1. 访问 `http://localhost:5173` 创建一些测试记忆
2. 配置 MCP 或接入你的 Agent
3. 开始使用！
