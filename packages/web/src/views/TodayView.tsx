/**
 * KM-404：Today 视图——"系统昨晚干了什么"。
 * Dream 报告卡片（促进/归档/合并计数）+ 每条可一键撤销（复用 rollbackDream），
 * pending todo 待确认队列；自治行为事后列出、可逆、显式（Part 5 原则②）。
 */
import { useEffect, useState } from 'react';
import type { DreamReport, DreamTodoItem } from '../lib/api';
import { listDreamReports, rollbackDream, getDreamTodos } from '../lib/api';
import { Card, Badge, EmptyState, DegradedBanner } from '../components/ui';
import { useI18n } from '../i18n';
import { userFacingDreamStatus } from '../lib/userFacing';

interface TodayViewProps {
  degradedPaths: string[];
  onToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** 嵌入其它页面（如智能整理）内嵌区块时去掉自身页边距 */
  embedded?: boolean;
}

export default function TodayView({ degradedPaths, onToast, embedded = false }: TodayViewProps) {
  const { language } = useI18n();
  const [reports, setReports] = useState<DreamReport[]>([]);
  const [todos, setTodos] = useState<DreamTodoItem[]>([]);
  const [rollingBack, setRollingBack] = useState<string | null>(null);

  const load = async () => {
    try {
      const [reportList, todoList] = await Promise.all([listDreamReports(10), getDreamTodos(50)]);
      setReports(reportList);
      setTodos(todoList.todos ?? []);
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  };

  useEffect(() => { void load(); }, []);

  const handleRollback = async (reportId: string) => {
    setRollingBack(reportId);
    try {
      await rollbackDream(reportId);
      onToast('已撤销该次自动整理', 'success');
      await load();
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setRollingBack(null);
    }
  };

  const latest = reports[0];

  return (
    <div style={{ display: 'grid', gap: 14, padding: embedded ? 0 : 20, maxWidth: 980 }}>
      <header>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 750, color: 'var(--text-primary)' }}>最近整理</h2>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
          查看 KeyMemory 最近自动整理了什么，以及哪些内容仍需要你确认。所有整理都可以撤销。
        </p>
      </header>

      <DegradedBanner paths={degradedPaths} />

      {latest ? (
        <Card
          title="最近一次自动整理"
          extra={
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Badge tone={latest.status === 'completed' ? 'good' : latest.status === 'failed' ? 'bad' : 'warn'}>{userFacingDreamStatus(latest.status, language)}</Badge>
              {(latest.status === 'completed' || latest.status === 'rolled_back') && latest.status === 'completed' && (
                <button className="btn" disabled={rollingBack === latest.id} onClick={() => void handleRollback(latest.id)}>
                  {rollingBack === latest.id ? '撤销中…' : '一键撤销'}
                </button>
              )}
            </div>
          }
        >
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-secondary)' }}>
            <span>扫描 <strong>{latest.totalCandidates}</strong></span>
            <span>促进 <strong style={{ color: 'var(--success)' }}>{latest.promoted}</strong></span>
            <span>归档 <strong>{latest.archived}</strong></span>
            <span>合并 <strong>{latest.merged}</strong></span>
            <span style={{ color: 'var(--text-muted)' }}>{new Date(latest.createdAt).toLocaleString()}</span>
          </div>
        </Card>
      ) : (
        <EmptyState title="还没有自动整理记录" hint="等待定时整理，或在记忆健康中手动检查" />
      )}

      <Card title={`待确认队列（${todos.length}）`}>
        {todos.length === 0 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>没有需要你确认的自治操作。</span>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
            {todos.map((todo, index) => (
              <li key={`${todo.memoryId}-${index}`} style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                <Badge tone={todo.type === 'conflict' ? 'warn' : 'neutral'}>
                  {todo.type === 'conflict' ? '冲突' : '孤儿'}
                </Badge>{' '}
                {todo.title} <span style={{ color: 'var(--text-muted)' }}>— {todo.description || todo.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="历史整理记录">
        {reports.length <= 1 ? (
          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>暂无更多记录。</span>
        ) : (
          <table style={{ width: '100%', fontSize: 12.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-muted)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>时间</th>
                <th style={{ padding: '4px 8px' }}>状态</th>
                <th style={{ padding: '4px 8px' }}>促进/归档/合并</th>
                <th style={{ padding: '4px 8px' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {reports.slice(1).map(report => (
                <tr key={report.id} style={{ borderTop: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                  <td style={{ padding: '6px 8px' }}>{new Date(report.createdAt).toLocaleString()}</td>
                  <td style={{ padding: '6px 8px' }}>{userFacingDreamStatus(report.status, language)}</td>
                  <td style={{ padding: '6px 8px' }}>{report.promoted} / {report.archived} / {report.merged}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {report.status === 'completed' && (
                      <button className="btn" disabled={rollingBack === report.id} onClick={() => void handleRollback(report.id)}>
                        {rollingBack === report.id ? '撤销中…' : '撤销'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
