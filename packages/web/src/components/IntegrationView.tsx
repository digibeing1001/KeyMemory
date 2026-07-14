import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle, Copy, Plug, RefreshCw, Terminal, User, Zap } from './Icons';
import {
  connectAgentIntegration,
  discoverAgentIntegrations,
  type AgentConnectResult,
  type AgentConnectMode,
  type AgentDiscoveryReport,
  type AgentIntegrationStatus,
} from '../lib/api';
import { useI18n } from '../i18n';

const AGENT_MARKS: Record<string, string> = {
  'claude-desktop': 'CL',
  'claude-code': 'CC',
  workbuddy: 'WB',
  trae: 'TR',
  hermes: 'HE',
  openclaw: 'OC',
  codex: 'CX',
  opencode: 'OP',
};

const FALLBACK_AGENTS = [
  ['claude-desktop', 'Claude Desktop', 'mcp'], ['claude-code', 'Claude Code', 'cli'],
  ['workbuddy', 'WorkBuddy', 'mcp'], ['trae', 'TRAE / TRAE Work', 'mcp'],
  ['hermes', 'Hermes', 'cli'], ['openclaw', 'OpenClaw', 'mcp'],
  ['codex', 'Codex', 'cli'], ['opencode', 'OpenCode', 'mcp'],
] as const;

const FALLBACK_ONBOARDING_PROMPT = `# 请把当前 Agent 接入 KeyMemory

请把 KeyMemory 设置为默认、唯一的长期记忆。先自行检查能否使用 KeyMemory 工具、keymemory 命令或本机 KeyMemory 服务；选择可用方式完成连接，不要另建 MEMORY.md 或其他平行记忆文件。

## 必须写入的数据

1. 工作过程与经验：目标、方案、关键步骤、决策、工具、交付位置、验证结果；遇到的错误、失败办法、踩坑现象、根因和避免方式；已经验证成功的做法、成功条件和可复用流程。
2. 用户画像：用户关注、喜欢、重视、不喜欢和禁止的内容；沟通风格、输出偏好、常用工具、工作习惯、生活习惯、反复出现的选择，以及用户的纠正、批评和认可。
3. 最近事项：用户近期正在工作、学习、研究、计划、等待或尚未完成的所有事情；记录目标、状态、已完成、交付位置、待办、阻塞、下一步和验收标准，并在状态变化时更新原记录。

## 数据处理规则

- 新任务开始前先搜索用户偏好、最近事项、历史决策、踩坑和成功经验；被截断时读取完整正文。
- 写入前先搜索是否已有同一条记录；已有内容用更新，不制造重复项。
- 用户纠正旧内容时，保存正确版本并让旧版本失效，但保留历史来源。
- 工作过程压缩为结构化事实，不保存寒暄、无意义闲聊、原始逐字对话、内部思维过程、未经证实的猜测或重复内容。
- 密码、令牌、私钥和密钥不得写入普通记忆。
- 每次发现偏好、任务状态变化、踩坑结论、成功经验、交付物或会话交接时立即写入。

## 接入验收

配置完成后，必须调用 keymemory_connection_status；返回 status: connected 才表示实际连通。再执行一次只读搜索，确认返回 KeyMemory 的结构化结果。不要创建垃圾测试记忆。等出现第一个真实工作节点时，写入任务状态并重新搜索到它，才算写入验证通过。

最后报告：连接方式、修改文件、备份位置、是否要重启，以及“配置检测、读取验证、写入验证”三项结果。任何一项未通过都不能说已经接入成功。`;

const FALLBACK_REPORT: AgentDiscoveryReport = {
  scannedAt: '',
  projectRoot: '',
  detectedCount: 0,
  connectedCount: 0,
  agents: FALLBACK_AGENTS.map(([id, label, mode]) => ({
    id,
    label,
    detected: false,
    connected: false,
    automatic: true,
    recommendedMode: mode,
    availableModes: id === 'claude-desktop' ? ['mcp'] : ['mcp', 'cli', 'skill'],
    evidence: [],
    configPathHints: [],
    snippet: JSON.stringify({ mcpServers: { keymemory: { command: 'node', args: ['<KEYMEMORY_ROOT>/bin/keymemory-mcp.js'] } } }, null, 2),
    notes: ['当前后台服务需要重启后才能执行自动接入。', '重启后页面会自动获取本机安装路径并保留现有设置。'],
  })),
  operatingRules: '',
  onboardingPrompt: FALLBACK_ONBOARDING_PROMPT,
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const fallbackCopy = () => {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const succeeded = document.execCommand('copy');
    field.remove();
    return succeeded;
  };

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(fallbackCopy());
    }
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button type="button" className="integration-copy-button" onClick={() => void copy()}>
      {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
      {copied ? 'Copied' : label}
    </button>
  );
}

function AgentCard({ agent, selected, onSelect }: { agent: AgentIntegrationStatus; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`agent-integration-card${selected ? ' is-selected' : ''}${!agent.detected ? ' is-undetected' : ''}`}
      onClick={onSelect}
    >
      <span className="agent-mark" aria-hidden="true">{AGENT_MARKS[agent.id] ?? 'AI'}</span>
      <span className="agent-card-copy">
        <strong>{agent.label}</strong>
        <span>{agent.connected ? 'KeyMemory online' : agent.detected ? 'Ready to connect' : 'Can connect manually'}</span>
      </span>
      <span className={`agent-status-dot ${agent.connected ? 'is-online' : agent.detected ? 'is-ready' : ''}`} />
    </button>
  );
}

export default function IntegrationView() {
  const { language } = useI18n();
  const zh = language === 'zh';
  const [report, setReport] = useState<AgentDiscoveryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectResult, setConnectResult] = useState<AgentConnectResult | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [selectedMode, setSelectedMode] = useState<AgentConnectMode | 'auto'>('auto');
  const [serviceNeedsRestart, setServiceNeedsRestart] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const next = await discoverAgentIntegrations();
      setReport(next);
      setServiceNeedsRestart(false);
      const preferred = next.agents.find(agent => agent.detected && !agent.connected)
        ?? next.agents.find(agent => agent.detected)
        ?? next.agents[0];
      setSelectedId(current => current ?? preferred?.id ?? null);
    } catch {
      setReport(FALLBACK_REPORT);
      setServiceNeedsRestart(true);
      setSelectedId(current => current ?? FALLBACK_REPORT.agents[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const orderedAgents = useMemo(() => {
    if (!report) return [];
    return [...report.agents].sort((a, b) => Number(b.detected) - Number(a.detected) || Number(b.connected) - Number(a.connected));
  }, [report]);
  const selected = report?.agents.find(agent => agent.id === selectedId) ?? null;

  const connectSelected = async () => {
    if (!selected || !selected.automatic) return;
    setConnectingId(selected.id);
    setConnectResult(null);
    setConnectError(null);
    if (serviceNeedsRestart) {
      setConnectError(zh
        ? '当前后台服务仍是旧版本。请重启 KeyMemory，然后点击“检测接入状态”；重启后本按钮会直接完成配置。'
        : 'The running KeyMemory service is outdated. Restart it, then check the connection again.');
      setConnectingId(null);
      return;
    }
    try {
      const response = await connectAgentIntegration(selected.id, selectedMode);
      setReport(response.report);
      setConnectResult(response.result);
    } catch (error) {
      setConnectError(error instanceof Error ? error.message : (zh ? '自动接入失败' : 'Automatic connection failed'));
    } finally {
      setConnectingId(null);
    }
  };

  return (
    <div className="integration-view">
      <header className="integration-hero">
        <div className="integration-hero-grid" aria-hidden="true" />
        <div className="integration-hero-copy">
          <span className="integration-eyebrow"><Plug size={13} /> MEMORY CONTROL PLANE / 01</span>
          <h2>{zh ? '让每一个 Agent，记得同一个你。' : 'One memory. Every agent.'}</h2>
          <p>
            {zh
              ? '自动识别本机 AI 工具，把 KeyMemory 设为默认记忆层。偏好、任务状态与经验在工具之间连续流动。'
              : 'Detect local AI tools and make KeyMemory their default memory layer. Preferences, task state, and lessons move with you.'}
          </p>
        </div>
        <div className="integration-radar" aria-hidden="true">
          <span className="radar-orbit orbit-one" />
          <span className="radar-orbit orbit-two" />
          <span className="radar-core"><Activity size={22} /></span>
          <span className="radar-node node-a" />
          <span className="radar-node node-b" />
          <span className="radar-node node-c" />
        </div>
      </header>

      <section className="integration-summary-row">
        <div><span>{zh ? '已发现' : 'Detected'}</span><strong>{report?.detectedCount ?? '—'}</strong><small>LOCAL AGENTS</small></div>
        <div><span>{zh ? '已接入' : 'Connected'}</span><strong>{report?.connectedCount ?? '—'}</strong><small>MEMORY LINKS</small></div>
        <div><span>{zh ? '记忆策略' : 'Memory policy'}</span><strong>3</strong><small>CAPTURE GROUPS</small></div>
        <button type="button" className="integration-rescan" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'is-spinning' : ''} />
          {zh ? '检测接入状态' : 'Check connection'}
        </button>
      </section>

      {serviceNeedsRestart && (
        <div className="integration-service-warning" role="alert">
          <strong>{zh ? '页面和后台版本不一致' : 'The page and service versions do not match'}</strong>
          <span>{zh ? '请先重启 KeyMemory 服务。中文提示词仍可直接复制；重启后，一键接入和状态检测会恢复。' : 'Restart KeyMemory. The prompt remains available, and one-click setup will work after restart.'}</span>
        </div>
      )}

      <div className="integration-workbench">
        <section className="integration-agent-panel">
          <div className="section-kicker"><span>01</span>{zh ? '设备上的 Agent' : 'Agents on this device'}</div>
          <div className="agent-grid">
            {orderedAgents.map(agent => (
              <AgentCard
                key={agent.id}
                agent={agent}
                selected={selected?.id === agent.id}
                onSelect={() => {
                  setSelectedId(agent.id);
                  setSelectedMode('auto');
                  setConnectResult(null);
                  setConnectError(null);
                }}
              />
            ))}
          </div>
        </section>

        <aside className="integration-config-panel">
          {selected ? (
            <>
              <div className="config-panel-heading">
                <div>
                  <span>{selected.recommendedMode.toUpperCase()} SETUP</span>
                  <h3>{selected.label}</h3>
                </div>
                <span className={`connection-chip ${selected.connected ? 'is-online' : ''}`}>
                  {selected.connected ? (zh ? '已检测到配置' : 'Configuration found') : selected.detected ? (zh ? '待接入' : 'Ready') : (zh ? '可主动接入' : 'Manual target')}
                </span>
              </div>
              <p className="config-path">
                {selected.evidence[0] ?? selected.configPathHints[0] ?? (zh ? '在 Agent 的 MCP 设置中添加' : 'Add in the Agent MCP settings')}
              </p>
              <div className="auto-connect-card">
                <div>
                  <strong>{zh ? '自动接入并保留现有设置' : 'Connect automatically, preserve existing settings'}</strong>
                  <span>
                    {(selectedMode === 'auto' ? selected.recommendedMode : selectedMode) === 'cli'
                      ? (zh ? '写入持久指令，直接使用 KeyMemory CLI，无需配置 MCP。' : 'Adds persistent instructions and uses the KeyMemory CLI — no MCP setup required.')
                      : (selectedMode === 'auto' ? selected.recommendedMode : selectedMode) === 'skill'
                        ? (zh ? '安装 KeyMemory 规则包，并告诉 Agent 何时读取、写入和检查连接。' : 'Installs the KeyMemory Skill and its persistent usage rules.')
                        : (zh ? '自动合并 MCP 配置；修改前会备份已有文件。' : 'Merges the MCP configuration and backs up existing files first.')}
                  </span>
                </div>
                <div className="integration-mode-picker" aria-label={zh ? '选择接入方式' : 'Choose setup mode'}>
                  <button type="button" className={selectedMode === 'auto' ? 'is-active' : ''} onClick={() => setSelectedMode('auto')}>
                    {zh ? '自动推荐' : 'Auto'}
                  </button>
                  {(selected.availableModes ?? (selected.id === 'claude-desktop' ? ['mcp'] : ['mcp', 'cli', 'skill'])).map(mode => (
                    <button key={mode} type="button" className={selectedMode === mode ? 'is-active' : ''} onClick={() => setSelectedMode(mode)}>
                      {mode === 'mcp' ? (zh ? '自动连接' : 'MCP') : mode === 'cli' ? (zh ? '命令连接' : 'CLI') : (zh ? '规则包连接' : 'Skill')}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="integration-connect-button"
                  onClick={() => void connectSelected()}
                  disabled={!selected.automatic || connectingId === selected.id}
                >
                  {connectingId === selected.id ? <RefreshCw size={14} className="is-spinning" /> : <Zap size={14} />}
                  {connectingId === selected.id
                    ? (zh ? '正在接入…' : 'Connecting…')
                    : selected.connected
                      ? (zh ? '修复 / 重新应用' : 'Repair / reapply')
                      : (zh ? '一键接入' : 'Connect in one click')}
                </button>
              </div>

              {connectResult && connectResult.agentId === selected.id && (
                <div className="integration-connect-result is-success" role="status">
                  <CheckCircle size={15} />
                  <div>
                    <strong>{connectResult.changed ? (zh ? '接入完成' : 'Connected') : (zh ? '配置已是最新' : 'Already up to date')}</strong>
                    <small>{zh ? '接入方式：' : 'Mode: '}{connectResult.mode === 'mcp' ? (zh ? '自动连接' : 'MCP') : connectResult.mode === 'cli' ? (zh ? '命令连接' : 'CLI') : (zh ? '规则包连接' : 'Skill')}</small>
                    <span>{connectResult.files.join(' · ')}</span>
                    {connectResult.backups.length > 0 && <small>{zh ? '备份：' : 'Backup: '}{connectResult.backups.join(' · ')}</small>}
                    {connectResult.restartRequired && <small>{zh ? '请重启该 Agent 使 MCP 配置生效。' : 'Restart the Agent to activate the MCP connection.'}</small>}
                  </div>
                </div>
              )}
              {connectError && (
                <div className="integration-connect-result is-error" role="alert">
                  <span>{connectError}</span>
                </div>
              )}

              <div className="integration-verification-card">
                <strong>{zh ? '怎样判断真的接入成功？' : 'How to confirm the connection'}</strong>
                <ol>
                  <li className={selected.connected ? 'is-passed' : ''}>{zh ? '配置检测：页面发现 KeyMemory 配置或规则文件。' : 'Configuration: KeyMemory settings are present.'}</li>
                  <li>{zh ? '读取验证：让 Agent 调用 keymemory_connection_status，再做一次只读搜索。' : 'Read test: call keymemory_connection_status, then run a read-only search.'}</li>
                  <li>{zh ? '写入验证：在第一个真实工作节点写入任务状态，并确认能重新搜到。' : 'Write test: save the first real task milestone and retrieve it again.'}</li>
                </ol>
                <button type="button" onClick={() => void load()} disabled={loading}>
                  <RefreshCw size={13} className={loading ? 'is-spinning' : ''} />
                  {zh ? '重新检测配置' : 'Check configuration again'}
                </button>
              </div>

              <details className="manual-config-details">
                <summary>{zh ? '手动配置 / 高级选项' : 'Manual configuration / advanced'}</summary>
                <div className="config-code-wrap">
                  <div className="config-code-toolbar"><Terminal size={13} /><span>keymemory.mcp.json</span><CopyButton text={selected.snippet} label={zh ? '复制配置' : 'Copy config'} /></div>
                  <pre>{selected.snippet}</pre>
                </div>
                <ol className="integration-notes">
                  {selected.notes.slice(0, 3).map(note => <li key={note}>{note}</li>)}
                </ol>
              </details>
            </>
          ) : <div className="integration-empty">{zh ? '选择一个 Agent 查看接入方式' : 'Select an agent to view setup'}</div>}
        </aside>
      </div>

      <section className="memory-policy-section">
        <div className="section-kicker"><span>02</span>{zh ? '自动写入什么' : 'What gets remembered'}</div>
        <div className="memory-policy-grid">
          <article className="policy-card policy-profile">
            <div className="policy-number">A</div><User size={18} />
            <h3>{zh ? '用户画像' : 'User profile'}</h3>
            <p>{zh ? '偏好、习惯、工作与沟通风格、纠正和批评、高频工具与模式。' : 'Preferences, habits, working and communication style, corrections, criticism, and frequent tools.'}</p>
            <span>LONG / ENTITY</span>
          </article>
          <article className="policy-card policy-task">
            <div className="policy-number">B</div><Activity size={18} />
            <h3>{zh ? '任务状态' : 'Task state'}</h3>
            <p>{zh ? '名称、目标、状态、关键步骤、交付位置、待办、阻塞、下一步与验收标准。' : 'Name, objective, status, milestones, delivery paths, blockers, next action, and acceptance criteria.'}</p>
            <span>SHORT / PROJECT</span>
          </article>
          <article className="policy-card policy-lessons">
            <div className="policy-number">C</div><Zap size={18} />
            <h3>{zh ? '经验沉淀' : 'Lessons learned'}</h3>
            <p>{zh ? '踩坑原因、失败路径、成功做法与可复用的约束或流程。' : 'Pitfalls, failed paths, successful approaches, and reusable constraints or procedures.'}</p>
            <span>LONG / PROCEDURE</span>
          </article>
        </div>
      </section>

      <section className="future-agent-section">
        <div className="future-agent-copy">
          <div className="section-kicker"><span>03</span>{zh ? '给未来的新 Agent' : 'For your next agent'}</div>
          <h3>{zh ? '一段提示词，立即加入共享记忆。' : 'One prompt joins the shared memory.'}</h3>
          <p>{zh ? '安装任何新 Agent 后，把右侧内容直接发给它。它会选择 MCP 或 CLI、验证连接，并继承同一套写入和提取规则。' : 'Paste this into any new agent. It will choose MCP or CLI, verify the connection, and inherit the same recall and capture policy.'}</p>
          {report && <CopyButton text={report.onboardingPrompt} label={zh ? '复制接入提示词' : 'Copy onboarding prompt'} />}
        </div>
        <div className="future-prompt-panel">
          <div className="prompt-lights"><span /><span /><span /><b>AGENT_ONBOARDING.md</b></div>
          <pre>{report?.onboardingPrompt ?? (loading ? (zh ? '正在生成接入提示词…' : 'Generating onboarding prompt…') : '')}</pre>
        </div>
      </section>
    </div>
  );
}
