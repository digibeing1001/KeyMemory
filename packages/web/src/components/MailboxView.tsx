import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import type { MailMessageType, MailThread, MailThreadDetail, MailThreadKind } from '@keymemory/shared';
import { Archive, ArrowLeft, ChevronDown, Clock, Close, Inbox, Layers, Mail, Paperclip, Plus, RefreshCw, Search, Send, Star, Trash, User } from './Icons';
import { useI18n } from '../i18n';
import {
  createMailboxThread,
  getMailboxStats,
  getMailboxThread,
  listMailboxThreads,
  replyMailboxThread,
  syncMailbox,
  syncMailboxThread,
  updateMailboxThread,
  type MailboxFolder,
  type MailboxStats,
} from '../lib/api';

type Notice = { text: string; tone: 'success' | 'error' } | null;

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

function senderLabel(type: string, senderId: string | undefined, zh: boolean): string {
  if (type === 'secretary') return zh ? '记忆秘书' : 'Memory Secretary';
  if (type === 'agent') return senderId ? `Agent · ${senderId.replace(/^agent:/, '')}` : 'Agent';
  return zh ? '我' : 'Me';
}

function senderInitial(type: string): string {
  if (type === 'secretary') return '秘';
  if (type === 'agent') return 'A';
  return '我';
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

export default function MailboxView() {
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

  const selected = useMemo(() => threads.find((item) => item.id === selectedId), [threads, selectedId]);

  const openThread = (id: string) => {
    setSelectedId(id);
    setMobileDetail(true);
    setThreads((current) => current.map((item) => item.id === id ? { ...item, unreadCount: 0 } : item));
  };

  const patchThread = async (data: Parameters<typeof updateMailboxThread>[1], successText?: string) => {
    if (!selectedId) return;
    try {
      const updated = await updateMailboxThread(selectedId, data);
      setThreads((current) => current.map((item) => item.id === updated.id ? updated : item));
      setDetail((current) => current ? { ...current, thread: updated } : current);
      if (data.folder && data.folder !== folder && folder !== 'all') {
        setThreads((current) => current.filter((item) => item.id !== updated.id));
        setSelectedId(null);
      }
      if (successText) setNotice({ text: successText, tone: 'success' });
      void getMailboxStats().then(setStats);
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : (zh ? '操作失败' : 'Action failed'), tone: 'error' });
    }
  };

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

  const runSync = async () => {
    setSyncing(true);
    try {
      const result = selectedId ? await syncMailboxThread(selectedId) : await syncMailbox();
      await refresh();
      if (selectedId) setDetail(await getMailboxThread(selectedId));
      const sent = 'sent' in result ? (typeof result.sent === 'number' ? result.sent : Number(result.sent)) : 0;
      const created = 'createdThreads' in result ? Number(result.createdThreads) : 0;
      const skipped = 'skipped' in result && Array.isArray(result.skipped) ? result.skipped : [];
      const text = created > 0
        ? (zh ? `记忆秘书已建立 ${created} 个工作主题` : `Memory Secretary created ${created} work thread(s)`)
        : sent > 0
          ? (zh ? '记忆秘书已补充一封新邮件' : 'Memory Secretary added an update')
          : skipped.length > 0
            ? String(skipped[0])
            : (zh ? '已检查，目前没有需要补充的新变化' : 'Checked; there are no new changes');
      setNotice({ text, tone: skipped.length > 0 && created === 0 && sent === 0 ? 'error' : 'success' });
    } catch (cause) {
      setNotice({ text: cause instanceof Error ? cause.message : (zh ? '整理失败' : 'Sync failed'), tone: 'error' });
    } finally {
      setSyncing(false);
    }
  };

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
        <div className="mailbox-rule-card">
          <strong>{zh ? '一个主题，一项工作' : 'One subject, one body of work'}</strong>
          <p>{zh ? '项目、任务和事件用邮件串接力；通用事实仍保存在记忆库。' : 'Projects, tasks, and events continue as mail threads. Reusable facts stay in memory.'}</p>
        </div>
      </aside>

      <section className={`mailbox-list${mobileDetail ? ' is-hidden-mobile' : ''}`}>
        <div className="mailbox-list-toolbar">
          <form onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? '搜索主题和邮件内容' : 'Search mail'} />
            {query && <button type="button" onClick={() => { setQuery(''); setSearch(''); }} aria-label={zh ? '清除搜索' : 'Clear search'}><Close size={14} /></button>}
          </form>
          <button type="button" className="mail-icon-button" onClick={() => void refresh()} aria-label={zh ? '刷新' : 'Refresh'}><RefreshCw size={16} /></button>
        </div>
        <div className="mailbox-list-heading">
          <div><h2>{zh ? FOLDERS.find((item) => item.key === folder)?.zh : FOLDERS.find((item) => item.key === folder)?.en}</h2><span>{threads.length} {zh ? '个工作主题' : 'threads'}</span></div>
          <button type="button" className="btn" onClick={runSync} disabled={syncing}><RefreshCw size={14} />{syncing ? (zh ? '整理中…' : 'Syncing…') : (zh ? '记忆秘书整理' : 'Secretary sync')}</button>
        </div>
        <div className="mail-thread-list">
          {loading ? <div className="mail-empty">{zh ? '正在取信…' : 'Loading mail…'}</div> : threads.length === 0 ? (
            <div className="mail-empty"><Mail size={30} /><strong>{search ? (zh ? '没有找到相关邮件' : 'No matching mail') : (zh ? '这里还没有邮件' : 'No mail here yet')}</strong><p>{zh ? '为一项具体工作写第一封邮件，后续人类、Agent 与记忆会在同一项目中持续补充信息。' : 'Write the first message for a concrete body of work.'}</p></div>
          ) : threads.map((thread) => (
            <button type="button" key={thread.id} className={`mail-thread-row${thread.id === selectedId ? ' active' : ''}${thread.unreadCount > 0 ? ' unread' : ''}`} onClick={() => openThread(thread.id)}>
              <span className="mail-row-star" onClick={(event) => { event.stopPropagation(); void updateMailboxThread(thread.id, { starred: !thread.starred }).then(() => refresh()); }}><Star size={15} style={{ fill: thread.starred ? 'var(--warning)' : 'none', color: thread.starred ? 'var(--warning)' : undefined }} /></span>
              <span className="mail-row-content"><span className="mail-row-top"><strong>{thread.subject}</strong><time>{formatMailboxDate(thread.lastMessageAt || thread.updatedAt, zh)}</time></span><span className="mail-row-preview"><em>{zh ? KIND_LABEL[thread.kind].zh : KIND_LABEL[thread.kind].en}</em>{thread.currentSummary || (zh ? '打开查看完整往来' : 'Open to read the conversation')}</span><span className="mail-row-meta"><span>{thread.messageCount} {zh ? '封' : 'messages'}</span>{thread.status === 'waiting' && <span>{zh ? '等待回复' : 'Waiting'}</span>}{thread.status === 'completed' && <span>{zh ? '已完成' : 'Completed'}</span>}</span></span>
            </button>
          ))}
        </div>
      </section>

      <main className={`mailbox-reader${mobileDetail ? ' is-visible-mobile' : ''}`}>
        {!selectedId ? <div className="mail-reader-empty"><Mail size={38} /><strong>{zh ? '选择一封邮件开始阅读' : 'Select a message to read'}</strong><p>{zh ? '这里是人类与 Agent 共同了解工作进度的地方。' : 'This is where humans and Agents share progress.'}</p></div> : detailLoading || !detail ? <div className="mail-reader-empty">{zh ? '正在打开邮件…' : 'Opening message…'}</div> : (
          <>
            <div className="mail-reader-toolbar">
              <button type="button" className="mail-icon-button mail-mobile-back" onClick={() => setMobileDetail(false)} aria-label={zh ? '返回' : 'Back'}><ArrowLeft size={17} /></button>
              <button type="button" className="mail-icon-button" onClick={() => patchThread({ folder: 'archive' }, zh ? '已归档' : 'Archived')} title={zh ? '归档' : 'Archive'}><Archive size={17} /></button>
              <button type="button" className="mail-icon-button" onClick={() => patchThread({ folder: 'trash' }, zh ? '已移到垃圾箱' : 'Moved to trash')} title={zh ? '移到垃圾箱' : 'Move to trash'}><Trash size={17} /></button>
              <button type="button" className="mail-icon-button" onClick={() => patchThread({ starred: !detail.thread.starred })} title={zh ? '星标' : 'Star'}><Star size={17} style={{ fill: detail.thread.starred ? 'var(--warning)' : 'none', color: detail.thread.starred ? 'var(--warning)' : undefined }} /></button>
              <span className="mail-toolbar-spacer" />
              <button type="button" className="btn" onClick={runSync} disabled={syncing}><RefreshCw size={14} />{zh ? '检查新变化' : 'Check changes'}</button>
            </div>
            <article className="mail-reader-scroll">
              <header className="mail-thread-header">
                <div><span className="mail-kind-badge">{zh ? KIND_LABEL[detail.thread.kind].zh : KIND_LABEL[detail.thread.kind].en}</span><span className={`mail-status-badge status-${detail.thread.status}`}>{detail.thread.status === 'open' ? (zh ? '进行中' : 'Open') : detail.thread.status === 'waiting' ? (zh ? '等待中' : 'Waiting') : (zh ? '已完成' : 'Completed')}</span></div>
                <h1>{detail.thread.subject}</h1>
                <p>{zh ? `${detail.thread.messageCount} 封邮件 · 人类、Agent 与记忆共同可读` : `${detail.thread.messageCount} messages · shared by humans, Agents, and memory`}</p>
              </header>
              <div className="mail-message-stack">
                {detail.messages.map((message, index) => (
                  <section className={`mail-message sender-${message.senderType}`} key={message.id}>
                    <div className="mail-sender-avatar">{senderInitial(message.senderType)}</div>
                    <div className="mail-message-main">
                      <header><div><strong>{senderLabel(message.senderType, message.senderId, zh)}</strong><span>{message.senderType === 'secretary' ? (zh ? '自动整理' : 'Automatic digest') : message.senderType === 'agent' ? (zh ? '工作进度' : 'Agent update') : (zh ? '人工补充' : 'Human note')}</span></div><time>{formatMailboxDate(message.sentAt || message.createdAt, zh, true)}</time></header>
                      <div className="mail-message-body">{message.body}</div>
                      {message.attachments.length > 0 && <div className="mail-attachments"><Paperclip size={14} /><span>{message.attachments.length} {zh ? '个附件' : 'attachments'}</span>{message.attachments.map((attachment) => <details key={attachment.id}><summary><ChevronDown size={14} />{attachment.title}</summary><pre>{attachment.content || (zh ? '关联记忆，可在记忆库中查看。' : 'Linked memory; open it in the memory library.')}</pre></details>)}</div>}
                      {index < detail.messages.length - 1 && <div className="mail-message-divider" />}
                    </div>
                  </section>
                ))}
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
      {notice && <div className={`mail-notice ${notice.tone}`}>{notice.text}</div>}
    </div>
  );
}
