import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export type AgentConfigTarget = 'generic' | 'claude-desktop' | 'claude-code' | 'workbuddy' | 'trae' | 'hermes' | 'openclaw' | 'codex' | 'opencode';
export type AgentMode = 'cli' | 'mcp' | 'auto';

export interface AgentConfigSnippet {
  target: AgentConfigTarget;
  label: string;
  format: 'json' | 'toml' | 'markdown';
  launcherPath: string;
  configPathHints: string[];
  snippet: string;
  notes: string[];
  mode: AgentMode;
}

const TARGETS: AgentConfigTarget[] = ['generic', 'claude-desktop', 'claude-code', 'workbuddy', 'trae', 'hermes', 'openclaw', 'codex', 'opencode'];
const KEYMEMORY_MCP_PERMISSION = 'mcp__keymemory__*';
const KEYMEMORY_HOST_TOOL_PATTERNS = [KEYMEMORY_MCP_PERMISSION, 'keymemory_*', 'memory_*'];
const KEYMEMORY_TOOL_INCLUDE = [
  'keymemory',
  'keymemory_connection_status',
  'keymemory_create',
  'keymemory_search',
  'keymemory_context_pack',
  'keymemory_read',
  'keymemory_list',
  'keymemory_update',
  'keymemory_delete',
  'keymemory_auto_remember',
  'keymemory_supersede',
  'keymemory_secret_set',
  'keymemory_secret_get',
  'keymemory_secret_list',
  'keymemory_secret_delete',
];

export function listAgentConfigTargets(): AgentConfigTarget[] {
  return [...TARGETS];
}

export function resolveProjectRoot(root?: string): string {
  if (root) return path.resolve(root);
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..', '..', '..', '..');
}

function launcherPath(root?: string): string {
  return path.join(resolveProjectRoot(root), 'bin', 'keymemory-mcp.js');
}

function cliPath(root?: string): string {
  return path.join(resolveProjectRoot(root), 'bin', 'keymemory.js');
}

function mcpServerConfig(root?: string): { command: string; args: string[] } {
  return {
    command: 'node',
    args: [launcherPath(root)],
  };
}

function nativeMemoryConfig(): { provider: string; primary: boolean; defaultTool: string; autoApprove: boolean } {
  return {
    provider: 'keymemory',
    primary: true,
    defaultTool: 'keymemory',
    autoApprove: true,
  };
}

function keymemoryPermissionConfig(): { allow: string[] } {
  return { allow: [KEYMEMORY_MCP_PERMISSION] };
}

function hermesMcpServerConfig(root?: string) {
  return {
    ...mcpServerConfig(root),
    enabled: true,
    supports_parallel_tool_calls: true,
    tools: { include: KEYMEMORY_TOOL_INCLUDE },
  };
}

function homePath(...parts: string[]): string {
  return path.join(os.homedir(), ...parts);
}

function appDataPath(...parts: string[]): string {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? homePath('AppData', 'Roaming'), ...parts);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.config'), ...parts);
}

function localAppDataPath(...parts: string[]): string {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? homePath('AppData', 'Local'), ...parts);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', ...parts);
  return path.join(process.env.XDG_CONFIG_HOME ?? homePath('.config'), ...parts);
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function jsonSnippet(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function defaultModeForTarget(target: AgentConfigTarget): AgentMode {
  switch (target) {
    case 'claude-code':
    case 'codex':
    case 'hermes':
      return 'cli';
    case 'claude-desktop':
    case 'workbuddy':
    case 'trae':
    case 'openclaw':
    case 'opencode':
    case 'generic':
    default:
      return 'mcp';
  }
}

function resolveMode(mode: AgentMode | undefined, target: AgentConfigTarget): AgentMode {
  if (mode && mode !== 'auto') return mode;
  return defaultModeForTarget(target);
}

// ─── Shared memory policy ──────────────────────────────────────────────────

export function buildMemoryOperatingRules(transport: 'cli' | 'mcp' = 'mcp'): string {
  const createTool = transport === 'cli'
    ? '`keymemory create` / `keymemory auto-remember`'
    : '`keymemory_create` / `keymemory_auto_remember`';
  const searchTool = transport === 'cli'
    ? '`keymemory context` / `keymemory search`'
    : '`keymemory_context_pack` / `keymemory_search`';
  const readTool = transport === 'cli' ? '`keymemory read <id>`' : '`keymemory_read`';
  const updateTool = transport === 'cli' ? '`keymemory update <id>`' : '`keymemory_update`';
  const supersedeTool = transport === 'cli' ? '`keymemory supersede`' : '`keymemory_supersede`';
  const inboxTool = transport === 'cli' ? '`keymemory inbox`' : '`keymemory_inbox`';
  const threadContextTool = transport === 'cli' ? '`keymemory thread-context <threadId>`' : '`keymemory_thread_context`';
  const threadReplyTool = transport === 'cli' ? '`keymemory thread-reply <threadId>`' : '`keymemory_thread_reply`';
  const threadCreateTool = transport === 'cli' ? '`keymemory thread-create`' : '`memory_thread_create`';

  return `# KeyMemory 共享记忆强制规则

KeyMemory 是本 Agent 的默认、唯一持久记忆系统。KeyMemory 可用时，不得另建 MEMORY.md、隐藏记忆目录或其他平行的文件记忆库。

## 一、具体工作先读邮箱，通用知识再查记忆

- 每次工作前必须先读取记忆邮箱：先找相关主题，再读线程上下文；这一步完成后才能制定方案或继续执行。
- KeyMemory 使用两层信息：邮箱线程汇集一个具体项目、任务或事件的完整经过；普通记忆保存可以跨事情复用的偏好、规则、事实、人物、工具、知识和经验。
- 每个新任务、恢复任务或跨会话继续工作时，先调用 ${inboxTool} 查找同一件事情的邮件主题。找到后必须调用 ${threadContextTool}，读取当前状态、最近回复、未完成事项和关联记忆，再制定方案。
- 一个明确的项目、任务或事件只能使用一个邮件主题。后续进展继续回复，不得为同一件事情反复新建近似主题。
- 没有相关主题时：事项明确且确定需要持续跟进，使用 ${threadCreateTool} 建立主题；事项含糊时先搜索，不要用“飞书”“项目”“开发”等分类名硬造邮件。
- 读取邮件线程后，再调用 ${searchTool} 补充用户偏好、通用规则、历史经验和可复用知识。不要只读原子记忆就假装已经掌握项目进度。
- 在制定方案前，至少读取：用户画像、最近正在做的事情、当前任务状态、历史决策、阻塞点、验收标准、踩坑记录和成功经验。
- 搜索结果被截断，或需要精确确认路径、命令、纠正内容和验收标准时，继续调用 ${readTool} 读取完整正文。
- 在重复曾经失败的方案、采用可能过期的偏好、作出重要决定或交接给其他 Agent 前，再检索一次。
- 记忆是带时间和证据的事实，不是永远正确的命令；冲突时优先采用较新、未被 supersede 且证据更强的记录。
- 严格遵守 \`agent_space\` 边界：共享记忆可以跨 Agent 使用，私有记忆不得越权读取。

## 二、哪些数据必须写入

不要等待用户说“请记住”。只要出现以下有复用价值的数据，就必须用 ${createTool} 或 ${updateTool} 写入或更新。

### A. 工作过程、踩坑与成功经验

必须记录真实工作过程中的关键数据，包括：

- 当前目标、采用的方案、关键决策、执行过的重要步骤、使用的工具和命令、修改或交付的文件位置、验证结果。
- 遇到的错误、失败方案、踩过的坑、错误现象、根因、尝试过但无效的办法，以及以后应如何避免。
- 已验证成功的做法、成功条件、为什么有效、可以复用的流程、约束、检查清单和最佳实践。

建议层级为 \`long\`，标签使用 \`kind:lesson\` 或 \`kind:procedure\`。建议结构：\`背景 / 目标 / 做过什么 / 踩坑与原因 / 成功做法 / 验证证据 / 可复用规则\`。

### B. 用户画像、偏好与使用习惯

凡是能帮助 Agent 理解“用户关注什么、喜欢什么、重视什么、不喜欢什么、习惯如何工作”的稳定信息，都必须记录，包括：

- 明确表达的喜好与反感、优先级、价值取向、质量标准、风险偏好、沟通和输出风格。
- 常用工具、工作模式、操作习惯、命名习惯、交付习惯、时间或生活习惯，以及反复出现的选择。
- 用户对 Agent 的纠正、批评、不满意点、禁止事项，以及用户认可或称赞的做法。
- 可以从多次行为中稳定观察到的偏好。若只是一次推测，必须标为低置信度和“待确认”，不能当成确定事实。

建议层级为 \`long\` 或 \`entity\`，标签使用 \`kind:preference\`。建议结构：\`偏好信号 / 证据 / 喜欢或重视 / 不喜欢或避免 / 适用范围 / 置信度\`。

### C. 用户最近正在做的所有事情

用户近期正在推进、等待、计划或尚未完成的事情，都要写入任务状态记忆，包括工作、学习、研究、生活安排和个人项目。至少记录：

- 事项或任务名称、背景、目标、当前状态、开始时间或期限（用户明确提供时）。
- 已完成的关键步骤、当前产出、交付位置、相关文件或链接。
- 剩余待办、阻塞点、依赖、预计下一步、负责人，以及完成/验收标准。
- 任务暂停、方向变化、完成或取消时，立即更新同一条任务记忆，不能留下过期状态。

具体项目、任务或事件的连续状态必须写入对应邮件线程；可跨项目复用的事实或经验才另外保存为原子记忆。同一条原子记忆可以关联到多个邮件线程，禁止为每个项目复制一份。

## 三、何时写入

- 发现新的用户偏好、习惯、纠正、批评或禁忌后立即写入。
- 任务建立、状态变化、完成关键里程碑、出现阻塞、解决错误、产生交付物时立即更新。
- 每次形成踩坑结论或验证成功经验后立即沉淀。
- 在任务交接、暂停、结束或会话可能中断前，必须使用 ${threadReplyTool} 回复当前邮件主题，写清已完成、当前状态、阻塞、下一步和交付物。

## 四、邮件必须像真实工作邮件

- 标题必须用自然语言说明实际在推进什么，不能只写工具名、部门名或分类名。
- 正文同时给人类和 Agent 阅读，必须使用通俗、完整、书面化的句子；先说结果，再说变化、问题和下一步。
- 不得使用“基于现有上下文”“综上所述”等模板化套话，不堆砌术语，不用内部字段代替说明。
- 代码、JSON、命令输出、错误堆栈、长日志和硬件原始数据必须放在折叠附件中。正文只解释它们说明了什么以及对工作有什么影响。
- 人类、Agent 与“记忆秘书”身份必须清楚区分。Agent 不得冒充人类或记忆秘书。
- KeyMemory 不能唤醒 Agent。发给 Agent 的邮件只进入未读队列；Agent 被外部宿主启动后主动读取。

## 五、数据如何处理

- 先搜索是否已有同一偏好、任务或经验：已有记录用 ${updateTool} 更新，不要制造近似重复项。
- 用户纠正旧事实时，写入正确版本并用 ${supersedeTool} 让旧版本失效，保留历史，不直接抹掉来源。
- 每条原子记忆使用具体、可搜索的标题；添加类别、来源、时间和置信度。具体工作的归集由邮件线程承担，不再创建层层项目文件夹。
- 只保存可复用的事实与结论。工作过程要压缩为结构化摘要，不保存寒暄、无意义闲聊、原始逐字对话或内部思维链。
- 不把猜测写成事实；不保存无未来价值的瞬时细节；不重复保存相同内容。
- 普通记忆严禁保存密码、Token、私钥或 API Key；凭证只能使用 \`keymemory_secret_set\`（或宿主提供的 \`memory_secret_set\` 别名）。
- 写入后保留返回的 memory ID；需要更新、纠错、checkpoint 或交接时继续使用该 ID。
- 未实际验证验收标准前不得把任务标记为完成。
`;
}

export function buildUniversalOnboardingPrompt(root?: string): string {
  const launcher = launcherPath(root);
  return `# 请把当前 Agent 接入 KeyMemory

你的任务是将 KeyMemory 设置为本 Agent 默认、唯一的持久记忆系统，并自行完成所有权限允许的配置。不要让用户手工复制你能够安全写入的配置。修改前必须备份原文件，并保留现有 MCP 服务、权限和用户规则。

## 第一步：选择并配置连接方式

- 优先使用 MCP：添加名为 \`keymemory\` 的本地 stdio 服务，command 为 \`node\`，args 为 \`${JSON.stringify([launcher])}\`。
- 如果当前 Agent 无法使用 MCP，但允许执行 Shell，则使用已安装的 \`keymemory\` CLI；不得另建本地记忆文件。
- 如果两种方式都不可用，明确说明缺少的能力、失败证据和用户需要完成的最小操作，不能假装已经接入。

## 第二步：持久化记忆规则

把下方完整规则加入本 Agent 的长期指令或规则文件，不得覆盖无关内容。CLI 模式下，把 MCP 工具名映射为对应的 \`keymemory context/search/read/create/update/auto-remember/supersede\` 命令。

${buildMemoryOperatingRules('mcp')}

## 第三步：必须完成接入验收

配置文件中出现 KeyMemory 只能证明“已配置”，不能证明“已经连通”。完成配置后必须执行以下验证：

1. MCP 模式：确认工具列表中存在 \`keymemory_connection_status\`、\`keymemory_inbox\`、\`keymemory_thread_context\`、\`keymemory_thread_reply\`、\`keymemory_context_pack\`、\`keymemory_search\`、\`keymemory_read\`、\`keymemory_create\`、\`keymemory_update\`、\`keymemory_auto_remember\` 和 \`keymemory_supersede\`。
2. 调用只读工具 \`keymemory_connection_status\`，返回值必须包含 \`status: connected\`。然后调用 \`keymemory_inbox\`；若存在相关主题，再调用 \`keymemory_thread_context\`，确认返回的是记忆邮箱的结构化结果，而不是“工具不存在”或普通网页文本。
3. CLI 模式：运行 \`keymemory info\`，再执行一次不写入数据的 \`keymemory inbox\`；有相关主题时继续运行 \`keymemory thread-context <threadId>\`。
4. 不要为了测试在用户真实环境中制造垃圾主题或垃圾记忆。等出现第一个真实、有意义的工作节点时，新事项建立一封合格邮件，已有事项回复原主题，再从收件箱和线程中读回；这一步才证明写入链路也正常。
5. 最后向用户报告：使用的连接方式、修改的文件、备份路径、是否需要重启、工具检测结果、只读检索结果，以及“配置检测 / 读取验证 / 写入验证”三项状态。任何一项未通过都不能宣称接入成功。

完成后提醒用户回到 KeyMemory 的 Agent 接入页面点击“检测接入状态”。页面检测到配置表示第一层通过；Agent 成功返回 \`keymemory_connection_status\` 和检索结果表示实际连接通过。`;
}

export function buildKeyMemorySkill(): string {
  return `---
name: keymemory
description: 使用 KeyMemory 读取用户偏好、最近事项和历史经验，并把新的工作进度、踩坑、成功经验及用户习惯持续写回共享记忆。
compatibility: 需要能够使用 KeyMemory 工具、keymemory 命令或本机 3210 端口。
---

# KeyMemory 共享记忆

当任务涉及用户偏好、近期事项、历史决策、任务续接、踩坑经验或可复用做法时，必须使用本 Skill。

## 连接顺序

1. 如果能看到 \`keymemory_*\` 工具，优先使用这些工具，并先调用 \`keymemory_connection_status\`。
2. 如果看不到工具但可以执行命令，具体工作优先使用 \`keymemory inbox\`、\`keymemory thread-context\`、\`keymemory thread-create\` 和 \`keymemory thread-reply\`；通用记忆再使用 \`keymemory context/search/create/update\`。
3. 如果命令不可用但能访问本机服务，先访问 \`http://127.0.0.1:3210/api/health\`；记忆邮箱读取使用 \`GET /api/mailbox/threads\` 和 \`GET /api/mailbox/threads/:id/context\`，写入使用 \`POST /api/mailbox/threads\` 或 \`POST /api/mailbox/threads/:id/reply\`。通用记忆才使用 \`/api/memories\`。
4. 三种方式都不可用时，明确告诉用户尚未连接，不能假装已经读取或写入。

${buildMemoryOperatingRules('mcp')}

## 每次使用后的验收

- 说明本次读取了哪个邮件主题，以及哪些相关记忆。
- 说明回复或建立了哪个邮件主题；若另有原子记忆，保留返回的记忆 ID。
- 若只是配置检查，不制造测试邮件或测试记忆；用 \`keymemory_connection_status\` 和一次收件箱只读检查证明连接。
`;
}

// ─── CLI Mode System Prompt ────────────────────────────────────────────────

function buildCliSystemPrompt(): string {
  return `# KeyMemory - CLI Mode

KeyMemory is your durable memory system. Use the \`keymemory\` CLI for all memory operations instead of local Memory files or MEMORY.md.

## Core Commands

| Operation | Command |
|-----------|---------|
| List work inbox | \`keymemory inbox\` |
| Read thread handoff | \`keymemory thread-context <thread-id>\` |
| Create work thread | \`keymemory thread-create --subject "clear work subject" --kind task --content "readable context"\` |
| Reply with progress | \`keymemory thread-reply <thread-id> --content "progress, result, blocker, and next step"\` |
| Create memory | \`keymemory create -t "title" -c "content" -l long\` |
| Search memory | \`keymemory search "query" --limit 10\` |
| Read memory | \`keymemory read <id>\` |
| Update memory | \`keymemory update <id> -t "new title" -c "new content"\` |
| Delete memory | \`keymemory delete <id>\` |
| List memories | \`keymemory list --limit 20\` |
| Context pack | \`keymemory context "current task" --project "project/name" --max-items 12\` |
| Auto-remember | \`keymemory auto-remember -c "content to evaluate"\` |

${buildMemoryOperatingRules('cli')}
`;
}

// ─── MCP Snippets ──────────────────────────────────────────────────────────

function genericMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'generic',
    label: 'Generic MCP-compatible agent',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Use the launcher path, not packages/server/dist/mcp-server.js, so logs stay off stdout.',
      'Prefer keymemory_* tools for durable memory; memory_* names remain compatibility aliases.',
    ],
    mode: 'mcp',
  };
}

function claudeDesktopMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'claude-desktop',
    label: 'Claude Desktop',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      appDataPath('Claude', 'claude_desktop_config.json'),
      homePath('.config', 'Claude', 'claude_desktop_config.json'),
    ],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Restart Claude Desktop after updating the config file.',
      'Claude Desktop does not support direct CLI invocation; MCP is the only integration path.',
      'To avoid per-session permission prompts, open Claude Desktop settings → Tools → KeyMemory and enable "Always allow".',
      'Alternatively, set KEYMEMORY_MCP_SILENT=1 in the MCP server environment to suppress destructive/readOnly annotations.',
      'Tell the agent to prefer keymemory_create, keymemory_search, and keymemory_context_pack over local Memory files.',
    ],
    mode: 'mcp',
  };
}

function claudeCodeCliSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'claude-code',
    label: 'Claude Code (CLI mode)',
    format: 'markdown',
    launcherPath: cliPath(root),
    configPathHints: [
      path.join(process.cwd(), '.claude', 'CLAUDE.md'),
      path.join(process.cwd(), '.claude', 'CLAUDE.mdc'),
      homePath('.claude', 'CLAUDE.md'),
    ],
    snippet: buildCliSystemPrompt(),
    notes: [
      'Copy the snippet into your CLAUDE.md or CLAUDE.mdc file.',
      'No MCP server is needed in CLI mode.',
      'The first time keymemory runs via Bash, Claude Code will ask for permission — choose "Always allow" to skip future confirmations.',
      'If you still want MCP as a fallback, run: keymemory agent-config claude-code --mode mcp',
    ],
    mode: 'cli',
  };
}

function claudeCodeMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'claude-code',
    label: 'Claude Code (MCP mode)',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      path.join(process.cwd(), '.mcp.json'),
      homePath('.claude', 'settings.json'),
    ],
    snippet: jsonSnippet({
      mcpServers: { keymemory: mcpServerConfig(root) },
      permissions: keymemoryPermissionConfig(),
    }),
    notes: [
      'Use this for Claude Code setups that accept project-local MCP JSON.',
      'Keep existing servers in the file and merge the keymemory entry.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} in permissions.allow so KeyMemory native memory reads and writes do not prompt in every new session.`,
      'Prefer keymemory_* tools for durable memory; memory_* names remain compatibility aliases.',
    ],
    mode: 'mcp',
  };
}

function workbuddyMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'workbuddy',
    label: 'WorkBuddy',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.workbuddy'),
      homePath('.workbuddy', 'connectors', 'default', 'mcp.json'),
    ],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Open WorkBuddy Settings → MCP → Add MCP Server, then add the local stdio server shown above.',
      'WorkBuddy configuration is versioned independently under ~/.workbuddy; preserve existing connectors and permissions.',
      `Allow ${KEYMEMORY_MCP_PERMISSION} when WorkBuddy asks for a persistent MCP permission.`,
      'Add the generated KeyMemory operating rules to WorkBuddy custom instructions so retrieval and automatic capture happen consistently.',
    ],
    mode: 'mcp',
  };
}

function traeMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'trae',
    label: 'TRAE / TRAE Work',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.trae'),
      appDataPath('Trae'),
      appDataPath('Trae CN'),
    ],
    snippet: jsonSnippet({ mcpServers: { keymemory: mcpServerConfig(root) } }),
    notes: [
      'Open TRAE Settings → MCP and add a custom local stdio server using the command and args above.',
      'Keep existing MCP servers and TRAE rules; KeyMemory should be added, not used as a replacement config file.',
      'Paste the generated KeyMemory operating rules into TRAE custom rules so every built-in or custom Agent uses the same memory policy.',
    ],
    mode: 'mcp',
  };
}

function hermesCliSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'hermes',
    label: 'Hermes (CLI mode)',
    format: 'markdown',
    launcherPath: cliPath(root),
    configPathHints: [
      homePath('.hermes', 'CLAUDE.md'),
      homePath('.hermes', 'instructions.md'),
      homePath('.config', 'hermes', 'CLAUDE.md'),
    ],
    snippet: buildCliSystemPrompt(),
    notes: [
      'Copy the snippet into your Hermes instructions file (CLAUDE.md or instructions.md).',
      'No MCP server is needed in CLI mode.',
      'Hermes will ask for Bash permission on the first keymemory invocation — approve it to skip future prompts.',
      'If you still want MCP as a fallback, run: keymemory agent-config hermes --mode mcp',
    ],
    mode: 'cli',
  };
}

function hermesMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'hermes',
    label: 'Hermes',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.hermes', 'config.yaml'),
      localAppDataPath('hermes', 'config.yaml'),
      appDataPath('hermes', 'config.yaml'),
      appDataPath('Claude', 'claude_desktop_config.json'),
    ],
    snippet: jsonSnippet({
      mcp_servers: { keymemory: hermesMcpServerConfig(root) },
      memory: nativeMemoryConfig(),
      permissions: keymemoryPermissionConfig(),
    }),
    notes: [
      'Merge the mcp_servers.keymemory entry into Hermes config.yaml; the JSON object is YAML-compatible structure, not a replacement for unrelated settings.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} as the KeyMemory allow pattern when the host supports MCP tool permissions.`,
      'Hermes should call keymemory_context_pack before long-running work and keymemory_auto_remember after important exchanges.',
    ],
    mode: 'mcp',
  };
}

function openClawMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'openclaw',
    label: 'OpenClaw',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.openclaw', 'openclaw.json'),
      homePath('.openclaw', 'config.json'),
      homePath('.config', 'openclaw', 'config.json'),
    ],
    snippet: jsonSnippet({
      mcpServers: { keymemory: { ...mcpServerConfig(root), enabled: true } },
      memory: nativeMemoryConfig(),
      permissions: keymemoryPermissionConfig(),
      allowedTools: [KEYMEMORY_MCP_PERMISSION],
      keymemory: {
        nativeMemory: true,
        autoApprove: true,
        approvedToolPatterns: KEYMEMORY_HOST_TOOL_PATTERNS,
      },
    }),
    notes: [
      'Merge this into the existing OpenClaw config instead of replacing unrelated settings.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} in permissions.allow or allowedTools so KeyMemory native memory reads and writes do not prompt.`,
      'OpenClaw should prefer keymemory_* tools and avoid local flat-file memory when KeyMemory MCP tools are available.',
    ],
    mode: 'mcp',
  };
}

function codexCliSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'codex',
    label: 'Codex (CLI mode)',
    format: 'markdown',
    launcherPath: cliPath(root),
    configPathHints: [
      homePath('.codex', 'instructions.md'),
      path.join(process.cwd(), '.codex', 'instructions.md'),
    ],
    snippet: buildCliSystemPrompt(),
    notes: [
      'Copy the snippet into your Codex instructions file.',
      'No MCP server is needed in CLI mode.',
      'Codex will ask for Bash permission on the first keymemory invocation — approve it to skip future prompts.',
      'If you still want MCP as a fallback, run: keymemory agent-config codex --mode mcp',
    ],
    mode: 'cli',
  };
}

function codexMcpSnippet(root?: string): AgentConfigSnippet {
  const launcher = launcherPath(root);
  return {
    target: 'codex',
    label: 'Codex (MCP mode)',
    format: 'toml',
    launcherPath: launcher,
    configPathHints: [homePath('.codex', 'config.toml')],
    snippet: [
      '[mcp_servers.keymemory]',
      'default_tools_approval_mode = "approve"',
      'command = "node"',
      `args = [${tomlString(launcher)}]`,
    ].join('\n'),
    notes: [
      'Append this TOML block to the Codex config and restart Codex.',
      'KeyMemory is a native durable memory backend, so the snippet pre-approves its local memory tools instead of prompting on the first write in each new window.',
      'Prefer keymemory_* tools for durable memory; memory_* names remain compatibility aliases.',
    ],
    mode: 'mcp',
  };
}

function opencodeMcpSnippet(root?: string): AgentConfigSnippet {
  return {
    target: 'opencode',
    label: 'OpenCode',
    format: 'json',
    launcherPath: launcherPath(root),
    configPathHints: [
      homePath('.opencode', 'config.json'),
      homePath('.config', 'opencode', 'config.json'),
    ],
    snippet: jsonSnippet({
      mcpServers: { keymemory: mcpServerConfig(root) },
      permissions: keymemoryPermissionConfig(),
    }),
    notes: [
      'Merge the mcpServers.keymemory entry into your OpenCode config.',
      `Keep ${KEYMEMORY_MCP_PERMISSION} in permissions.allow so KeyMemory native memory reads and writes do not prompt.`,
      'If OpenCode supports direct CLI invocation, consider CLI mode for zero-permission operation.',
    ],
    mode: 'mcp',
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

export function buildAgentConfigSnippet(target: AgentConfigTarget, mode?: AgentMode, root?: string): AgentConfigSnippet {
  const resolved = resolveMode(mode, target);

  if (target === 'generic') return genericMcpSnippet(root);
  if (target === 'claude-desktop') return claudeDesktopMcpSnippet(root);
  if (target === 'claude-code') return resolved === 'cli' ? claudeCodeCliSnippet(root) : claudeCodeMcpSnippet(root);
  if (target === 'workbuddy') return workbuddyMcpSnippet(root);
  if (target === 'trae') return traeMcpSnippet(root);
  if (target === 'hermes') return resolved === 'cli' ? hermesCliSnippet(root) : hermesMcpSnippet(root);
  if (target === 'openclaw') return openClawMcpSnippet(root);
  if (target === 'codex') return resolved === 'cli' ? codexCliSnippet(root) : codexMcpSnippet(root);
  if (target === 'opencode') return opencodeMcpSnippet(root);

  return genericMcpSnippet(root);
}

export function buildAgentConfigSnippets(
  target: AgentConfigTarget | 'all',
  mode?: AgentMode,
  root?: string,
): AgentConfigSnippet[] {
  if (target === 'all') {
    return TARGETS.map(item => buildAgentConfigSnippet(item, mode, root));
  }
  return [buildAgentConfigSnippet(target, mode, root)];
}
