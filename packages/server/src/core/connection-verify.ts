import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { discoverAgentIntegrations, type AgentIntegrationStatus } from './agent-discovery.js';

/**
 * 三层连接验证：
 *   1. config —— Agent 配置文件中确实包含 KeyMemory 接入信息（只读检查）
 *   2. read   —— 沿着 Agent 实际使用的通道（MCP stdio 或 CLI）真实调用只读工具并拿到结构化结果
 *   3. write  —— 同一通道真实写入一条探针记忆，重新搜索命中后清理（仅在用户明确允许时执行）
 *
 * 全部探针都是真实执行，禁止任何模拟/随机数/时间差伪造。
 * "配置已写入"只通过第一层，绝不等于"已连接"。
 */

export type VerifyStepName = 'config' | 'read' | 'write';
export type VerifyTransport = 'mcp' | 'cli';
export type VerifyOverall = 'connected' | 'configured-only' | 'disconnected';

export interface VerifyFailure {
  reason: string;
  fix: string;
}

export interface VerifyStepResult {
  step: VerifyStepName;
  passed: boolean;
  skipped?: boolean;
  detail: string;
  evidence: string[];
  failure?: VerifyFailure;
}

export interface McpProbePlan {
  transport: 'mcp';
  command: string;
  args: string[];
  env?: Record<string, string>;
  configuredIn?: string;
}

export interface CliProbePlan {
  transport: 'cli';
  cliEntry: string;
  configuredIn?: string;
}

export type ProbePlan = McpProbePlan | CliProbePlan;

export interface VerifyAgentOptions {
  projectRoot?: string;
  /** 写入探针会真实创建并清理一条记忆；必须用户明确允许才执行。默认 false。 */
  allowWriteProbe?: boolean;
  timeoutMs?: number;
}

export interface VerifyAgentResult {
  agentId: string;
  overall: VerifyOverall;
  transport?: VerifyTransport;
  steps: {
    config: VerifyStepResult;
    read: VerifyStepResult;
    write: VerifyStepResult;
  };
  verifiedAt: string;
}

const PROBE_TAG = 'keymemory-connection-probe';

function step(stepName: VerifyStepName, passed: boolean, detail: string, evidence: string[] = [], failure?: VerifyFailure, skipped = false): VerifyStepResult {
  return { step: stepName, passed, skipped, detail, evidence, failure };
}

function earlyResult(agentId: string, config: VerifyStepResult, read?: VerifyStepResult, write?: VerifyStepResult): VerifyAgentResult {
  const steps = {
    config,
    read: read ?? step('read', false, '', [], undefined, true),
    write: write ?? step('write', false, '', [], undefined, true),
  };
  const overall: VerifyOverall = config.passed && steps.read.passed && (steps.write.skipped || steps.write.passed)
    ? 'connected'
    : config.passed ? 'configured-only' : 'disconnected';
  return { agentId, overall, steps, verifiedAt: new Date().toISOString() };
}

/* ---------------------------------- MCP 配置解析 ---------------------------------- */

function tryParseJson(filePath: string): unknown | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return undefined;
  }
}

/** 在任意 JSON 结构里找到名为 keymemory 的 MCP 服务条目（兼容多种宿主的配置形状）。 */
function findKeyMemoryServerEntry(node: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object' || depth > 6) return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findKeyMemoryServerEntry(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  const candidate = record.keymemory;
  if (candidate && typeof candidate === 'object' && !Array.isArray(candidate) && typeof (candidate as Record<string, unknown>).command === 'string') {
    return candidate as Record<string, unknown>;
  }
  for (const value of Object.values(record)) {
    const found = findKeyMemoryServerEntry(value, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function mentionsKeyMemoryFile(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size > 2_000_000) return false;
    return /keymemory/i.test(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return false;
  }
}

/**
 * 根据 Agent 的真实配置文件推导探针通道：
 * - 能从 MCP 配置 JSON 里解析出 keymemory 条目 → 用与 Agent 完全相同的 command/args 启动 MCP；
 * - 只有指令/规则文件（CLI 或 Skill 模式）→ 用 KeyMemory CLI 探针；
 * - 解析不出来时回退到本仓库的 MCP launcher。
 */
export function resolveProbePlan(agent: AgentIntegrationStatus, projectRoot: string): ProbePlan {
  const fallbackMcp: McpProbePlan = {
    transport: 'mcp',
    command: process.execPath,
    args: [path.join(projectRoot, 'bin', 'keymemory-mcp.js')],
  };

  for (const file of agent.evidence) {
    if (!/\.json$/i.test(file)) continue;
    const parsed = tryParseJson(file);
    if (parsed === undefined) continue;
    const entry = findKeyMemoryServerEntry(parsed);
    if (!entry || typeof entry.command !== 'string') continue;
    const args = Array.isArray(entry.args) ? entry.args.filter((item): item is string => typeof item === 'string') : [];
    const env: Record<string, string> = {};
    if (entry.env && typeof entry.env === 'object') {
      for (const [key, value] of Object.entries(entry.env as Record<string, unknown>)) {
        if (typeof value === 'string') env[key] = value;
      }
    }
    return { transport: 'mcp', command: entry.command, args, env: Object.keys(env).length > 0 ? env : undefined, configuredIn: file };
  }

  const instructionsFile = agent.evidence.find(file => /\.md$/i.test(file) && mentionsKeyMemoryFile(file));
  if (instructionsFile) {
    return { transport: 'cli', cliEntry: path.join(projectRoot, 'bin', 'keymemory.js'), configuredIn: instructionsFile };
  }

  if (agent.connected) return fallbackMcp;
  return fallbackMcp;
}

/** 供 UI 在"分步引导"里提前展示将要执行的探针动作（不执行任何操作）。 */
export function describeProbePlan(plan: ProbePlan): string[] {
  if (plan.transport === 'mcp') {
    const command = [plan.command, ...plan.args].join(' ');
    return [
      `按 Agent 配置原样启动 MCP 通道：${command}`,
      'JSON-RPC initialize 握手，确认服务端应答',
      '调用只读工具 memory_connection_status 与 memory_search，检查真实返回',
      '（写入探针开启时）写入一条带 keymemory-connection-probe 标签的探针记忆，搜索命中后删除',
    ];
  }
  return [
    `使用 KeyMemory CLI 通道：${plan.cliEntry}`,
    '运行只读命令 keymemory health / keymemory search，检查真实输出',
    '（写入探针开启时）写入一条带 keymemory-connection-probe 标签的探针记忆，搜索命中后删除',
  ];
}

/* ---------------------------------- MCP stdio 探针 ---------------------------------- */

interface JsonRpcResponse {
  id: number;
  result?: any;
  error?: { code?: number; message?: string };
}

function extractText(result: any): string {
  const parts: string[] = [];
  if (result?.content && Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item && typeof item === 'object' && typeof item.text === 'string') parts.push(item.text);
    }
  }
  return parts.join('\n');
}

export async function runMcpProbe(plan: McpProbePlan, timeoutMs: number, allowWriteProbe: boolean): Promise<{ read: VerifyStepResult; write: VerifyStepResult }> {
  const commandLine = [plan.command, ...plan.args].join(' ');
  const child = spawn(plan.command, plan.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...(plan.env ?? {}) },
  });

  let stderrTail = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrTail = (stderrTail + chunk.toString()).slice(-4000);
  });
  let spawnError: string | undefined;
  child.on('error', (error) => { spawnError = error.message; });

  const pending = new Map<number, (response: JsonRpcResponse) => void>();
  let buffer = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const message = JSON.parse(line);
        if (message && typeof message.id === 'number' && pending.has(message.id)) {
          pending.get(message.id)!(message as JsonRpcResponse);
          pending.delete(message.id);
        }
      } catch {
        /* 非 JSON 行忽略 */
      }
    }
  });

  let nextId = 1;
  const send = (method: string, params?: unknown): void => {
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })}\n`);
  };
  const notify = (method: string, params?: unknown): void => {
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  };

  const call = async (method: string, params?: unknown): Promise<JsonRpcResponse> => {
    const id = nextId;
    const response = await new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`等待 ${method} 应答超时（${timeoutMs}ms）`));
      }, timeoutMs);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      send(method, params);
    });
    return response;
  };

  const finish = (read: VerifyStepResult, write: VerifyStepResult) => {
    try { child.kill(); } catch { /* 忽略 */ }
    return { read, write };
  };

  const channelFailure = (reason: string): VerifyFailure => ({
    reason,
    fix: `确认 Agent 配置里的启动命令可以手动运行：${commandLine}。若提示缺少构建产物，先在 KeyMemory 目录执行 pnpm build；若命令不存在，重新执行一键接入生成正确配置。`,
  });

  try {
    if (spawnError) throw new Error(spawnError);

    const initResponse = await call('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'keymemory-verify', version: '1.0.0' },
    });
    if (initResponse.error) throw new Error(initResponse.error.message ?? 'initialize 返回错误');
    const serverName = initResponse.result?.serverInfo?.name;
    if (serverName !== 'keymemory') throw new Error(`MCP 握手应答不是 KeyMemory（serverInfo.name=${serverName ?? '未知'}）`);
    notify('notifications/initialized');

    const statusResponse = await call('tools/call', { name: 'memory_connection_status', arguments: {} });
    if (statusResponse.error) throw new Error(`memory_connection_status 调用失败：${statusResponse.error.message}`);
    const statusText = extractText(statusResponse.result);
    if (!/"status":\s*"connected"/.test(statusText)) {
      throw new Error(`memory_connection_status 未返回 status: connected（返回：${statusText.slice(0, 200)}）`);
    }

    const searchResponse = await call('tools/call', { name: 'memory_search', arguments: { query: 'keymemory', limit: 1 } });
    if (searchResponse.error) throw new Error(`memory_search 调用失败：${searchResponse.error.message}`);
    const searchResults = searchResponse.result?.structuredContent?.results;
    if (!searchResults || typeof searchResults !== 'object') {
      throw new Error('memory_search 没有返回结构化结果');
    }

    const readEvidence = [
      `initialize 握手成功（serverInfo.name=${serverName}）`,
      'memory_connection_status 返回 status: connected',
      'memory_search 返回结构化检索结果',
      ...(plan.configuredIn ? [`通道来源：${plan.configuredIn}`] : []),
    ];
    const read = step('read', true, 'MCP 通道真实握手并成功调用只读工具', readEvidence);

    if (!allowWriteProbe) {
      return finish(read, step('write', false, '未启用写入探针', [], undefined, true));
    }

    const probeToken = `kmprobe${Date.now().toString(36)}`;
    const write = await mcpWriteProbe(call, probeToken);
    return finish(read, write);
  } catch (error) {
    const reason = (error as Error).message;
    const detail = stderrTail.trim() ? `${reason}（服务端日志尾部：${stderrTail.trim().slice(-300)}）` : reason;
    const read = step('read', false, 'MCP 通道读取验证失败', [commandLine], channelFailure(detail));
    const write = step('write', false, '', [], undefined, true);
    return finish(read, write);
  }
}

async function mcpWriteProbe(call: (method: string, params?: unknown) => Promise<JsonRpcResponse>, probeToken: string): Promise<VerifyStepResult> {
  let createdId: string | undefined;
  try {
    const createResponse = await call('tools/call', {
      name: 'memory_create',
      arguments: {
        title: `KeyMemory 连接验证探针 ${probeToken}`,
        content: `连接验证探针 ${probeToken}：写入验证通过后会自动删除，无需保留。`,
        layer: 'flash',
        tags: [PROBE_TAG, probeToken],
      },
    });
    if (createResponse.error) throw new Error(`memory_create 调用失败：${createResponse.error.message}`);
    createdId = createResponse.result?.structuredContent?.memory?.id;
    if (!createdId) throw new Error('memory_create 未返回记忆 ID');

    const searchResponse = await call('tools/call', { name: 'memory_search', arguments: { query: probeToken, limit: 5 } });
    if (searchResponse.error) throw new Error(`探针记忆搜索失败：${searchResponse.error.message}`);
    const results = searchResponse.result?.structuredContent?.results;
    const items: any[] = Array.isArray(results) ? results : (results?.items ?? results?.memories ?? []);
    const hit = items.some((item: any) => item?.id === createdId || probeToken.includes(String(item?.id ?? '')) || JSON.stringify(item).includes(probeToken));
    if (!hit) throw new Error(`探针记忆 ${createdId} 写入成功，但重新搜索未命中`);

    const deleteResponse = await call('tools/call', { name: 'memory_delete', arguments: { id: createdId } });
    if (deleteResponse.error) throw new Error(`探针记忆清理失败：${deleteResponse.error.message}`);

    // 清理成功的唯一可信标准：重新搜索不再命中（软删除会从 FTS 索引移除）
    const recheck = await call('tools/call', { name: 'memory_search', arguments: { query: probeToken, limit: 5 } });
    const recheckResults = recheck.result?.structuredContent?.results;
    const recheckItems: any[] = Array.isArray(recheckResults) ? recheckResults : (recheckResults?.items ?? recheckResults?.memories ?? []);
    const stillVisible = recheckItems.some((item: any) => item?.id === createdId || JSON.stringify(item).includes(probeToken));

    return step('write', !stillVisible, stillVisible ? '探针记忆写入并搜索命中，但清理后仍可被搜到' : '探针记忆写入→搜索命中→已清理（不再可被搜到）', [
      `memory_create 成功：${createdId}`,
      `memory_search("${probeToken}") 命中探针记忆`,
      stillVisible
        ? `清理不彻底：探针记忆 ${createdId} 仍可被搜索命中，请在回收站中永久删除`
        : 'memory_delete 已清理探针记忆，重新搜索不再命中',
    ], stillVisible ? { reason: `探针记忆 ${createdId} 删除后仍可被搜索命中`, fix: '在记忆页回收站中永久删除该探针记忆后重试。' } : undefined);
  } catch (error) {
    return step('write', false, '写入验证失败', [], {
      reason: (error as Error).message,
      fix: '写入失败通常是数据库权限或磁盘空间问题。确认 ~/.keymemory 目录可写后重试；若探针记忆残留，可在记忆列表中搜索 keymemory-connection-probe 标签删除。',
    });
  }
}

/* ---------------------------------- CLI 探针 ---------------------------------- */

function parseJsonLoose(stdout: string): any | undefined {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const begin = start === -1 ? arrayStart : arrayStart === -1 ? start : Math.min(start, arrayStart);
  if (begin === -1) return undefined;
  try {
    return JSON.parse(trimmed.slice(begin));
  } catch {
    return undefined;
  }
}

function runCliProbe(plan: CliProbePlan, timeoutMs: number, allowWriteProbe: boolean): { read: VerifyStepResult; write: VerifyStepResult } {
  const run = (args: string[]) => spawnSync(process.execPath, [plan.cliEntry, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
  });

  const cliFailure = (reason: string): VerifyFailure => ({
    reason,
    fix: `手动运行 node "${plan.cliEntry}" status 查看具体报错；若提示构建产物缺失，先在 KeyMemory 目录执行 pnpm build。`,
  });

  const health = run(['health']);
  if (health.error || health.status !== 0) {
    const reason = health.error?.message ?? `keymemory health 退出码 ${health.status}：${(health.stderr || health.stdout || '').slice(-300)}`;
    return {
      read: step('read', false, 'CLI 通道读取验证失败', [], cliFailure(reason)),
      write: step('write', false, '', [], undefined, true),
    };
  }

  const search = run(['search', 'keymemory']);
  if (search.error || search.status !== 0) {
    const reason = search.error?.message ?? `keymemory search 退出码 ${search.status}：${(search.stderr || '').slice(-300)}`;
    return {
      read: step('read', false, 'CLI 通道读取验证失败', [], cliFailure(reason)),
      write: step('write', false, '', [], undefined, true),
    };
  }
  const searchPayload = parseJsonLoose(search.stdout);
  if (searchPayload === undefined) {
    return {
      read: step('read', false, 'CLI 通道读取验证失败', [], cliFailure('keymemory search 输出不是可解析的 JSON')),
      write: step('write', false, '', [], undefined, true),
    };
  }

  const readEvidence = [
    'keymemory health 退出码 0',
    'keymemory search 返回可解析的 JSON 结果',
    ...(plan.configuredIn ? [`通道来源：${plan.configuredIn}`] : []),
  ];
  const read = step('read', true, 'CLI 通道真实执行只读命令成功', readEvidence);

  if (!allowWriteProbe) {
    return { read, write: step('write', false, '未启用写入探针', [], undefined, true) };
  }

  const probeToken = `kmprobe${Date.now().toString(36)}`;
  const create = run([
    'create',
    '--title', `KeyMemory 连接验证探针 ${probeToken}`,
    '--content', `连接验证探针 ${probeToken}：写入验证通过后会自动删除，无需保留。`,
    '--layer', 'flash',
    '--tags', `${PROBE_TAG},${probeToken}`,
  ]);
  const created = create.error || create.status !== 0 ? undefined : parseJsonLoose(create.stdout);
  const createdId = created?.id;
  if (!createdId) {
    const reason = create.error?.message ?? `keymemory create 退出码 ${create.status}：${(create.stderr || '').slice(-300)}`;
    return { read, write: step('write', false, '写入验证失败', [], cliFailure(reason)) };
  }

  const reSearch = run(['search', probeToken]);
  const rePayload = reSearch.status === 0 ? parseJsonLoose(reSearch.stdout) : undefined;
  const reItems: any[] = Array.isArray(rePayload) ? rePayload : (rePayload?.items ?? rePayload?.memories ?? []);
  const hit = reItems.some((item: any) => item?.id === createdId || JSON.stringify(item).includes(probeToken));
  if (!hit) {
    return { read, write: step('write', false, '写入验证失败', [], { reason: `探针记忆 ${createdId} 写入成功，但重新搜索未命中`, fix: '检查搜索索引是否正常，可运行 keymemory health 后重试。' }) };
  }

  const cleanup = run(['delete', createdId, '--permanent']);
  const recheckProbe = run(['search', probeToken]);
  const recheckPayload = recheckProbe.status === 0 ? parseJsonLoose(recheckProbe.stdout) : undefined;
  const recheckItems2: any[] = Array.isArray(recheckPayload) ? recheckPayload : (recheckPayload?.items ?? recheckPayload?.memories ?? []);
  const stillVisible = recheckItems2.some((item: any) => item?.id === createdId || JSON.stringify(item).includes(probeToken));
  const cleanedUp = cleanup.status === 0 && !stillVisible;
  return {
    read,
    write: step('write', cleanedUp, cleanedUp ? '探针记忆写入→搜索命中→已清理' : '探针记忆写入并搜索命中（清理失败或清理后仍可被搜到）', [
      `keymemory create 成功：${createdId}`,
      `keymemory search "${probeToken}" 命中探针记忆`,
      cleanedUp ? 'keymemory delete --permanent 已清理探针记忆，重新搜索不再命中' : `清理失败：探针记忆 ${createdId} 仍存在或仍可被搜到`,
    ]),
  };
}

/* ---------------------------------- 主入口 ---------------------------------- */

/**
 * 三层验证主入口（REST/UI 调用）。全部探针真实执行；写入探针默认关闭，需用户明确允许。
 */
export async function verifyAgentIntegrationAsync(agentId: string, options: VerifyAgentOptions = {}): Promise<VerifyAgentResult> {
  const timeoutMs = Math.max(5000, options.timeoutMs ?? 60000);
  const report = discoverAgentIntegrations(options.projectRoot);
  const projectRoot = report.projectRoot;
  const agent = report.agents.find(item => item.id === agentId);

  if (!agent) {
    const config = step('config', false, `不支持的 Agent：${agentId}`, [], {
      reason: `KeyMemory 暂不支持 ${agentId} 的自动接入。`,
      fix: '在接入页面选择已支持的 Agent，或使用"接入提示词"手动接入。',
    });
    return earlyResult(agentId, config);
  }

  if (!agent.connected) {
    const missing = agent.detected
      ? `已在本机发现 ${agent.label}，但它的配置里还没有 KeyMemory 接入信息。`
      : `未在本机发现 ${agent.label} 的安装痕迹，配置中也没有 KeyMemory 接入信息。`;
    const config = step('config', false, missing, [...agent.evidence, ...agent.configPathHints].slice(0, 3), {
      reason: missing,
      fix: agent.automatic
        ? `对 ${agent.label} 执行一键接入（会自动备份并保留已有配置），然后重新验证。`
        : '复制接入页面的配置片段，手动添加到该 Agent 的 MCP / 指令配置中，然后重新验证。',
    });
    return earlyResult(agentId, config);
  }
  const config = step('config', true, 'Agent 配置中已包含 KeyMemory 接入信息', agent.evidence.slice(0, 4));

  const plan = resolveProbePlan(agent, projectRoot);
  const allowWrite = options.allowWriteProbe === true;
  const probeResult = plan.transport === 'mcp'
    ? await runMcpProbe(plan, timeoutMs, allowWrite)
    : runCliProbe(plan, timeoutMs, allowWrite);

  return {
    agentId,
    overall: overallOf(config, probeResult.read, probeResult.write),
    transport: plan.transport,
    steps: { config, read: probeResult.read, write: probeResult.write },
    verifiedAt: new Date().toISOString(),
  };
}

function overallOf(config: VerifyStepResult, read: VerifyStepResult, write: VerifyStepResult): VerifyOverall {
  if (config.passed && read.passed && (write.skipped || write.passed)) return 'connected';
  if (config.passed) return 'configured-only';
  return 'disconnected';
}
