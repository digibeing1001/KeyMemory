import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { useI18n } from '../i18n';
import { Key } from '../components/Icons';
import { ApiRequestError, authStatus } from '../lib/api';

type Mode = 'login' | 'register';

export default function Login() {
  const { t, language } = useI18n();
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [hasUsers, setHasUsers] = useState<boolean | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const zh = language === 'zh';

  useEffect(() => {
    let cancelled = false;
    authStatus()
      .then(({ hasUsers: usersExist }) => {
        if (cancelled) return;
        setHasUsers(usersExist);
        setMode(usersExist ? 'login' : 'register');
      })
      .catch(() => {
        if (!cancelled) setHasUsers(null);
      })
      .finally(() => {
        if (!cancelled) setCheckingStatus(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const formatError = (err: unknown) => {
    if (!(err instanceof ApiRequestError)) {
      return (err as Error)?.message || (zh ? '操作失败，请稍后重试。' : 'Operation failed. Please try again.');
    }
    const messages: Record<string, [string, string]> = {
      AUTH_REQUIRED_FIELDS: ['请填写所有必填项。', 'Complete all required fields.'],
      AUTH_INVALID_EMAIL: ['请输入有效的邮箱地址。', 'Enter a valid email address.'],
      AUTH_PASSWORD_TOO_SHORT: ['密码至少需要 8 个字符。', 'Password must be at least 8 characters.'],
      AUTH_EMAIL_EXISTS: ['该邮箱已经注册，请直接登录。', 'An account with this email already exists. Log in instead.'],
      AUTH_INVALID_CREDENTIALS: ['邮箱或密码不正确。', 'Incorrect email or password.'],
      AUTH_REGISTRATION_FAILED: ['账户创建失败，请重试。', 'Unable to create the account. Please try again.'],
    };
    const localized = err.code ? messages[err.code] : undefined;
    return localized ? localized[zh ? 0 : 1] : err.message;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === 'register' && password.length < 8) {
      setError(zh ? '密码至少需要 8 个字符。' : 'Password must be at least 8 characters.');
      return;
    }
    if (mode === 'register' && password !== confirmPassword) {
      setError(zh ? '两次输入的密码不一致。' : 'Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register({ name: name.trim(), email: email.trim(), password });
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
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
          {checkingStatus
            ? (zh ? '正在准备...' : 'Getting ready...')
            : mode === 'login'
              ? (zh ? '登录' : 'Log in')
              : (zh ? '注册主账户' : 'Register main account')}
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--text-muted)' }}>
          {checkingStatus
            ? (zh ? '正在检查这台设备是否已有账户。' : 'Checking whether this device already has an account.')
            : mode === 'login'
            ? (zh ? '输入邮箱和密码登录你的账户。' : 'Enter your email and password to sign in.')
            : (zh ? '系统尚无用户，首个注册者将成为主账户（boss）。' : 'No users yet. The first registrant becomes the main account (boss).')}
        </p>

        {checkingStatus && (
          <div role="status" style={{ minHeight: 120, display: 'grid', placeItems: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
            {zh ? '正在检查账户状态...' : 'Checking account status...'}
          </div>
        )}

        <form onSubmit={handleSubmit} aria-hidden={checkingStatus} style={{ display: checkingStatus ? 'none' : 'grid', gap: 12 }}>
          {mode === 'register' && (
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)' }}>
                {zh ? '姓名' : 'Name'}
              </span>
              <input
                type="text"
                name="name"
                autoComplete="name"
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
              name="email"
              autoComplete="email"
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
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : undefined}
              aria-describedby={mode === 'register' ? 'password-help' : undefined}
              placeholder="••••••••"
              style={inputStyle}
            />
            {mode === 'register' && (
              <span id="password-help" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {zh ? '至少 8 个字符；这是新密码，不需要查找已保存密码。' : 'At least 8 characters. Create a new password here.'}
              </span>
            )}
          </label>

          {mode === 'register' && (
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 650, color: 'var(--text-secondary)' }}>
                {zh ? '确认密码' : 'Confirm password'}
              </span>
              <input
                type={showPassword ? 'text' : 'password'}
                name="confirmPassword"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="••••••••"
                style={inputStyle}
              />
            </label>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={showPassword}
              onChange={(e) => setShowPassword(e.target.checked)}
            />
            {zh ? '显示密码' : 'Show password'}
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
            disabled={submitting || !email.trim() || !password || (mode === 'register' && (!name.trim() || !confirmPassword))}
            style={{ width: '100%', justifyContent: 'center', padding: '9px 12px', fontSize: 13, marginTop: 4 }}
          >
            {submitting
              ? (zh ? '处理中...' : 'Processing...')
              : mode === 'login'
                ? (zh ? '登录' : 'Log in')
                : (zh ? '注册主账户' : 'Register main account')}
          </button>
        </form>

        <div style={{ display: checkingStatus ? 'none' : 'block', marginTop: 16, fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>
          {mode === 'login' && hasUsers !== true ? (
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
          ) : mode === 'register' && hasUsers !== false ? (
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
          ) : mode === 'login' ? (
            <span>{zh ? '需要添加新成员？请登录后由主账户或管理员创建。' : 'Need another member? Log in and ask the main account or an admin to create it.'}</span>
          ) : null}
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
