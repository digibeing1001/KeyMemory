import { MEMORY_RELATION_TYPES } from '../graph/entity.js';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: MCPToolAnnotations;
}

export interface MCPToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

const LAYERS = ['flash', 'short', 'long', 'entity'];
const MEMORY_KINDS = [
  'preference',
  'project_fact',
  'decision',
  'task',
  'procedure',
  'concept',
  'relationship',
  'event',
  'constraint',
  'raw_note',
  'project_journal',
];
export const ENTITY_TYPES = ['person', 'tool', 'concept', 'organization', 'location', 'event', 'time', 'project'];

// 共享的细粒度过滤参数：memory_search 与 memory_list 同时暴露，
// 让 agent 能在不依赖 query 关键词的情况下精确命中记忆子集。
// 注意：agentSpace 不在此处暴露——隔离由 adapter 内部强制注入，避免调用方越权读取其他 agent 私有空间。
const memoryFilterProperties = {
  tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags. Memories are selected when they contain any/all of the listed tags. Tags are stored as a JSON array and matched precisely via json_each.' },
  tagsMatch: { type: 'string', enum: ['any', 'all'], description: 'Tag match mode. "any" (default) selects memories containing at least one listed tag; "all" requires every listed tag.' },
  entityId: { type: 'string', description: 'Filter by entity ID. When provided, takes precedence over entityName/entityType.' },
  entityName: { type: 'string', description: 'Filter by exact entity name. Combine with entityType to disambiguate.' },
  entityType: { type: 'string', enum: ENTITY_TYPES, description: 'Filter by entity type. Selects memories linked to any entity of this type.' },
  source: { type: 'string', description: 'Filter by source label, e.g. hermes, openclaw, conversation, manual.' },
  minConfidence: { type: 'number', minimum: 0, maximum: 1, description: 'Only return memories with confidence >= this value.' },
  createdAfter: { type: 'string', description: 'ISO 8601 timestamp. Only memories created at or after this time.' },
  createdBefore: { type: 'string', description: 'ISO 8601 timestamp. Only memories created at or before this time.' },
  updatedAfter: { type: 'string', description: 'ISO 8601 timestamp. Only memories updated at or after this time.' },
  updatedBefore: { type: 'string', description: 'ISO 8601 timestamp. Only memories updated at or before this time.' },
  lastHitAfter: { type: 'string', description: 'ISO 8601 timestamp. Only memories whose last retrieval hit was at or after this time. Memories never hit are excluded.' },
  lastHitBefore: { type: 'string', description: 'ISO 8601 timestamp. Only memories whose last retrieval hit was at or before this time. Memories never hit are excluded.' },
  asOf: { type: 'string', description: 'ISO 8601 instant used for temporal validity. Defaults to now.' },
  includeExpired: { type: 'boolean', description: 'Include memories outside their validity windows. Default false for agent retrieval.' },
};

const memoryCreateSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short, searchable memory title.' },
    content: { type: 'string', description: 'Full durable memory content. Markdown is supported.' },
    layer: { type: 'string', enum: LAYERS, description: 'Memory layer: flash, short, long, or entity. Optional; inferred from content/metadata when omitted. Default short.' },
    projectId: { type: 'string', description: 'Optional KeyMemory project ID.' },
    projectPath: { type: 'string', description: 'Optional project path, such as Product/Backend/Memory. Missing folders are created automatically.' },
    confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Evidence-calibrated confidence. Explicit writes default to 1.' },
    validFrom: { type: 'string', description: 'ISO 8601 start of the fact validity window. Defaults to creation time.' },
    validTo: { type: 'string', description: 'ISO 8601 exclusive end of the fact validity window.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Optional searchable tags.' },
    metadata: { type: 'object', description: 'Optional structured metadata such as timeline, entities, context, category, and importance.' },
    source: { type: 'string', description: 'Optional source label, such as conversation, hermes, openclaw, or manual.' },
    sourceId: { type: 'string', description: 'Optional ID from the source system.' },
  },
  required: ['title', 'content'],
};

const memorySearchSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query for durable KeyMemory memories.' },
    projectId: { type: 'string', description: 'Optional project ID. Descendants are included by default.' },
    projectPath: { type: 'string', description: 'Optional source-path scope retained from older project-based memories. Prefer mailbox threads for concrete work; this filter does not create folders.' },
    includeDescendants: { type: 'boolean', description: 'Whether project search includes child projects. Default true.' },
    includeSuperseded: { type: 'boolean', description: 'Include memories superseded by newer active memories. Default false.' },
    memoryKind: { type: 'string', enum: MEMORY_KINDS, description: 'Optional normalized memory kind filter.' },
    layer: { type: 'string', enum: LAYERS, description: 'Optional memory layer filter.' },
    limit: { type: 'number', description: 'Maximum number of results. Default 10.' },
    explain: { type: 'boolean', description: 'Include RRF ranks and quality-boost contributions in each result.' },
    ...memoryFilterProperties,
  },
  required: ['query'],
};

const memoryContextPackSchema = {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Current task or question.' },
    project: { type: 'string', description: 'Project path, name, or ID. Descendants are included by default.' },
    projectId: { type: 'string', description: 'Project ID.' },
    includeDescendants: { type: 'boolean', description: 'Whether to include child projects. Default true.' },
    includeSuperseded: { type: 'boolean', description: 'Include superseded memories for audit or historical inspection.' },
    asOf: { type: 'string', description: 'ISO 8601 instant used to assemble historical/current context. Defaults to now.' },
    includeExpired: { type: 'boolean', description: 'Include memories outside their validity windows. Default false.' },
    memoryKinds: { type: 'array', items: { type: 'string' }, description: 'Optional memory kinds to include.' },
    maxItems: { type: 'number', description: 'Max memories. Default 12.' },
    maxChars: { type: 'number', description: 'Approximate character budget. Default 6000.' },
  },
};

const mailboxListSchema = {
  type: 'object',
  properties: {
    folder: { type: 'string', enum: ['inbox', 'starred', 'snoozed', 'sent', 'drafts', 'scheduled', 'archive', 'trash', 'all'], description: 'Mailbox folder. Default inbox.' },
    query: { type: 'string', description: 'Optional natural-language search across thread subjects and message bodies.' },
    limit: { type: 'number', minimum: 1, maximum: 250, description: 'Maximum threads. Default 100.' },
    offset: { type: 'number', minimum: 0, description: 'Pagination offset.' },
  },
};

const mailThreadCreateSchema = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'A natural, human-readable work-email subject that states what is being advanced. Do not use category-only names such as “Feishu” or “Project”.' },
    kind: { type: 'string', enum: ['project', 'task', 'event'], description: 'What this one-thread context represents.' },
    body: { type: 'string', description: 'The first email in plain written language: explain why the work exists, its current state, confirmed decisions, unresolved questions, and next action. Put code and logs in attachments, not the body.' },
    recipientIds: { type: 'array', items: { type: 'string' }, description: 'Internal human or Agent mailbox IDs. Defaults to the local human and all Agents.' },
    memoryIds: { type: 'array', items: { type: 'string' }, description: 'Existing atomic memories to attach as sources. One memory may support many threads.' },
    metadata: { type: 'object', description: 'Optional structured envelope metadata; never substitute this for a readable email body.' },
  },
  required: ['subject', 'kind', 'body'],
};

const mailThreadIdSchema = {
  type: 'object',
  properties: {
    threadId: { type: 'string', description: 'Mail thread ID.' },
    maxMessages: { type: 'number', minimum: 1, maximum: 12, description: 'For context reads, maximum recent replies. Default 5.' },
    maxMemories: { type: 'number', minimum: 1, maximum: 20, description: 'For context reads, maximum linked atomic memories. Default 8.' },
  },
  required: ['threadId'],
};

const mailThreadReplySchema = {
  type: 'object',
  properties: {
    threadId: { type: 'string', description: 'Mail thread ID.' },
    body: { type: 'string', description: 'A human-readable work reply. State progress, result, blocker, decision, question, or next step in ordinary written language. Never paste raw code, JSON, stack traces, or long logs into the body.' },
    messageType: { type: 'string', enum: ['reply', 'digest', 'progress', 'question', 'decision', 'correction'], description: 'Meaning of the reply. Agent work updates normally use progress.' },
    recipientIds: { type: 'array', items: { type: 'string' }, description: 'Internal recipients. Defaults to the local human and all Agents.' },
    attachments: {
      type: 'array',
      description: 'Collapsed technical material or evidence. Use this for code, logs, hardware data, files, and exact memory sources.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['memory', 'file', 'log', 'hardware', 'technical'] },
          title: { type: 'string' },
          content: { type: 'string' },
          memoryId: { type: 'string' },
          collapsed: { type: 'boolean', description: 'Keep technical details collapsed. Default true.' },
        },
        required: ['kind', 'title'],
      },
    },
  },
  required: ['threadId', 'body'],
};

const mailThreadLinkSchema = {
  type: 'object',
  properties: {
    threadId: { type: 'string' },
    memoryId: { type: 'string' },
    relationType: { type: 'string', enum: ['source', 'supports', 'decision', 'task', 'reference', 'correction'], description: 'How the atomic memory supports this thread.' },
  },
  required: ['threadId', 'memoryId'],
};

const loopBudgetProperties = {
  query: { type: 'string', description: 'Optional retrieval query. Defaults to the run objective.' },
  maxItems: { type: 'number', minimum: 1, maximum: 40, description: 'Maximum memory items in the context pack.' },
  maxChars: { type: 'number', minimum: 800, maximum: 30000, description: 'Approximate context character budget.' },
};

const loopRunStartSchema = {
  type: 'object',
  properties: {
    objective: { type: 'string', description: 'Stable objective for the durable loop run.' },
    project: { type: 'string', description: 'Project path or name. Created when missing.' },
    projectId: { type: 'string', description: 'Existing KeyMemory project ID.' },
    agentId: { type: 'string', description: 'Logical agent or loop worker ID.' },
    idempotencyKey: { type: 'string', description: 'Unique caller-generated key. Replays return the original run.' },
    leaseOwner: { type: 'string', description: 'Worker instance currently responsible for the run.' },
    leaseTtlSeconds: { type: 'number', minimum: 15, maximum: 3600, description: 'Lease lifetime. Default 60 seconds.' },
    metadata: { type: 'object', description: 'Structured run metadata. Secrets are redacted before persistence.' },
    tokenBudget: { type: 'number', minimum: 1, description: 'Optional hard cap on total tokens used by the run. When tokenUsed >= tokenBudget the circuit breaker fires (circuit-breaker.token-budget).' },
    costUsdBudget: { type: 'number', minimum: 0, description: 'Optional hard cap on total USD cost for the run. Tracked but not currently enforced as a breaker; use for observability and audit.' },
    ...loopBudgetProperties,
  },
  required: ['objective', 'agentId', 'idempotencyKey', 'leaseOwner'],
  oneOf: [{ required: ['project'] }, { required: ['projectId'] }],
};

const loopContextSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string', description: 'Durable loop run ID.' },
    leaseOwner: { type: 'string', description: 'Worker instance reading or resuming the run.' },
    renewLeaseSeconds: { type: 'number', minimum: 15, maximum: 3600, description: 'Renew the worker lease. Default 60 seconds.' },
    afterSequence: { type: 'number', minimum: 0, description: 'Return events after this cursor sequence.' },
    maxEvents: { type: 'number', minimum: 1, maximum: 200, description: 'Maximum incremental events. Default 50.' },
    ...loopBudgetProperties,
  },
  required: ['runId', 'leaseOwner'],
};

const loopCheckpointSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string', description: 'Durable loop run ID.' },
    expectedVersion: { type: 'number', minimum: 0, description: 'Optimistic concurrency version from the last cursor.' },
    idempotencyKey: { type: 'string', description: 'Unique key for this checkpoint write.' },
    leaseOwner: { type: 'string', description: 'Worker instance holding or acquiring the run lease.' },
    leaseTtlSeconds: { type: 'number', minimum: 15, maximum: 3600 },
    phase: { type: 'string', description: 'Stable phase name, such as plan, execute, verify, or wait.' },
    summary: { type: 'string', description: 'Compact authoritative working-state summary.' },
    state: { type: 'object', description: 'Structured restorable working state. Secrets are redacted.' },
    nextActions: { type: 'array', items: { type: 'string' }, description: 'Actionable continuation steps.' },
    artifacts: { type: 'array', items: { type: 'string' }, description: 'Files, URLs, IDs, or other produced artifacts.' },
    memoryRefs: { type: 'array', items: { type: 'string' }, description: 'IDs of validated durable memories used or created by this checkpoint.' },
    status: { type: 'string', enum: ['running', 'waiting'], description: 'Whether work can continue or is waiting.' },
    eventName: { type: 'string', description: 'Optional stable event name. Default loop.checkpoint.saved.' },
    severity: { type: 'string', enum: ['debug', 'info', 'warn', 'error'] },
    spanId: { type: 'string', description: 'Optional caller trace span ID.' },
    tokenUsage: { type: 'number', minimum: 0, description: 'Tokens consumed by this attempt. Accumulated into run.tokenUsed. When the running total reaches tokenBudget the circuit breaker fires.' },
    attemptOutcome: { type: 'string', enum: ['success', 'failure', 'noop'], description: 'Outcome of this attempt. success resets consecutiveFailures to 0; failure increments it (circuit-breaker.no-progress at 5, stagnation at 3 identical signatures); noop leaves the counter unchanged.' },
    error: { type: 'string', description: 'Failure message. When attemptOutcome=failure a normalized errorSignature is derived and stored for stagnation detection.' },
  },
  required: ['runId', 'expectedVersion', 'idempotencyKey', 'leaseOwner', 'phase', 'summary'],
};

const loopFinishSchema = {
  type: 'object',
  properties: {
    runId: { type: 'string', description: 'Durable loop run ID.' },
    expectedVersion: { type: 'number', minimum: 0, description: 'Optimistic concurrency version from the last cursor.' },
    idempotencyKey: { type: 'string', description: 'Unique key for this terminal write.' },
    leaseOwner: { type: 'string', description: 'Worker instance holding the run lease.' },
    status: { type: 'string', enum: ['completed', 'failed', 'cancelled'] },
    summary: { type: 'string', description: 'Terminal outcome or failure summary.' },
    state: { type: 'object', description: 'Final structured state. Secrets are redacted.' },
    artifacts: { type: 'array', items: { type: 'string' } },
    memoryRefs: { type: 'array', items: { type: 'string' }, description: 'IDs of validated durable memories produced by the run.' },
    spanId: { type: 'string', description: 'Optional caller trace span ID.' },
    tokenUsage: { type: 'number', minimum: 0, description: 'Tokens consumed by this terminal attempt. Accumulated into run.tokenUsed for final audit.' },
    attemptOutcome: { type: 'string', enum: ['success', 'failure', 'noop'], description: 'Outcome of the terminal attempt. When omitted, derived from status: completed->success, failed->failure, cancelled->noop.' },
    error: { type: 'string', description: 'Failure message for failed runs. When status=failed or attemptOutcome=failure a normalized errorSignature is derived and stored.' },
  },
  required: ['runId', 'expectedVersion', 'idempotencyKey', 'leaseOwner', 'status', 'summary'],
};

const memoryImportSchema = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Memory title.' },
          content: { type: 'string', description: 'Full memory content.' },
          layer: { type: 'string', enum: LAYERS, description: 'Optional memory layer. Auto-inferred when omitted.' },
          projectId: { type: 'string', description: 'Optional project ID.' },
          projectPath: { type: 'string', description: 'Optional project path.' },
          confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Optional source confidence.' },
          validFrom: { type: 'string', description: 'Optional ISO 8601 validity start.' },
          validTo: { type: 'string', description: 'Optional ISO 8601 validity end.' },
          tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
          metadata: { type: 'object', description: 'Optional structured metadata.' },
          source: { type: 'string', description: 'Optional source label.' },
          sourceId: { type: 'string', description: 'Optional source-system ID.' },
        },
        required: ['title', 'content'],
      },
      description: 'Memories to import directly into KeyMemory.',
    },
    autoLayer: { type: 'boolean', description: 'Infer layer for memories without a layer. Default true.' },
    stripPrefixes: { type: 'boolean', description: 'Strip common source prefixes from titles and content. Default true.' },
  },
  required: ['memories'],
};

const toolSecretNameSchema = {
  type: 'object',
  properties: {
    tool: { type: 'string', description: 'Tool or agent name, such as hermes, openclaw, anthropic, openai, github, or codex.' },
    name: { type: 'string', description: 'Secret name. Defaults to api_key.' },
  },
  required: ['tool'],
};

const BASE_MCP_TOOLS: MCPTool[] = [
  {
    name: 'memory_connection_status',
    description: 'Verify that this Agent can actually call the live KeyMemory MCP server. This is a read-only connectivity receipt and does not create test memories.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, idempotentHint: true },
  },
  {
    name: 'memory_create',
    description: 'Create a durable memory in KeyMemory. Use this instead of local Memory, MEMORY.md, AGENTS.md, or flat-file memory stores.',
    inputSchema: memoryCreateSchema,
  },
  {
    name: 'memory_search',
    description: 'Search durable KeyMemory memories. Use before relying on user preferences, project facts, prior decisions, or previous instructions.',
    inputSchema: memorySearchSchema,
  },
  {
    name: 'memory_context_pack',
    description: 'Build an agent-ready KeyMemory context pack. For a concrete project, task, or event, read its mailbox thread first; use this pack to add shared preferences, constraints, procedures, and reusable atomic memories.',
    inputSchema: memoryContextPackSchema,
  },
  {
    name: 'memory_inbox_list',
    description: '列出当前 Agent 的记忆邮箱。开始或继续具体项目、任务、事件时，先读收件箱并找到唯一的相关邮件主题，再搜索零散记忆。 List the memory mailbox first and find the single related thread before raw memory search.',
    inputSchema: mailboxListSchema,
    annotations: { readOnlyHint: true },
  },
  {
    name: 'memory_thread_create',
    description: '为一项明确的项目、任务或事件建立一个长期邮件主题。标题和正文必须像真实工作邮件，不能只写分类名，也不能直接粘贴机器日志。 Create one durable, human-readable work thread.',
    inputSchema: mailThreadCreateSchema,
  },
  {
    name: 'memory_thread_read',
    description: '读取完整的共同邮件线程，并标记为当前 Agent 已读。人类与 Agent 看到相同的书面正文；代码、日志等技术证据保留在折叠附件中。 Read the same thread humans see.',
    inputSchema: mailThreadIdSchema,
  },
  {
    name: 'memory_thread_context',
    description: '读取一份适合接力的紧凑邮件上下文，包括当前情况、最近回复、待办事项和关联记忆。规划或继续工作前必须先读它。 Read the human-readable thread handoff before planning or continuing work.',
    inputSchema: mailThreadIdSchema,
  },
  {
    name: 'memory_thread_reply',
    description: '把有意义的进展、结果、阻碍、决定、问题或下一步回复到共同邮件主题。正文必须使用自然、通俗的书面语言；代码、日志、JSON、报错堆栈和硬件输出一律放入折叠附件。 Reply in plain human-readable prose and keep technical material collapsed.',
    inputSchema: mailThreadReplySchema,
  },
  {
    name: 'memory_thread_link_memory',
    description: '把一条已有的原子记忆作为依据附加到邮件主题。记忆不会被复制，同一条记忆可以支持多个主题。 Link one reusable atomic memory to one or more mail threads.',
    inputSchema: mailThreadLinkSchema,
  },
  {
    name: 'memory_mailbox_sync',
    description: '让记忆秘书检查关联记忆、去除已经整理过的变化，并仅在确有新内容时追加一封通俗易懂的摘要邮件。这个操作不会启动或唤醒任何 Agent。 Check changes and append a readable digest without waking Agents.',
    inputSchema: {
      type: 'object',
      properties: { threadId: { type: 'string', description: 'Optional single thread. Omit to check all visible threads.' } },
    },
  },
  {
    name: 'memory_loop_start',
    description: 'Start or idempotently resume a durable Loop run with a lease, initial checkpoint, event cursor, and budgeted KeyMemory context.',
    inputSchema: loopRunStartSchema,
    annotations: { idempotentHint: true },
  },
  {
    name: 'memory_loop_context',
    description: 'Read and resume the authoritative Loop checkpoint, incremental events, and budgeted memory context. Renews the caller lease.',
    inputSchema: loopContextSchema,
  },
  {
    name: 'memory_loop_checkpoint',
    description: 'Transactionally persist restorable Loop state using an idempotency key, worker lease, and optimistic checkpoint version.',
    inputSchema: loopCheckpointSchema,
    annotations: { idempotentHint: true },
  },
  {
    name: 'memory_loop_finish',
    description: 'Transactionally finish a Loop run and append its terminal checkpoint and trace event.',
    inputSchema: loopFinishSchema,
    annotations: { idempotentHint: true },
  },
  {
    name: 'memory_read',
    description: 'Read one durable KeyMemory memory by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory ID.' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_list',
    description: 'List recent durable KeyMemory memories with optional filters. Use memory_search when relevance ranking is needed; use memory_list for deterministic listing by tags, entities, time ranges, or source.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: { type: 'string', enum: LAYERS, description: 'Optional memory layer filter.' },
        projectId: { type: 'string', description: 'Optional project ID filter.' },
        status: { type: 'string', enum: ['active', 'archived', 'decayed', 'deleted'], description: 'Optional memory status. Default active.' },
        limit: { type: 'number', description: 'Maximum number of memories. Default 20.' },
        ...memoryFilterProperties,
      },
    },
  },
  {
    name: 'memory_update',
    description: 'Update an existing durable KeyMemory memory.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID.' },
        title: { type: 'string', description: 'New title.' },
        content: { type: 'string', description: 'New content.' },
        layer: { type: 'string', enum: LAYERS, description: 'New memory layer.' },
        projectId: { type: 'string', description: 'New project ID.' },
        projectPath: { type: 'string', description: 'New project path.' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'New evidence confidence.' },
        validFrom: { type: 'string', description: 'New ISO 8601 validity start.' },
        validTo: { type: ['string', 'null'], description: 'New exclusive validity end; null reopens the window.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'New tags.' },
        metadata: { type: 'object', description: 'New metadata.' },
        source: { type: 'string', description: 'New source label.' },
        change_reason: { type: 'string', description: 'Optional provenance or reason for the change.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_delete',
    description: 'Delete or archive a durable KeyMemory memory by ID.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Memory ID.' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_auto_remember',
    description: 'Automatically evaluate content and save it to KeyMemory when it has durable value. Prefer this after significant exchanges.',
    inputSchema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Conversation or content to evaluate and possibly remember.' },
        source: { type: 'string', description: 'Optional content source label.' },
        agentId: { type: 'string', description: 'Agent ID, such as hermes or openclaw.' },
        isolationMode: { type: 'string', enum: ['isolated', 'shared', 'hybrid', 'project'], description: 'Optional agent memory isolation mode.' },
        currentProject: { type: 'string', description: 'Optional current project ID.' },
        conversationRound: { type: 'number', description: 'Optional conversation round number.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'memory_relate',
    description: 'Create or update a relation between two KeyMemory memories, such as supersedes when newer guidance replaces older guidance.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Source memory ID.' },
        targetId: { type: 'string', description: 'Target memory ID.' },
        relationType: { type: 'string', enum: [...MEMORY_RELATION_TYPES], description: 'Relation type.' },
        strength: { type: 'number', description: 'Relation strength from 0 to 1. Default 1.' },
        reason: { type: 'string', description: 'Optional provenance or reason.' },
      },
      required: ['sourceId', 'targetId', 'relationType'],
    },
  },
  {
    name: 'memory_related',
    description: 'List memories related to one KeyMemory memory, including dream-created supersedes relations.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory ID.' },
        relationType: { type: 'string', enum: [...MEMORY_RELATION_TYPES], description: 'Optional relation type filter.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_supersede',
    description: 'Make one visible memory supersede another, close the older fact validity window, and preserve both memories for temporal recall.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Newer replacement memory ID.' },
        targetId: { type: 'string', description: 'Older memory ID whose validity window will be closed.' },
        effectiveAt: { type: 'string', description: 'ISO 8601 effective time. Defaults to the newer memory validFrom.' },
        reason: { type: 'string', description: 'Required provenance for the knowledge update.' },
      },
      required: ['sourceId', 'targetId', 'reason'],
    },
    annotations: { idempotentHint: true },
  },
  {
    name: 'memory_import',
    description: 'Import a batch of memories directly into KeyMemory. Use migration tools for files or old local memory folders.',
    inputSchema: memoryImportSchema,
  },
  {
    name: 'memory_migration_discover',
    description: 'Discover local memory sources for one-click migration across Windows, Linux, macOS, and WSL.',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: 'Optional workspace root path. Multiple paths may be separated by ; or ,' },
        includeHome: { type: 'boolean', description: 'Include home-directory memory sources. Default true.' },
        includeMissing: { type: 'boolean', description: 'Include expected source paths even when missing. Default false.' },
      },
    },
  },
  {
    name: 'memory_migration_import',
    description: 'Import one memory file or directory and normalize it into KeyMemory projects, kinds, tags, evidence, and optional dream consolidation.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory path to import.' },
        source: { type: 'string', description: 'Source identifier, such as codex, claude-code, cursor, mem0, hermes, or openclaw.' },
        format: { type: 'string', enum: ['auto', 'json', 'jsonl', 'markdown', 'text'], description: 'Input format. Default auto.' },
        defaultLayer: { type: 'string', enum: LAYERS, description: 'Fallback layer. Default short.' },
        defaultProjectPath: { type: 'string', description: 'Fallback project path if source has none.' },
        recursive: { type: 'boolean', description: 'Import directories recursively. Default true.' },
        maxFiles: { type: 'number', description: 'Directory file cap. Default 200.' },
        runDream: { type: 'boolean', description: 'Run dream consolidation after import. Default false.' },
        dryRun: { type: 'boolean', description: 'Preview counts without writing memories or running dream. Default false.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'memory_offload',
    description: 'Offload long content (logs, research dumps, intermediate artifacts) to an external reference file. Keeps only a summary plus the reference path in the main context, cutting injected tokens for long-running tasks. When to use: content > ~500 chars that the conversation does not need verbatim. When not to use: durable facts, preferences, or decisions — store those with memory_create instead.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short descriptive title for the offloaded document.' },
        content: { type: 'string', description: 'The long content to offload.' },
        summary: { type: 'string', description: 'Optional summary kept in the main context. Defaults to the first 200 chars.' },
        runId: { type: 'string', description: 'Optional loop run id to associate for traceability.' },
        source: { type: 'string', description: 'Optional source label.' },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'memory_backup_create',
    description: 'Create a portable KeyMemory JSON backup before migration, dream consolidation, or risky maintenance.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Optional backup file path. Defaults to KeyMemory data-dir backups folder.' },
        includeEmbeddings: { type: 'boolean', description: 'Include embedding blobs. Larger file. Default false.' },
        includeOperationalLogs: { type: 'boolean', description: 'Include query logs that may contain user text. Default false.' },
      },
    },
  },
  {
    name: 'memory_backup_inspect',
    description: 'Inspect and checksum-verify a KeyMemory backup file without changing current data.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'Backup file path to inspect.' } },
      required: ['filePath'],
    },
  },
  {
    name: 'memory_backup_restore_dry_run',
    description: 'Validate whether a KeyMemory backup could be restored. This is dry-run only and never writes data.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'Backup file path to validate.' } },
      required: ['filePath'],
    },
  },
  {
    name: 'memory_project_suggestions',
    description: 'List dream-created project organization suggestions so agents can review proposed project-tree changes.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'accepted', 'rejected'], description: 'Optional suggestion status. Default all.' },
      },
    },
  },
  {
    name: 'memory_project_suggestion_accept',
    description: 'Accept a project organization suggestion and move suggested projects under a new parent project.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Suggestion ID.' },
        customName: { type: 'string', description: 'Optional custom parent project name.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_project_suggestion_reject',
    description: 'Reject a project organization suggestion.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Suggestion ID.' } },
      required: ['id'],
    },
  },
  {
    name: 'memory_secret_set',
    description: 'Store a tool credential or API key in KeyMemory secret storage. Use this for API keys instead of memory_create; secrets are encrypted and not indexed, embedded, searched, dreamed, or exported by normal memory backup.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Tool or agent name, such as hermes, openclaw, anthropic, openai, github, or codex.' },
        name: { type: 'string', description: 'Secret name. Defaults to api_key.' },
        value: { type: 'string', description: 'Secret value to encrypt and store.' },
        metadata: { type: 'object', description: 'Optional non-secret metadata, such as provider, scope, or note.' },
      },
      required: ['tool', 'value'],
    },
  },
  {
    name: 'memory_secret_get',
    description: 'Read and decrypt one KeyMemory tool credential. Use only when a configured tool needs the secret value.',
    inputSchema: toolSecretNameSchema,
  },
  {
    name: 'memory_secret_list',
    description: 'List stored tool credentials without returning secret values.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', description: 'Optional tool or agent name filter.' },
      },
    },
  },
  {
    name: 'memory_secret_delete',
    description: 'Delete one stored tool credential.',
    inputSchema: toolSecretNameSchema,
  },
  {
    name: 'memory_isolation_rule_create',
    description: 'Create a memory isolation rule that routes matching memories to a specific agent_space at write time. Use ruleType "keyword" for simple substring matching (no regex knowledge needed) or "regex" for pattern matching. targetSpace "private" is an alias for the calling agent\'s private space.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID this rule applies to. Omit for a global rule that applies to all agents.' },
        ruleType: { type: 'string', enum: ['regex', 'keyword'], description: ' "keyword" escapes the pattern and does substring matching (user-friendly); "regex" treats the pattern as a regular expression.' },
        pattern: { type: 'string', description: 'Match pattern. For "keyword" type, this is a plain substring (e.g. "password", "财务"). For "regex" type, this is a JS regex source (e.g. "password|secret|密码").' },
        targetSpace: { type: 'string', description: 'Target agent_space when the pattern matches. Values: "global" (shared across agents), "private" (alias for the calling agent\'s private space), "agent:<id>" (specific agent space), "project:<name>" (project space).' },
        priority: { type: 'number', description: 'Rule priority. Higher priority rules are evaluated first. Default 0.' },
        enabled: { type: 'boolean', description: 'Whether the rule is active. Default true.' },
      },
      required: ['ruleType', 'pattern', 'targetSpace'],
    },
  },
  {
    name: 'memory_isolation_rule_list',
    description: 'List memory isolation rules. Without agentId, lists all rules. With agentId, lists global rules plus that agent-specific rules.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Optional agent ID filter. Returns global rules plus this agent\'s rules.' },
      },
    },
  },
  {
    name: 'memory_isolation_rule_update',
    description: 'Update an existing memory isolation rule. All fields are optional; only provided fields are updated.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Rule ID.' },
        ruleType: { type: 'string', enum: ['regex', 'keyword'] },
        pattern: { type: 'string' },
        targetSpace: { type: 'string' },
        priority: { type: 'number' },
        enabled: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_isolation_rule_delete',
    description: 'Delete a memory isolation rule by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Rule ID to delete.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'memory_entity_alias_add',
    description: 'Register an alias for an entity. After adding, memory extraction and search will match the alias to the same entity. Useful for multilingual names (e.g. "React" = "ReactJS"), nicknames (e.g. "张三" = "小张"), or abbreviations.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Target entity ID (the canonical entity).' },
        alias: { type: 'string', description: 'Alias to register. Must not conflict with another entity\'s name or existing alias.' },
      },
      required: ['entityId', 'alias'],
    },
  },
  {
    name: 'memory_entity_alias_remove',
    description: 'Remove an alias from an entity.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Entity ID.' },
        alias: { type: 'string', description: 'Alias to remove.' },
      },
      required: ['entityId', 'alias'],
    },
  },
  {
    name: 'memory_entity_alias_list',
    description: 'List all aliases for an entity.',
    inputSchema: {
      type: 'object',
      properties: {
        entityId: { type: 'string', description: 'Entity ID.' },
      },
      required: ['entityId'],
    },
  },
  {
    name: 'memory_entity_merge',
    description: 'Merge a source entity into a target entity. Transfers all memory links, aliases, and entity relations from source to target, then deletes source. The source entity\'s name becomes an alias of target. Use this to deduplicate entities created by different agents using different names for the same thing.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string', description: 'Source entity ID (will be deleted after merge).' },
        targetId: { type: 'string', description: 'Target entity ID (will remain after merge).' },
      },
      required: ['sourceId', 'targetId'],
    },
  },
  {
    name: 'memory_entity_duplicates',
    description: 'Find potential duplicate entities (same name with different IDs, or entity names that are registered as aliases of other entities). Returns pairs that can be merged via memory_entity_merge.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function toolByName(name: string): MCPTool {
  const tool = BASE_MCP_TOOLS.find(item => item.name === name);
  if (!tool) throw new Error(`Unknown KeyMemory MCP tool: ${name}`);
  return tool;
}

function aliasTool(name: string, canonicalName: string, description: string): MCPTool {
  const canonical = toolByName(canonicalName);
  return {
    name,
    description,
    inputSchema: canonical.inputSchema,
  };
}

export const KEYMEMORY_ALIAS_TOOLS: MCPTool[] = [
  aliasTool('keymemory', 'memory_create', 'KeyMemory default memory tool: save a durable memory instead of writing local Memory files.'),
  aliasTool('keymemory_connection_status', 'memory_connection_status', 'KeyMemory: return a read-only receipt proving that the live MCP connection is available.'),
  aliasTool('keymemory_create', 'memory_create', 'KeyMemory: save a durable memory. Use for remember, keep this, save this, or update my memory requests instead of local Memory files.'),
  aliasTool('keymemory_search', 'memory_search', 'KeyMemory: search durable memories. Use for recall, what do you remember, preferences, prior decisions, and project context.'),
  aliasTool('keymemory_context_pack', 'memory_context_pack', 'KeyMemory: build a compact context pack before long-running work.'),
  aliasTool('keymemory_inbox', 'memory_inbox_list', 'KeyMemory mailbox: list unread and relevant project, task, and event threads before starting work.'),
  aliasTool('keymemory_thread_context', 'memory_thread_context', 'KeyMemory mailbox: read one project thread as a compact handoff.'),
  aliasTool('keymemory_thread_reply', 'memory_thread_reply', 'KeyMemory mailbox: reply with human-readable progress or results.'),
  aliasTool('keymemory_read', 'memory_read', 'KeyMemory: read one durable memory by ID.'),
  aliasTool('keymemory_list', 'memory_list', 'KeyMemory: list recent durable memories.'),
  aliasTool('keymemory_update', 'memory_update', 'KeyMemory: update an existing durable memory.'),
  aliasTool('keymemory_delete', 'memory_delete', 'KeyMemory: delete or archive a durable memory.'),
  aliasTool('keymemory_auto_remember', 'memory_auto_remember', 'KeyMemory: auto-evaluate content and save it when it has durable value.'),
  aliasTool('keymemory_secret_set', 'memory_secret_set', 'KeyMemory secrets: encrypt and store a tool API key or credential outside regular memory.'),
  aliasTool('keymemory_secret_get', 'memory_secret_get', 'KeyMemory secrets: decrypt and read a stored tool API key or credential.'),
  aliasTool('keymemory_secret_list', 'memory_secret_list', 'KeyMemory secrets: list stored tool credentials without values.'),
  aliasTool('keymemory_secret_delete', 'memory_secret_delete', 'KeyMemory secrets: delete a stored tool credential.'),
];

export const MCP_TOOL_ALIASES: Record<string, string> = {
  keymemory: 'memory_create',
  keymemory_connection_status: 'memory_connection_status',
  keymemory_create: 'memory_create',
  save_memory: 'memory_create',
  remember: 'memory_create',
  keymemory_search: 'memory_search',
  keymemory_recall: 'memory_search',
  recall_memory: 'memory_search',
  search_memory: 'memory_search',
  keymemory_context: 'memory_context_pack',
  keymemory_context_pack: 'memory_context_pack',
  keymemory_inbox: 'memory_inbox_list',
  keymemory_thread_context: 'memory_thread_context',
  keymemory_thread_reply: 'memory_thread_reply',
  keymemory_read: 'memory_read',
  read_memory: 'memory_read',
  keymemory_list: 'memory_list',
  list_memory: 'memory_list',
  keymemory_update: 'memory_update',
  update_memory: 'memory_update',
  keymemory_supersede: 'memory_supersede',
  supersede_memory: 'memory_supersede',
  keymemory_delete: 'memory_delete',
  delete_memory: 'memory_delete',
  forget_memory: 'memory_delete',
  keymemory_auto: 'memory_auto_remember',
  keymemory_auto_remember: 'memory_auto_remember',
  keymemory_secret_set: 'memory_secret_set',
  keymemory_secret_get: 'memory_secret_get',
  keymemory_secret_list: 'memory_secret_list',
  keymemory_secret_delete: 'memory_secret_delete',
};

export function canonicalToolName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return MCP_TOOL_ALIASES[name] ?? name;
}

const READ_ONLY_TOOL_NAMES = new Set([
  'memory_connection_status',
  'memory_search',
  'memory_read',
  'memory_list',
  'memory_related',
  'memory_inbox_list',
  'memory_migration_discover',
  'memory_backup_inspect',
  'memory_backup_restore_dry_run',
  'memory_project_suggestions',
  'memory_secret_get',
  'memory_secret_list',
]);

const DESTRUCTIVE_TOOL_NAMES = new Set([
  'memory_delete',
  'memory_secret_delete',
]);

/** 当 KEYMEMORY_MCP_SILENT=1 时，所有 tool annotations 设为 false，避免客户端弹出权限确认 */
const SILENT_MODE = process.env.KEYMEMORY_MCP_SILENT === '1';

function toolTitle(name: string): string {
  return name
    .split('_')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function annotateTool(tool: MCPTool): MCPTool {
  const canonicalName = canonicalToolName(tool.name);
  const readOnly = READ_ONLY_TOOL_NAMES.has(canonicalName);
  const destructive = DESTRUCTIVE_TOOL_NAMES.has(canonicalName);

  if (SILENT_MODE) {
    return {
      ...tool,
      annotations: {
        title: tool.annotations?.title ?? toolTitle(tool.name),
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
        ...tool.annotations,
      },
    };
  }

  return {
    ...tool,
    annotations: {
      title: tool.annotations?.title ?? toolTitle(tool.name),
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      idempotentHint: readOnly,
      openWorldHint: false,
      ...tool.annotations,
    },
  };
}

export const MCP_TOOLS: MCPTool[] = [
  ...KEYMEMORY_ALIAS_TOOLS,
  ...BASE_MCP_TOOLS,
].map(annotateTool);

/**
 * KM-306：每个工具必须携带 when_to_use / when_not_to_use，
 * 避免 Agent 误调（如在只需检索时写入、在普通对话里启动 loop）。
 * 按规范名（canonical）配置，别名工具自动继承。
 */
const TOOL_GUIDANCE: Record<string, { whenToUse: string; whenNotToUse: string }> = {
  memory_connection_status: { whenToUse: '接入验收与排障：确认 KeyMemory 真实连通后再读写。', whenNotToUse: '不要每轮对话都调用；会话首次与怀疑断连时即可。' },
  memory_create: { whenToUse: '已有明确标题与完整正文的事实/偏好/决策，且检索确认无重复时。', whenNotToUse: '寒暄、过程独白、未验证猜测；不确定时先用 memory_search。' },
  memory_search: { whenToUse: '任务开始前召回相关记忆；写入前查重；回答涉及历史事实时。', whenNotToUse: '与当前任务无关的漫游检索；不要为凑上下文反复搜索。' },
  memory_context_pack: { whenToUse: '需要项目维度的结构化上下文注入（含邮箱接力与待确认项）。', whenNotToUse: '只需单条记忆时用 memory_read；高频每轮调用。' },
  memory_read: { whenToUse: '已知记忆 ID 且需要完整正文（如搜索摘要被截断）。', whenNotToUse: '不知道 ID 时；请先 memory_search。' },
  memory_list: { whenToUse: '浏览指定范围/筛选条件的记忆清单。', whenNotToUse: '大库无条件全量拉取；用搜索或分页。' },
  memory_update: { whenToUse: '纠正或补充已有记忆（保持单一事实源）。', whenNotToUse: '新建重复记忆代替更新；修改不属于当前空间的记忆。' },
  memory_delete: { whenToUse: '用户明确要求删除，或清理已确认错误的记忆。', whenNotToUse: '仅因“过时”就删除；请先考虑 memory_supersede。' },
  memory_auto_remember: { whenToUse: '对话中出现值得沉淀的内容时交给质量门禁自动评估写入。', whenNotToUse: '已有结构化标题与正文时直接 memory_create。' },
  memory_relate: { whenToUse: '两条记忆存在明确的推导/引用/部分关系时显式建边。', whenNotToUse: '仅因同时出现就建边（共现由系统自动治理）。' },
  memory_related: { whenToUse: '沿关系图扩展某条记忆的关联上下文。', whenNotToUse: '替代全文搜索；关系稀疏时的主检索手段。' },
  memory_supersede: { whenToUse: '新事实取代旧事实，需要保留历史可追溯时。', whenNotToUse: '补充而非取代；旧事实仍然有效时。' },
  memory_import: { whenToUse: '从备份/导出 JSON 批量恢复记忆。', whenNotToUse: '单条写入；未确认来源可信的导入。' },
  memory_migration_discover: { whenToUse: '接入阶段扫描本机其它记忆文件（MEMORY.md 等）。', whenNotToUse: '日常读写；已完成迁移后反复扫描。' },
  memory_migration_import: { whenToUse: '确认预览后把发现的来源迁移进 KeyMemory。', whenNotToUse: '未经 discover/预览直接导入陌生文件。' },
  memory_backup_create: { whenToUse: '迁移、dream 整理或高风险维护前创建可携备份。', whenNotToUse: '每次写入后都备份；把备份当版本历史。' },
  memory_backup_inspect: { whenToUse: '恢复前核对备份内容完整性。', whenNotToUse: '代替恢复操作本身。' },
  memory_backup_restore_dry_run: { whenToUse: '恢复前预演影响面（不写入）。', whenNotToUse: '当作实际恢复；确认后应使用完整恢复入口。' },
  memory_project_suggestions: { whenToUse: '查看待确认的项目归类建议。', whenNotToUse: '自动批量接受而不逐条核对。' },
  memory_project_suggestion_accept: { whenToUse: '建议内容与实际归属一致时接受。', whenNotToUse: '建议明显错误或归属不明时。' },
  memory_project_suggestion_reject: { whenToUse: '建议不适用时显式拒绝，避免重复提议。', whenNotToUse: '未读建议内容就拒绝。' },
  memory_secret_set: { whenToUse: '保存工具凭据/密钥（加密存储，不入普通记忆）。', whenNotToUse: '保存非凭据信息；把密钥写进 memory_create。' },
  memory_secret_get: { whenToUse: '工具调用前取出所需凭据。', whenNotToUse: '把取出的密钥输出到对话或写进记忆。' },
  memory_secret_list: { whenToUse: '盘点已存凭据名称（不含值）。', whenNotToUse: '用于导出或迁移密钥。' },
  memory_secret_delete: { whenToUse: '凭据作废或轮换后删除旧值。', whenNotToUse: '仍在使用的凭据。' },
  memory_isolation_rule_create: { whenToUse: '为多 Agent 共存定义新的隔离规则。', whenNotToUse: '临时性需求；先评估现有规则是否已覆盖。' },
  memory_isolation_rule_list: { whenToUse: '排障跨空间读写问题前查看现行规则。', whenNotToUse: '频繁轮询；规则变更是低频操作。' },
  memory_isolation_rule_update: { whenToUse: '现行规则产生误隔离或泄漏时修正。', whenNotToUse: '未确认影响面就放宽隔离。' },
  memory_isolation_rule_delete: { whenToUse: '规则已冗余或被新规则取代时。', whenNotToUse: '仍在生效且无替代的规则。' },
  memory_entity_alias_add: { whenToUse: '同一实体出现新别名（代号/缩写）时登记。', whenNotToUse: '把不同实体登记为别名。' },
  memory_entity_alias_remove: { whenToUse: '别名登记错误或实体更名后清理。', whenNotToUse: '仍在被引用的别名。' },
  memory_entity_alias_list: { whenToUse: '合并实体前核对别名清单。', whenNotToUse: '高频每轮调用。' },
  memory_entity_merge: { whenToUse: '确认两个实体记录同一对象时合并（先用 duplicates 核对）。', whenNotToUse: '仅名称相似但指代不同对象时。' },
  memory_entity_duplicates: { whenToUse: '定期体检实体库，发现疑似重复。', whenNotToUse: '代替人工确认直接批量合并。' },
  memory_inbox_list: { whenToUse: '查看邮箱待处理线程列表。', whenNotToUse: '已知具体线程时直接 memory_thread_context。' },
  memory_thread_create: { whenToUse: '新任务/事件需要独立邮件主题延续上下文时。', whenNotToUse: '已有同主题线程；请先检索避免重复主题。' },
  memory_thread_read: { whenToUse: '读取指定线程的消息列表。', whenNotToUse: '需要含记忆引用的完整接力上下文时用 thread_context。' },
  memory_thread_context: { whenToUse: '继续某线程工作前获取线程+关联记忆的完整上下文。', whenNotToUse: '与当前线程无关的浏览。' },
  memory_thread_reply: { whenToUse: '里程碑/交接/阻塞时向线程回复进展。', whenNotToUse: '每条对话都回；琐碎过程不入线程。' },
  memory_thread_link_memory: { whenToUse: '把新建原子记忆关联到所属线程。', whenNotToUse: '与线程主题无关的记忆。' },
  memory_mailbox_sync: { whenToUse: '同步/修复邮箱线程状态或重建索引。', whenNotToUse: '常规读写；同步是维护操作。' },
  memory_loop_start: { whenToUse: '多步长任务启动，需要幂等/租约/断点恢复时。', whenNotToUse: '单步即可完成的任务；不要为简单问答启动 loop。' },
  memory_loop_context: { whenToUse: '恢复/续租正在运行的 loop，获取事件与上下文包。', whenNotToUse: 'loop 已终态；重新 start 新任务。' },
  memory_loop_checkpoint: { whenToUse: '每完成一个可验证步骤后持久化进度。', whenNotToUse: '把大段日志写进 checkpoint（用 memory_offload）。' },
  memory_loop_finish: { whenToUse: '目标达成或确认终止时收尾 loop。', whenNotToUse: '尚有未完成步骤；中途放弃不记录原因。' },
  memory_offload: { whenToUse: '长日志/调研/中间产物卸载为外部引用，主上下文只留摘要+路径。', whenNotToUse: '需要长期保留的事实/偏好/决策（用 memory_create）。' },
};

function withGuidance(tool: MCPTool): MCPTool {
  const guidance = TOOL_GUIDANCE[canonicalToolName(tool.name)];
  if (!guidance) return tool;
  return {
    ...tool,
    description: `${tool.description}\nWhen to use: ${guidance.whenToUse}\nWhen not to use: ${guidance.whenNotToUse}`,
  };
}

for (let i = 0; i < MCP_TOOLS.length; i++) {
  MCP_TOOLS[i] = withGuidance(MCP_TOOLS[i]);
}

export const MCP_RESOURCES = [
  {
    uri: 'keymemory://stats',
    name: 'KeyMemory Statistics',
    description: 'Current memory statistics by layer',
  },
];

export const MCP_PROMPTS = [
  {
    name: 'memory_context',
    description: 'Inject relevant KeyMemory memories into conversation context.',
    arguments: [
      { name: 'project', description: 'Current project name, path, or ID.', required: false },
      { name: 'query', description: 'Context query.', required: false },
      { name: 'projectId', description: 'Project ID.', required: false },
    ],
  },
];
