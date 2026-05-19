import { useState, useEffect, useCallback } from 'react';
import { Moon, Play, Settings, Activity, Sparkles, RotateCcw, Clock, Zap, Brain, Eye } from './Icons';
import {
  listDreamReports,
  getDreamSignals,
  getSchedulerConfig,
  updateSchedulerConfig,
  runDream,
  rollbackDream,
} from '../lib/api';
import type { DreamReport, DreamSignalEntry, SchedulerConfig } from '../lib/api';
import { useToast } from './Toast';

const PHASE_CONFIG: Record<string, { label: string; icon: typeof Brain; color: string; bg: string; desc: string }> = {
  light: { label: '浅睡期', icon: Eye, color: '#F5A623', bg: 'rgba(245,166,35,0.08)', desc: '筛选与评分' },
  rem: { label: 'REM期', icon: Brain, color: '#7B61FF', bg: 'rgba(123,97,255,0.08)', desc: '关联与重组' },
  deep: { label: '深睡期', icon: Zap, color: '#34C759', bg: 'rgba(52,199,89,0.08)', desc: '归档与合并' },
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function cronToLabel(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const minute = parseInt(parts[0], 10);
  const hour = parseInt(parts[1], 10);
  return `每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export default function DreamView() {
  const { toast } = useToast();
  const [reports, setReports] = useState<DreamReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<DreamReport | null>(null);
  const [signals, setSignals] = useState<DreamSignalEntry[]>([]);
  const [config, setConfig] = useState<SchedulerConfig | null>(null);
  const [running, setRunning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingCron, setEditingCron] = useState(false);
  const [cronHour, setCronHour] = useState(3);
  const [cronMinute, setCronMinute] = useState(0);
  const [animatingCards, setAnimatingCards] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([listDreamReports(20), getSchedulerConfig()]);
      setReports(r);
      setConfig(c);
    } catch {
      toast('加载梦境数据失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleRunDream = useCallback(async () => {
    setRunning(true);
    try {
      const report = await runDream();
      toast(`梦境完成：${report.promoted} 条记忆升级`, 'success');
      fetchData();
      setSelectedReport(report);
    } catch {
      toast('梦境运行失败', 'error');
    } finally {
      setRunning(false);
    }
  }, [toast, fetchData]);

  const handleSelectReport = useCallback(async (report: DreamReport) => {
    setSelectedReport(report);
    setAnimatingCards(new Set([report.id]));
    setTimeout(() => setAnimatingCards(new Set()), 400);
    try {
      const s = await getDreamSignals(report.id);
      setSignals(s);
    } catch {
      setSignals([]);
    }
  }, []);

  const handleToggleDreaming = useCallback(async (enabled: boolean) => {
    if (!config) return;
    try {
      const updated = await updateSchedulerConfig({ dreamingEnabled: enabled });
      setConfig(updated);
      toast(enabled ? '梦境已开启' : '梦境已关闭', 'success');
    } catch {
      toast('更新失败', 'error');
    }
  }, [config, toast]);

  const handleSaveCron = useCallback(async () => {
    const newCron = `${cronMinute} ${cronHour} * * *`;
    try {
      const updated = await updateSchedulerConfig({ dreamingCron: newCron });
      setConfig(updated);
      setEditingCron(false);
      toast(`调度时间已更新为 ${String(cronHour).padStart(2, '0')}:${String(cronMinute).padStart(2, '0')}`, 'success');
    } catch {
      toast('更新调度时间失败', 'error');
    }
  }, [cronHour, cronMinute, toast]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
        <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
        加载中...
      </div>
    );
  }

  return (
    <div className="px-8 py-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#e0e6ed',
              boxShadow: '0 4px 16px rgba(15,52,96,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -10,
                right: -10,
                width: 28,
                height: 28,
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(245,166,35,0.4) 0%, transparent 70%)',
              }}
            />
            <Moon size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.02em' }}>
              梦境
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
              记忆自动整理与巩固 · Light → REM → Deep
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: '9px 16px',
              borderRadius: 'var(--radius-md)',
              border: '0.5px solid var(--border)',
              background: showSettings ? 'var(--bg-muted)' : 'var(--bg-card)',
              color: 'var(--text-secondary)',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all var(--transition-fast)',
            }}
            onMouseEnter={(e) => { if (!showSettings) e.currentTarget.style.background = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { if (!showSettings) e.currentTarget.style.background = 'var(--bg-card)'; }}
          >
            <Settings size={14} />
            设置
          </button>
          <button
            onClick={handleRunDream}
            disabled={running}
            style={{
              padding: '9px 18px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: running ? 'var(--bg-muted)' : 'linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)',
              color: running ? 'var(--text-tertiary)' : '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: running ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all var(--transition-fast)',
              boxShadow: running ? 'none' : '0 4px 14px rgba(15,52,96,0.25)',
            }}
            onMouseEnter={(e) => { if (!running) e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'translateY(0)'; }}
          >
            {running ? (
              <><div className="animate-spin w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" /> 运行中...</>
            ) : (
              <><Sparkles size={14} /> 立即运行</>
            )}
          </button>
        </div>
      </div>

      {/* Settings Panel */}
      {showSettings && config && (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '0.5px solid var(--border)',
            padding: 24,
            marginBottom: 28,
            boxShadow: 'var(--shadow-sm)',
            animation: 'slide-up 0.3s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 20px' }}>
            调度设置
          </h3>
          <div
            style={{
              padding: 18,
              borderRadius: 'var(--radius-md)',
              border: '0.5px solid var(--border)',
              background: 'var(--bg-main)',
              maxWidth: 420,
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Moon size={16} style={{ color: '#7B61FF' }} />
                自动梦境
              </span>
              <label style={{ position: 'relative', display: 'inline-block', width: 48, height: 26, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.dreamingEnabled}
                  onChange={(e) => handleToggleDreaming(e.target.checked)}
                  style={{ opacity: 0, width: 0, height: 0 }}
                />
                <span
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    borderRadius: 13,
                    background: config.dreamingEnabled ? '#7B61FF' : 'var(--bg-muted)',
                    transition: '0.25s',
                  }}
                >
                  <span
                    style={{
                      position: 'absolute',
                      width: 20, height: 20,
                      left: config.dreamingEnabled ? 26 : 3,
                      bottom: 3,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: '0.25s',
                      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                    }}
                  />
                </span>
              </label>
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {editingCron ? (
                <div className="flex items-center gap-2" style={{ marginTop: 4 }}>
                  <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={cronHour}
                    onChange={(e) => setCronHour(Math.max(0, Math.min(23, parseInt(e.target.value) || 0)))}
                    style={{ width: 52, padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, textAlign: 'center' }}
                  />
                  <span style={{ color: 'var(--text-tertiary)' }}>:</span>
                  <input
                    type="number"
                    min={0}
                    max={59}
                    value={cronMinute}
                    onChange={(e) => setCronMinute(Math.max(0, Math.min(59, parseInt(e.target.value) || 0)))}
                    style={{ width: 52, padding: '5px 8px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 500, textAlign: 'center' }}
                  />
                  <button
                    onClick={handleSaveCron}
                    style={{ padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: '#7B61FF', color: '#fff', fontSize: 12, fontWeight: 500, cursor: 'pointer', marginLeft: 4 }}
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setEditingCron(false)}
                    style={{ padding: '5px 12px', borderRadius: 'var(--radius-sm)', border: '0.5px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <span
                  onClick={() => {
                    if (config) {
                      const parts = config.dreamingCron.trim().split(/\s+/);
                      setCronMinute(parseInt(parts[0], 10) || 0);
                      setCronHour(parseInt(parts[1], 10) || 3);
                    }
                    setEditingCron(true);
                  }}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
                  <span style={{ borderBottom: '1px dashed var(--text-tertiary)' }}>
                    {cronToLabel(config.dreamingCron)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-tertiary)', marginLeft: 4 }}>点击修改</span>
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
              <RotateCcw size={12} />
              上次运行: {formatTime(config.lastDreamRun)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 10, opacity: 0.7, lineHeight: 1.5 }}>
              梦境包含评分升级、去重合并、归档过期等全部整理操作
            </div>
          </div>
        </div>
      )}

      {/* Selected Report Detail */}
      {selectedReport && (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '0.5px solid var(--border)',
            padding: 28,
            marginBottom: 28,
            boxShadow: 'var(--shadow-sm)',
            animation: 'slide-up 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)',
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                }}
              >
                <Sparkles size={16} />
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  梦境报告 #{selectedReport.id.slice(0, 8)}
                </h3>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
                  {formatTime(selectedReport.completedAt || selectedReport.createdAt)}
                  {selectedReport.durationMs ? ` · 耗时 ${formatDuration(selectedReport.durationMs)}` : ''}
                </p>
              </div>
            </div>
            <button
              onClick={() => setSelectedReport(null)}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                border: '0.5px solid var(--border)',
                background: 'var(--bg-main)',
                color: 'var(--text-secondary)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all var(--transition-fast)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--bg-main)'; }}
            >
              关闭
            </button>
          </div>

          {/* Phase Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 24 }}>
            {selectedReport.sessions.map((session, idx) => {
              const phaseInfo = PHASE_CONFIG[session.phase] || { label: session.phase, icon: Brain, color: '#86868B', bg: 'var(--bg-muted)', desc: '' };
              const PhaseIcon = phaseInfo.icon;
              return (
                <div
                  key={session.id}
                  style={{
                    padding: 18,
                    borderRadius: 'var(--radius-md)',
                    border: '0.5px solid var(--border)',
                    background: phaseInfo.bg,
                    transition: 'all var(--transition-fast)',
                    animation: `slide-up 0.4s cubic-bezier(0.25, 0.1, 0.25, 1) ${idx * 0.08}s both`,
                  }}
                >
                  <div className="flex items-center gap-2.5 mb-3">
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: phaseInfo.color,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#fff',
                      }}
                    >
                      <PhaseIcon size={16} />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {phaseInfo.label}
                      </div>
                      <div style={{ fontSize: 11, color: phaseInfo.color, fontWeight: 500 }}>
                        {phaseInfo.desc}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                    {session.summary || (
                      <span>
                        处理 <strong style={{ color: 'var(--text-primary)' }}>{session.candidatesProcessed}</strong> 条记忆，
                        <strong style={{ color: 'var(--success)' }}> {session.candidatesPromoted}</strong> 条提升
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Stats Bar */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '14px 18px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-main)',
              fontSize: 13,
              color: 'var(--text-secondary)',
              marginBottom: signals.length > 0 ? 20 : 0,
            }}
          >
            {[
              { label: '候选', value: selectedReport.totalCandidates, icon: '📊' },
              { label: '升级', value: selectedReport.promoted, icon: '⬆️', accent: true },
              { label: '归档', value: selectedReport.archived, icon: '📦' },
              { label: '合并', value: selectedReport.merged, icon: '🔗' },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: stat.accent ? 'rgba(52,199,89,0.08)' : 'transparent',
                  color: stat.accent ? 'var(--success)' : 'var(--text-secondary)',
                  fontWeight: stat.accent ? 600 : 500,
                }}
              >
                <span>{stat.icon}</span>
                <span>{stat.value} {stat.label}</span>
              </div>
            ))}
            <div style={{ flex: 1 }} />
            {selectedReport.status === 'completed' && (
              <button
                onClick={async () => {
                  try {
                    const result = await rollbackDream(selectedReport.id);
                    setSelectedReport(result);
                    toast('梦境已回滚，所有记忆已恢复', 'success');
                    fetchData();
                    try {
                      const s = await getDreamSignals(result.id);
                      setSignals(s);
                    } catch { /* ignore */ }
                  } catch {
                    toast('回滚失败', 'error');
                  }
                }}
                style={{
                  padding: '7px 14px',
                  borderRadius: 'var(--radius-sm)',
                  border: '0.5px solid rgba(255,59,48,0.25)',
                  background: 'rgba(255,59,48,0.05)',
                  color: '#FF3B30',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  transition: 'all var(--transition-fast)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,59,48,0.1)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,59,48,0.05)'; }}
              >
                <RotateCcw size={13} />
                回滚此梦境
              </button>
            )}
          </div>

          {/* Signals */}
          {signals.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={14} />
                评分信号
              </h4>
              <div style={{ display: 'grid', gap: 6 }}>
                {signals.slice(0, 10).map((sig, idx) => (
                  <div
                    key={sig.memoryId}
                    className="flex items-center justify-between"
                    style={{
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      background: sig.promoted ? 'rgba(52,199,89,0.06)' : 'var(--bg-main)',
                      border: sig.promoted ? '0.5px solid rgba(52,199,89,0.15)' : '0.5px solid var(--border)',
                      transition: 'all var(--transition-fast)',
                      animation: `slide-up 0.3s cubic-bezier(0.25, 0.1, 0.25, 1) ${idx * 0.04}s both`,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: sig.promoted ? '#fff' : 'var(--text-tertiary)',
                        background: sig.promoted ? 'var(--success)' : 'var(--bg-muted)',
                        padding: '2px 7px',
                        borderRadius: 10,
                        letterSpacing: '0.02em',
                      }}>
                        {sig.promoted ? 'UP' : '—'}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                        {sig.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-5" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>评分 <strong style={{ color: 'var(--text-secondary)' }}>{sig.score.toFixed(2)}</strong></span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>相关 <strong style={{ color: 'var(--text-secondary)' }}>{sig.signals.relevance.toFixed(2)}</strong></span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>频率 <strong style={{ color: 'var(--text-secondary)' }}>{sig.signals.frequency.toFixed(2)}</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History List */}
      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Clock size={15} style={{ color: 'var(--text-tertiary)' }} />
          历史梦境
        </h3>
        {reports.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center"
            style={{
              padding: 56,
              color: 'var(--text-tertiary)',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-lg)',
              border: '0.5px solid var(--border)',
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                background: 'var(--bg-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
              }}
            >
              <Moon size={28} style={{ opacity: 0.35 }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-secondary)' }}>暂无梦境记录</span>
            <span style={{ fontSize: 13, marginTop: 6, opacity: 0.6 }}>
              点击「立即运行」开始第一次梦境
            </span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {reports.map((report, idx) => {
              const isSelected = selectedReport?.id === report.id;
              const isAnimating = animatingCards.has(report.id);
              return (
                <div
                  key={report.id}
                  onClick={() => handleSelectReport(report)}
                  style={{
                    padding: '16px 20px',
                    borderRadius: 'var(--radius-md)',
                    border: isSelected ? '1px solid rgba(123,97,255,0.35)' : '0.5px solid var(--border)',
                    background: isSelected ? 'rgba(123,97,255,0.03)' : 'var(--bg-card)',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    animation: isAnimating ? 'slide-up 0.35s cubic-bezier(0.25, 0.1, 0.25, 1)' : undefined,
                    boxShadow: isSelected ? '0 2px 8px rgba(123,97,255,0.08)' : 'none',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--bg-hover)';
                      e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                      e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.background = 'var(--bg-card)';
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        background: report.status === 'completed'
                          ? 'linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%)'
                          : 'var(--bg-muted)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: report.status === 'completed' ? '#fff' : 'var(--text-tertiary)',
                        fontSize: 14,
                        flexShrink: 0,
                      }}
                    >
                      {report.status === 'completed' ? <Sparkles size={16} /> : <Activity size={16} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                        梦境 #{report.id.slice(0, 8)}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={11} />
                        {formatTime(report.completedAt || report.createdAt)}
                        {report.durationMs && (
                          <span style={{ marginLeft: 4 }}>· {formatDuration(report.durationMs)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-5" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--text-tertiary)' }}>候选 </span>
                      <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{report.totalCandidates}</strong>
                    </span>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--success)', fontWeight: 600 }}>
                      <span>升级 </span>
                      <strong>{report.promoted}</strong>
                    </span>
                    {report.status !== 'completed' && (
                      <span style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: 'var(--bg-muted)',
                        color: 'var(--text-tertiary)',
                        fontWeight: 500,
                      }}>
                        {report.status === 'running' ? '运行中' : '失败'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
