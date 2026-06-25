import { useState, useEffect, useCallback } from 'react';
import type { MouseEvent } from 'react';
import type { Memory, Project } from '@keymemory/shared';
import {
  Archive,
  Close,
  Play,
  Settings,
  Activity,
  RotateCcw,
  Clock,
  CheckCircle,
  Link,
  Inbox,
  AlertTriangle,
  GitMerge,
  Eye,
  Trash,
  Sparkles,
  Folder,
} from './Icons';
import {
  listDreamReports,
  getDreamSignals,
  getSchedulerConfig,
  updateSchedulerConfig,
  runDream,
  rollbackDream,
  deleteDreamReport,
  forgetMemory,
  getMemory,
  listProjects,
  updateMemory,
  resolveConflict,
} from '../lib/api';
import type { DreamReport, DreamSignalEntry, SchedulerConfig, ConflictAction } from '../lib/api';
import { useToast } from './Toast';
import ConfirmDialog from './ConfirmDialog';
import { useI18n } from '../i18n';
import MarkdownRenderer from './MarkdownRenderer';
import MemoryQualityPanel from './MemoryQualityPanel';
import { formatDateTime, formatMemoryTitle, getMemoryKind, LAYER_COLORS, redactSensitiveText } from '../lib/memoryFormat';

interface DreamViewProps {
  onMemorySelect?: (id: string) => void;
}

function formatTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString(locale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function cronToLabel(cron: string, language: 'zh' | 'en'): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return language === 'zh' ? `每天 ${time}` : `Every day ${time}`;
}

function StatCard({ label, value, hint, icon: Icon, accent }: {
  label: string;
  value: number;
  hint?: string;
  icon: typeof Archive;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--bg-card)',
        padding: 16,
        minHeight: 104,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: accent ? 'var(--accent)' : 'var(--text-muted)' }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>{label}</span>
        <Icon size={16} />
      </div>
      <div style={{ marginTop: 10, fontSize: 30, fontWeight: 750, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </div>
      {hint && <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>{hint}</p>}
    </div>
  );
}

export default function DreamView({ onMemorySelect }: DreamViewProps) {
  const { language, t } = useI18n();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const { toast } = useToast();
  const [reports, setReports] = useState<DreamReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DreamReport | null>(null);
  const [signals, setSignals] = useState<DreamSignalEntry[]>([]);
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingCron, setEditingCron] = useState(false);
  const [cronHour, setCronHour] = useState(3);
  const [cronMinute, setCronMinute] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [assignmentInputs, setAssignmentInputs] = useState<Record<string, string>>({});
  const [assigningMemoryId, setAssigningMemoryId] = useState<string | null>(null);
  const [previewMemory, setPreviewMemory] = useState<Memory | null>(null);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    message: string;
    danger?: boolean;
    onConfirm: () => void;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [conflictDialog, setConflictDialog] = useState<{
    memoryId: string;
    targetId: string;
  } | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [nextReports, nextConfig] = await Promise.all([listDreamReports(20), getSchedulerConfig()]);
      setReports(nextReports);
      setConfig(nextConfig);
      if (nextReports[0]) {
        setSelectedReport((current) => nextReports.find((report) => report.id === current?.id) ?? nextReports[0]);
        getDreamSignals(nextReports[0].id).then(setSignals).catch(() => setSignals([]));
      } else {
        setSelectedReport(null);
        setSignals([]);
      }
    } catch {
      toast(language === 'zh' ? '加载整理记录失败' : 'Failed to load organize records', 'error');
    } finally {
      setLoading(false);
    }
  }, [language, toast]);

  const fetchProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const handleRunDream = useCallback(async () => {
    setRunning(true);
    try {
      const report = await runDream();
      toast(language === 'zh' ? `整理完成，需要确认 ${report.todoItems.length} 项` : `Organized. ${report.todoItems.length} items need review`, 'success');
      setSelectedReport(report);
      setShowAdvanced(false);
      setSignals([]);
      await fetchData();
      getDreamSignals(report.id).then(setSignals).catch(() => setSignals([]));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast((language === 'zh' ? '整理失败: ' : 'Organize failed: ') + message, 'error');
    } finally {
      setRunning(false);
    }
  }, [fetchData, language, toast]);

  const handleSelectReport = useCallback(async (report: DreamReport) => {
    setSelectedReport(report);
    setShowAdvanced(false);
    try {
      setSignals(await getDreamSignals(report.id));
    } catch {
      setSignals([]);
    }
  }, []);

  const handleDeleteReport = useCallback(async (reportId: string, event?: MouseEvent) => {
    event?.stopPropagation();
    setConfirmDialog({
      open: true,
      title: t('dream.deleteReport'),
      message: t('dream.confirmDelete'),
      danger: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        try {
          await deleteDreamReport(reportId);
          toast(language === 'zh' ? '整理记录已删除' : 'Organize report deleted', 'success');
          setSelectedReport((prev) => (prev?.id === reportId ? null : prev));
          await fetchData();
        } catch (err) {
          toast((err as Error).message || (language === 'zh' ? '删除失败' : 'Delete failed'), 'error');
        }
      },
    });
  }, [fetchData, language, t, toast]);

  const handleRollback = useCallback(async (reportId: string) => {
    setConfirmDialog({
      open: true,
      title: t('dream.rollback'),
      message: t('dream.confirmRollback'),
      danger: true,
      onConfirm: async () => {
        setConfirmDialog((prev) => ({ ...prev, open: false }));
        try {
          const result = await rollbackDream(reportId);
          setSelectedReport(result);
          toast(language === 'zh' ? '已回滚本次整理' : 'Organize run rolled back', 'success');
          await fetchData();
        } catch {
          toast(language === 'zh' ? '回滚失败' : 'Rollback failed', 'error');
        }
      },
    });
  }, [fetchData, language, t, toast]);

  const handleArchiveMemory = useCallback(async (memoryId: string) => {
    try {
      await forgetMemory(memoryId, 'archive');
      setSelectedReport((prev) => prev ? {
        ...prev,
        todoItems: prev.todoItems.filter((item) => item.memoryId !== memoryId),
      } : prev);
      setReports((prev) => prev.map((report) => ({
        ...report,
        todoItems: report.todoItems.filter((item) => item.memoryId !== memoryId),
      })));
      toast(language === 'zh' ? '记忆已归档' : 'Memory archived', 'success');
    } catch {
      toast(language === 'zh' ? '归档失败' : 'Archive failed', 'error');
    }
  }, [language, toast]);

  const handleAssignProject = useCallback(async (memoryId: string) => {
    const value = (assignmentInputs[memoryId] ?? '').trim();
    if (!value) {
      toast(t('dream.todo.assignMissing'), 'error');
      return;
    }

    const matchedProject = projects.find((project) => (
      project.id === value
      || project.path.toLowerCase() === value.toLowerCase()
      || project.name.toLowerCase() === value.toLowerCase()
    ));

    setAssigningMemoryId(memoryId);
    try {
      await updateMemory(memoryId, matchedProject ? { projectId: matchedProject.id } : { projectPath: value });
      setAssignmentInputs((prev) => {
        const next = { ...prev };
        delete next[memoryId];
        return next;
      });
      setSelectedReport((prev) => prev ? {
        ...prev,
        todoItems: prev.todoItems.filter((item) => item.memoryId !== memoryId || item.type !== 'orphan'),
      } : prev);
      setReports((prev) => prev.map((report) => ({
        ...report,
        todoItems: report.todoItems.filter((item) => item.memoryId !== memoryId || item.type !== 'orphan'),
      })));
      await fetchProjects();
      toast(t('dream.todo.assigned'), 'success');
    } catch {
      toast(t('dream.todo.assignFailed'), 'error');
    } finally {
      setAssigningMemoryId(null);
    }
  }, [assignmentInputs, fetchProjects, projects, t, toast]);

  const handlePreviewMemory = useCallback(async (memoryId: string) => {
    setPreviewLoadingId(memoryId);
    setPreviewMemory(null);
    try {
      setPreviewMemory(await getMemory(memoryId));
    } catch {
      toast(language === 'zh' ? '加载记忆详情失败' : 'Failed to load memory details', 'error');
    } finally {
      setPreviewLoadingId(null);
    }
  }, [language, toast]);

  const handleResolveConflict = useCallback(async (memoryId: string, targetId: string, action: ConflictAction, mergeData?: { title?: string; content?: string; tags?: string[] }) => {
    try {
      const result = await resolveConflict(memoryId, targetId, action, mergeData);
      if (result.success) {
        toast(t('dream.conflict.success'), 'success');
        setConflictDialog(null);
        setSelectedReport((prev) => prev ? {
          ...prev,
          todoItems: prev.todoItems.filter((item) => !(item.type === 'conflict' && item.memoryId === memoryId && item.targetId === targetId)),
        } : prev);
        setReports((prev) => prev.map((report) => ({
          ...report,
          todoItems: report.todoItems.filter((item) => !(item.type === 'conflict' && item.memoryId === memoryId && item.targetId === targetId)),
        })));
      } else {
        toast(result.message || t('dream.conflict.failed'), 'error');
      }
    } catch {
      toast(t('dream.conflict.failed'), 'error');
    }
  }, [t, toast]);

  const handleToggleDreaming = useCallback(async (enabled: boolean) => {
    if (!config) return;
    try {
      setConfig(await updateSchedulerConfig({ dreamingEnabled: enabled }));
      toast(enabled ? t('dream.enabled') : t('dream.disabled'), 'success');
    } catch {
      toast(language === 'zh' ? '更新设置失败' : 'Failed to update settings', 'error');
    }
  }, [config, language, t, toast]);

  const handleSaveCron = useCallback(async () => {
    const newCron = `${cronMinute} ${cronHour} * * *`;
    try {
      setConfig(await updateSchedulerConfig({ dreamingCron: newCron }));
      setEditingCron(false);
      toast(language === 'zh' ? '整理时间已更新' : 'Schedule updated', 'success');
    } catch {
      toast(language === 'zh' ? '更新时间失败' : 'Failed to update schedule', 'error');
    }
  }, [cronHour, cronMinute, language, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
        <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
        {t('common.loading')}
      </div>
    );
  }

  const todoItems = selectedReport?.todoItems ?? [];
  const promoted = selectedReport?.details?.promoted ?? [];
  const archived = selectedReport?.details?.archived ?? [];
  const merged = selectedReport?.details?.merged ?? [];

  return (
    <main className="dream-view app-page px-8 py-6" style={{ maxWidth: 1120, width: '100%', boxSizing: 'border-box' }}>
      <ConfirmDialog
        open={confirmDialog.open}
        title={confirmDialog.title}
        message={confirmDialog.message}
        danger={confirmDialog.danger}
        onConfirm={confirmDialog.onConfirm}
        onCancel={() => setConfirmDialog((prev) => ({ ...prev, open: false }))}
      />
      <datalist id="dream-project-options">
        {projects.map((project) => (
          <option key={project.id} value={project.path}>{project.name}</option>
        ))}
      </datalist>
      {(previewMemory || previewLoadingId) && (
        <DreamMemoryDrawer
          memory={previewMemory}
          projects={projects}
          loading={Boolean(previewLoadingId)}
          locale={locale}
          onClose={() => {
            setPreviewMemory(null);
            setPreviewLoadingId(null);
          }}
          onOpenInList={previewMemory && onMemorySelect ? () => onMemorySelect(previewMemory.id) : undefined}
        />
      )}

      {conflictDialog && (
        <ConflictResolveDialog
          memoryId={conflictDialog.memoryId}
          targetId={conflictDialog.targetId}
          locale={locale}
          onClose={() => setConflictDialog(null)}
          onResolve={handleResolveConflict}
        />
      )}

      <header className="page-header flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-4">
          <div
            className="km-icon-tile"
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
            }}
          >
            <Sparkles size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>
              {t('dream.title')}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '5px 0 0', lineHeight: 1.65, maxWidth: 680 }}>
              {t('dream.subtitle')}
            </p>
          </div>
        </div>
        <div className="dream-header-actions flex items-center gap-2">
          <button className="btn" onClick={() => setShowSettings((value) => !value)}>
            <Settings size={14} />
            {t('dream.settings')}
          </button>
          <button className="btn btn-primary" onClick={handleRunDream} disabled={running}>
            {running ? <span className="animate-spin" style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} /> : <Play size={14} />}
            {running ? t('dream.running') : t('dream.run')}
          </button>
        </div>
      </header>

      {config && (
        <section
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            padding: '14px 18px',
            marginBottom: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: config.dreamingEnabled ? 'var(--success)' : 'var(--danger)' }} />
            {t('dream.auto')} {config.dreamingEnabled ? t('dream.enabled') : t('dream.disabled')}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            <Clock size={13} />
            {t('dream.lastRun')}: <strong style={{ color: 'var(--text-primary)' }}>{config.lastDreamRun ? formatTime(config.lastDreamRun, locale) : t('dream.never')}</strong>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            <Clock size={13} />
            {t('dream.nextRun')}: <strong style={{ color: 'var(--text-primary)' }}>{cronToLabel(config.dreamingCron, language)}</strong>
          </span>
        </section>
      )}

      {showSettings && config && (
        <section
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)',
            padding: 18,
            marginBottom: 22,
            display: 'grid',
            gap: 16,
            maxWidth: 560,
          }}
        >
          <label className="flex items-center justify-between gap-4">
            <span>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 650, color: 'var(--text-primary)' }}>{t('dream.auto')}</span>
              <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t('dream.subtitle')}</span>
            </span>
            <input type="checkbox" checked={config.dreamingEnabled} onChange={(event) => handleToggleDreaming(event.target.checked)} />
          </label>

          <div>
            <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 8 }}>{t('dream.schedule')}</div>
            {editingCron ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={cronHour}
                  onChange={(event) => setCronHour(Math.max(0, Math.min(23, parseInt(event.target.value, 10) || 0)))}
                  style={{ width: 58, padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                />
                <span>:</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={cronMinute}
                  onChange={(event) => setCronMinute(Math.max(0, Math.min(59, parseInt(event.target.value, 10) || 0)))}
                  style={{ width: 58, padding: '6px 8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                />
                <button className="btn btn-primary" onClick={handleSaveCron}>{t('common.save')}</button>
                <button className="btn" onClick={() => setEditingCron(false)}>{t('common.cancel')}</button>
              </div>
            ) : (
              <button className="btn" onClick={() => setEditingCron(true)}>
                <Clock size={14} />
                {cronToLabel(config.dreamingCron, language)}
              </button>
            )}
          </div>
        </section>
      )}

      {selectedReport && (
        <section style={{ marginBottom: 26 }}>
          <div className="flex items-center justify-between gap-4 mb-3">
            <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)', fontWeight: 700 }}>
              {t('dream.summary')} · {formatTime(selectedReport.completedAt || selectedReport.createdAt, locale)}
            </h3>
            <div className="flex items-center gap-2">
              <button className="btn" onClick={() => handleRollback(selectedReport.id)}>
                <RotateCcw size={14} />
                {t('dream.rollback')}
              </button>
              <button className="btn" onClick={() => handleDeleteReport(selectedReport.id)} style={{ color: 'var(--danger)' }}>
                <Trash size={14} />
                {t('dream.deleteReport')}
              </button>
            </div>
          </div>

          <div className="dream-stat-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 16 }}>
            <StatCard label={t('dream.checked')} value={selectedReport.totalCandidates} icon={Activity} />
            <StatCard label={t('dream.strengthened')} value={selectedReport.promoted} icon={CheckCircle} accent />
            <StatCard label={t('dream.merged')} value={selectedReport.merged} icon={GitMerge} />
            <StatCard label={t('dream.needReview')} value={todoItems.length} icon={AlertTriangle} accent={todoItems.length > 0} />
          </div>

          <section className="dream-next-action" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: todoItems.length > 0 ? 'rgba(245, 158, 11, 0.08)' : 'rgba(16, 185, 129, 0.08)', padding: 14, marginBottom: 14 }}>
            <div className="flex items-start gap-3">
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--bg-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: todoItems.length > 0 ? 'var(--warning)' : 'var(--success)', flexShrink: 0 }}>
                {todoItems.length > 0 ? <AlertTriangle size={15} /> : <CheckCircle size={15} />}
              </span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 750, color: 'var(--text-primary)' }}>{t('dream.nextAction')}</div>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--text-secondary)' }}>
                  {todoItems.length > 0 ? t('dream.nextActionTodo') : t('dream.nextActionDone')}
                </p>
              </div>
            </div>
          </section>

          <div className="dream-report-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14 }}>
            <section className="dream-did-card" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', padding: 16 }}>
              <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }}>{t('dream.did')}</h4>
              <div style={{ display: 'grid', gap: 10 }}>
                {selectedReport.sessions.map((session) => (
                  <div key={session.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--bg-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                      {session.phase === 'light' ? <Inbox size={14} /> : session.phase === 'rem' ? <Link size={14} /> : <CheckCircle size={14} />}
                    </span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{t(`dream.phase.${session.phase}`)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                        {language === 'zh'
                          ? `检查 ${session.candidatesProcessed} 条，处理 ${session.candidatesPromoted} 条`
                          : `Checked ${session.candidatesProcessed}, changed ${session.candidatesPromoted}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="dream-todo-list" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', padding: 16 }}>
              <h4 style={{ margin: '0 0 12px', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700 }}>{t('dream.needsYou')}</h4>
              {todoItems.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>{t('dream.noTodo')}</p>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {todoItems.slice(0, 8).map((item) => {
                    const isOrphan = item.type === 'orphan';
                    const Icon = isOrphan ? Inbox : AlertTriangle;
                    return (
                      <article className="dream-todo-card" key={`${item.type}-${item.memoryId}`} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12, background: isOrphan ? 'var(--bg-main)' : 'rgba(245, 158, 11, 0.06)' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                          <Icon size={16} style={{ color: isOrphan ? 'var(--text-muted)' : 'var(--warning)', marginTop: 2 }} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                              {isOrphan ? t('dream.todo.orphan') : t('dream.todo.conflict')}
                            </div>
                            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{redactSensitiveText(item.title)}</div>
                            <p style={{ margin: '5px 0 6px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                              {isOrphan ? t('dream.todo.orphanHint') : t('dream.todo.conflictHint')}
                            </p>
                            {item.reason && (
                              <div style={{ margin: '0 0 8px', padding: '6px 10px', background: 'var(--bg-muted)', borderRadius: 'var(--radius-sm)', borderLeft: '2px solid var(--border)' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.3 }}>{t('dream.todo.detail')}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.55 }}>{redactSensitiveText(item.reason)}</div>
                              </div>
                            )}
                            <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{t('dream.todo.howToFix')}：</span>
                              {isOrphan ? t('dream.todo.orphanHowTo') : t('dream.todo.conflictHowTo')}
                            </p>
                            {isOrphan && (
                              <div className="dream-assign-row">
                                <label htmlFor={`dream-assign-${item.memoryId}`}>
                                  {t('dream.todo.assignProject')}
                                </label>
                                <div className="dream-assign-control">
                                  <input
                                    id={`dream-assign-${item.memoryId}`}
                                    type="text"
                                    list="dream-project-options"
                                    value={assignmentInputs[item.memoryId] ?? ''}
                                    placeholder={t('dream.todo.assignPlaceholder')}
                                    onChange={(event) => setAssignmentInputs((prev) => ({ ...prev, [item.memoryId]: event.target.value }))}
                                  />
                                  <button
                                    className="btn"
                                    onClick={() => handleAssignProject(item.memoryId)}
                                    disabled={assigningMemoryId === item.memoryId}
                                  >
                                    <Folder size={12} />
                                    {t('dream.todo.assign')}
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="dream-todo-actions flex items-center gap-2">
                              <button className="btn" onClick={() => handlePreviewMemory(item.memoryId)}>
                                <Eye size={12} />
                                {t('common.view')}
                              </button>
                              {isOrphan && (
                                <button className="btn" onClick={() => handleArchiveMemory(item.memoryId)}>
                                  <Archive size={12} />
                                  {t('common.archive')}
                                </button>
                              )}
                              {!isOrphan && item.targetId && (
                                <>
                                  <button className="btn" style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }} onClick={() => setConflictDialog({ memoryId: item.memoryId, targetId: item.targetId! })}>
                                    <GitMerge size={12} />
                                    {t('dream.conflict.resolve')}
                                  </button>
                                  <button className="btn" onClick={() => handleResolveConflict(item.memoryId, item.targetId!, 'keep_memory')}>
                                    <CheckCircle size={12} />
                                    {t('dream.conflict.keepThis')}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                  {todoItems.length > 8 && (
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                      {t('dream.moreTodo', { count: todoItems.length - 8 })}
                    </p>
                  )}
                </div>
              )}
            </section>
          </div>

          {(promoted.length > 0 || archived.length > 0 || merged.length > 0 || signals.length > 0) && (
            <section style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', background: 'var(--bg-card)', overflow: 'hidden' }}>
              <button
                onClick={() => setShowAdvanced((value) => !value)}
                style={{
                  width: '100%',
                  border: 'none',
                  background: 'transparent',
                  padding: '14px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                }}
              >
                <span>{t('dream.advanced')}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('dream.advancedHint')}</span>
              </button>
              {showAdvanced && (
                <div className="dream-advanced-content" style={{ padding: '0 16px 16px', display: 'grid', gap: 12 }}>
                  {promoted.length > 0 && (
                    <AdvancedList title={t('dream.strengthened')} items={promoted.map((item) => `${redactSensitiveText(item.title)} · ${Math.round(item.score * 100)}%`)} />
                  )}
                  {merged.length > 0 && (
                    <AdvancedList title={t('dream.merged')} items={merged.map((item) => `${redactSensitiveText(item.title)} -> ${redactSensitiveText(item.intoTitle)}`)} />
                  )}
                  {archived.length > 0 && (
                    <AdvancedList title={t('dream.archived')} items={archived.map((item) => `${redactSensitiveText(item.title)} · ${redactSensitiveText(item.reason)}`)} />
                  )}
                  {signals.length > 0 && (
                    <div>
                      <h5 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{t('dream.signals')}</h5>
                      <div style={{ display: 'grid', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                        {signals.slice(0, 30).map((signal) => (
                          <button
                            key={signal.memoryId}
                            onClick={() => handlePreviewMemory(signal.memoryId)}
                            style={{
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius-md)',
                              background: signal.promoted ? 'rgba(16, 185, 129, 0.08)' : 'var(--bg-main)',
                              color: 'var(--text-secondary)',
                              padding: '8px 10px',
                              cursor: 'pointer',
                              display: 'grid',
                              gridTemplateColumns: 'minmax(0, 1fr) auto',
                              gap: 10,
                              textAlign: 'left',
                              fontSize: 12,
                            }}
                          >
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{redactSensitiveText(signal.title)}</span>
                            <strong>{signal.score.toFixed(2)}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </section>
      )}

      <section>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={15} style={{ color: 'var(--text-tertiary)' }} />
          {t('dream.history')}
        </h3>
        {reports.length === 0 ? (
          <div className="empty-state" style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: 48 }}>
            <Archive size={28} style={{ opacity: 0.45, marginBottom: 12 }} />
            <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-secondary)' }}>{t('dream.noReports')}</span>
            <span style={{ fontSize: 13, marginTop: 6, color: 'var(--text-muted)' }}>{t('dream.noReportsHint')}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {reports.map((report) => {
              const isSelected = selectedReport?.id === report.id;
              return (
                <button
                  className="dream-history-row"
                  key={report.id}
                  onClick={() => handleSelectReport(report)}
                  style={{
                    padding: '14px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected ? '1px solid rgba(35, 131, 226, 0.32)' : '1px solid var(--border)',
                    background: isSelected ? 'var(--bg-selected)' : 'var(--bg-card)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    textAlign: 'left',
                  }}
                >
                  <span className="dream-history-main flex items-center gap-3">
                    <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--bg-main)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                      {report.status === 'completed' ? <GitMerge size={16} /> : <Activity size={16} />}
                    </span>
                    <span>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {formatTime(report.completedAt || report.createdAt, locale)}
                      </span>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {report.totalCandidates} {t('dream.checked')} · {report.todoItems.length} {t('dream.needReview')} {formatDuration(report.durationMs)}
                      </span>
                    </span>
                  </span>
                  <span className="dream-history-stats" style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, color: 'var(--text-secondary)' }}>
                    <span>{t('dream.strengthened')} {report.promoted}</span>
                    <span>{t('dream.merged')} {report.merged}</span>
                    <span>{t('dream.needReview')} {report.todoItems.length}</span>
                    <button className="btn" onClick={(event) => handleDeleteReport(report.id, event)} style={{ color: 'var(--danger)' }}>
                      <Trash size={12} />
                    </button>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}

function ConflictResolveDialog({
  memoryId,
  targetId,
  locale,
  onClose,
  onResolve,
}: {
  memoryId: string;
  targetId: string;
  locale: string;
  onClose: () => void;
  onResolve: (memoryId: string, targetId: string, action: ConflictAction, mergeData?: { title?: string; content?: string; tags?: string[] }) => Promise<void>;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [memA, setMemA] = useState<Memory | null>(null);
  const [memB, setMemB] = useState<Memory | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'merge' | 'keep' | 'delete'>('merge');
  const [primary, setPrimary] = useState<'a' | 'b'>('a');
  const [mergedTitle, setMergedTitle] = useState('');
  const [mergedContent, setMergedContent] = useState('');
  const [mergedTags, setMergedTags] = useState('');
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [a, b] = await Promise.all([getMemory(memoryId), getMemory(targetId)]);
        setMemA(a);
        setMemB(b);
      } catch {
        toast(t('dream.conflict.loadOtherFailed'), 'error');
      } finally {
        setLoading(false);
      }
    })();
  }, [memoryId, targetId, t, toast]);

  useEffect(() => {
    if (!memA || !memB) return;
    const primaryMem = primary === 'a' ? memA : memB;
    const otherMem = primary === 'a' ? memB : memA;
    setMergedTitle(primaryMem.title);
    setMergedContent(primaryMem.content + '\n\n---\n' + otherMem.content);
    setMergedTags([...new Set([...(primaryMem.tags || []), ...(otherMem.tags || [])])].join(', '));
  }, [primary, memA, memB]);

  const handleMerge = async () => {
    setResolving(true);
    const action: ConflictAction = primary === 'a' ? 'merge_into_memory' : 'merge_into_target';
    const tags = mergedTags.split(',').map((s) => s.trim()).filter(Boolean);
    await onResolve(memoryId, targetId, action, { title: mergedTitle, content: mergedContent, tags });
    setResolving(false);
  };

  const handleKeep = async (which: 'a' | 'b') => {
    setResolving(true);
    const action: ConflictAction = which === 'a' ? 'keep_memory' : 'keep_target';
    await onResolve(memoryId, targetId, action);
    setResolving(false);
  };

  const handleDelete = async (which: 'a' | 'b') => {
    setResolving(true);
    const action: ConflictAction = which === 'a' ? 'delete_memory' : 'delete_target';
    await onResolve(memoryId, targetId, action);
    setResolving(false);
  };

  const MemoryCard = ({ mem, label, side }: { mem: Memory | null; label: string; side: 'a' | 'b' }) => (
    <div style={{
      border: side === primary && mode === 'merge' ? '2px solid var(--accent)' : '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      padding: 12,
      background: 'var(--bg-main)',
      flex: 1,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </div>
      {mem ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6, wordBreak: 'break-word' }}>
            {redactSensitiveText(mem.title)}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55, maxHeight: 200, overflowY: 'auto', wordBreak: 'break-word' }}>
            {redactSensitiveText(mem.content)}
          </div>
          {mem.tags && mem.tags.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {mem.tags.slice(0, 8).map((tag) => (
                <span key={tag} className="tag-pill" style={{ fontSize: 11 }}>{tag}</span>
              ))}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
            {formatDateTime(mem.updatedAt, locale)} · {t('detail.hits')}: {mem.hitCount}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '20px 0', textAlign: 'center' }}>
          {loading ? t('dream.conflict.loadingOther') : t('dream.conflict.otherNotFound')}
        </div>
      )}
    </div>
  );

  return (
    <>
      <button type="button" className="dream-preview-scrim" aria-label={t('common.close')} onClick={onClose} />
      <aside className="dream-preview-drawer" role="dialog" aria-modal="true" aria-label={t('dream.conflict.title')} style={{ maxWidth: 720 }}>
        <div className="dream-preview-header">
          <div>
            <div className="dream-preview-eyebrow">{t('dream.todo.conflict')}</div>
            <h3>{t('dream.conflict.title')}</h3>
          </div>
          <button className="btn" onClick={onClose} aria-label={t('common.close')}>
            <Close size={14} />
          </button>
        </div>

        {loading && (
          <div className="dream-preview-loading">
            <div className="animate-spin" style={{ width: 18, height: 18, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
            {t('common.loading')}
          </div>
        )}

        {!loading && memA && memB && (
          <>
            {/* 模式选择 tab */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
              {(['merge', 'keep', 'delete'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  style={{
                    padding: '8px 16px',
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: 700,
                    color: mode === m ? 'var(--accent)' : 'var(--text-secondary)',
                    borderBottom: mode === m ? '2px solid var(--accent)' : '2px solid transparent',
                  }}
                >
                  {m === 'merge' && (<><GitMerge size={12} style={{ display: 'inline', marginRight: 4 }} />{t('dream.conflict.resolve')}</>)}
                  {m === 'keep' && (<><CheckCircle size={12} style={{ display: 'inline', marginRight: 4 }} />{t('dream.conflict.keepThis')}</>)}
                  {m === 'delete' && (<><Trash size={12} style={{ display: 'inline', marginRight: 4 }} />{t('common.delete')}</>)}
                </button>
              ))}
            </div>

            {/* 两条记忆并排展示 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
              <MemoryCard mem={memA} label={t('dream.conflict.thisMemory')} side="a" />
              <MemoryCard mem={memB} label={t('dream.conflict.otherMemory')} side="b" />
            </div>

            {/* 合并模式 */}
            {mode === 'merge' && (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {t('dream.conflict.chooseMain')}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn"
                    style={primary === 'a' ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                    onClick={() => setPrimary('a')}
                  >
                    {t('dream.conflict.useThis')}
                  </button>
                  <button
                    className="btn"
                    style={primary === 'b' ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : {}}
                    onClick={() => setPrimary('b')}
                  >
                    {t('dream.conflict.useOther')}
                  </button>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {t('dream.conflict.mergedTitle')}
                  </label>
                  <input
                    type="text"
                    value={mergedTitle}
                    onChange={(e) => setMergedTitle(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {t('dream.conflict.mergedContent')}
                  </label>
                  <textarea
                    value={mergedContent}
                    onChange={(e) => setMergedContent(e.target.value)}
                    rows={10}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 4 }}>
                    {t('dream.conflict.mergedTags')}
                  </label>
                  <input
                    type="text"
                    value={mergedTags}
                    onChange={(e) => setMergedTags(e.target.value)}
                    placeholder="tag1, tag2, tag3"
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13 }}
                  />
                </div>

                <button
                  className="btn"
                  style={{ background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)', justifyContent: 'center' }}
                  onClick={handleMerge}
                  disabled={resolving}
                >
                  <GitMerge size={13} />
                  {resolving ? t('common.loading') : t('dream.conflict.confirmMerge')}
                </button>
              </div>
            )}

            {/* 保留模式 */}
            {mode === 'keep' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
                  {t('dream.conflict.confirmKeep')}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleKeep('a')} disabled={resolving}>
                    <CheckCircle size={13} />
                    {t('dream.conflict.useThis')}
                  </button>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center' }} onClick={() => handleKeep('b')} disabled={resolving}>
                    <CheckCircle size={13} />
                    {t('dream.conflict.useOther')}
                  </button>
                </div>
              </div>
            )}

            {/* 删除模式 */}
            {mode === 'delete' && (
              <div style={{ display: 'grid', gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)', lineHeight: 1.55 }}>
                  {t('common.confirmDelete')}
                </p>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center', color: 'var(--danger)' }} onClick={() => handleDelete('a')} disabled={resolving}>
                    <Trash size={13} />
                    {t('dream.conflict.deleteThis')}
                  </button>
                  <button className="btn" style={{ flex: 1, justifyContent: 'center', color: 'var(--danger)' }} onClick={() => handleDelete('b')} disabled={resolving}>
                    <Trash size={13} />
                    {t('dream.conflict.deleteOther')}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function DreamMemoryDrawer({
  memory,
  projects,
  loading,
  locale,
  onClose,
  onOpenInList,
}: {
  memory: Memory | null;
  projects: Project[];
  loading: boolean;
  locale: string;
  onClose: () => void;
  onOpenInList?: () => void;
}) {
  const { t, layerLabel, memoryKindLabel } = useI18n();
  const project = memory?.projectId ? projects.find((item) => item.id === memory.projectId) : undefined;
  const kind = memory ? getMemoryKind(memory) : null;

  return (
    <>
      <button type="button" className="dream-preview-scrim" aria-label={t('common.close')} onClick={onClose} />
      <aside className="dream-preview-drawer" role="dialog" aria-modal="true" aria-label={t('detail.title')}>
        <div className="dream-preview-header">
          <div>
            <div className="dream-preview-eyebrow">{t('detail.title')}</div>
            <h3>{memory ? formatMemoryTitle(memory) : t('common.loading')}</h3>
          </div>
          <button className="btn" onClick={onClose} aria-label={t('common.close')}>
            <Close size={14} />
          </button>
        </div>

        {loading && (
          <div className="dream-preview-loading">
            <div className="animate-spin" style={{ width: 18, height: 18, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
            {t('common.loading')}
          </div>
        )}

        {memory && (
          <>
            <div className="dream-preview-meta">
              <span className="tag-pill" style={{ color: LAYER_COLORS[memory.layer], background: `${LAYER_COLORS[memory.layer]}18` }}>
                {layerLabel(memory.layer)}
              </span>
              <span className="tag-pill">{memoryKindLabel(kind)}</span>
              <span className="tag-pill">{project?.path ?? memory.projectId ?? '-'}</span>
            </div>

            <div className="dream-preview-facts">
              <span>{t('detail.updated')}: <strong>{formatDateTime(memory.updatedAt, locale)}</strong></span>
              <span>{t('detail.hits')}: <strong>{memory.hitCount}</strong></span>
              <span>{t('common.confidence')}: <strong>{Math.round(memory.confidence * 100)}%</strong></span>
            </div>

            <div className="dream-preview-quality">
              <MemoryQualityPanel memory={memory} compact />
            </div>

            {memory.tags && memory.tags.length > 0 && (
              <div className="dream-preview-tags">
                {memory.tags.slice(0, 12).map((tag) => (
                  <span key={tag} className="tag-pill">{tag}</span>
                ))}
              </div>
            )}

            <div className="dream-preview-body markdown-body">
              <MarkdownRenderer content={redactSensitiveText(memory.content)} />
            </div>

            {onOpenInList && (
              <div className="dream-preview-actions">
                <button className="btn" onClick={onOpenInList}>
                  <Eye size={13} />
                  {t('dream.openInList')}
                </button>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}

function AdvancedList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h5 style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-secondary)' }}>{title}</h5>
      <div style={{ display: 'grid', gap: 6 }}>
        {items.slice(0, 20).map((item, index) => (
          <div key={`${item}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-main)', padding: '8px 10px', fontSize: 12, color: 'var(--text-secondary)' }}>
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
