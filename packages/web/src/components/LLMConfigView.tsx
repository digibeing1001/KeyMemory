import { useEffect, useState } from 'react';
import type { LLMProviderConfig, LLMVerifyResult } from '@keymemory/shared';
import { LLM_PROVIDER_DEFAULTS } from '@keymemory/shared';
import { useI18n } from '../i18n';
import { useToast } from './Toast';
import {
  saveLLMConfig,
  clearLLMConfig,
  verifyLLMConnection,
  fetchLLMModels,
  getLLMStatus,
  getRelationReasoningStats,
  runRelationReasoning,
  type RelationReasoningStats,
} from '../lib/api';
import {
  Brain,
  RefreshCw,
  CheckCircle,
  XCircle,
  Key,
  Sparkles,
  Trash,
  Zap,
  Activity,
} from './Icons';

interface ConfigState {
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

const EMPTY_CONFIG: ConfigState = {
  baseUrl: LLM_PROVIDER_DEFAULTS.defaultBaseUrl,
  apiKey: '',
  model: '',
  enabled: false,
};

export default function LLMConfigView() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [config, setConfig] = useState<ConfigState>(EMPTY_CONFIG);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [savedConfig, setSavedConfig] = useState<LLMProviderConfig | null>(null);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyResult, setVerifyResult] = useState<LLMVerifyResult | null>(null);
  const [relationReasoningStats, setRelationReasoningStats] = useState<RelationReasoningStats | null>(null);
  const [runningRelationReasoning, setRunningRelationReasoning] = useState(false);

  async function loadConfig() {
    setLoading(true);
    try {
      const status = await getLLMStatus();
      setAvailable(status.available);
      if (status.config) {
        setSavedConfig(status.config);
        setConfig({
          baseUrl: status.config.baseUrl || LLM_PROVIDER_DEFAULTS.defaultBaseUrl,
          apiKey: '', // API key 出于安全考虑不回填
          model: status.config.model || '',
          enabled: status.config.enabled,
        });
        setAvailableModels(status.config.availableModels || []);
      }
    } catch (err) {
      toast(t('llm.loadFailed') + ': ' + (err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
    // 加载原子记忆之间的关联推理统计（不阻塞主配置加载）。
    // 具体工作的接力已经统一由共同邮箱承担，不再展示旧项目接龙入口。
    loadFeatureStats();
  }

  async function loadFeatureStats() {
    try {
      setRelationReasoningStats(await getRelationReasoningStats());
    } catch {
      // 静默失败，状态卡片不是核心功能
    }
  }

  async function handleRunRelationReasoning() {
    if (!available) {
      toast(t('llm.relationReasoningNoLlm'), 'info');
      return;
    }
    setRunningRelationReasoning(true);
    try {
      const report = await runRelationReasoning();
      if (report.skipped.length > 0) {
        toast(t('llm.relationReasoningSkipped', { count: report.skipped.length }), 'info');
      }
      toast(
        t('llm.relationReasoningSuccess', { scanned: report.scanned, relations: report.relationsCreated, ms: report.durationMs }),
        report.scanned > 0 ? 'success' : 'info'
      );
      await loadFeatureStats();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setRunningRelationReasoning(false);
    }
  }

  useEffect(() => {
    loadConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleTest() {
    if (!config.baseUrl.trim()) {
      toast(t('llm.baseUrlRequired'), 'error');
      return;
    }
    setTesting(true);
    setVerifyResult(null);
    try {
      const result = await verifyLLMConnection({
        baseUrl: config.baseUrl.trim(),
        apiKey: config.apiKey.trim(),
      });
      setVerifyResult(result);
      if (result.ok) {
        toast(t('llm.testSuccess', { count: result.models.length, ms: result.latencyMs ?? 0 }), 'success');
        if (result.models.length > 0) {
          setAvailableModels(result.models);
          // 如果当前 model 不在列表中，自动选第一个
          if (!config.model || !result.models.includes(config.model)) {
            setConfig((prev) => ({ ...prev, model: result.models[0] }));
          }
        }
      } else {
        toast(t('llm.testFailed') + ': ' + (result.error || 'unknown'), 'error');
      }
    } catch (err) {
      toast(t('llm.testFailed') + ': ' + (err as Error).message, 'error');
    } finally {
      setTesting(false);
    }
  }

  async function handleFetchModels() {
    if (!config.baseUrl.trim()) {
      toast(t('llm.baseUrlRequired'), 'error');
      return;
    }
    setFetchingModels(true);
    try {
      const result = await fetchLLMModels(config.baseUrl.trim(), config.apiKey.trim());
      setAvailableModels(result.models || []);
      if (result.models.length === 0) {
        toast(t('llm.noModels'), 'info');
      } else {
        toast(t('llm.modelsFetched', { count: result.models.length }), 'success');
        if (!config.model || !result.models.includes(config.model)) {
          setConfig((prev) => ({ ...prev, model: result.models[0] }));
        }
      }
    } catch (err) {
      toast(t('llm.fetchFailed') + ': ' + (err as Error).message, 'error');
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleSave() {
    if (!config.baseUrl.trim()) {
      toast(t('llm.baseUrlRequired'), 'error');
      return;
    }
    if (!config.model) {
      toast(t('llm.modelRequired'), 'error');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveLLMConfig({
        baseUrl: config.baseUrl.trim(),
        apiKey: config.apiKey.trim(),
        model: config.model,
        enabled: config.enabled,
      });
      setSavedConfig(saved);
      setAvailable(saved.enabled && !!saved.model);
      toast(t('llm.saved'), 'success');
    } catch (err) {
      toast(t('llm.saveFailed') + ': ' + (err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!confirm(t('llm.confirmClear'))) return;
    try {
      await clearLLMConfig();
      setConfig(EMPTY_CONFIG);
      setSavedConfig(null);
      setAvailable(false);
      setAvailableModels([]);
      setVerifyResult(null);
      toast(t('llm.cleared'), 'success');
    } catch (err) {
      toast(t('llm.clearFailed') + ': ' + (err as Error).message, 'error');
    }
  }

  if (loading) {
    return (
      <main className="llm-config-view app-page px-8 py-6" style={{ maxWidth: 880, width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-secondary)' }}>
          <span className="animate-spin" style={{ width: 18, height: 18, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
          {t('llm.loading')}
        </div>
      </main>
    );
  }

  return (
    <main className="llm-config-view app-page px-8 py-6" style={{ maxWidth: 880, width: '100%', boxSizing: 'border-box' }}>
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
            <Brain size={22} />
          </div>
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>
              {t('llm.title')}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '5px 0 0', lineHeight: 1.65, maxWidth: 560 }}>
              {t('llm.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={handleTest} disabled={testing}>
            {testing ? (
              <span className="animate-spin" style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
            ) : (
              <Zap size={14} />
            )}
            {testing ? t('llm.testing') : t('llm.test')}
          </button>
        </div>
      </header>

      {/* 状态条：让用户一眼看出"通了没通" */}
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
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: available ? 'var(--success)' : 'var(--danger)' }} />
          {t('llm.statusLabel')} {available ? t('llm.connected') : t('llm.disconnected')}
        </span>
        {savedConfig?.lastVerifiedAt && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            <CheckCircle size={13} />
            {t('llm.lastVerified')}: <strong style={{ color: 'var(--text-primary)' }}>{new Date(savedConfig.lastVerifiedAt).toLocaleString()}</strong>
          </span>
        )}
        {savedConfig?.model && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            <Sparkles size={13} />
            {t('llm.currentModel')}: <strong style={{ color: 'var(--text-primary)' }}>{savedConfig.model}</strong>
          </span>
        )}
        {verifyResult?.ok && verifyResult.latencyMs != null && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            {t('llm.latency')}: <strong style={{ color: 'var(--text-primary)' }}>{verifyResult.latencyMs}ms</strong>
          </span>
        )}
      </section>

      {/* 测试结果详情 */}
      {verifyResult && (
        <section
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--radius-lg)',
            border: `1px solid ${verifyResult.ok ? 'var(--success)' : 'var(--danger)'}`,
            padding: '14px 18px',
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {verifyResult.ok ? (
              <CheckCircle size={16} style={{ color: 'var(--success)' }} />
            ) : (
              <XCircle size={16} style={{ color: 'var(--danger)' }} />
            )}
            <strong style={{ color: verifyResult.ok ? 'var(--success)' : 'var(--danger)', fontSize: 14 }}>
              {verifyResult.ok ? t('llm.testSuccessShort') : t('llm.testFailedShort')}
            </strong>
          </div>
          {verifyResult.error && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace', background: 'var(--bg-primary)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', marginBottom: 8 }}>
              {verifyResult.error}
            </div>
          )}
          {verifyResult.ok && verifyResult.models.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('llm.availableModels')}: {verifyResult.models.slice(0, 8).join(', ')}
              {verifyResult.models.length > 8 ? ` ... (+${verifyResult.models.length - 8})` : ''}
            </div>
          )}
        </section>
      )}

      {/* 配置表单 */}
      <section
        style={{
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          padding: 20,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Base URL */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 6 }}>
              {t('llm.baseUrl')}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('llm.baseUrlHint')}</span>
            </label>
            <input
              type="text"
              value={config.baseUrl}
              onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
              placeholder={LLM_PROVIDER_DEFAULTS.defaultBaseUrl}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
          </div>

          {/* API Key */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 6 }}>
              <Key size={13} />
              {t('llm.apiKey')}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('llm.apiKeyHint')}</span>
            </label>
            <input
              type="password"
              value={config.apiKey}
              onChange={(e) => setConfig((prev) => ({ ...prev, apiKey: e.target.value }))}
              placeholder={savedConfig ? t('llm.apiKeyPlaceholderSaved') : t('llm.apiKeyPlaceholder')}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: 13,
                fontFamily: 'monospace',
              }}
            />
          </div>

          {/* Model 选择 + 拉取按钮 */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 650, color: 'var(--text-primary)', marginBottom: 6 }}>
              <Sparkles size={13} />
              {t('llm.model')}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                ({availableModels.length} {t('llm.modelsAvailable')})
              </span>
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={config.model}
                onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
                placeholder={t('llm.modelPlaceholder')}
                list="llm-model-options"
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: 13,
                  fontFamily: 'monospace',
                }}
              />
              <button className="btn" onClick={handleFetchModels} disabled={fetchingModels} title={t('llm.fetchModels')}>
                {fetchingModels ? (
                  <span className="animate-spin" style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
                ) : (
                  <RefreshCw size={14} />
                )}
                {t('llm.fetchModels')}
              </button>
            </div>
            <datalist id="llm-model-options">
              {availableModels.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>

          {/* Enabled 复选框 */}
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              color: 'var(--text-primary)',
              cursor: 'pointer',
              padding: '8px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
            }}
          >
            <input
              type="checkbox"
              checked={config.enabled}
              onChange={(e) => setConfig((prev) => ({ ...prev, enabled: e.target.checked }))}
              style={{ cursor: 'pointer' }}
            />
            <span style={{ fontWeight: 600 }}>{t('llm.enabled')}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('llm.enabledHint')}</span>
          </label>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 4 }}>
            <button
              onClick={handleClear}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--danger)',
                fontSize: 12,
                cursor: 'pointer',
                padding: '6px 8px',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Trash size={13} />
              {t('llm.clear')}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={handleTest} disabled={testing}>
                {testing ? (
                  <span className="animate-spin" style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
                ) : (
                  <Zap size={14} />
                )}
                {t('llm.test')}
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <span className="animate-spin" style={{ width: 13, height: 13, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
                ) : (
                  <CheckCircle size={14} />
                )}
                {t('llm.save')}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 说明区 */}
      <section
        style={{
          marginTop: 18,
          padding: '12px 16px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          fontSize: 12,
          color: 'var(--text-secondary)',
          lineHeight: 1.7,
        }}
      >
        <strong style={{ color: 'var(--text-primary)' }}>{t('llm.notesTitle')}</strong>
        <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
          <li>{t('llm.note1')}</li>
          <li>{t('llm.note2')}</li>
          <li>{t('llm.note3')}</li>
        </ul>
      </section>

      {/* 原子记忆保留关联推理；具体工作接力统一在共同邮箱中完成。 */}
      <section
        style={{
          marginTop: 18,
          padding: '16px 20px',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)',
          background: 'var(--bg-card)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <Activity size={16} style={{ color: 'var(--accent)' }} />
          <strong style={{ fontSize: 14, color: 'var(--text-primary)' }}>{t('llm.featuresTitle')}</strong>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
          {/* 关联推理 */}
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              background: 'var(--bg-primary)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 650, color: 'var(--text-primary)' }}>{t('llm.relationReasoningTitle')}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.5 }}>{t('llm.relationReasoningDesc')}</div>
              </div>
              <button
                className="btn btn-primary"
                onClick={handleRunRelationReasoning}
                disabled={runningRelationReasoning || !available}
                title={available ? '' : t('llm.relationReasoningNoLlm')}
                style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
              >
                {runningRelationReasoning ? (
                  <span className="animate-spin" style={{ width: 11, height: 11, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%' }} />
                ) : (
                  <Zap size={11} />
                )}
                {runningRelationReasoning ? t('llm.relationReasoningRunning') : t('llm.relationReasoningRun')}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>{t('llm.relationReasoningScanned')}: <strong style={{ color: 'var(--text-primary)' }}>{relationReasoningStats?.totalScanned ?? 0}</strong></span>
              <span>{t('llm.relationReasoningRelations')}: <strong style={{ color: 'var(--text-primary)' }}>{relationReasoningStats?.totalRelations ?? 0}</strong></span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('llm.relationReasoningLastScan')}: {relationReasoningStats?.lastScanAt ? new Date(relationReasoningStats.lastScanAt).toLocaleString() : t('llm.relationReasoningNever')}
            </div>
          </div>

        </div>
      </section>
    </main>
  );
}
