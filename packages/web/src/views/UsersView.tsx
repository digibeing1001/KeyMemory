import { useEffect, useState } from 'react';
import { listUsers, updateUserRole, type ListedUser, type UserRole } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';

const ALL_ROLES: UserRole[] = ['boss', 'exec', 'pm', 'member', 'admin'];

const ROLE_LABEL_ZH: Record<UserRole, string> = {
  boss: '主账户',
  exec: '主管',
  pm: '项目经理',
  member: '成员',
  admin: '管理员',
};

const ROLE_LABEL_EN: Record<UserRole, string> = {
  boss: 'Boss',
  exec: 'Exec',
  pm: 'PM',
  member: 'Member',
  admin: 'Admin',
};

export default function UsersView() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const { language } = useI18n();
  const zh = language === 'zh';
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listUsers()
      .then((res) => {
        if (!cancelled) setUsers(res.users);
      })
      .catch((err) => {
        if (!cancelled) toast(zh ? `加载用户失败: ${err.message}` : `Failed to load users: ${err.message}`, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast, zh]);

  const handleRoleChange = async (id: string, role: UserRole) => {
    setUpdatingId(id);
    try {
      const res = await updateUserRole(id, role);
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...res.user } : u)));
      toast(zh ? '已更新角色' : 'Role updated', 'success');
    } catch (err) {
      toast(zh ? `更新失败: ${(err as Error).message}` : `Update failed: ${(err as Error).message}`, 'error');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-8 py-6">
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 24, fontWeight: 750, color: 'var(--text-primary)', margin: 0 }}>
          {zh ? '用户管理' : 'User management'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', margin: '4px 0 0' }}>
          {zh ? '查看所有用户并调整角色。只有 boss/admin 可以访问。' : 'View all users and adjust roles. Only boss/admin can access.'}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-tertiary)' }}>
          <div className="animate-spin w-5 h-5 border-2 border-current border-t-transparent rounded-full mr-2" />
          {zh ? '加载中...' : 'Loading...'}
        </div>
      ) : users.length === 0 ? (
        <div
          className="empty-state"
          style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', padding: 56 }}
        >
          <span style={{ fontSize: 15, fontWeight: 650, color: 'var(--text-secondary)' }}>
            {zh ? '暂无用户' : 'No users'}
          </span>
        </div>
      ) : (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--surface-raised)',
            overflow: 'hidden',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--surface-soft)', borderBottom: '1px solid var(--border)' }}>
                <th style={thStyle}>{zh ? '姓名' : 'Name'}</th>
                <th style={thStyle}>{zh ? '邮箱' : 'Email'}</th>
                <th style={thStyle}>{zh ? '角色' : 'Role'}</th>
                <th style={thStyle}>{zh ? '主账户' : 'Main account'}</th>
                <th style={thStyle}>{zh ? '状态' : 'Status'}</th>
                <th style={thStyle}>{zh ? '操作' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => {
                const isSelf = currentUser?.id === u.id;
                const roleLabel = zh ? ROLE_LABEL_ZH[u.role] : ROLE_LABEL_EN[u.role];
                return (
                  <tr
                    key={u.id}
                    style={{
                      borderBottom: idx === users.length - 1 ? 'none' : '1px solid var(--border-light)',
                    }}
                  >
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 650, color: 'var(--text-primary)' }}>
                        {u.name}
                        {isSelf && (
                          <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--accent)' }}>
                            ({zh ? '你' : 'you'})
                          </span>
                        )}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--text-secondary)' }}>{u.email}</td>
                    <td style={tdStyle}>
                      <span
                        className="tag-pill"
                        style={{
                          color: 'var(--accent)',
                          background: 'var(--accent-soft)',
                          borderColor: 'color-mix(in srgb, var(--accent) 24%, transparent)',
                        }}
                      >
                        {roleLabel}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: u.isMainAccount ? 'var(--success)' : 'var(--text-muted)' }}>
                        {u.isMainAccount ? (zh ? '是' : 'Yes') : (zh ? '否' : 'No')}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <span style={{ color: u.userStatus === 'active' ? 'var(--success)' : 'var(--warning)' }}>
                        {u.userStatus}
                      </span>
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={u.role}
                        disabled={updatingId === u.id || u.isMainAccount}
                        onChange={(e) => handleRoleChange(u.id, e.target.value as UserRole)}
                        style={{
                          padding: '4px 8px',
                          borderRadius: 'var(--radius-sm)',
                          border: '1px solid var(--border)',
                          background: 'var(--surface-recessed)',
                          color: 'var(--text-primary)',
                          fontSize: 12,
                          cursor: updatingId === u.id || u.isMainAccount ? 'not-allowed' : 'pointer',
                          opacity: u.isMainAccount ? 0.6 : 1,
                        }}
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>
                            {zh ? ROLE_LABEL_ZH[r] : ROLE_LABEL_EN[r]}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--text-muted)',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 14px',
  fontSize: 13,
  color: 'var(--text-primary)',
};
