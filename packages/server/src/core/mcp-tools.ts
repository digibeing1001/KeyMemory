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
    description: 'Build an agent-ready KeyMemory context pack grouped by preferences, constraints, decisions, tasks, procedures, and project facts. Use before long-running work.',
    inputSchema: memoryContextPackSchema,
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
