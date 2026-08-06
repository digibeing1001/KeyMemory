import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { MailMessageType, MailThread, MailThreadDetail, MailThreadKind } from '@keymemory/shared';
import { Archive, ArrowLeft, ChevronDown, Clock, Close, Inbox, Layers, Mail, Paperclip, Plus, RefreshCw, Search, Send, Star, Trash, User } from './Icons';
import { useI18n } from '../i18n';
import {
  createMailboxThread,
  discoverAgentIntegrations,
  getMailboxStats,
  getMailboxThread,
  listMailboxThreads,
  replyMailboxThread,
  syncMailbox,
  syncMailboxThread,
  updateMailboxThread,
  type AgentIntegrationStatus,
  type MailboxFolder,
  type MailboxStats,
} from '../lib/api';
import type { MailThreadFolder } from '@keymemory/shared';
import ConfirmDialog from './ConfirmDialog';

type Notice = { text: string; tone: 'success' | 'error'; undo?: { label: string; action: () => void } } | null;

const FOLDERS: Array<{ key: MailboxFolder; zh: string; en: string; icon: typeof Inbox; count?: keyof MailboxStats }> = [
  { key: 'inbox', zh: '收件箱', en: 'Inbox', icon: Inbox, count: 'unread' },
  { key: 'starred', zh: '已加星标', en: 'Starred', icon: Star, count: 'starred' },
  { key: 'snoozed', zh: '已延后', en: 'Snoozed', icon: Clock, count: 'snoozed' },
  { key: 'sent', zh: '已发送', en: 'Sent', icon: Send, count: 'sent' },
  { key: 'archive', zh: '归档', en: 'Archive', icon: Archive, count: 'archive' },
  { key: 'all', zh: '所有邮件', en: 'All mail', icon: Mail, count: 'all' },
  { key: 'trash', zh: '垃圾箱', en: 'Trash', icon: Trash, count: 'trash' },
];

const KIND_LABEL: Record<MailThreadKind, { zh: string; en: string }> = {
  project: { zh: '项目', en: 'Project' },
  task: { zh: '任务', en: 'Task' },
  event: { zh: '事件', en: 'Event' },
};

const MESSAGE_TYPE_CONFIG: Record<string, { icon: string; label: string; labelEn: string; color: string }> = {
  reply: { icon: '↩', label: '回复', labelEn: 'Reply', color: '#5b9bd5' },
  question: { icon: '?', label: '提问', labelEn: 'Question', color: '#e8a735' },
  decision: { icon: '✓', label: '决定', labelEn: 'Decision', color: '#4f8a67' },
  correction: { icon: '!', label: '更正', labelEn: 'Correction', color: '#d9534f' },
  digest: { icon: '☰', label: '摘要', labelEn: 'Digest', color: '#8065a3' },
  progress: { icon: '→', label: '进展', labelEn: 'Progress', color: '#2f8297' },
};

function formatRelativeTime(dateStr: string, language: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return language === 'zh' ? '刚刚' : 'Just now';
  if (minutes < 60) return language === 'zh' ? `${minutes} 分钟前` : `${minutes}m ago`;
  if (hours < 24) return language === 'zh' ? `${hours} 小时前` : `${hours}h ago`;

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);

  if (date >= todayStart) return language === 'zh' ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : `Today ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (date >= yesterdayStart) return language === 'zh' ? `昨天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : `Yesterday ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  if (days < 7) {
    const weekdays = language === 'zh' ? ['周日','周一','周二','周三','周四','周五','周六'] : ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `${weekdays[date.getDay()]} ${date.toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: language !== 'zh' })}`;
  }
  return date.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' });
}

const MIDDLE_THRESHOLD = 8;

interface AgentConfig {
  id: string;
  name: string;
  logo: string;
  color: string;
  status: 'active' | 'idle' | 'offline';
}

const AGENT_CONFIGS: AgentConfig[] = [
  { id: 'openclaw',   name: 'OpenClaw',   logo: '/agents/agent-openclaw.svg',   color: '#ff4d4d', status: 'offline' },
  { id: 'hermes',     name: 'Hermes',     logo: '/agents/agent-hermes.png',     color: '#6C5CE7', status: 'offline' },
  { id: 'codex',      name: 'Codex',      logo: '/agents/agent-codex.svg',      color: '#10A37F', status: 'offline' },
  { id: 'secretary',  name: 'Secretary',  logo: '/agents/agent-secretary.svg',  color: '#F39C12', status: 'offline' },
  { id: 'workbuddy',  name: 'WorkBuddy',  logo: '/agents/agent-workbuddy.svg',  color: '#6C4DFF', status: 'offline' },
  { id: 'trae',       name: 'TRAE Work',   logo: '/agents/agent-default.svg',    color: '#4B7BEC', status: 'offline' },
  { id: 'traework',   name: 'TRAE Work',   logo: '/agents/agent-default.svg',    color: '#4B7BEC', status: 'offline' },
  { id: 'qoder',      name: 'Qoder',       logo: '/agents/agent-default.svg',    color: '#8E5AE8', status: 'offline' },
  { id: 'claude',     name: 'Claude',      logo: '/agents/agent-default.svg',    color: '#D97757', status: 'offline' },
  { id: 'opencode',   name: 'OpenCode',    logo: '/agents/agent-default.svg',    color: '#267DFF', status: 'offline' },
];

function getAgentConfig(id: string): AgentConfig {
  const lower = id.toLowerCase();
  return AGENT_CONFIGS.find(a => a.id === lower || lower.startsWith(a.id)) ?? {
    id, name: id.charAt(0).toUpperCase() + id.slice(1), logo: '/agents/agent-default.svg', color: '#636E72', status: 'offline'
  };
}

function senderLabel(type: string, senderId: string | undefined, zh: boolean): string {
  if (type === 'secretary') return zh ? '记忆秘书' : 'Memory Secretary';
  if (type === 'agent' && senderId) return getAgentConfig(senderId.replace(/^agent:/, '')).name;
  if (type === 'agent') return zh ? '未知 Agent' : 'Unknown Agent';
  return zh ? '我' : 'Me';
}

function senderInitial(type: string, zh: boolean, senderId?: string): string {
  // E10：头像首字母随语言切换，英文模式下不再显示中文字符。
  if (type === 'secretary') return zh ? '秘' : 'S';
  if (type === 'agent') return getAgentConfig((senderId ?? 'agent').replace(/^agent:/, '')).name.charAt(0).toUpperCase();
  return zh ? '我' : 'M';
}

function formatMailboxDate(value: string | undefined, zh: boolean, full = false): string {
  if (!value) return '';
  const date = new Date(value);
  const today = new Date();
  if (!full && date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  return new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', full
    ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(date);
}

type DateGroup = 'today' | 'yesterday' | 'thisWeek' | 'earlier';

// 后端在 MailThread 上追加的可选已读回执字段（可能暂不存在，前端需容错）。
type ThreadAgentReader = { recipientId: string; readAt: string };
type MailThreadWithReaders = MailThread & { agentReaders?: ThreadAgentReader[] };

interface MailboxViewProps {
  /** 可选：跳转 Agent 接入页（integrations 视图）的回调，由宿主提供。 */
  onOpenIntegrations?: () => void;
}

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekStart = new Date(today.getTime() - today.getDay() * 86400000);
  if (date >= today) return 'today';
  if (date >= yesterday) return 'yesterday';
  if (date >= weekStart) return 'thisWeek';
  return 'earlier';
}

const GROUP_LABELS: Record<DateGroup, [string, string]> = {
  today: ['今天', 'Today'],
  yesterday: ['昨天', 'Yesterday'],
  thisWeek: ['本周', 'This Week'],
  earlier: ['更早', 'Earlier'],
};

interface ComposerProps {
  onClose: () => void;
  onCreated: (thread: MailThreadDetail) => void;
  zh: boolean;
}

function Composer({ onClose, onCreated, zh }: ComposerProps) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<MailThreadKind>('project');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    setError('');
    try {
      onCreated(await createMailboxThread({ subject: subject.trim(), kind, body: body.trim() }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : (zh ? '发送失败' : 'Failed to send'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mail-compose" role="dialog" aria-modal="true" aria-label={zh ? '写邮件' : 'Compose'}>
      <div className="mail-compose-titlebar">
        <strong>{zh ? '新邮件' : 'New message'}</strong>
        <button type="button" className="mail-icon-button" onClick={onClose} aria-label={zh ? '关闭' : 'Close'}><Close size={16} /></button>
      </div>
      <form onSubmit={submit} className="mail-compose-form">
        <label className="mail-compose-field">
          <span>{zh ? '收件人' : 'To'}</span>
          <input value={zh ? '记忆邮箱（人类与已接入的 Agent）' : 'Memory mailbox (human and connected Agents)'} readOnly />
        </label>
        <label className="mail-compose-field">
          <span>{zh ? '类型' : 'Type'}</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as MailThreadKind)}>
            {(Object.keys(KIND_LABEL) as MailThreadKind[]).map((value) => <option key={value} value={value}>{zh ? KIND_LABEL[value].zh : KIND_LABEL[value].en}</option>)}
          </select>
        </label>
        <label className="mail-compose-field">
          <span>{zh ? '主题' : 'Subject'}</span>
          <input autoFocus value={subject} onChange={(event) => setSubject(event.target.value)} placeholder={zh ? '例如：KeyMemory 邮箱功能进入可用性验收' : 'e.g. KeyMemory mailbox enters acceptance review'} />
        </label>
        <textarea className="mail-compose-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder={zh ? '像写工作邮件一样说明背景、当前进展、结论和需要继续处理的事项。技术日志请作为附件补充。' : 'Write the background, current progress, decisions, and next actions in plain language.'} />
        {error && <p className="mail-compose-error">{error}</p>}
        <div className="mail-compose-actions">
          <button className="btn btn-primary" disabled={sending || !subject.trim() || !body.trim()}><Send size={15} />{sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '发送' : 'Send')}</button>
          <span>{zh ? '这封邮件会建立一个持续更新的工作主题。' : 'This starts a continuing work thread.'}</span>
        </div>
      </form>
    </div>
  );
}

export default function MailboxView({ onOpenIntegrations }: MailboxViewProps = {}) {
  const { language } = useI18n();
  const zh = language === 'zh';
  const [folder, setFolder] = useState<MailboxFolder>('inbox');
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [stats, setStats] = useState<MailboxStats | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailThreadDetail | null>(null);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [replyType, setReplyType] = useState<MailMessageType>('reply');
  const [sending, setSending] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<{ status?: string; kind?: string; sort?: string }>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<'compact' | 'comfortable' | 'relaxed'>('comfortable');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [agentIntegrations, setAgentIntegrations] = useState<AgentIntegrationStatus[]>([]);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const toggleGroup = useCallback((group: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(group) ? next.delete(group) : next.add(group);
      return next;
    });
  }, []);

  const toggleMessage = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const refresh = useCallback(async (keepSelection = true) => {
    setLoading(true);
    try {
      const [items, nextStats] = await Promise.all([listMailboxThreads(folder, search), getMailboxStats()]);
      setThreads(items);
      setStats(nextStats);
      if (!keepSelection || (selectedId && !items.some((item) => item.id === selectedId))) {
        setSelectedId(items[0]?.id ?? null);
      } else if (!selectedId && items.length > 0) {
        setSelectedId(items[0].id);
      }
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : (zh ? '邮箱加载失败' : 'Mailbox failed to load'), tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, [folder, search, selectedId, zh]);

  useEffect(() => { void refresh(false); }, [folder, search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    discoverAgentIntegrations()
      .then(report => setAgentIntegrations(report.agents))
      .catch(() => setAgentIntegrations([]));
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    setDetailLoading(true);
    getMailboxThread(selectedId)
      .then((next) => { setDetail(next); void getMailboxStats().then(setStats); })
      .catch((cause) => setNotice({ text: cause instanceof Error ? cause.message : (zh ? '邮件读取失败' : 'Message failed to load'), tone: 'error' }))
      .finally(() => setDetailLoading(false));
  }, [selectedId, zh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    setExpandedIds(new Set());
  }, [detail?.thread.id]);

  const selected = useMemo(() => threads.find((item) => item.id === selectedId), [threads, selectedId]);

  const agentReaders = useMemo(() => {
    return (detail?.readers ?? [])
      .filter(reader => reader.readerType === 'agent')
      .map(reader => ({
        id: reader.recipientId.replace(/^agent:/, ''),
        hasRead: Boolean(reader.readAt),
        readAt: reader.readAt,
        unreadCount: reader.unreadCount,
      }));
  }, [detail]);

  const connectedAgents = useMemo(() => agentIntegrations
    .filter(agent => agent.connected || agent.detected)
    .map(agent => ({
      ...getAgentConfig(agent.id),
      name: agent.label,
      status: agent.connected ? 'active' as const : 'idle' as const,
    })), [agentIntegrations]);

  function formatAgentReadTime(readAt: string): string {
    const diff = Date.now() - new Date(readAt).getTime();
    if (diff < 60000) return zh ? '刚刚' : 'just now';
    if (diff < 3600000) return zh ? `${Math.floor(diff / 60000)} 分钟前` : `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return zh ? `${Math.floor(diff / 3600000)} 小时前` : `${Math.floor(diff / 3600000)}h ago`;
    return zh ? `${Math.floor(diff / 86400000)} 天前` : `${Math.floor(diff / 86400000)}d ago`;
  }

  // Agent 面板：桌面在邮箱左栏，窄屏（.mailbox-folders 被隐藏时）以横向条带显示在邮件列表顶部。
  const renderAgentsPanel = (extraClass: string) => {
    if (connectedAgents.length === 0) return null;
    return (
      <div className={`mailbox-agents-online${extraClass ? ` ${extraClass}` : ''}`}>
        <span className="mailbox-agents-label">
          <span className="agent-pulse" />
          {zh ? '已发现的 Agent' : 'Discovered Agents'}
        </span>
        <div className="mailbox-agents-list">
          {connectedAgents.map(agent => (
            <button type="button" key={agent.id} className="mailbox-agent-row"
              onClick={() => onOpenIntegrations?.()}
              title={`${agent.name} · ${agent.status === 'active' ? (zh ? '已接入' : 'Connected') : (zh ? '待接入' : 'Pending')} · ${zh ? '点击查看接入' : 'Open integrations'}`}>
              <span className={`agent-avatar is-${agent.status}`} style={{ '--agent-active-color': agent.color } as React.CSSProperties}>
                <img src={agent.logo} alt="" width={28} height={28} />
              </span>
              <span className="mailbox-agent-copy">
                <strong>{agent.name}</strong>
              </span>
              <span className={`mailbox-agent-status ${agent.status === 'active' ? 'is-connected' : 'is-pending'}`}>
                {agent.status === 'active' ? (zh ? '已接入' : 'Connected') : (zh ? '待接入' : 'Pending')}
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  };

  // 邮件列表行已读标识：后端 agentReaders 只含已读回执，字段可能暂不存在，undefined 时不渲染。
  const renderThreadReaders = (thread: MailThread) => {
    const readers = (thread as MailThreadWithReaders).agentReaders;
    if (!Array.isArray(readers) || readers.length === 0) return null;
    const shown = readers.slice(0, 3);
    const rest = readers.length - shown.length;
    return (
      <span className="mail-row-read-indicators" aria-label={zh ? '已读 Agent' : 'Read by agents'}>
        {shown.map(reader => {
          const config = getAgentConfig(String(reader?.recipientId ?? '').replace(/^agent:/, ''));
          const when = typeof reader?.readAt === 'string' && reader.readAt ? formatAgentReadTime(reader.readAt) : '';
          return <img key={reader.recipientId} className="mail-row-read-logo" src={config.logo} alt={config.name} width={14} height={14} title={`${config.name} · ${zh ? '已读' : 'Read'}${when ? ` · ${when}` : ''}`} />;
        })}
        {rest > 0 && <span className="mail-row-read-more">+{rest}</span>}
      </span>
    );
  };

  const filteredThreads = useMemo(() => {
    let result = threads;
    if (filters.status) result = result.filter((t) => t.status === filters.status);
    if (filters.kind) result = result.filter((t) => t.kind === filters.kind);
    if (filters.sort === 'created') {
      result = [...result].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (filters.sort === 'messages') {
      result = [...result].sort((a, b) => b.messageCount - a.messageCount);
    }
    return result;
  }, [threads, filters]);

  const groupedThreads = useMemo(() => {
    const groups: { group: DateGroup; threads: typeof filteredThreads }[] = [];
    let currentGroup: DateGroup | null = null;
    let currentBatch: typeof filteredThreads = [];
    for (const thread of filteredThreads) {
      const group = getDateGroup(thread.lastMessageAt || thread.updatedAt);
      if (group !== currentGroup) {
        if (currentBatch.length > 0) groups.push({ group: currentGroup!, threads: currentBatch });
        currentGroup = group;
        currentBatch = [thread];
      } else {
        currentBatch.push(thread);
      }
    }
    if (currentBatch.length > 0) groups.push({ group: currentGroup!, threads: currentBatch });
    return groups;
  }, [filteredThreads]);

  const openThread = (id: string) => {
    setSelectedId(id);
    setMobileDetail(true);
    setThreads((current) => current.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
  };

  const toggleStar = (thread: MailThread) => {
    updateMailboxThread(thread.id, { starred: !thread.starred })
      .then(() => refresh())
      .catch((cause) => setNotice({ text: cause instanceof Error ? cause.message : (zh ? '星标操作失败' : 'Star failed'), tone: 'error' }));
  };

  const patchThread = useCallback(async (data: Parameters<typeof updateMailboxThread>[1], successText?: string) => {
    if (!selectedId) return false;
    const threadId = selectedId;
    const previous = threads.find((item) => item.id === threadId);
    try {
      const updated = await updateMailboxThread(threadId, data);
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetail((current) => current ? { ...current, thread: updated } : current);
      if (data.folder && data.folder !== folder && folder !== 'all') {
        setThreads((current) => current.filter((item) => item.id !== updated.id));
        setSelectedId(null);
      } else if (data.snoozedUntil && folder === 'inbox') {
        setThreads((current) => current.filter((item) => item.id !== updated.id));
        setSelectedId(null);
      }
      if (successText) {
        const undoable = (data.folder === 'archive' || data.folder === 'trash') && previous;
        setNotice({
          text: successText,
          tone: 'success',
          undo: undoable ? {
            label: data.folder === 'archive'
              ? (zh ? '移回收件箱（报告保留）' : 'Move back (report kept)')
              : (zh ? '撤销' : 'Undo'),
            action: () => {
              void updateMailboxThread(threadId, { folder: previous.folder as MailThreadFolder })
                .then(() => { setNotice(null); void refresh(); void getMailboxStats().then(setStats); })
                .catch((cause) => setNotice({ text: cause instanceof Error ? cause.message : (zh ? '撤销失败' : 'Undo failed'), tone: 'error' }));
            },
          } : undefined,
        });
      }
      void getMailboxStats().then(setStats);
      return true;
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : (zh ? '操作失败' : 'Action failed'), tone: 'error' });
      return false;
    }
  }, [selectedId, folder, zh, threads, refresh]);

  const requestArchive = useCallback(() => {
    if (!selectedId || detail?.thread.folder === 'archive') return;
    setArchiveConfirmOpen(true);
  }, [selectedId, detail?.thread.folder]);

  const archiveThread = useCallback(async () => {
    if (archiving) return;
    setArchiving(true);
    const success = await patchThread(
      { folder: 'archive' },
      zh ? '已归档，完整项目报告已整理到记忆库' : 'Archived; the complete project report is now in memory',
    );
    if (success) setArchiveConfirmOpen(false);
    setArchiving(false);
  }, [archiving, patchThread, zh]);

  const sendReply = async () => {
    if (!selectedId || !reply.trim()) return;
    setSending(true);
    try {
      await replyMailboxThread(selectedId, { body: reply.trim(), messageType: replyType });
      setReply('');
      setDetail(await getMailboxThread(selectedId));
      await refresh();
      setNotice({ text: zh ? '回复已写入这个工作主题' : 'Reply added to this work thread', tone: 'success' });
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : (zh ? '回复发送失败' : 'Reply failed'), tone: 'error' });
    } finally {
      setSending(false);
    }
  };

  const runSync = async (threadId?: string) => {
    setSyncing(true);
    try {
      const result = threadId ? await syncMailboxThread(threadId) : await syncMailbox();
      await refresh();
      if (threadId) setDetail(await getMailboxThread(threadId));
      const sent = 'sent' in result ? (typeof result.sent === 'number' ? result.sent : Number(result.sent)) : 0;
      const created = 'createdThreads' in result ? Number(result.createdThreads) : 0;
      const skipped = 'skipped' in result && Array.isArray(result.skipped) ? result.skipped : [];
      const text = created > 0
        ? (zh ? `记忆秘书已建立 ${created} 个工作主题` : `Memory Secretary created ${created} work thread(s)`)
        : sent > 0
          ? (zh ? '记忆秘书已补充一封新邮件' : 'Memory Secretary added an update')
          : skipped.length > 0
            ? `${String(skipped[0])}${created === 0 && sent === 0 ? (zh ? '——请打开“智能整理设置”完成模型连接后重试' : ' — connect a model in Smart organization and try again') : ''}`
            : (zh ? '已检查，目前没有需要补充的新变化' : 'Checked; there are no new changes');
      setNotice({ text, tone: skipped.length > 0 && created === 0 && sent === 0 ? 'error' : 'success' });
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : (zh ? '整理失败' : 'Sync failed'), tone: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  // 键盘快捷键导航
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (target.closest('.mail-filter-panel')) return;

      const items = filteredThreads;
      const currentIndex = items.findIndex(t => t.id === selectedId);

      switch (e.key.toLowerCase()) {
        case 'j': {
          e.preventDefault();
          const nextIdx = Math.min(currentIndex + 1, items.length - 1);
          if (items[nextIdx]) setSelectedId(items[nextIdx].id);
          break;
        }
        case 'k': {
          e.preventDefault();
          const prevIdx = Math.max(currentIndex - 1, 0);
          if (items[prevIdx]) setSelectedId(items[prevIdx].id);
          break;
        }
        case 'enter':
        case 'o': {
          e.preventDefault();
          if (selectedId) {
            setMobileDetail(true);
            setThreads(current => current.map(item => item.id === selectedId ? { ...item, unreadCount: 0 } : item));
          }
          break;
        }
        case 'e': {
          e.preventDefault();
          requestArchive();
          break;
        }
        case 's': {
          e.preventDefault();
          if (selectedId) {
            const thread = items.find(t => t.id === selectedId);
            if (thread) toggleStar(thread);
          }
          break;
        }
        case 'r': {
          e.preventDefault();
          const replyTextarea = document.querySelector('.mail-reply-box textarea') as HTMLTextAreaElement;
          if (replyTextarea) replyTextarea.focus();
          break;
        }
        case 'escape': {
          e.preventDefault();
          if (mobileDetail) {
            setMobileDetail(false);
          }
          break;
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, detail, folder, filteredThreads, zh, mobileDetail, patchThread, refresh, requestArchive]);

  return (
    <div className="mailbox-shell">
      <aside className="mailbox-folders">
        <button type="button" className="mail-compose-button" onClick={() => setComposeOpen(true)}><Plus size={18} />{zh ? '写邮件' : 'Compose'}</button>
        <nav aria-label={zh ? '邮箱文件夹' : 'Mailbox folders'}>
          {FOLDERS.map((item) => {
            const Icon = item.icon;
            const count = stats && item.count ? stats[item.count] : 0;
            return <button type="button" key={item.key} className={folder === item.key ? 'active' : ''} onClick={() => { setFolder(item.key); setMobileDetail(false); }}><Icon size={16} /><span>{zh ? item.zh : item.en}</span>{Boolean(count) && <b>{count}</b>}</button>;
          })}
        </nav>
        {renderAgentsPanel('')}
        <div className="mailbox-rule-card">
          <strong>{zh ? '人与 Agent 的上下文中转站' : 'Human-Agent context relay'}</strong>
          <p>{zh ? '每项工作使用一个主题。Agent 会先结合主题和记忆整理上下文，再用邮件汇报理解与进展。' : 'Each body of work uses one subject. Agents combine the thread with memory before reporting context and progress.'}</p>
          <p>{zh ? '归档主题时，完整过程会整理成长期项目报告，不会删除原邮件。' : 'Archiving consolidates the full history into a durable project report without deleting the mail.'}</p>
        </div>
        <div className="mailbox-shortcuts-hint">
          <span>{zh ? '快捷键: J/K 导航 · Enter 打开 · S 星标 · R 回复 · Esc 返回' : 'Shortcuts: J/K navigate · Enter open · S star · R reply · Esc back'}</span>
        </div>
      </aside>

      <section className={`mailbox-list${mobileDetail ? ' is-hidden-mobile' : ''}`}>
        {renderAgentsPanel('mailbox-agents-mobile')}
        <div className="mailbox-list-toolbar">
          <form onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索主题和邮件内容' : 'Search mail'} />
            {query && <button type="button" onClick={() => { setQuery(''); setSearch(''); }} aria-label={zh ? '清除搜索' : 'Clear search'}><Close size={14} /></button>}
          </form>
          <button type="button" className="mail-icon-button" onClick={() => void refresh()} aria-label={zh ? '刷新' : 'Refresh'}><RefreshCw size={16} /></button>
          <button type="button" className={`mail-icon-button${showFilters ? ' is-active' : ''}`} onClick={() => setShowFilters(!showFilters)} title={zh ? '筛选' : 'Filter'}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M4 8h8M6 12h4"/></svg>
          </button>
          <button type="button" className="mail-icon-button"
            onClick={() => setDensity(d => d === 'compact' ? 'comfortable' : d === 'comfortable' ? 'relaxed' : 'compact')}
            title={zh ? `密度: ${density === 'compact' ? '紧凑' : density === 'comfortable' ? '舒适' : '宽松'}` : `Density: ${density}`}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {density === 'compact' && <><line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="12" x2="14" y2="12"/></>}
              {density === 'comfortable' && <><line x1="2" y1="3" x2="14" y2="3"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="13" x2="14" y2="13"/></>}
              {density === 'relaxed' && <><line x1="2" y1="2" x2="14" y2="2"/><line x1="2" y1="8" x2="14" y2="8"/><line x1="2" y1="14" x2="14" y2="14"/></>}
            </svg>
          </button>
        </div>
        {showFilters && (
          <div className="mail-filter-panel">
            <div className="mail-filter-group">
              <label>{zh ? '状态' : 'Status'}</label>
              <div className="mail-filter-chips">
                {['', 'open', 'waiting', 'completed'].map((v) => (
                  <button key={v} className={`mail-filter-chip${filters.status === v || (!v && !filters.status) ? ' is-active' : ''}`} onClick={() => setFilters((f) => ({ ...f, status: v || undefined }))}>
                    {v === '' ? (zh ? '全部' : 'All') : v === 'open' ? (zh ? '进行中' : 'Open') : v === 'waiting' ? (zh ? '等待回复' : 'Waiting') : (zh ? '已完成' : 'Done')}
                  </button>
                ))}
              </div>
            </div>
            <div className="mail-filter-group">
              <label>{zh ? '类型' : 'Type'}</label>
              <div className="mail-filter-chips">
                {['', 'project', 'task', 'event'].map((v) => (
                  <button key={v} className={`mail-filter-chip${filters.kind === v || (!v && !filters.kind) ? ' is-active' : ''}`} onClick={() => setFilters((f) => ({ ...f, kind: v || undefined }))}>
                    {v === '' ? (zh ? '全部' : 'All') : v === 'project' ? (zh ? '项目' : 'Project') : v === 'task' ? (zh ? '任务' : 'Task') : (zh ? '事件' : 'Event')}
                  </button>
                ))}
              </div>
            </div>
            <div className="mail-filter-group">
              <label>{zh ? '排序' : 'Sort'}</label>
              <div className="mail-filter-chips">
                {['', 'created', 'messages'].map((v) => (
                  <button key={v} className={`mail-filter-chip${filters.sort === v || (!v && !filters.sort) ? ' is-active' : ''}`} onClick={() => setFilters((f) => ({ ...f, sort: v || undefined }))}>
                    {v === '' ? (zh ? '最近活动' : 'Recent') : v === 'created' ? (zh ? '创建时间' : 'Created') : (zh ? '消息数' : 'Messages')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="mailbox-list-heading">
          <div><h2>{zh ? FOLDERS.find((item) => item.key === folder)?.zh : FOLDERS.find((item) => item.key === folder)?.en}</h2><span>{threads.length} {zh ? '个工作主题' : 'threads'}</span></div>
          <button type="button" className="btn" onClick={() => void runSync()} disabled={syncing}><RefreshCw size={14} />{syncing ? (zh ? '整理中…' : 'Syncing…') : (zh ? '记忆秘书整理' : 'Secretary sync')}</button>
        </div>
        <div className={`mail-thread-list density-${density}`}>
          {loading ? <div className="mail-empty">{zh ? '正在取信…' : 'Loading mail…'}</div> : filteredThreads.length === 0 ? (
            <div className="mail-empty"><Mail size={30} /><strong>{search ? (zh ? '没有找到相关邮件' : 'No matching mail') : (zh ? '这里还没有邮件' : 'No mail here yet')}</strong><p>{zh ? '为一项具体工作写第一封邮件，后续人类、Agent 与记忆会在同一项目中持续补充信息。' : 'Write the first message for a concrete body of work.'}</p></div>
          ) : groupedThreads.map(({ group, threads: groupThreads }) => (
            <div key={group} className="mail-thread-group">
              <button type="button" className={`mail-group-heading${collapsedGroups.has(group) ? ' is-collapsed' : ''}`}
                onClick={() => toggleGroup(group)}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <path d={collapsedGroups.has(group) ? 'M3 1l4 4-4 4' : 'M1 3l4 4 4-4'} />
                </svg>
                {GROUP_LABELS[group][language === 'zh' ? 0 : 1]}
                <span className="mail-group-count">{groupThreads.length}</span>
              </button>
              {!collapsedGroups.has(group) && groupThreads.map((thread) => (
                <div key={thread.id} role="button" tabIndex={0} className={`mail-thread-row${thread.id === selectedId ? ' active' : ''}${thread.unreadCount > 0 ? ' unread' : ''}`}
                  onClick={() => openThread(thread.id)}
                  onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); openThread(thread.id); } }}>
                  <button type="button" className="mail-row-star" aria-label={thread.starred ? (zh ? '取消星标' : 'Unstar') : (zh ? '加星标' : 'Star')} aria-pressed={thread.starred} onClick={(event) => { event.stopPropagation(); toggleStar(thread); }}><Star size={15} style={{ fill: thread.starred ? 'var(--warning)' : 'none', color: thread.starred ? 'var(--warning)' : undefined }} /></button>
                  <span className="mail-row-content"><span className="mail-row-top"><strong>{thread.subject}</strong><time>{formatMailboxDate(thread.lastMessageAt || thread.updatedAt, zh)}</time></span><span className="mail-row-preview"><em>{zh ? KIND_LABEL[thread.kind].zh : KIND_LABEL[thread.kind].en}</em>{thread.currentSummary || (zh ? '打开查看完整往来' : 'Open to read the conversation')}</span><span className="mail-row-meta"><span>{thread.messageCount} {zh ? '封' : 'messages'}</span>{renderThreadReaders(thread)}{thread.status === 'waiting' && <span>{zh ? '等待回复' : 'Waiting'}</span>}{thread.status === 'completed' && <span>{zh ? '已完成' : 'Completed'}</span>}{(thread.metadata as any)?.lastAgentActivity && (
                      <span className="mail-row-agent-activity">
                        <img className="agent-activity-logo" src={getAgentConfig((thread.metadata as any).lastAgentActivity.split(' ')[0] || 'secretary').logo} alt="" width={12} height={12} />
                        <span className="agent-activity-pulse" />
                        {(thread.metadata as any).lastAgentActivity}
                      </span>
                    )}</span></span>
                  {thread.unreadCount > 0 && <span className="mail-unread-badge">{thread.unreadCount > 99 ? '99+' : thread.unreadCount}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <main className={`mailbox-reader${mobileDetail ? ' is-visible-mobile' : ''}`}>
        {!selectedId ? <div className="mail-reader-empty"><Mail size={38} /><strong>{zh ? '选择一封邮件开始阅读' : 'Select a message to read'}</strong><p>{zh ? '这里是人类与 Agent 共同了解工作进度的地方。' : 'This is where humans and Agents share progress.'}</p></div> : detailLoading || !detail ? <div className="mail-reader-empty">{zh ? '正在打开邮件…' : 'Opening message…'}</div> : (
          <>
            <div className="mail-reader-toolbar">
              <button type="button" className="mail-icon-button mail-mobile-back" onClick={() => setMobileDetail(false)} aria-label={zh ? '返回' : 'Back'}><ArrowLeft size={17} /></button>
              <button type="button" className="mail-icon-button" onClick={requestArchive} disabled={archiving || detail.thread.folder === 'archive'} title={detail.thread.folder === 'archive' ? (zh ? '这个主题已经归档' : 'Already archived') : (zh ? '归档并生成项目报告' : 'Archive and create project report')}><Archive size={17} /></button>
              <button type="button" className="mail-icon-button" onClick={() => patchThread({ folder: 'trash' }, zh ? '已移到垃圾箱' : 'Moved to trash')} title={zh ? '移到垃圾箱' : 'Move to trash'}><Trash size={17} /></button>
              <button type="button" className="mail-icon-button" onClick={() => patchThread({ starred: !detail.thread.starred })} title={zh ? '星标' : 'Star'}><Star size={17} style={{ fill: detail.thread.starred ? 'var(--warning)' : 'none', color: detail.thread.starred ? 'var(--warning)' : undefined }} /></button>
              <button type="button" className="mail-icon-button" onClick={() => {
                const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
                patchThread({ snoozedUntil: detail.thread.snoozedUntil ? null : until }, detail.thread.snoozedUntil ? (zh ? '已取消延后' : 'Snooze cancelled') : (zh ? '已延后 24 小时' : 'Snoozed for 24h'));
              }} title={detail.thread.snoozedUntil ? (zh ? '取消延后' : 'Cancel snooze') : (zh ? '延后 24 小时' : 'Snooze 24h')}><Clock size={17} /></button>
              <span className="mail-toolbar-spacer" />
              <button type="button" className="btn" onClick={() => void runSync(selectedId)} disabled={syncing}><RefreshCw size={14} />{zh ? '检查新变化' : 'Check changes'}</button>
            </div>
            <article className="mail-reader-scroll">
              <header className="mail-thread-header">
                <div><span className="mail-kind-badge">{zh ? KIND_LABEL[detail.thread.kind].zh : KIND_LABEL[detail.thread.kind].en}</span><span className={`mail-status-badge status-${detail.thread.status}`}>{detail.thread.status === 'open' ? (zh ? '进行中' : 'Open') : detail.thread.status === 'waiting' ? (zh ? '等待中' : 'Waiting') : (zh ? '已完成' : 'Completed')}</span></div>
                <h1>{detail.thread.subject}</h1>
                <p>{zh ? `${detail.thread.messageCount} 封邮件 · 人类、Agent 与记忆共同可读` : `${detail.thread.messageCount} messages · shared by humans, Agents, and memory`}</p>
              </header>
              {agentReaders.length > 0 && (
                <div className="mail-agent-readers">
                  <span className="mail-agent-readers-label">
                    {zh ? 'Agent 阅读状态' : 'Agent Readers'}
                  </span>
                  <div className="mail-agent-badges">
                    {agentReaders.map(reader => {
                      const config = getAgentConfig(reader.id);
                      return (
                        <span key={reader.id} className={`mail-agent-badge ${reader.hasRead ? 'is-read' : 'is-unread'}`}
                          style={{ '--agent-color': config.color } as React.CSSProperties}>
                          <img className="mail-agent-logo" src={config.logo} alt={config.name} width={18} height={18} />
                          <span className="mail-agent-name">{config.name}</span>
                          {reader.hasRead && reader.readAt && (
                            <time className="mail-agent-time">{formatAgentReadTime(reader.readAt)}</time>
                          )}
                          {!reader.hasRead && <span className="mail-agent-time">{zh ? '尚未读取' : 'Not read'}</span>}
                          {reader.unreadCount > 0 && <span className="mail-agent-time">{zh ? `${reader.unreadCount} 封未读` : `${reader.unreadCount} unread`}</span>}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="mail-message-stack">
                {(() => {
                  const messages = detail.messages.slice().reverse();
                  const total = messages.length;

                  type VisMsg = { msg: typeof messages[0]; isLatest: boolean; hidden: boolean };
                  const visibleMsgs: VisMsg[] = total <= MIDDLE_THRESHOLD
                    ? messages.map((msg, i) => ({ msg, isLatest: i === 0, hidden: false }))
                    : messages.map((msg, i) => {
                        const isLatest = i === 0;
                        const showTop = i < 4;
                        const showBottom = i >= total - 2;
                        const hidden = !showTop && !showBottom && !isLatest && !expandedIds.has(msg.id);
                        return { msg, isLatest, hidden };
                      });

                  const avatarColors: Record<string, string> = {
                    human: 'color-mix(in srgb, var(--accent) 14%, var(--bg-secondary))',
                    agent: 'color-mix(in srgb, #7c6bb5 14%, var(--bg-secondary))',
                    secretary: 'color-mix(in srgb, #a9773e 14%, var(--bg-secondary))',
                  };
                  const avatarTextColors: Record<string, string> = {
                    human: 'var(--accent)',
                    agent: '#7c6bb5',
                    secretary: '#a9773e',
                  };

                  const elements: React.ReactNode[] = [];
                  let hiddenCount = 0;
                  let hiddenGroupKey = 0;

                  const flushHidden = () => {
                    if (hiddenCount > 0) {
                      elements.push(
                        <div className="mail-hidden-group" key={`hidden-${hiddenGroupKey++}`}>
                          <button type="button" onClick={() => {
                            setExpandedIds(prev => {
                              const s = new Set(prev);
                              visibleMsgs.forEach(v => { if (v.hidden) s.add(v.msg.id); });
                              return s;
                            });
                          }}>{zh ? `还有 ${hiddenCount} 条旧消息` : `${hiddenCount} older messages`}</button>
                        </div>
                      );
                      hiddenCount = 0;
                    }
                  };

                  visibleMsgs.forEach((v, idx) => {
                    if (v.hidden) {
                      hiddenCount++;
                      return;
                    }
                    flushHidden();

                    const msg = v.msg;
                    const isLatest = v.isLatest;
                    const isExpanded = isLatest || expandedIds.has(msg.id);
                    const typeConfig = MESSAGE_TYPE_CONFIG[msg.messageType];
                    const avatarColor = avatarColors[msg.senderType] || avatarColors.human;
                    const avatarTextColor = avatarTextColors[msg.senderType] || avatarTextColors.human;
                    const avatarLetter = senderInitial(msg.senderType, zh, msg.senderId);
                    const sLabel = senderLabel(msg.senderType, msg.senderId, zh);
                    const timeStr = formatRelativeTime(msg.sentAt || msg.createdAt || '', language);
                    const fullTimeStr = (msg.sentAt || msg.createdAt) ? new Date(msg.sentAt || msg.createdAt).toLocaleString(zh ? 'zh-CN' : 'en-US') : '';
                    const bodyPreview = msg.body.length > 30 ? msg.body.slice(0, 30) + '…' : msg.body;

                    if (isExpanded) {
                      elements.push(
                        <section className={`mail-message sender-${msg.senderType}`} key={msg.id}>
                          <div className="mail-sender-avatar" style={{ background: avatarColor, color: avatarTextColor }}>
                            {avatarLetter}
                          </div>
                          <div className="mail-message-main">
                            <header>
                              <div>
                                {typeConfig && <span className="mail-type-badge" data-type={msg.messageType} style={{ color: typeConfig.color }} title={zh ? typeConfig.label : typeConfig.labelEn}>{typeConfig.icon}</span>}
                                <strong>{sLabel}</strong>
                                <span>{msg.senderType === 'secretary' ? (zh ? '自动整理' : 'Automatic digest') : msg.senderType === 'agent' ? (zh ? '工作进度' : 'Agent update') : (zh ? '人工补充' : 'Human note')}</span>
                              </div>
                              <time title={fullTimeStr}>{timeStr}</time>
                              {!isLatest && (
                                <button type="button" className="mail-collapse-btn" onClick={() => toggleMessage(msg.id)} title={zh ? '折叠' : 'Collapse'}>▴</button>
                              )}
                            </header>
                            <div className="mail-message-body">{msg.body}</div>
                            {msg.attachments.length > 0 && <div className="mail-attachments"><Paperclip size={14} /><span>{msg.attachments.length} {zh ? '个附件' : 'attachments'}</span>{msg.attachments.map((attachment) => <details key={attachment.id}><summary><ChevronDown size={14} />{attachment.title}</summary><pre>{attachment.content || (zh ? '关联记忆，可在记忆库中查看。' : 'Linked memory; open it in the memory library.')}</pre></details>)}</div>}
                            {idx < visibleMsgs.length - 1 && <div className="mail-message-divider" />}
                          </div>
                        </section>
                      );
                    } else {
                      elements.push(
                        <button type="button" className="mail-message-collapsed" key={msg.id} onClick={() => toggleMessage(msg.id)}
                          style={{ '--type-color': (MESSAGE_TYPE_CONFIG[msg.messageType] ?? MESSAGE_TYPE_CONFIG.reply).color } as React.CSSProperties}>
                          <span className="mail-sender-avatar is-small" style={{ background: avatarColor, color: avatarTextColor }}>
                            {avatarLetter}
                          </span>
                          <span className="mail-collapsed-info">
                            {typeConfig && <span className="mail-type-badge" data-type={msg.messageType} style={{ color: typeConfig.color }} title={zh ? typeConfig.label : typeConfig.labelEn}>{typeConfig.icon}</span>}
                            <strong>{sLabel}</strong>
                            <em>{bodyPreview}</em>
                          </span>
                          <time className="mail-collapsed-time" title={fullTimeStr}>{timeStr}</time>
                          <span className="mail-expand-icon">▾</span>
                        </button>
                      );
                    }
                  });
                  flushHidden();

                  return elements;
                })()}
              </div>
              {detail.linkedMemories.length > 0 && <details className="mail-linked-memories"><summary><Layers size={15} />{zh ? `这个主题引用了 ${detail.linkedMemories.length} 条记忆` : `${detail.linkedMemories.length} linked memories`}<ChevronDown size={14} /></summary><div>{detail.linkedMemories.map((memory) => <span key={memory.id}>{memory.title}</span>)}</div></details>}
              <section className="mail-reply-box">
                <div className="mail-sender-avatar"><User size={15} /></div>
                <div className="mail-reply-main">
                  <div className="mail-reply-heading"><strong>{zh ? '回复这个工作主题' : 'Reply to this work thread'}</strong><select value={replyType} onChange={(event) => setReplyType(event.target.value as MailMessageType)}><option value="reply">{zh ? '补充信息' : 'Update'}</option><option value="question">{zh ? '提出问题' : 'Question'}</option><option value="decision">{zh ? '记录决定' : 'Decision'}</option><option value="correction">{zh ? '更正信息' : 'Correction'}</option></select></div>
                  <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={zh ? '用清楚、自然的书面语言补充进展、决定或问题。' : 'Add progress, decisions, or questions in clear language.'} />
                  <div><button type="button" className="btn btn-primary" disabled={sending || !reply.trim()} onClick={sendReply}><Send size={14} />{sending ? (zh ? '发送中…' : 'Sending…') : (zh ? '回复' : 'Reply')}</button><span>{zh ? '回复会成为 Agent 下次接力时的上下文。' : 'This reply becomes context for the next Agent handoff.'}</span></div>
                </div>
              </section>
            </article>
          </>
        )}
      </main>

      {composeOpen && <Composer zh={zh} onClose={() => setComposeOpen(false)} onCreated={(created) => { setComposeOpen(false); setFolder('inbox'); setSelectedId(created.thread.id); setDetail(created); setMobileDetail(true); void refresh(); }} />}
      <ConfirmDialog
        open={archiveConfirmOpen}
        title={zh ? '归档并整理项目报告？' : 'Archive and consolidate this project?'}
        message={zh
          ? 'KeyMemory 会根据这个主题的全部邮件与关联记忆，整理一份包含起因、过程、因果链、结果和反思的长期报告。原邮件不会被删除；主题恢复后再次归档会更新同一份报告。'
          : 'KeyMemory will consolidate every message and linked memory into one durable report covering the background, process, causal chain, results, and reflection. Mail is not deleted, and re-archiving updates the same report.'}
        confirmLabel={archiving ? (zh ? '正在整理…' : 'Consolidating…') : (zh ? '归档并整理' : 'Archive and consolidate')}
        cancelLabel={zh ? '暂不归档' : 'Not now'}
        onConfirm={() => void archiveThread()}
        onCancel={() => { if (!archiving) setArchiveConfirmOpen(false); }}
      />
      {notice && <div className={`mail-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}{notice.undo && <button type="button" className="mail-notice-undo" onClick={notice.undo.action}>{notice.undo.label}</button>}</div>}
    </div>
  );
}
