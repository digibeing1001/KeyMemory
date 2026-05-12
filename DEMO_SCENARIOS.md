# 🧠 KeyMemory 真实生产力场景演示

展示 KeyMemory 在日常工作中如何**主动收集**和**智能使用**记忆！

---

## 🚀 场景一：项目开发初始化

### 对话示例

**用户：**
> 好的，我要开始开发 KeyMemory 项目了。
>
> 让我梳理一下：
> - 项目名：KeyMemory
> - 技术栈：React + Fastify + SQLite + ONNX
> - 架构：pnpm monorepo
> - 数据库：SQLite（本地存储，不用服务器）
> - 主要功能：个人记忆系统，让 AI 记住用户信息

**KeyMemory 会做：**
```typescript
// 🧠 AI 自动调用：memory_create
{
  "title": "KeyMemory 项目初始化",
  "content": "项目：KeyMemory\n\n技术栈：\n- 前端：React\n- 后端：Fastify (Node.js)\n- 数据库：SQLite (better-sqlite3)\n- 搜索：SQLite FTS5 + 向量搜索\n- 嵌入：ONNX Runtime (本地运行)\n\n架构：pnpm monorepo\n\n核心功能：个人记忆系统，MCP 服务器，支持 Agent 集成",
  "layer": "project",
  "project": "KeyMemory"
}
```

---

## 🔧 场景二：解决技术问题

### 对话示例

**用户：**
> 糟糕，遇到了 better-sqlite3 的问题！它不能直接在浏览器里用，必须是 Node.js。
>
> 我还是单独用后端做数据库访问吧。

**KeyMemory 会做：**
```typescript
// 🧠 自动记录踩坑经验
{
  "title": "技术踩坑：better-sqlite3 环境限制",
  "content": "技术问题：better-sqlite3 仅 Node.js 环境可用，浏览器不支持\n\n解决方案：\n- 数据库操作全部放在 Node.js 后端\n- 前端通过 API 与数据库交互\n- 前后端分离架构",
  "layer": "long"
}
```

### 后续对话

**用户（一周后）：**
> 我能不能用 better-sqlite3 前端？

**KeyMemory 会做：**
```typescript
// 🧠 先搜索记忆
memory_search("better-sqlite3")

// 🧠 找到记忆后，提醒用户：
// "你之前试过这个，better-sqlite3 只能在 Node.js 用哦。"
```

---

## 👥 场景三：团队协作信息

### 对话示例

**用户：**
> 对了，我们团队有 3 个人：
> - 张三：全栈，主要写前端，喜欢用 Tailwind
> - 李四：后端专家，擅长数据库优化
> - 王五：产品经理，每天下午 3 点要开会

**KeyMemory 会做：**
```typescript
// 🧠 保存团队信息（entity 层级）
{
  "title": "团队成员信息",
  "content": "团队成员：\n\n👤 张三\n- 角色：全栈开发\n- 专长：前端\n- 偏好：Tailwind CSS\n\n👤 李四\n- 角色：后端专家\n- 专长：数据库优化\n\n👤 王五\n- 角色：产品经理\n- 习惯：每天下午 3 点开会",
  "layer": "entity"
}
```

---

## 📅 场景四：项目进度追踪

### 对话示例

**用户：**
> 今天完成了 MCP 服务器的搭建！
>
> 目前进度：
> - ✅ SQLite 数据库搭建
> - ✅ CRUD API 接口
> - ✅ MCP 服务器实现
> - ⏳ 还需要做：语义搜索、Web UI

**KeyMemory 会做：**
```typescript
// 🧠 保存项目进度（project 层级）
{
  "title": "KeyMemory 项目进度更新",
  "content": "项目：KeyMemory\n更新时间：2026-05-11\n\n已完成：\n✅ SQLite 数据库初始化 + FTS5\n✅ 记忆 CRUD API\n✅ MCP 服务器实现\n✅ monorepo 架构\n\n待完成：\n⏳ 语义搜索 (ONNX)\n⏳ Web UI (React)\n⏳ 记忆衰变机制\n⏳ 测试 + 文档",
  "layer": "project",
  "project": "KeyMemory"
}
```

---

## 📚 场景五：技术决策记录

### 对话示例

**用户：**
> 向量搜索我决定用 ONNX + all-MiniLM-L6-v2，不用 OpenAI 的 API，因为：
> 1. 免费本地运行，不用花钱
> 2. 隐私安全，不上网
> 3. 速度更快，不用网络请求

**KeyMemory 会做：**
```typescript
// 🧠 保存技术决策（带理由！）
{
  "title": "技术选型：向量搜索方案",
  "content": "技术方案：向量搜索\n\n选型：ONNX Runtime + all-MiniLM-L6-v2\n\n选择理由：\n1. 💰 完全免费，本地运行\n2. 🔒 隐私安全，不联网\n3. ⚡️ 速度快，无网络延迟\n\n替代方案：OpenAI Embedding API（对比：花钱、联网、隐私问题）",
  "layer": "entity"
}
```

---

## 💡 场景六：常见工作流程

### 日常对话示例（AI 主动收集记忆）

```
用户："我每周一上午 10 点有例会"
🧠 保存到 long 层级记忆

用户："这个 bug 用 setTimeout 绕过去了"
🧠 记录问题和临时方案（short 层级）

用户："这个项目截止日期是 6 月底"
🧠 保存项目里程碑（project 层级）

用户："我喜欢用 VS Code 的快捷键：Ctrl+D 多选"
🧠 保存技术偏好（long 层级）

用户："这个 API 文档地址是 https://docs.example.com"
🧠 保存有用链接（long 层级）
```

---

## 🔄 场景七：上下文感知回复

### 对话示例

**用户：**
> 帮我写个数据库 schema

**KeyMemory 会做：**
```typescript
// 🧠 先搜索之前的记忆
memory_search("KeyMemory SQLite")

// 🧠 找到项目信息后，自动结合上下文：
// "基于我们之前的 KeyMemory 项目，我给你写一个包含记忆表的 schema..."
```

---

## 📖 使用 KeyMemory 的日常工作流

### 理想流程

1. **开始工作** → 先列出项目记忆：`memory_list` 或搜索项目名
2. **遇到问题** → 先搜索：有没有解决过？
3. **解决问题** → 自动记录：`memory_create`（AI 主动做！）
4. **结束工作** → 可以保存进度或重要决策

---

## 🎯 总结：KeyMemory 如何提升生产力

| 传统方式 | KeyMemory 方式 |
|---------|--------------|
| "那个问题我之前怎么解决的？翻聊天记录..." | 🔍 一键搜索记忆 |
| "等一下，项目技术栈是什么来着？" | 📦 随时查看项目信息 |
| "我跟谁提过这个？不记得了" | 👥 团队信息统一管理 |
| "又要查文档，之前看过的" | 📝 保存常用信息 |

