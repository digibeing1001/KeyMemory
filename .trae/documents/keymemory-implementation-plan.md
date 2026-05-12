# KeyMemory 实施计划

## 摘要

基于 Notion 文档「KeyMemory 产品定义与设计文档 v1.1」，实现个人记忆操作系统（Personal Memory OS）。采用本地服务 + Web 前端架构，用户运行 `keymemory start` 后浏览器打开即用。

**技术栈决策：**
- 架构：本地 Node.js 后端 + React Web 前端（浏览器访问）
- 包管理：pnpm + monorepo（pnpm workspace）
- 后端：Fastify + better-sqlite3（FTS5）+ onnxruntime-node
- 前端：React + Vite + shadcn/ui + Tailwind CSS
- 语义编码：ONNX Runtime（本地模型）
- 协议：REST API + MCP（Model Context Protocol）

**实施范围：** 全部 4 个 Phase，约 8 周

---

## 当前状态分析

- 项目目录 `c:\Users\zexin\Desktop\KeyMemory` 完全空白
- 环境已具备：Node.js v25.6.0、pnpm 11.0.8、bun 1.3.13
- 环境缺失：Rust（不需要了，已放弃 Tauri 方案）
- Notion 文档已完整读取，包含 10 个章节的产品定义

---

## 项目结构

```
KeyMemory/
├── package.json                  # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── shared/                   # 共享类型定义
│   │   ├── package.json
│   │   └── src/
│   │       ├── types.ts          # 记忆原子、层级、实体等类型
│   │       └── constants.ts      # 层级定义、阈值常量
│   ├── server/                   # 后端服务
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts          # Fastify 入口
│   │       ├── core/
│   │       │   ├── atom.ts       # 记忆原子 CRUD
│   │       │   ├── layer.ts      # 五层管理 + 层间流动
│   │       │   ├── query.ts      # 查询引擎（全文+语义）
│   │       │   ├── context.ts    # 上下文注入
│   │       │   ├── evolution.ts  # 自进化引擎
│   │       │   ├── compression.ts# 记忆压缩
│   │       │   ├── forgetting.ts # 遗忘机制
│   │       │   ├── provenance.ts # 版本溯源
│   │       │   └── health.ts     # 健康度检测
│   │       ├── db/
│   │       │   ├── sqlite.ts     # SQLite 连接 + 迁移
│   │       │   ├── schema.ts     # Schema 定义
│   │       │   └── migrations/   # SQL 迁移文件
│   │       ├── embed/
│   │       │   └── onnx.ts       # ONNX 语义编码
│   │       ├── graph/
│   │       │   └── entity.ts     # 实体解析 + 关系图谱
│   │       ├── adapters/
│   │       │   ├── base.ts       # MCP 统一接口
│   │       │   ├── hermes.ts     # Hermes adapter
│   │       │   ├── openclaw.ts   # OpenClaw adapter
│   │       │   └── claude-code.ts# Claude Code .claude/ 同步
│   │       ├── api/
│   │       │   ├── rest.ts       # REST API 路由
│   │       │   └── mcp.ts        # MCP 协议实现
│   │       └── selfcheck/
│   │           └── evaluator.ts  # 自检算法（五维度评估）
│   └── web/                      # 前端应用
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.ts
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── lib/
│           │   └── api.ts        # 后端 API 客户端
│           ├── views/
│           │   ├── Search.tsx     # 检索（语义+全文+图谱）
│           │   ├── Editor.tsx     # 编辑（Markdown+实体提取）
│           │   ├── Timeline.tsx   # 时间线
│           │   ├── Projects.tsx   # 项目视图
│           │   ├── Entities.tsx   # 实体关系图谱
│           │   ├── Health.tsx     # 健康度面板
│           │   ├── Evolution.tsx  # 进化面板
│           │   └── Versions.tsx   # 版本历史
│           └── components/
│               ├── Layout.tsx     # 三栏布局
│               ├── LayerNav.tsx   # 分层导航
│               ├── MemoryList.tsx # 记忆列表
│               ├── MemoryCard.tsx # 记忆卡片
│               ├── MarkdownEditor.tsx
│               └── SearchBar.tsx
```

---

## Phase 1: 核心存储（步骤 1-5）

### 步骤 1: 项目初始化

**做什么：** 搭建 monorepo 骨架，配置 pnpm workspace、TypeScript、ESLint

**文件：**
- `package.json` — workspace root，scripts: dev/build/lint
- `pnpm-workspace.yaml` — packages: ['packages/*']
- `tsconfig.base.json` — 共享 TS 配置
- `packages/shared/package.json` + `tsconfig.json`
- `packages/server/package.json` + `tsconfig.json`
- `packages/web/package.json` + `tsconfig.json`

**依赖：**
- server: fastify, better-sqlite3, onnxruntime-node, uuid
- web: react, react-dom, react-router-dom, tailwindcss, @shadcn/ui
- shared: 无外部依赖（纯类型）

**验证：** `pnpm install` 成功，`pnpm -r build` 无报错

### 步骤 2: 数据库 Schema 设计

**做什么：** SQLite Schema + FTS5 全文索引 + 迁移系统

**文件：**
- `packages/server/src/db/sqlite.ts` — 连接管理，数据目录 `~/.keymemory/data.db`
- `packages/server/src/db/schema.ts` — 表结构定义
- `packages/server/src/db/migrations/001_init.sql`

**Schema 设计：**

```sql
-- 记忆原子主表
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,          -- Markdown 内容
  layer TEXT NOT NULL,            -- flash|short|long|project|entity
  project TEXT,                   -- 项目名称（L4专用）
  confidence REAL DEFAULT 1.0,    -- 置信度
  hit_count INTEGER DEFAULT 0,    -- 命中次数
  last_hit_at TEXT,               -- 最后命中时间
  status TEXT DEFAULT 'active',   -- active|archived|decayed|deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  decay_factor REAL DEFAULT 1.0   -- 衰减系数
);

-- FTS5 全文索引
CREATE VIRTUAL TABLE memories_fts USING fts5(
  title, content, project,
  content=memories,
  content_rowid=rowid,
  tokenize='unicode61'
);

-- 实体表（L5 人事物）
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,             -- person|tool|concept|organization
  properties TEXT,                -- JSON 属性
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 关系表
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL,    -- belongs_to|related_to|depends_on|...
  strength REAL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES entities(id),
  FOREIGN KEY (target_id) REFERENCES entities(id)
);

-- 记忆-实体关联表
CREATE TABLE memory_entities (
  memory_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (memory_id, entity_id),
  FOREIGN KEY (memory_id) REFERENCES memories(id),
  FOREIGN KEY (entity_id) REFERENCES entities(id)
);

-- 版本历史表
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  change_type TEXT NOT NULL,      -- create|update|layer_move|merge|restore
  change_reason TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);

-- 向量索引表（语义搜索）
CREATE TABLE embeddings (
  memory_id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,        -- Float32 向量
  model TEXT NOT NULL,            -- 模型名称
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);

-- 自检日志表
CREATE TABLE selfcheck_logs (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  conversation_round INTEGER,
  scores TEXT NOT NULL,           -- JSON: 五维度分数
  total REAL NOT NULL,
  action TEXT NOT NULL,           -- auto_record|suggest|ignore
  created_at TEXT NOT NULL
);

-- 进化任务表
CREATE TABLE evolution_tasks (
  id TEXT PRIMARY KEY,
  task_type TEXT NOT NULL,        -- merge|archive|solidify|conflict|orphan
  source_ids TEXT NOT NULL,       -- JSON array
  suggestion TEXT NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending|accepted|rejected|expired
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

-- 隔离规则表（多Agent）
CREATE TABLE isolation_rules (
  id TEXT PRIMARY KEY,
  agent_id TEXT,                  -- null = 全局规则
  rule_type TEXT NOT NULL,        -- layer|keyword|regex|composite
  pattern TEXT NOT NULL,
  target_space TEXT NOT NULL,     -- global|private|project:xxx
  priority INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT NOT NULL
);
```

**验证：** 数据库初始化成功，所有表创建无误

### 步骤 3: 记忆原子与五层管理核心模块

**做什么：** 实现核心类型定义和五层管理逻辑

**文件：**
- `packages/shared/src/types.ts` — 所有共享类型
- `packages/shared/src/constants.ts` — 层级定义、阈值常量
- `packages/server/src/core/atom.ts` — 记忆原子 CRUD
- `packages/server/src/core/layer.ts` — 五层管理 + 层间流动规则

**类型定义（types.ts）：**

```typescript
export type Layer = 'flash' | 'short' | 'long' | 'project' | 'entity';
export type MemoryStatus = 'active' | 'archived' | 'decayed' | 'deleted';
export type EntityType = 'person' | 'tool' | 'concept' | 'organization';
export type ChangeType = 'create' | 'update' | 'layer_move' | 'merge' | 'restore';
export type EvolutionTaskType = 'merge' | 'archive' | 'solidify' | 'conflict' | 'orphan';
export type IsolationMode = 'isolated' | 'shared' | 'hybrid' | 'project';
export type ForgetMethod = 'archive' | 'decay' | 'delete';

export interface Memory {
  id: string;
  title: string;
  content: string;
  layer: Layer;
  project?: string;
  confidence: number;
  hitCount: number;
  lastHitAt?: string;
  status: MemoryStatus;
  decayFactor: number;
  createdAt: string;
  updatedAt: string;
  entities?: Entity[];
  tags?: string[];
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  properties?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Relation {
  id: string;
  sourceId: string;
  targetId: string;
  relationType: string;
  strength: number;
  createdAt: string;
}

export interface Version {
  id: string;
  memoryId: string;
  version: number;
  title: string;
  content: string;
  changeType: ChangeType;
  changeReason?: string;
  createdAt: string;
}

export interface SelfCheckResult {
  projectRelevance: number;
  longTermValue: number;
  novelty: number;
  userEmphasis: number;
  reusability: number;
  total: number;
  action: 'auto_record' | 'suggest' | 'ignore';
}

export interface EvolutionTask {
  id: string;
  taskType: EvolutionTaskType;
  sourceIds: string[];
  suggestion: string;
  status: 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: string;
  resolvedAt?: string;
}
```

**五层管理逻辑（layer.ts）：**
- 层间流动规则实现（文档 §2.2）
  - 闪念→短期：手动标记 / 7天内引用>2次 / 项目绑定
  - 短期→长期：手动固化 / 3项目验证 / 30天查询>10次
- 衰减策略
  - 闪念：7天未命中 → 0.9/天
  - 短期：30天未命中 → 0.95/天
  - 长期：永不衰减

**验证：** 单元测试通过，CRUD 操作正确

### 步骤 4: CRUD API（REST + MCP 协议）

**做什么：** 实现 REST API 和 MCP 协议

**文件：**
- `packages/server/src/index.ts` — Fastify 入口，注册路由和插件
- `packages/server/src/api/rest.ts` — REST API 路由
- `packages/server/src/api/mcp.ts` — MCP 协议实现

**REST API 设计：**

```
POST   /api/memories              # 创建记忆
GET    /api/memories              # 列表（支持 layer/project/status 筛选）
GET    /api/memories/:id          # 获取详情
PUT    /api/memories/:id          # 更新记忆
DELETE /api/memories/:id          # 删除记忆
PATCH  /api/memories/:id/layer    # 层间移动
GET    /api/memories/search       # 全文搜索

POST   /api/entities              # 创建实体
GET    /api/entities              # 列表
GET    /api/entities/:id          # 详情

GET    /api/versions/:memoryId    # 版本历史

GET    /api/health                # 健康度概览
GET    /api/evolution/tasks       # 进化任务列表
POST   /api/evolution/tasks/:id/resolve  # 处理进化任务
```

**MCP 协议：**
- 暴露为 MCP Server，提供 tools/resources/prompts
- 核心工具：memory_create, memory_search, memory_update, memory_delete, context_inject

**验证：** API 端点测试通过，MCP 工具可被外部 Agent 调用

### 步骤 5: 基础 UI（三栏布局）

**做什么：** 实现前端三栏布局和基础视图

**文件：**
- `packages/web/src/App.tsx` — 路由配置
- `packages/web/src/components/Layout.tsx` — 三栏布局
- `packages/web/src/components/LayerNav.tsx` — 左侧分层导航
- `packages/web/src/components/MemoryList.tsx` — 中间记忆列表
- `packages/web/src/components/MemoryCard.tsx` — 记忆卡片
- `packages/web/src/components/MarkdownEditor.tsx` — Markdown 编辑器
- `packages/web/src/components/SearchBar.tsx` — 搜索栏
- `packages/web/src/views/Editor.tsx` — 编辑视图
- `packages/web/src/views/Projects.tsx` — 项目视图
- `packages/web/src/lib/api.ts` — API 客户端

**布局（文档 §5.1）：**
```
┌─────────────────────────────────────────────────────┐
│ [KeyMemory] [搜索框🔍] [+ 新建] [健康度⚡] [设置⚙]  │
├──────────┬──────────────────────┬─────────────────────┤
│  分层    │    记忆列表           │    详情/编辑         │
│  导航    │    （可筛选排序）      │    （Markdown）      │
│          │                      │                     │
│  ▶ 闪念  │  • 记忆卡片...       │  ┌───────────────┐  │
│  ▶ 短期  │                      │  │ [编辑] [归档]  │  │
│  ▶ 长期  │                      │  │ [关联] [引用]  │  │
│  ▶ 项目  │                      │  └───────────────┘  │
│  ▶ 人事物│                      │                     │
└──────────┴──────────────────────┴─────────────────────┘
```

**验证：** 页面渲染正确，CRUD 操作可通过 UI 完成

---

## Phase 2: 智能层（步骤 6-10）

### 步骤 6: 本地 ONNX Embedding 语义编码

**做什么：** 集成 ONNX Runtime，实现本地语义编码

**文件：**
- `packages/server/src/embed/onnx.ts`

**实现：**
- 使用 onnxruntime-node 加载本地 ONNX 模型
- 模型选择：all-MiniLM-L6-v2（轻量，80MB，384维）
- 模型存储路径：`~/.keymemory/models/`
- 首次启动自动下载模型
- 提供 `embed(text: string): Float32Array` 接口
- 批量编码 `embedBatch(texts: string[]): Float32Array[]`

**验证：** 给定文本能返回正确维度的向量

### 步骤 7: 语义搜索 + 全文搜索融合

**做什么：** 实现混合搜索引擎

**文件：**
- `packages/server/src/core/query.ts` — 查询引擎

**实现：**
- 全文搜索：SQLite FTS5，BM25 排序
- 语义搜索：余弦相似度，Top-K 检索
- 融合策略：RRF（Reciprocal Rank Fusion）
  - 全文分数权重 0.4，语义分数权重 0.6
- API: `search(query: string, options?: { layer?, project?, limit? }): SearchResult[]`

**验证：** 搜索结果兼顾关键词匹配和语义相关性

### 步骤 8: 自检算法（五维度价值评估）

**做什么：** 实现每10轮对话触发的自检算法

**文件：**
- `packages/server/src/selfcheck/evaluator.ts`

**实现（文档 §3.1）：**
- 五维度评估模型：
  - projectRelevance (0.3)：关联活跃项目
  - longTermValue (0.3)：影响未来决策
  - novelty (0.2)：与现有记忆差异
  - userEmphasis (0.1)：用户强调/重复
  - reusability (0.1)：跨场景复用
- 阈值处理：
  - total > 0.75 → 自动记录，静默处理
  - total > 0.60 → 生成建议卡片，用户一键确认
  - total ≤ 0.60 → 忽略
- 触发机制：对话轮次计数器，每10轮触发

**验证：** 自检评分逻辑正确，不同阈值触发不同动作

### 步骤 9: 进化引擎（整合/精炼/归档建议）

**做什么：** 实现每日巡检的进化引擎

**文件：**
- `packages/server/src/core/evolution.ts`

**实现（文档 §3.2）：**
- 5 项每日巡检任务：
  1. 闪念扫描：>7天未整理 → 标灰
  2. 短期扫描：命中次数>10 → 生成固化建议
  3. 重复检测：语义相似度>0.9 → 合并建议
  4. 孤儿检测：无实体/无项目/无关联 → 标红
  5. 矛盾检测：同一实体相反断言 → 标冲突
- 巡检结果写入 evolution_tasks 表
- API 提供任务列表和处理接口

**验证：** 巡检任务正确生成，建议可被用户接受/拒绝

### 步骤 10: 实体提取 + 关系图谱基础

**做什么：** 实现 @#[[ 语法解析和实体关系图谱

**文件：**
- `packages/server/src/graph/entity.ts`

**实现：**
- 语法解析：
  - `@人名` → 人物实体
  - `#标签` → 概念实体
  - `[[项目名]]` → 项目关联
- 保存记忆时自动提取实体和关系
- 实体-记忆关联写入 memory_entities 表
- 关系写入 relations 表
- API: 实体 CRUD、关系查询、图谱数据

**验证：** 编辑器中输入 @#[[ 语法后实体正确提取和关联

---

## Phase 3: 高级功能（步骤 11-14）

### 步骤 11: 版本溯源

**做什么：** 实现完整 diff 链和版本历史

**文件：**
- `packages/server/src/core/provenance.ts`
- `packages/web/src/views/Versions.tsx`

**实现：**
- 每次记忆变更自动创建版本记录
- 版本链：v1 → v2 → v3，可追溯完整变更历史
- changeType: create|update|layer_move|merge|restore
- changeReason: 记录变更原因（手动/自动）
- API: 版本列表、版本对比（diff）、版本回滚

**验证：** 修改记忆后版本正确记录，可查看 diff 和回滚

### 步骤 12: 遗忘机制

**做什么：** 实现衰减策略和三种遗忘方式

**文件：**
- `packages/server/src/core/forgetting.ts`

**实现（文档 §3.3）：**
- 衰减策略：
  - 闪念：7天未命中 → 衰减系数 0.9/天
  - 短期：30天未命中 → 衰减系数 0.95/天
  - 长期：永不衰减（只更新置信度）
- 遗忘方式：
  - archive：移入归档库（可恢复）
  - decay：置信度归零（可逆转）
  - delete：彻底删除（需确认）
- 定时任务：每日执行衰减计算

**验证：** 衰减计算正确，归档/恢复流程正常

### 步骤 13: 记忆压缩

**做什么：** 实现分层摘要生成

**文件：**
- `packages/server/src/core/compression.ts`

**实现：**
- 同一项目下多条记忆 → 生成项目摘要
- 同一实体相关记忆 → 生成实体摘要
- 压缩策略：保留关键信息，去除冗余
- 压缩后原始记忆保留（可展开查看）
- 可选接入 LLM 进行智能摘要（预留接口）

**验证：** 压缩后摘要保留核心信息

### 步骤 14: 上下文注入 + 健康度面板

**做什么：** 实现上下文注入和健康度检测

**文件：**
- `packages/server/src/core/context.ts`
- `packages/server/src/core/health.ts`
- `packages/web/src/views/Health.tsx`

**实现：**

**上下文注入（context.ts）：**
- 根据当前对话上下文，自动注入相关记忆
- 注入策略：当前项目 > 最近命中 > 高置信度
- 注入格式：结构化 system prompt 片段
- 优先注入 Hermes（文档 §6 P2）

**健康度面板（health.ts）：**
- 检测指标：
  - 重复率：语义相似度>0.9 的记忆对数
  - 孤儿率：无关联记忆占比
  - 矛盾数：同一实体冲突断言数
  - 衰减率：即将衰减的记忆数
  - 层级分布：各层记忆数量和占比
- 健康度评分：0-100，综合各指标
- UI 面板展示各指标和趋势

**验证：** 健康度面板正确展示各指标，上下文注入返回相关记忆

---

## Phase 4: 工具适配（步骤 15-16）

### 步骤 15: Agent Harness 统一适配层 + 多Agent隔离

**做什么：** 实现统一适配层和多 Agent 记忆隔离

**文件：**
- `packages/server/src/adapters/base.ts` — MCP 统一接口
- `packages/server/src/api/mcp.ts` — 完善 MCP 协议

**实现（文档 §9, §10）：**

**Agent Harness（base.ts）：**
- 统一接口定义：read/write/search/context
- 适配器注册机制
- 请求路由：根据 agent_id 路由到对应适配器

**多 Agent 隔离：**
- 四种模式：isolated / shared / hybrid / project
- 默认模式：hybrid（全局池 + Agent 私有空间）
- 智能分流三层判断：
  1. 硬规则（O(1)）：层级规则、关键词规则、敏感规则、项目规则
  2. 智能推测（LLM 异步）：语义分析、关系分析、复用分析
  3. 用户确认（仅冲突时）：规则 vs 推测不一致 / 置信度<0.8 / 涉及敏感信息
- 用户自定义规则引擎：层级路由、关键词规则、正则规则、复合规则
- 反馈闭环：用户纠正 → 模式分析 → 规则建议 → 一键采纳

**验证：** 不同 Agent 写入的记忆按隔离策略正确分流

### 步骤 16: 三方适配器

**做什么：** 实现 Hermes、Claude Code、OpenClaw 适配器

**文件：**
- `packages/server/src/adapters/hermes.ts`
- `packages/server/src/adapters/claude-code.ts`
- `packages/server/src/adapters/openclaw.ts`

**实现：**

**Hermes adapter：**
- 通过 memory provider 接口 + system prompt 注入
- 读取 Hermes 配置，同步记忆

**Claude Code adapter：**
- 通过 `.claude/CLAUDE.md` 双向同步
- 监听文件变更，自动同步

**OpenClaw adapter：**
- 通过 MCP server 提供 tools/resources/prompts
- 标准 MCP 协议对接

**验证：** 各适配器能正确读写对应 Agent 的记忆

---

## 假设与决策记录

| 决策项 | 选择 | 原因 |
|--------|------|------|
| 架构 | 本地服务 + Web 前端 | 无需安装桌面应用，浏览器即用 |
| 桌面壳 | 暂不使用 | 后续可选择性用 Tauri 包装 |
| 后端框架 | Fastify | 高性能、TypeScript 优先 |
| SQLite 驱动 | better-sqlite3 | 原生性能最佳，支持 FTS5 |
| 前端框架 | React + Vite | 生态成熟，shadcn/ui 兼容 |
| UI 组件库 | shadcn/ui + Tailwind | 现代设计，可定制性强 |
| 包管理器 | pnpm | 磁盘效率高，monorepo 友好 |
| 项目结构 | Monorepo | 前后端共享类型，统一管理 |
| Embedding 模型 | all-MiniLM-L6-v2 | 轻量（80MB），384维，本地运行 |
| 默认隔离模式 | hybrid | 平衡隐私和共享 |
| ONNX Runtime | onnxruntime-node | Node.js 原生绑定，性能好 |

---

## 验证步骤

每个 Phase 完成后的验证：

1. **Phase 1 验证：**
   - `pnpm install` && `pnpm -r build` 无报错
   - 服务器启动成功，`http://localhost:3000` 可访问
   - 通过 UI 完成：新建记忆 → 编辑 → 搜索 → 删除
   - 五层切换和层间移动正常

2. **Phase 2 验证：**
   - 语义搜索返回相关结果（非仅关键词匹配）
   - 自检算法在对话后正确触发
   - 进化引擎巡检任务正确生成
   - @#[[ 语法正确提取实体

3. **Phase 3 验证：**
   - 版本历史可查看和回滚
   - 衰减计算正确执行
   - 健康度面板展示各指标
   - 上下文注入返回相关记忆

4. **Phase 4 验证：**
   - MCP 工具可被外部 Agent 调用
   - 多 Agent 隔离策略正确执行
   - 至少一个适配器（Claude Code）正常工作
