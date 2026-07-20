import { useState } from 'react';
import type { Memory, LoopRun, LoopRunStatus } from '@keymemory/shared';
import { useI18n } from '../i18n';
import { useWorkingSet } from '../hooks/useWorkingSet';
import { Activity, Clock, Plus, RefreshCw, Zap } from './Icons';
import {
  formatDate,
  formatMemoryTitle,
  formatRelativeTime,
  LAYER_COLORS,
  summarizeMemory,
} from '../lib/memoryFormat';

interface WorkingSetViewProps {
  onMemorySelect: (id: string) => void;
}

const LOOP_STATUS_COLOR: Record<LoopRunStatus, string> = {
  running: '#3b82f6',
  waiting: '#f59e0b',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: 'var(--text-muted)',
};

export default function WorkingSetView({ onMemorySelect }: WorkingSetViewProps) {
  const { t, language, layerLabel } = useI18n();
  const { recentHits, recentCreated, loopRuns, loading, refresh } = useWorkingSet();
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';
  const [wsFilter, setWsFilter] = useState<string>('');

  const filteredHits = wsFilter ? recentHits.filter(i => i.layer === wsFilter) : recentHits;
  const filteredCreated = wsFilter ? recentCreated.filter(i => i.layer === wsFilter) : recentCreated;

  return (
    <div className="flex-1 px-8 py-6">
      <div className="flex items-start justify-between mb-6">
        <div style={{ maxWidth: 640 }}>
          <h2 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>
            {t('workingSet.title')}
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '6px 0 0', lineHeight: 1.55 }}>
            {t('workingSet.subtitle')}
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={refresh}
          disabled={loading}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh')}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 12,
          marginBottom: 24,
        }}
      >
        <StatCard
          icon={<Zap size={16} />}
          color={LAYER_COLORS.short}
          count={recentHits.length}
          label={t('workingSet.statHits')}
          hint={t('workingSet.statHitsHint')}
        />
        <StatCard
          icon={<Plus size={16} />}
          color={LAYER_COLORS.flash}
          count={recentCreated.length}
          label={t('workingSet.statCreated')}
          hint={t('workingSet.statCreatedHint')}
        />
        <StatCard
          icon={<Activity size={16} />}
          color={LAYER_COLORS.long}
          count={loopRuns.length}
          label={t('workingSet.statLoops')}
          hint={t('workingSet.statLoopsHint')}
        />
      </div>

      <div className="mail-filter-panel" style={{ borderBottom: '1px solid var(--border-primary)', marginBottom: 16 }}>
        <div className="mail-filter-group">
          <label>{language === 'zh' ? '层级' : 'Layer'}</label>
          <div className="mail-filter-chips">
            {[
              ['', language === 'zh' ? '全部' : 'All'],
              ['flash', 'Flash'],
              ['short', language === 'zh' ? '短期' : 'Short'],
              ['long', language === 'zh' ? '长期' : 'Long'],
              ['entity', language === 'zh' ? '实体' : 'Entity']
            ].map(([val, label]) => (
              <button key={val} type="button"
                className={`mail-filter-chip${(wsFilter === val || (!val && !wsFilter)) ? ' is-active' : ''}`}
                onClick={() => setWsFilter(val as string)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filteredHits.length === 0 && filteredCreated.length === 0 && loopRuns.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <div className="empty-state-title">{language === 'zh' ? '工作集为空' : 'Working set is empty'}</div>
          <div className="empty-state-desc">{language === 'zh' ? '将需要频繁使用的记忆添加到工作集中，方便快速访问' : 'Add frequently used memories to your working set for quick access'}</div>
        </div>
      ) : (

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <Column
          title={t('workingSet.colHits')}
          subtitle={t('workingSet.colHitsSub')}
          emptyHint={t('workingSet.colHitsEmpty')}
        >
          {filteredHits.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              locale={locale}
              language={language}
              layerLabel={layerLabel(memory.layer)}
              onClick={() => onMemorySelect(memory.id)}
              timeLabel={memory.lastHitAt ? formatRelativeTime(memory.lastHitAt, language) : ''}
              timeLabelKind="hit"
            />
          ))}
        </Column>

        <Column
          title={t('workingSet.colCreated')}
          subtitle={t('workingSet.colCreatedSub')}
          emptyHint={t('workingSet.colCreatedEmpty')}
        >
          {filteredCreated.map((memory) => (
            <MemoryRow
              key={memory.id}
              memory={memory}
              locale={locale}
              language={language}
              layerLabel={layerLabel(memory.layer)}
              onClick={() => onMemorySelect(memory.id)}
              timeLabel={formatRelativeTime(memory.createdAt, language)}
              timeLabelKind="created"
            />
          ))}
        </Column>

        <Column
          title={t('workingSet.colLoops')}
          subtitle={t('workingSet.colLoopsSub')}
          emptyHint={t('workingSet.colLoopsEmpty')}
        >
          {loopRuns.map((run) => (
            <LoopRunRow key={run.id} run={run} language={language} />
          ))}
        </Column>
      </div>
      )}
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  color: string;
  count: number;
  label: string;
  hint: string;
}

function StatCard({ icon, color, count, label, hint }: StatCardProps) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 'var(--radius-md)',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 'var(--radius-sm)',
          background: `${color}1a`,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 22, fontWeight: 750, color: 'var(--text-primary)', lineHeight: 1.1 }}>
          {count}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, fontWeight: 600 }}>
          {label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hint}
        </div>
      </div>
    </div>
  );
}

interface ColumnProps {
  title: string;
  subtitle: string;
  emptyHint: string;
  children: React.ReactNode;
}

function Column({ title, subtitle, emptyHint, children }: ColumnProps) {
  const items = (children as React.ReactNode[] | null);
  const isEmpty = Array.isArray(items) ? items.length === 0 : !children;
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ marginBottom: 4 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{title}</h3>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0', lineHeight: 1.4 }}>{subtitle}</p>
      </div>
      {isEmpty ? (
        <div
          style={{
            padding: '24px 16px',
            borderRadius: 'var(--radius-md)',
            border: '1px dashed var(--border)',
            background: 'var(--bg-secondary)',
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: 12,
            lineHeight: 1.55,
          }}
        >
          {emptyHint}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

interface MemoryRowProps {
  memory: Memory;
  locale: string;
  language: 'zh' | 'en';
  layerLabel: string;
  onClick: () => void;
  timeLabel: string;
  timeLabelKind: 'hit' | 'created';
}

function MemoryRow({ memory, locale, language, layerLabel, onClick, timeLabel, timeLabelKind }: MemoryRowProps) {
  const layerColor = LAYER_COLORS[memory.layer];
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        width: '100%',
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        cursor: 'pointer',
        display: 'flex',
        gap: 10,
        alignItems: 'stretch',
      }}
    >
      <div style={{ width: 3, borderRadius: 2, background: layerColor, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span
            className="tag-pill"
            style={{ color: layerColor, background: `${layerColor}18`, fontSize: 10 }}
          >
            {layerLabel}
          </span>
          {memory.hitCount > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              · {t('workingSet.hitCount', { count: String(memory.hitCount) })}
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
            {timeLabel}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            marginBottom: 3,
          }}
        >
          {formatMemoryTitle(memory)}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            lineHeight: 1.45,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {summarizeMemory(memory, 110)}
        </div>
        {timeLabelKind === 'hit' && memory.lastHitAt && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('workingSet.lastHit')}: {formatDate(memory.lastHitAt, locale)}
          </div>
        )}
      </div>
    </button>
  );
}

function LoopRunRow({ run, language }: { run: LoopRun; language: 'zh' | 'en' }) {
  const { t } = useI18n();
  const statusColor = LOOP_STATUS_COLOR[run.status] ?? 'var(--text-muted)';
  const objective = run.objective || t('workingSet.noObjective');
  const projectLabel = run.projectPath || run.projectId || t('workingSet.noProject');
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        borderRadius: 'var(--radius-md)',
        padding: '12px 14px',
        display: 'flex',
        gap: 10,
      }}
    >
      <div style={{ width: 3, borderRadius: 2, background: statusColor, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span
            className="tag-pill"
            style={{ color: statusColor, background: `${statusColor}1a`, fontSize: 10 }}
          >
            {run.status}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            · {language === 'zh' ? `v${run.checkpointVersion}` : `v${run.checkpointVersion}`}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>
            {formatRelativeTime(run.updatedAt, language)}
          </span>
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 650,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            marginBottom: 3,
          }}
        >
          {objective}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
          <Clock size={10} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{projectLabel}</span>
        </div>
      </div>
    </div>
  );
}
