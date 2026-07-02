import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useI18n } from '../i18n';
import { Key } from '../components/Icons';

type Mode = 'login' | 'register';

export default function Login() {
  const { t, language } = useI18n();
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zh = language === 'zh';

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register({ name: name.trim(), email: email.trim(), password });
      }
      navigate('/');
    } catch (err) {
      setError((err as Error).message || (zh ? '操作失败' : 'Operation failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  return (
    <div
      className="flex items-center justify-center"
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0) 240px), var(--bg-main)',
      }}
    >
      <div
        style={{
          width: 'min(420px, 92vw)',
          background: 'var(--surface-raised)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '28px 24px 22px',
          boxShadow: 'var(--shadow-panel)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md)',
              background: 'linear-gradient(180deg, var(--accent), var(--accent-hover))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              boxShadow: '0 4px 12px rgba(36, 121, 143, 0.28)',
            }}
          >
            <Key size={18} />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>
              KeyMemory
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              {zh ? '长期记忆系统' : 'Long-term memory system'}
            </p>
          </div>
        </div>

        <h2 style={{ margin: '20px 0 4px', fontSize: 16, fontWeight: 650, color: 'var(--text-primary)' }}>
          {mode === 'login' ? (zh ? '登录' : 'Log in') : (zh ? '注册主账户' : 'Register main account')}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          {mode === 'login'
            ? (zh ? '输入邮箱和密码登录你的账户。' : 'Enter your email and password to sign in.')
            : (zh ? '系统尚无用户，首个注册者将成为主账户（boss）。' : 'No users yet. The first registrant becomes the main account (boss).')}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12 }}>
          {mode === 'register' && (
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)' }}>
                {zh ? '姓名' : 'Name'}
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
                placeholder={zh ? '你的名字' : 'Your name'}
                style={inputStyle}
              />
            </label>
          )}

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)' }}>
              {zh ? '邮箱' : 'Email'}
            </span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus={mode === 'login'}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)' }}>
              {zh ? '密码' : 'Password'}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={inputStyle}
            />
          </label>

          {error && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--danger)',
                background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                border: '1px solid color-mix(in srgb, var(--danger) 32%, transparent)',
                borderRadius: 'var(--radius-md)',
                padding: '8px 10px',
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !email.trim() || !password.trim() || (mode === 'register' && !name.trim())}
            style={{ width: '100%', justifyContent: 'center', padding: '9px 12px', fontSize: 13, marginTop: 4 }}
          >
            {submitting
              ? (zh ? '处理中...' : 'Processing...')
              : mode === 'login'
                ? (zh ? '登录' : 'Log in')
                : (zh ? '注册主账户' : 'Register main account')}
          </button>
        </form>

        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          {mode === 'login' ? (
            <>
              {zh ? '首次使用？' : 'First time?'}{' '}
              <button
                type="button"
                onClick={() => switchMode('register')}
                style={linkButtonStyle}
              >
                {zh ? '注册主账户' : 'Register main account'}
              </button>
            </>
          ) : (
            <>
              {zh ? '已有账户？' : 'Have an account?'}{' '}
              <button
                type="button"
                onClick={() => switchMode('login')}
                style={linkButtonStyle}
              >
                {zh ? '返回登录' : 'Back to log in'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--surface-recessed)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-primary)',
  padding: '9px 11px',
  fontSize: 13,
};

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  color: 'var(--accent)',
  fontSize: 12,
  fontWeight: 650,
  cursor: 'pointer',
  textDecoration: 'underline',
};
