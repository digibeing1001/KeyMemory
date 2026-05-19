# KeyMemory 代码审查报告

**审查日期**: 2026-05-20
**审查范围**: 完整代码库（server / web / shared）
**版本**: 0.1.0
**审查人**: AI Code Reviewer

---

## 执行摘要

KeyMemory 是一个功能丰富的五层记忆系统 MCP 服务器，代码结构清晰，采用了 monorepo + pnpm workspace 架构。经过全面审查，发现 **1 个严重构建错误**（已修复）和 **若干安全及质量问题**，建议在下个版本中修复后再进行正式分发。

| 类别 | 数量 | 状态 |
|------|------|------|
| 严重 (Critical) | 0 | - |
| 高 (High) | 3 | 待修复 |
| 中 (Medium) | 5 | 建议修复 |
| 低 (Low) | 4 | 建议改进 |
| 已修复 | 1 | ✅ |

---

## 已修复问题

### ✅ [FIXED] 构建错误：DreamReport 类型缺少 `durationMs` 属性

**位置**: 
- `packages/shared/src/types.ts`
- `packages/web/src/lib/api.ts`

**问题描述**: 
`DreamView.tsx` 组件引用了 `durationMs` 属性，但 `DreamReport` 接口中没有定义此属性，导致 TypeScript 编译失败。

**修复方式**:
```typescript
// packages/shared/src/types.ts
export interface DreamReport {
  // ... 其他字段
  durationMs?: number;  // 新增
}

// packages/web/src/lib/api.ts
export interface DreamReport {
  // ... 其他字段
  durationMs?: number;  // 新增
}
```

**验证**: `pnpm build` 和 `pnpm typecheck` 全部通过 ✅

---

## 高优先级问题（HIGH）

### 🔴 HIGH-1: CORS 配置过于宽松

**位置**: 
- `packages/server/src/index.ts:24`
- `packages/server/src/cli.ts:556`
- `packages/server/src/mcp-server.ts:33`

**问题描述**: 
所有入口文件都使用了 `origin: true`，允许任何来源访问 API。对于一个本地数据存储工具，虽然便利，但存在安全风险：
- 恶意网站可以通过 CSRF 攻击访问用户的记忆数据
- 如果用户在公共网络使用，数据可能被窃取

**建议修复**:
```typescript
// 方案 A: 仅允许本地访问
await app.register(cors, { 
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3210'] 
});

// 方案 B: 提供环境变量配置
cors: {
  origin: process.env.KEYMEMORY_CORS_ORIGIN?.split(',') || ['http://localhost:5173']
}
```

### 🔴 HIGH-2: 缺少输入验证和 Sanitization

**位置**: 
- `packages/server/src/api/rest.ts` - 多个端点

**问题描述**: 
大量 API 端点直接接受并处理用户输入，缺少适当的验证：
- `/api/memories` POST - `title`, `content`, `layer` 仅做存在性检查，无长度限制
- `/api/memories/import` - 导入 JSON 无 schema 验证
- `/api/sync/claude-md` - 写入文件系统无路径验证
- `/api/scheduler/config` - 配置更新无验证

**风险**: 
- 超长输入可能导致 DoS
- 无效数据可能导致数据库异常
- 导入恶意数据可能污染记忆库

**建议修复**:
引入 Zod 或类似库进行输入验证：
```typescript
import { z } from 'zod';

const CreateMemorySchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(50000),
  layer: z.enum(['flash', 'short', 'long', 'project', 'entity']),
  // ...
});
```

### 🔴 HIGH-3: 类型定义重复

**位置**: 
- `packages/shared/src/types.ts`
- `packages/web/src/lib/api.ts`

**问题描述**: 
`DreamReport`, `DreamSession`, `SchedulerConfig` 等类型在 shared 包和 web 包中重复定义。这导致类型不一致（如 `durationMs` 缺失问题），增加了维护成本。

**建议修复**:
web 包应该从 `@keymemory/shared` 导入类型，而不是重复定义：
```typescript
// 替代方案
import type { DreamReport, DreamSession, SchedulerConfig } from '@keymemory/shared';
```

---

## 中优先级问题（MEDIUM）

### 🟡 MEDIUM-1: Web UI 缺少 XSS 防护

**位置**: 
- `packages/web/src/components/MarkdownRenderer.tsx`

**问题描述**: 
自定义 Markdown 渲染器缺少对 HTML 标签的过滤。虽然不使用 `dangerouslySetInnerHTML`，但用户输入的 Markdown 中如果包含 HTML，可能会被执行。

**建议修复**:
在渲染前过滤 HTML 标签：
```typescript
function sanitizeHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}
```

### 🟡 MEDIUM-2: 错误处理不一致

**位置**: 
- `packages/server/src/api/rest.ts`

**问题描述**: 
错误处理方式不一致：
- 部分端点使用 `reply.code(404)` 后返回对象
- 部分端点直接返回 `{ error: '...' }` 而不设置状态码
- 部分端点使用 try-catch，部分不使用

**建议修复**:
统一错误处理中间件：
```typescript
app.setErrorHandler((error, request, reply) => {
  if (error.validation) {
    return reply.code(400).send({ error: 'Validation failed', details: error.message });
  }
  // ...
});
```

### 🟡 MEDIUM-3: 数据库查询缺少分页限制

**位置**: 
- `packages/server/src/api/rest.ts:342-356`

**问题描述**: 
`/api/backup` 端点查询整个数据库所有表，没有限制。如果数据量大，可能导致内存溢出。

**建议修复**:
添加分页或限制：
```typescript
const data = db.prepare(`SELECT * FROM memories LIMIT 10000`).all();
```

### 🟡 MEDIUM-4: 定时任务缺乏容错

**位置**: 
- `packages/server/src/index.ts:38-45`
- `packages/server/src/mcp-server.ts:17-19`

**问题描述**: 
使用 `setInterval` 执行定时任务，如果某次执行失败，后续执行不会受到影响，但错误仅被简单记录。更关键的是，`86400000` (24小时) 的间隔不够精确，如果服务在重启后运行，可能会错过执行窗口。

**建议修复**:
使用 Cron 或调度库替代简单 interval：
```typescript
import cron from 'node-cron';

// 每天凌晨执行
cron.schedule('0 0 * * *', async () => {
  await runDailyInspection();
  applyDecay();
});
```

### 🟡 MEDIUM-5: CLI 缺少输入验证

**位置**: 
- `packages/server/src/cli.ts`

**问题描述**: 
多个 CLI 命令接受文件路径等用户输入，但没有验证路径是否在允许范围内：
- `import` 命令的 `--file` 参数
- `serve` 命令的 `--data-dir` 参数

**风险**: 
潜在的路径遍历攻击

**建议修复**:
验证路径安全性：
```typescript
function resolveSafePath(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  if (!resolved.startsWith(process.cwd()) && !resolved.startsWith(os.homedir())) {
    throw new Error('Invalid path');
  }
  return resolved;
}
```

---

## 低优先级问题 / 建议（LOW）

### 🟢 LOW-1: 大量 console.log 需要替换为结构化日志

**位置**: 多个文件

**建议**: 
使用 pino 或 winston 等结构化日志库，支持日志级别控制和输出格式化。

### 🟢 LOW-2: 版本号硬编码

**位置**: 
- `packages/server/src/mcp-server.ts:73`
- `packages/server/src/cli.ts:128`
- `packages/server/src/api/mcp.ts:96`

**建议**: 
从 package.json 读取版本号：
```typescript
import { readFileSync } from 'fs';
const { version } = JSON.parse(readFileSync('./package.json', 'utf8'));
```

### 🟢 LOW-3: 缺少 API 文档

**建议**: 
使用 Swagger/OpenAPI 自动生成 API 文档，便于第三方集成。

### 🟢 LOW-4: 测试覆盖率不足

**现状**: 
项目中未看到测试文件。

**建议**: 
为关键功能添加单元测试和集成测试，特别是：
- 记忆 CRUD 操作
- 搜索算法
- SelfCheck 评估逻辑
- Agent 隔离规则

---

## 架构质量评估

### ✅ 优点

1. **清晰的 Monorepo 架构**: pnpm workspace 组织合理，shared 包提取公共类型
2. **模块化设计**: core, adapters, db, graph 等模块职责清晰
3. **五层记忆模型**: 设计精巧，符合认知科学原理
4. **Agent 隔离**: 支持多种隔离模式，保护用户隐私
5. **版本溯源**: 每条记忆都有完整的版本历史
6. **内置嵌入模型**: 无需外部 API 即可使用语义搜索
7. **Web UI 美观**: 现代化的界面设计，交互流畅

### ⚠️ 需要改进

1. **类型一致性**: shared 包和 web 包类型定义重复
2. **错误边界**: Web UI 缺少 ErrorBoundary，错误可能导致白屏
3. **数据迁移**: 数据库 schema 变更通过 ALTER TABLE 处理，缺少正式迁移系统
4. **配置管理**: 缺少统一的配置管理，环境变量散落各处

---

## 正式分发前检查清单

### 必须完成（BLOCKING）

- [x] **构建通过**: `pnpm build` 成功
- [x] **类型检查通过**: `pnpm typecheck` 无错误
- [ ] **修复 CORS 配置**: 限制为本地访问或提供配置选项
- [ ] **添加输入验证**: 至少对关键 API 端点添加 Zod 验证
- [ ] **统一类型定义**: 移除 web 包中重复的类型定义

### 强烈建议（STRONGLY RECOMMENDED）

- [ ] **添加 XSS 防护**: 在 MarkdownRenderer 中过滤 HTML
- [ ] **统一错误处理**: 使用 Fastify 错误处理中间件
- [ ] **添加 API 限流**: 防止暴力破解和 DoS
- [ ] **修复备份端点**: 添加数据量限制

### 后续迭代（NICE TO HAVE）

- [ ] **添加测试**: 单元测试 + 集成测试
- [ ] **API 文档**: Swagger/OpenAPI 文档
- [ ] **日志系统**: 结构化日志替代 console.log
- [ ] **配置系统**: 统一的配置管理

---

## 安全评估总结

| 检查项 | 状态 | 备注 |
|--------|------|------|
| SQL 注入防护 | ✅ | 使用参数化查询 |
| XSS 防护 | ⚠️ | Markdown 渲染器需要加强 |
| CSRF 防护 | ⚠️ | CORS 过于宽松 |
| 路径遍历 | ⚠️ | CLI 输入缺少验证 |
| 硬编码密钥 | ✅ | 未发现 |
| 依赖安全 | ✅ | 需定期更新 |
| 错误信息泄露 | ⚠️ | 部分错误返回详细信息 |
| 输入验证 | ❌ | 缺少系统性验证 |

---

## 结论

KeyMemory 是一个**架构优秀、功能丰富**的记忆系统，代码质量整体良好。主要问题集中在：

1. **安全加固** - CORS、输入验证、XSS 防护
2. **类型一致性** - 消除重复类型定义
3. **错误处理** - 统一和规范化

**建议**: 
- **短期（1-2 周）**: 修复高优先级问题，即可进行 Beta 分发
- **中期（1 个月）**: 修复中优先级问题，添加基础测试
- **长期**: 完善文档、测试覆盖率和监控

项目整体 **推荐分发**，但建议先完成高优先级修复。

---

*报告生成时间: 2026-05-20*
*审查工具: AI Code Reviewer*
