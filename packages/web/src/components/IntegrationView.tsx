import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle, Copy, Plug, RefreshCw, Terminal, User, Zap } from './Icons';
import { discoverAgentIntegrations, type AgentDiscoveryReport, type AgentIntegrationStatus } from '../lib/api';
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
    recommendedMode: mode,
    evidence: [],
    configPathHints: [],
    snippet: JSON.stringify({ mcpServers: { keymemory: { command: 'node', args: ['<KEYMEMORY_ROOT>/bin/keymemory-mcp.js'] } } }, null, 2),
    notes: ['Start the current KeyMemory server and rescan to get an installation-specific path.', 'Merge this server into the Agent MCP settings without replacing existing entries.'],
  })),
  operatingRules: '',
  onboardingPrompt: 'Ask this Agent to connect a local stdio MCP server named keymemory, verify the tools, and make KeyMemory its default durable memory system. Run `node install-default-memory.js --prompt` for the installation-specific version.',
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
      className={`agent-integration-card${selected ? ' is-selected' : ''}${!agent.detected ? ' is-dormant' : ''}`}
      onClick={onSelect}
    >
      <span className="agent-mark" aria-hidden="true">{AGENT_MARKS[agent.id] ?? 'AI'}</span>
      <span className="agent-card-copy">
        <strong>{agent.label}</strong>
        <span>{agent.connected ? 'KeyMemory online' : agent.detected ? 'Ready to connect' : 'Not detected'}</span>
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

  const load = async () => {
    setLoading(true);
    try {
      const next = await discoverAgentIntegrations();
      setReport(next);
      const preferred = next.agents.find(agent => agent.detected && !agent.connected)
        ?? next.agents.find(agent => agent.detected)
        ?? next.agents[0];
      setSelectedId(current => current ?? preferred?.id ?? null);
    } catch {
      setReport(FALLBACK_REPORT);
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
          {zh ? '重新扫描' : 'Rescan'}
        </button>
      </section>

      <div className="integration-workbench">
        <section className="integration-agent-panel">
          <div className="section-kicker"><span>01</span>{zh ? '设备上的 Agent' : 'Agents on this device'}</div>
          <div className="agent-grid">
            {orderedAgents.map(agent => (
              <AgentCard key={agent.id} agent={agent} selected={selected?.id === agent.id} onSelect={() => setSelectedId(agent.id)} />
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
                  {selected.connected ? (zh ? '已接入' : 'Connected') : selected.detected ? (zh ? '待接入' : 'Ready') : (zh ? '未发现' : 'Missing')}
                </span>
              </div>
              <p className="config-path">
                {selected.evidence[0] ?? selected.configPathHints[0] ?? (zh ? '在 Agent 的 MCP 设置中添加' : 'Add in the Agent MCP settings')}
              </p>
              <div className="config-code-wrap">
                <div className="config-code-toolbar"><Terminal size={13} /><span>keymemory.mcp.json</span><CopyButton text={selected.snippet} label={zh ? '复制配置' : 'Copy config'} /></div>
                <pre>{selected.snippet}</pre>
              </div>
              <ol className="integration-notes">
                {selected.notes.slice(0, 3).map(note => <li key={note}>{note}</li>)}
              </ol>
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
