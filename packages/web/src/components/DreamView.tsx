import { useState, useEffect, useCallback } from 'react';
import { Moon, Play, Settings, Activity } from './Icons';
import {
  listDreamReports,
  getDreamSignals,
  getSchedulerConfig,
  updateSchedulerConfig,
  runDream,
} from '../lib/api';
import type { DreamReport, DreamSignalEntry, SchedulerConfig } from '../lib/api';
import { useToast } from './Toast';

const PHASE_LABELS: Record<string, { label: string; icon: string }> = {
  light: { label: '浅睡', icon: '☀️' },
  rem: { label: 'REM', icon: '👁️' },
  deep: { label: '深睡', icon: '🌑' },
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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

  const handleToggleConsolidation = useCallback(async (enabled: boolean) => {
    if (!config) return;
    try {
      const updated = await updateSchedulerConfig({ consolidationEnabled: enabled });
      setConfig(updated);
      toast(enabled ? '整理已开启' : '整理已关闭', 'success');
    } catch {
      toast('更新失败', 'error');
    }
  }, [config, toast]);

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
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}
          >
            <Moon size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>梦境</h2>
            <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '2px 0 0' }}>
              记忆自动整理与巩固 · Light → REM → Deep
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowSettings(!showSettings)}
            style={{
              padding: '8px 14px',
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
            }}
          >
            <Settings size={14} />
            设置
          </button>
          <button
            onClick={handleRunDream}
            disabled={running}
            style={{
              padding: '8px 16px',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: running ? 'var(--bg-muted)' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: running ? 'var(--text-tertiary)' : '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: running ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {running ? (
              <><div className="animate-spin w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full" /> 运行中...</>
            ) : (
              <><Play size={14} /> 立即运行</>
            )}
          </button>
        </div>
      </div>

      {showSettings && config && (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '0.5px solid var(--border)',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 20px' }}>
            调度设置
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--border)',
                background: 'var(--bg-main)',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                  🌙 梦境整理
                </span>
                <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24 }}>
                  <input
                    type="checkbox"
                    checked={config.dreamingEnabled}
                    onChange={(e) => handleToggleDreaming(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0, left: 0, right: 0, bottom: 0,
                      borderRadius: 12,
                      background: config.dreamingEnabled ? 'var(--accent)' : 'var(--bg-muted)',
                      transition: '0.2s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        width: 18, height: 18,
                        left: config.dreamingEnabled ? 23 : 3,
                        bottom: 3,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: '0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}
                    />
                  </span>
                </label>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                调度: {cronToLabel(config.dreamingCron)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                上次运行: {formatTime(config.lastDreamRun)}
              </div>
            </div>

            <div
              style={{
                padding: 16,
                borderRadius: 'var(--radius-md)',
                border: '0.5px solid var(--border)',
                background: 'var(--bg-main)',
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                  📋 记忆整理
                </span>
                <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24 }}>
                  <input
                    type="checkbox"
                    checked={config.consolidationEnabled}
                    onChange={(e) => handleToggleConsolidation(e.target.checked)}
                    style={{ opacity: 0, width: 0, height: 0 }}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      cursor: 'pointer',
                      top: 0, left: 0, right: 0, bottom: 0,
                      borderRadius: 12,
                      background: config.consolidationEnabled ? 'var(--accent)' : 'var(--bg-muted)',
                      transition: '0.2s',
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        width: 18, height: 18,
                        left: config.consolidationEnabled ? 23 : 3,
                        bottom: 3,
                        borderRadius: '50%',
                        background: '#fff',
                        transition: '0.2s',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                      }}
                    />
                  </span>
                </label>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>
                调度: {cronToLabel(config.consolidationCron)}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 4 }}>
                上次运行: {formatTime(config.lastConsolidationRun)}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedReport && (
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: '0.5px solid var(--border)',
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div className="flex items-center justify-between mb-4">
            <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              梦境报告 #{selectedReport.id.slice(0, 8)}
            </h3>
            <button
              onClick={() => setSelectedReport(null)}
              style={{
                fontSize: 12,
                color: 'var(--accent)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              关闭
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {selectedReport.sessions.map((session) => {
              const phaseInfo = PHASE_LABELS[session.phase] || { label: session.phase, icon: '❓' };
              return (
                <div
                  key={session.id}
                  style={{
                    padding: 14,
                    borderRadius: 'var(--radius-md)',
                    border: '0.5px solid var(--border)',
                    background: 'var(--bg-main)',
                  }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span style={{ fontSize: 18 }}>{phaseInfo.icon}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {phaseInfo.label}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
                    {session.summary || `${session.candidatesProcessed} 条处理，${session.candidatesPromoted} 条提升`}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="flex items-center gap-6"
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-main)',
              fontSize: 13,
              color: 'var(--text-secondary)',
            }}
          >
            <span>📊 候选: {selectedReport.totalCandidates}</span>
            <span>⬆️ 升级: {selectedReport.promoted}</span>
            <span>📦 归档: {selectedReport.archived}</span>
            <span>🔗 合并: {selectedReport.merged}</span>
          </div>

          {signals.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>
                评分信号
              </h4>
              <div style={{ display: 'grid', gap: 8 }}>
                {signals.slice(0, 10).map((sig) => (
                  <div
                    key={sig.memoryId}
                    className="flex items-center justify-between"
                    style={{
                      padding: '8px 12px',
                      borderRadius: 'var(--radius-sm)',
                      background: sig.promoted ? 'rgba(52,199,89,0.08)' : 'var(--bg-main)',
                      border: sig.promoted ? '0.5px solid rgba(52,199,89,0.2)' : '0.5px solid var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <span style={{ fontSize: 11, color: sig.promoted ? 'var(--success)' : 'var(--text-tertiary)' }}>
                        {sig.promoted ? '✅' : '⏳'}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                        {sig.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-4" style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      <span>评分 {sig.score.toFixed(2)}</span>
                      <span>相关 {sig.signals.relevance.toFixed(2)}</span>
                      <span>频率 {sig.signals.frequency.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div>
        <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 16 }}>
          历史梦境
        </h3>
        {reports.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center"
            style={{ padding: 48, color: 'var(--text-tertiary)' }}
          >
            <Moon size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
            <span style={{ fontSize: 14 }}>暂无梦境记录</span>
            <span style={{ fontSize: 12, marginTop: 4, opacity: 0.6 }}>
              点击「立即运行」开始第一次梦境
            </span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {reports.map((report) => (
              <div
                key={report.id}
                onClick={() => handleSelectReport(report)}
                className="flex items-center justify-between"
                style={{
                  padding: '14px 18px',
                  borderRadius: 'var(--radius-md)',
                  border: selectedReport?.id === report.id ? '1px solid var(--accent)' : '0.5px solid var(--border)',
                  background: selectedReport?.id === report.id ? 'rgba(0,122,255,0.04)' : 'var(--bg-card)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div className="flex items-center gap-4">
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 8,
                      background: report.status === 'completed'
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                        : 'var(--bg-muted)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: report.status === 'completed' ? '#fff' : 'var(--text-tertiary)',
                      fontSize: 14,
                    }}
                  >
                    <Activity size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                      梦境 #{report.id.slice(0, 8)}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>
                      {formatTime(report.completedAt || report.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-5" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  <span>📊 {report.totalCandidates} 候选</span>
                  <span style={{ color: 'var(--success)' }}>⬆️ {report.promoted} 升级</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
