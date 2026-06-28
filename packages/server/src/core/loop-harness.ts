import { createHash } from 'crypto';
import { v4 as uuid } from 'uuid';
import type {
  AgentContextPack,
  LoopCheckpoint,
  LoopCheckpointRequest,
  LoopContextData,
  LoopContextRequest,
  LoopEvent,
  LoopFinishRequest,
  LoopHarnessError,
  LoopObservation,
  LoopRun,
  LoopRunStartRequest,
  LoopRunStatus,
} from '@keymemory/shared';
import { getDatabase } from '../db/sqlite.js';
import { buildAgentContextPack } from './context-pack.js';
import { redactSensitiveValue } from './privacy.js';
import { ensureProjectPath, findProjectRef, getProject } from './project.js';
import { visibleSpacesFor } from '../adapters/base.js';

const SCHEMA_VERSION = 'keymemory.loop-observation.v1' as const;
const TERMINAL_STATUSES = new Set<LoopRunStatus>(['completed', 'failed', 'cancelled']);

export class LoopProtocolError extends Error {
  readonly detail: LoopHarnessError;

  constructor(detail: LoopHarnessError) {
    super(detail.message);
    this.name = 'LoopProtocolError';
    this.detail = detail;
  }
}

function protocolError(code: string, message: string, retryable: boolean, versions?: { expected: number; actual: number }): never {
  throw new LoopProtocolError({
    code,
    message,
    retryable,
    expectedVersion: versions?.expected,
    actualVersion: versions?.actual,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertOptionalString(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'string') {
    protocolError('INVALID_INPUT', `${name} must be a string`, false);
  }
}

function assertOptionalNumber(value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value))) {
    protocolError('INVALID_INPUT', `${name} must be a finite number`, false);
  }
}

function assertOptionalRecord(value: unknown, name: string): void {
  if (value !== undefined && !isRecord(value)) {
    protocolError('INVALID_INPUT', `${name} must be an object`, false);
  }
}

function assertOptionalStringArray(value: unknown, name: string): void {
  if (value !== undefined && (!Array.isArray(value) || !value.every(item => typeof item === 'string'))) {
    protocolError('INVALID_INPUT', `${name} must be an array of strings`, false);
  }
}

function assertStringLimit(value: string | undefined, name: string, maxChars: number): void {
  if (value !== undefined && value.length > maxChars) {
    protocolError('LIMIT_EXCEEDED', `${name} exceeds the ${maxChars} character limit`, false);
  }
}

function assertJsonLimit(value: unknown, name: string, maxChars: number): void {
  if (value !== undefined && JSON.stringify(value).length > maxChars) {
    protocolError('LIMIT_EXCEEDED', `${name} exceeds the ${maxChars} character serialized limit`, false);
  }
}

function assertStringArrayLimit(value: string[] | undefined, name: string, maxItems: number, maxItemChars = 4096): void {
  if (!value) return;
  if (value.length > maxItems || value.some(item => item.length > maxItemChars)) {
    protocolError('LIMIT_EXCEEDED', `${name} exceeds its item or character limit`, false);
  }
}

function assertSpanId(value: string | undefined): void {
  if (value !== undefined && !/^[0-9a-fA-F]{16}$/.test(value)) {
    protocolError('INVALID_INPUT', 'spanId must be a 16-character hexadecimal OpenTelemetry span ID', false);
  }
}

function assertMemoryRefs(memoryRefs: string[], agentSpaces?: string[]): void {
  const db = getDatabase();
  const accessibleSet = agentSpaces && agentSpaces.length > 0 ? new Set(agentSpaces) : undefined;
  for (const memoryId of memoryRefs) {
    const row = db.prepare(`SELECT id, agent_space FROM memories WHERE id = ? AND status != 'deleted'`)
      .get(memoryId) as { id: string; agent_space: string } | undefined;
    if (!row) protocolError('MEMORY_NOT_FOUND', `Referenced memory not found: ${memoryId}`, false);
    // 隔离校验：若指定了可见空间，引用的记忆必须落在这些空间内，防止跨 agent 越权引用
    if (accessibleSet && !accessibleSet.has(row.agent_space)) {
      protocolError('MEMORY_NOT_ACCESSIBLE', `Referenced memory ${memoryId} is not in an accessible agent space`, false);
    }
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseStrings(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function rowToRun(row: Record<string, unknown>): LoopRun {
  return {
    id: String(row.id),
    objective: String(row.objective),
    projectId: row.project_id ? String(row.project_id) : undefined,
    projectPath: row.project_path ? String(row.project_path) : undefined,
    agentId: String(row.agent_id),
    status: String(row.status) as LoopRunStatus,
    checkpointVersion: Number(row.checkpoint_version),
    lastEventSequence: Number(row.last_event_sequence),
    traceId: String(row.trace_id),
    leaseOwner: String(row.lease_owner),
    leaseExpiresAt: String(row.lease_expires_at),
    metadata: Object.keys(parseObject(row.metadata)).length > 0 ? parseObject(row.metadata) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
  };
}

function rowToCheckpoint(row: Record<string, unknown>): LoopCheckpoint {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    version: Number(row.version),
    phase: String(row.phase),
    summary: String(row.summary),
    state: parseObject(row.state),
    nextActions: parseStrings(row.next_actions),
    artifacts: parseStrings(row.artifacts),
    memoryRefs: parseStrings(row.memory_refs),
    createdAt: String(row.created_at),
  };
}

function rowToEvent(row: Record<string, unknown>): LoopEvent {
  return {
    id: String(row.id),
    runId: String(row.run_id),
    sequence: Number(row.sequence),
    eventName: String(row.event_name),
    severity: String(row.severity) as LoopEvent['severity'],
    traceId: String(row.trace_id),
    spanId: row.span_id ? String(row.span_id) : undefined,
    body: row.body ? String(row.body) : undefined,
    attributes: parseObject(row.attributes),
    timestamp: String(row.created_at),
  };
}

function getRunOrThrow(runId: string): LoopRun {
  const row = getDatabase().prepare('SELECT * FROM loop_runs WHERE id = ?').get(runId) as Record<string, unknown> | undefined;
  if (!row) protocolError('RUN_NOT_FOUND', `Loop run not found: ${runId}`, false);
  return rowToRun(row);
}

function getCheckpoint(runId: string, version?: number): LoopCheckpoint {
  const row = version === undefined
    ? getDatabase().prepare('SELECT * FROM loop_checkpoints WHERE run_id = ? ORDER BY version DESC LIMIT 1').get(runId)
    : getDatabase().prepare('SELECT * FROM loop_checkpoints WHERE run_id = ? AND version = ?').get(runId, version);
  if (!row) protocolError('CHECKPOINT_NOT_FOUND', `Checkpoint not found for run: ${runId}`, false);
  return rowToCheckpoint(row as Record<string, unknown>);
}

function normalizeTtl(seconds: number | undefined): number {
  if (seconds === undefined) return 60;
  if (!Number.isFinite(seconds)) protocolError('INVALID_INPUT', 'lease TTL must be a finite number', false);
  return Math.max(15, Math.min(Math.trunc(seconds), 3600));
}

function leaseExpiry(seconds: number | undefined): string {
  return new Date(Date.now() + normalizeTtl(seconds) * 1000).toISOString();
}

function assertVersion(run: LoopRun, expectedVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    protocolError('INVALID_INPUT', 'expectedVersion must be a non-negative integer', false);
  }
  if (run.checkpointVersion !== expectedVersion) {
    protocolError(
      'VERSION_CONFLICT',
      `Checkpoint version changed from ${expectedVersion} to ${run.checkpointVersion}`,
      true,
      { expected: expectedVersion, actual: run.checkpointVersion },
    );
  }
}

function assertLease(run: LoopRun, leaseOwner: string): void {
  if (!leaseOwner.trim()) protocolError('INVALID_INPUT', 'leaseOwner is required', false);
  const active = Date.parse(run.leaseExpiresAt) > Date.now();
  if (active && run.leaseOwner !== leaseOwner) {
    protocolError('LEASE_CONFLICT', `Run is leased by ${run.leaseOwner} until ${run.leaseExpiresAt}`, true);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function requestHash(value: Record<string, unknown>, ephemeralKeys: string[] = []): string {
  const payload = Object.fromEntries(Object.entries(value).filter(([key]) => !ephemeralKeys.includes(key)));
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex');
}

function contextFingerprint(pack: AgentContextPack): string {
  const identity = pack.sections.flatMap(section => section.items.map(item => `${item.id}:${item.updatedAt}`));
  return createHash('sha256').update(JSON.stringify({ query: pack.query, projectId: pack.projectId, identity })).digest('hex');
}

function buildLoopQuery(run: LoopRun, checkpoint: LoopCheckpoint, query?: string): string {
  const parts = [query, run.objective, `phase: ${checkpoint.phase}`, checkpoint.summary, ...checkpoint.nextActions]
    .map(part => part?.trim())
    .filter((part): part is string => Boolean(part));
  return Array.from(new Set(parts)).join('\n').slice(0, 2000);
}

function appendEvent(input: {
  run: LoopRun;
  sequence: number;
  eventName: string;
  severity: LoopEvent['severity'];
  body?: string;
  spanId?: string;
  attributes?: Record<string, unknown>;
  timestamp: string;
}): void {
  getDatabase().prepare(`
    INSERT INTO loop_events (id, run_id, sequence, event_name, severity, trace_id, span_id, body, attributes, created_at)
    VALUES (@id, @runId, @sequence, @eventName, @severity, @traceId, @spanId, @body, @attributes, @createdAt)
  `).run({
    id: uuid(),
    runId: input.run.id,
    sequence: input.sequence,
    eventName: input.eventName,
    severity: input.severity,
    traceId: input.run.traceId,
    spanId: input.spanId ?? null,
    body: input.body ?? null,
    attributes: JSON.stringify(redactSensitiveValue(input.attributes ?? {})),
    createdAt: input.timestamp,
  });
}

function listEvents(runId: string, afterSequence = 0, maxEvents = 50): LoopEvent[] {
  const limit = Math.max(1, Math.min(Math.trunc(maxEvents), 200));
  const rows = getDatabase().prepare(`
    SELECT * FROM loop_events
    WHERE run_id = ? AND sequence > ?
    ORDER BY sequence ASC
    LIMIT ?
  `).all(runId, Math.max(0, Math.trunc(afterSequence)), limit) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

async function observe(
  run: LoopRun,
  checkpoint: LoopCheckpoint,
  input: { query?: string; afterSequence?: number; maxEvents?: number; maxItems?: number; maxChars?: number },
  status: LoopObservation<LoopContextData>['status'] = 'success',
  summary?: string,
): Promise<LoopObservation<LoopContextData>> {
  const contextPack = await buildAgentContextPack({
    query: buildLoopQuery(run, checkpoint, input.query),
    project: run.projectPath,
    projectId: run.projectId,
    maxItems: input.maxItems,
    maxChars: input.maxChars,
    // loop run 的 context pack 只暴露该 agent 可见空间的记忆，防止跨 agent 泄露
    agentSpaces: visibleSpacesFor(run.agentId),
  });
  const nextActions = checkpoint.nextActions.length > 0
    ? checkpoint.nextActions
    : TERMINAL_STATUSES.has(run.status)
      ? []
      : ['Persist progress with memory_loop_checkpoint before the next irreversible action.'];
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    summary: summary ?? `Loop run ${run.id} is ${run.status} at checkpoint ${run.checkpointVersion}.`,
    nextActions,
    artifacts: checkpoint.artifacts,
    data: {
      run,
      checkpoint,
      events: listEvents(run.id, input.afterSequence, input.maxEvents),
      contextPack,
      contextFingerprint: contextFingerprint(contextPack),
    },
    cursor: { checkpointVersion: run.checkpointVersion, eventSequence: run.lastEventSequence },
  };
}

export function loopErrorObservation(error: unknown): LoopObservation {
  if (!(error instanceof LoopProtocolError)) {
    console.error('[KeyMemory][Loop] Unexpected error:', error);
  }
  const detail = error instanceof LoopProtocolError
    ? error.detail
    : { code: 'INTERNAL_ERROR', message: 'Unexpected Loop harness error', retryable: false };
  const nextActions = detail.code === 'VERSION_CONFLICT'
    ? ['Call memory_loop_context, merge the latest checkpoint, then retry with the returned checkpointVersion.']
    : detail.code === 'LEASE_CONFLICT'
      ? ['Wait for the lease to expire or resume with the active lease owner.']
      : [];
  return {
    schemaVersion: SCHEMA_VERSION,
    status: 'error',
    summary: detail.message,
    nextActions,
    artifacts: [],
    error: detail,
  };
}

export async function startLoopRun(input: LoopRunStartRequest): Promise<LoopObservation<LoopContextData>> {
  if (!isRecord(input) || !isNonEmptyString(input.objective) || !isNonEmptyString(input.agentId)
    || !isNonEmptyString(input.idempotencyKey) || !isNonEmptyString(input.leaseOwner)) {
    protocolError('INVALID_INPUT', 'objective, agentId, idempotencyKey, and leaseOwner are required', false);
  }
  assertOptionalString(input.project, 'project');
  assertOptionalString(input.projectId, 'projectId');
  assertOptionalString(input.query, 'query');
  assertOptionalNumber(input.leaseTtlSeconds, 'leaseTtlSeconds');
  assertOptionalNumber(input.maxItems, 'maxItems');
  assertOptionalNumber(input.maxChars, 'maxChars');
  assertOptionalRecord(input.metadata, 'metadata');
  assertStringLimit(input.objective, 'objective', 8000);
  assertStringLimit(input.project, 'project', 512);
  assertStringLimit(input.projectId, 'projectId', 256);
  assertStringLimit(input.agentId, 'agentId', 256);
  assertStringLimit(input.idempotencyKey, 'idempotencyKey', 512);
  assertStringLimit(input.leaseOwner, 'leaseOwner', 256);
  assertStringLimit(input.query, 'query', 8000);
  assertJsonLimit(input.metadata, 'metadata', 65536);
  if (!isNonEmptyString(input.project) && !isNonEmptyString(input.projectId)) {
    protocolError('INVALID_INPUT', 'project or projectId is required to prevent cross-project context leakage', false);
  }
  if (isNonEmptyString(input.project) && isNonEmptyString(input.projectId)) {
    protocolError('INVALID_INPUT', 'project and projectId are mutually exclusive', false);
  }
  const db = getDatabase();
  const existing = db.prepare('SELECT * FROM loop_runs WHERE idempotency_key = ?').get(input.idempotencyKey) as Record<string, unknown> | undefined;
  const hash = requestHash(input as unknown as Record<string, unknown>, ['leaseOwner', 'leaseTtlSeconds', 'query', 'maxItems', 'maxChars']);
  if (existing) {
    if (existing.request_hash && String(existing.request_hash) !== hash) {
      protocolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different run payload', false);
    }
    const run = rowToRun(existing);
    return observe(run, getCheckpoint(run.id), input, 'warning', `Idempotent replay resumed loop run ${run.id}.`);
  }

  const now = new Date().toISOString();
  const runId = uuid();
  const checkpointId = uuid();
  const traceId = createHash('sha256').update(`${runId}:${now}`).digest('hex').slice(0, 32);
  const safeMetadata = redactSensitiveValue(input.metadata ?? {}) as Record<string, unknown>;
  const safeObjective = redactSensitiveValue(input.objective.trim()) as string;
  const leaseExpiresAt = leaseExpiry(input.leaseTtlSeconds);
  let project: ReturnType<typeof getProject> = null;
  let concurrentReplay: Record<string, unknown> | undefined;

  const created = db.transaction(() => {
    concurrentReplay = db.prepare('SELECT * FROM loop_runs WHERE idempotency_key = ?').get(input.idempotencyKey) as Record<string, unknown> | undefined;
    if (concurrentReplay) return false;

    project = input.projectId
      ? getProject(input.projectId)
      : input.project
        ? findProjectRef(input.project) ?? ensureProjectPath(input.project)
        : null;
    if (input.projectId && !project) protocolError('PROJECT_NOT_FOUND', `Project not found: ${input.projectId}`, false);

    db.prepare(`
      INSERT INTO loop_runs (
        id, idempotency_key, request_hash, objective, project_id, project_path, agent_id, status,
        checkpoint_version, last_event_sequence, trace_id, lease_owner, lease_expires_at,
        metadata, created_at, updated_at
      ) VALUES (
        @id, @idempotencyKey, @requestHash, @objective, @projectId, @projectPath, @agentId, 'running',
        0, 1, @traceId, @leaseOwner, @leaseExpiresAt, @metadata, @createdAt, @updatedAt
      )
    `).run({
      id: runId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      objective: safeObjective,
      projectId: project?.id ?? null,
      projectPath: project?.path ?? input.project ?? null,
      agentId: input.agentId.trim(),
      traceId,
      leaseOwner: input.leaseOwner.trim(),
      leaseExpiresAt,
      metadata: JSON.stringify(safeMetadata),
      createdAt: now,
      updatedAt: now,
    });
    db.prepare(`
      INSERT INTO loop_checkpoints (
        id, run_id, version, phase, summary, state, next_actions, artifacts, memory_refs, created_at
      ) VALUES (?, ?, 0, 'started', ?, '{}', '[]', '[]', '[]', ?)
    `).run(checkpointId, runId, safeObjective, now);
    appendEvent({
      run: {
        id: runId,
        objective: safeObjective,
        projectId: project?.id,
        projectPath: project?.path ?? input.project,
        agentId: input.agentId.trim(),
        status: 'running',
        checkpointVersion: 0,
        lastEventSequence: 1,
        traceId,
        leaseOwner: input.leaseOwner.trim(),
        leaseExpiresAt,
        metadata: safeMetadata,
        createdAt: now,
        updatedAt: now,
      },
      sequence: 1,
      eventName: 'loop.run.started',
      severity: 'info',
      body: safeObjective,
      attributes: { agentId: input.agentId, projectId: project?.id, projectPath: project?.path },
      timestamp: now,
    });
    return true;
  }).immediate();

  if (!created) {
    if (!concurrentReplay) protocolError('IDEMPOTENCY_CONFLICT', 'Run was not created and no replay target exists', true);
    if (concurrentReplay.request_hash && String(concurrentReplay.request_hash) !== hash) {
      protocolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different run payload', false);
    }
    const replayRun = rowToRun(concurrentReplay);
    return observe(replayRun, getCheckpoint(replayRun.id), input, 'warning', `Idempotent replay resumed loop run ${replayRun.id}.`);
  }

  const run = getRunOrThrow(runId);
  return observe(run, getCheckpoint(runId), input, 'success', `Started durable loop run ${runId}.`);
}

export async function getLoopContext(input: LoopContextRequest): Promise<LoopObservation<LoopContextData>> {
  if (!isRecord(input) || !isNonEmptyString(input.runId) || !isNonEmptyString(input.leaseOwner)) {
    protocolError('INVALID_INPUT', 'runId and leaseOwner are required', false);
  }
  assertOptionalString(input.query, 'query');
  assertOptionalNumber(input.renewLeaseSeconds, 'renewLeaseSeconds');
  assertOptionalNumber(input.afterSequence, 'afterSequence');
  assertOptionalNumber(input.maxEvents, 'maxEvents');
  assertOptionalNumber(input.maxItems, 'maxItems');
  assertOptionalNumber(input.maxChars, 'maxChars');
  assertStringLimit(input.runId, 'runId', 256);
  assertStringLimit(input.leaseOwner, 'leaseOwner', 256);
  assertStringLimit(input.query, 'query', 8000);
  const db = getDatabase();
  let run = getRunOrThrow(input.runId);
  db.transaction(() => {
    run = getRunOrThrow(input.runId);
    if (!TERMINAL_STATUSES.has(run.status)) {
      assertLease(run, input.leaseOwner);
      const now = new Date().toISOString();
      const update = db.prepare(`
        UPDATE loop_runs
        SET lease_owner = @leaseOwner, lease_expires_at = @leaseExpiresAt, updated_at = @updatedAt
        WHERE id = @id
          AND status IN ('running', 'waiting')
          AND (lease_owner = @leaseOwner OR lease_expires_at <= @updatedAt)
      `).run({
        id: run.id,
        leaseOwner: input.leaseOwner,
        leaseExpiresAt: leaseExpiry(input.renewLeaseSeconds),
        updatedAt: now,
      });
      if (update.changes !== 1) {
        run = getRunOrThrow(run.id);
        if (!TERMINAL_STATUSES.has(run.status)) assertLease(run, input.leaseOwner);
      }
      run = getRunOrThrow(run.id);
    }
  }).immediate();
  return observe(run, getCheckpoint(run.id), input);
}

export async function checkpointLoopRun(input: LoopCheckpointRequest): Promise<LoopObservation<LoopContextData>> {
  if (!isRecord(input) || !isNonEmptyString(input.runId) || !isNonEmptyString(input.leaseOwner)
    || !isNonEmptyString(input.idempotencyKey) || !isNonEmptyString(input.phase) || !isNonEmptyString(input.summary)) {
    protocolError('INVALID_INPUT', 'idempotencyKey, phase, and summary are required', false);
  }
  assertOptionalNumber(input.expectedVersion, 'expectedVersion');
  assertOptionalNumber(input.leaseTtlSeconds, 'leaseTtlSeconds');
  assertOptionalRecord(input.state, 'state');
  assertOptionalStringArray(input.nextActions, 'nextActions');
  assertOptionalStringArray(input.artifacts, 'artifacts');
  assertOptionalStringArray(input.memoryRefs, 'memoryRefs');
  assertOptionalString(input.eventName, 'eventName');
  assertOptionalString(input.spanId, 'spanId');
  assertStringLimit(input.runId, 'runId', 256);
  assertStringLimit(input.idempotencyKey, 'idempotencyKey', 512);
  assertStringLimit(input.leaseOwner, 'leaseOwner', 256);
  assertStringLimit(input.phase, 'phase', 128);
  assertStringLimit(input.summary, 'summary', 20000);
  assertStringLimit(input.eventName, 'eventName', 256);
  assertStringLimit(input.spanId, 'spanId', 256);
  assertSpanId(input.spanId);
  assertJsonLimit(input.state, 'state', 262144);
  assertStringArrayLimit(input.nextActions, 'nextActions', 100);
  assertStringArrayLimit(input.artifacts, 'artifacts', 100);
  assertStringArrayLimit(input.memoryRefs, 'memoryRefs', 200, 256);
  if (input.status && !['running', 'waiting'].includes(input.status)) {
    protocolError('INVALID_INPUT', 'checkpoint status must be running or waiting', false);
  }
  if (input.severity && !['debug', 'info', 'warn', 'error'].includes(input.severity)) {
    protocolError('INVALID_INPUT', 'severity must be debug, info, warn, or error', false);
  }
  const db = getDatabase();
  const replay = db.prepare(`
    SELECT * FROM loop_checkpoints WHERE run_id = ? AND idempotency_key = ?
  `).get(input.runId, input.idempotencyKey) as Record<string, unknown> | undefined;
  const hash = requestHash(input as unknown as Record<string, unknown>, ['leaseOwner', 'leaseTtlSeconds']);
  if (replay) {
    if (String(replay.request_hash) !== hash) {
      protocolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different checkpoint payload', false);
    }
    const run = getRunOrThrow(input.runId);
    return observe(run, getCheckpoint(run.id), {}, 'warning', `Idempotent replay matched checkpoint ${replay.version}; returning current checkpoint ${run.checkpointVersion}.`);
  }

  let now = '';
  const safeState = redactSensitiveValue(input.state ?? {}) as Record<string, unknown>;
  const safeSummary = redactSensitiveValue(input.summary) as string;
  const safeNextActions = redactSensitiveValue(input.nextActions ?? []) as string[];
  const safeArtifacts = redactSensitiveValue(input.artifacts ?? []) as string[];
  const memoryRefs = Array.from(new Set(input.memoryRefs ?? [])).filter(Boolean);
  let run = getRunOrThrow(input.runId);
  let nextVersion = 0;
  let nextSequence = 0;
  let concurrentReplay: Record<string, unknown> | undefined;

  db.transaction(() => {
    concurrentReplay = db.prepare(`
      SELECT * FROM loop_checkpoints WHERE run_id = ? AND idempotency_key = ?
    `).get(input.runId, input.idempotencyKey) as Record<string, unknown> | undefined;
    if (concurrentReplay) {
      if (String(concurrentReplay.request_hash) !== hash) {
        protocolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different checkpoint payload', false);
      }
      return;
    }

    run = getRunOrThrow(input.runId);
    now = new Date().toISOString();
    if (TERMINAL_STATUSES.has(run.status)) protocolError('RUN_TERMINAL', `Run is already ${run.status}`, false);
    assertLease(run, input.leaseOwner);
    assertVersion(run, input.expectedVersion);
    assertMemoryRefs(memoryRefs, visibleSpacesFor(run.agentId));
    nextVersion = run.checkpointVersion + 1;
    nextSequence = run.lastEventSequence + 1;
    db.prepare(`
      INSERT INTO loop_checkpoints (
        id, run_id, version, idempotency_key, request_hash, phase, summary,
        state, next_actions, artifacts, memory_refs, created_at
      ) VALUES (
        @id, @runId, @version, @idempotencyKey, @requestHash, @phase, @summary,
        @state, @nextActions, @artifacts, @memoryRefs, @createdAt
      )
    `).run({
      id: uuid(),
      runId: run.id,
      version: nextVersion,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      phase: input.phase.trim(),
      summary: safeSummary,
      state: JSON.stringify(safeState),
      nextActions: JSON.stringify(safeNextActions),
      artifacts: JSON.stringify(safeArtifacts),
      memoryRefs: JSON.stringify(memoryRefs),
      createdAt: now,
    });
    const update = db.prepare(`
      UPDATE loop_runs
      SET status = @status, checkpoint_version = @version, last_event_sequence = @sequence,
          lease_owner = @leaseOwner, lease_expires_at = @leaseExpiresAt, updated_at = @updatedAt
       WHERE id = @id AND checkpoint_version = @expectedVersion
         AND status IN ('running', 'waiting')
         AND (lease_owner = @leaseOwner OR lease_expires_at <= @updatedAt)
    `).run({
      id: run.id,
      status: input.status ?? 'running',
      version: nextVersion,
      sequence: nextSequence,
      leaseOwner: input.leaseOwner,
      leaseExpiresAt: leaseExpiry(input.leaseTtlSeconds),
      updatedAt: now,
      expectedVersion: input.expectedVersion,
    });
    if (update.changes !== 1) {
      protocolError('VERSION_CONFLICT', 'Checkpoint changed before this transaction could commit', true, {
        expected: input.expectedVersion,
        actual: getRunOrThrow(run.id).checkpointVersion,
      });
    }
    appendEvent({
      run,
      sequence: nextSequence,
      eventName: input.eventName?.trim() || 'loop.checkpoint.saved',
      severity: input.severity ?? 'info',
      spanId: input.spanId,
      body: safeSummary,
      attributes: { checkpointVersion: nextVersion, phase: input.phase, status: input.status ?? 'running', memoryRefCount: memoryRefs.length },
      timestamp: now,
    });
  }).immediate();

  if (concurrentReplay) {
    run = getRunOrThrow(input.runId);
    return observe(run, getCheckpoint(run.id), {}, 'warning', `Idempotent replay matched checkpoint ${concurrentReplay.version}; returning current checkpoint ${run.checkpointVersion}.`);
  }

  run = getRunOrThrow(run.id);
  return observe(run, getCheckpoint(run.id), {}, 'success', `Saved checkpoint ${nextVersion} for loop run ${run.id}.`);
}

export async function finishLoopRun(input: LoopFinishRequest): Promise<LoopObservation<LoopContextData>> {
  if (!isRecord(input) || !isNonEmptyString(input.runId) || !isNonEmptyString(input.leaseOwner)
    || !isNonEmptyString(input.idempotencyKey) || !isNonEmptyString(input.summary)) {
    protocolError('INVALID_INPUT', 'idempotencyKey and summary are required', false);
  }
  assertOptionalNumber(input.expectedVersion, 'expectedVersion');
  assertOptionalRecord(input.state, 'state');
  assertOptionalStringArray(input.artifacts, 'artifacts');
  assertOptionalStringArray(input.memoryRefs, 'memoryRefs');
  assertOptionalString(input.spanId, 'spanId');
  assertStringLimit(input.runId, 'runId', 256);
  assertStringLimit(input.idempotencyKey, 'idempotencyKey', 512);
  assertStringLimit(input.leaseOwner, 'leaseOwner', 256);
  assertStringLimit(input.summary, 'summary', 20000);
  assertStringLimit(input.spanId, 'spanId', 256);
  assertSpanId(input.spanId);
  assertJsonLimit(input.state, 'state', 262144);
  assertStringArrayLimit(input.artifacts, 'artifacts', 100);
  assertStringArrayLimit(input.memoryRefs, 'memoryRefs', 200, 256);
  if (!['completed', 'failed', 'cancelled'].includes(input.status)) {
    protocolError('INVALID_INPUT', 'finish status must be completed, failed, or cancelled', false);
  }
  const replay = getDatabase().prepare(`
    SELECT * FROM loop_checkpoints WHERE run_id = ? AND idempotency_key = ?
  `).get(input.runId, input.idempotencyKey) as Record<string, unknown> | undefined;
  const hash = requestHash(input as unknown as Record<string, unknown>, ['leaseOwner']);
  if (replay) {
    if (String(replay.request_hash) !== hash) {
      protocolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different finish payload', false);
    }
    const run = getRunOrThrow(input.runId);
    return observe(run, getCheckpoint(run.id), {}, 'warning', `Idempotent replay returned terminal run ${run.id}.`);
  }

  let now = '';
  const safeState = redactSensitiveValue(input.state ?? {}) as Record<string, unknown>;
  const safeSummary = redactSensitiveValue(input.summary) as string;
  const safeArtifacts = redactSensitiveValue(input.artifacts ?? []) as string[];
  const memoryRefs = Array.from(new Set(input.memoryRefs ?? [])).filter(Boolean);
  const db = getDatabase();
  let run = getRunOrThrow(input.runId);
  let nextVersion = 0;
  let nextSequence = 0;
  let concurrentReplay: Record<string, unknown> | undefined;

  db.transaction(() => {
    concurrentReplay = db.prepare(`
      SELECT * FROM loop_checkpoints WHERE run_id = ? AND idempotency_key = ?
    `).get(input.runId, input.idempotencyKey) as Record<string, unknown> | undefined;
    if (concurrentReplay) {
      if (String(concurrentReplay.request_hash) !== hash) {
        protocolError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used with a different finish payload', false);
      }
      return;
    }

    run = getRunOrThrow(input.runId);
    now = new Date().toISOString();
    if (TERMINAL_STATUSES.has(run.status)) protocolError('RUN_TERMINAL', `Run is already ${run.status}`, false);
    assertLease(run, input.leaseOwner);
    assertVersion(run, input.expectedVersion);
    assertMemoryRefs(memoryRefs, visibleSpacesFor(run.agentId));
    nextVersion = run.checkpointVersion + 1;
    nextSequence = run.lastEventSequence + 1;
    db.prepare(`
      INSERT INTO loop_checkpoints (
        id, run_id, version, idempotency_key, request_hash, phase, summary,
        state, next_actions, artifacts, memory_refs, created_at
      ) VALUES (?, ?, ?, ?, ?, 'finished', ?, ?, '[]', ?, ?, ?)
    `).run(uuid(), run.id, nextVersion, input.idempotencyKey, hash, safeSummary, JSON.stringify(safeState), JSON.stringify(safeArtifacts), JSON.stringify(memoryRefs), now);
    const update = db.prepare(`
      UPDATE loop_runs
      SET status = ?, checkpoint_version = ?, last_event_sequence = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND checkpoint_version = ?
        AND status IN ('running', 'waiting')
        AND (lease_owner = ? OR lease_expires_at <= ?)
    `).run(input.status, nextVersion, nextSequence, now, now, run.id, input.expectedVersion, input.leaseOwner, now);
    if (update.changes !== 1) {
      protocolError('VERSION_CONFLICT', 'Checkpoint changed before this transaction could commit', true, {
        expected: input.expectedVersion,
        actual: getRunOrThrow(run.id).checkpointVersion,
      });
    }
    appendEvent({
      run,
      sequence: nextSequence,
      eventName: `loop.run.${input.status}`,
      severity: input.status === 'failed' ? 'error' : input.status === 'cancelled' ? 'warn' : 'info',
      spanId: input.spanId,
      body: safeSummary,
      attributes: { checkpointVersion: nextVersion, status: input.status, memoryRefCount: memoryRefs.length },
      timestamp: now,
    });
  }).immediate();

  if (concurrentReplay) {
    run = getRunOrThrow(input.runId);
    return observe(run, getCheckpoint(run.id), {}, 'warning', `Idempotent replay returned terminal run ${run.id}.`);
  }

  run = getRunOrThrow(run.id);
  return observe(run, getCheckpoint(run.id), {}, 'success', `Loop run ${run.id} finished with status ${run.status}.`);
}
