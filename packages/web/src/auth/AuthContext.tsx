import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  authLogin,
  authLogout,
  authMe,
  authRegister,
  clearUserToken,
  getUserToken,
  setUserToken,
  type AuthUser,
  type UserRole,
} from '../lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: { name: string; email: string; password: string; role?: UserRole }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(() => getUserToken() || null);
  const [loading, setLoading] = useState<boolean>(() => !!getUserToken());
  const navigate = useNavigate();

  // 启动时如果有 token，调 /api/auth/me 恢复会话
  useEffect(() => {
    const stored = getUserToken();
    if (!stored) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    authMe()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setToken(stored);
      })
      .catch(() => {
        if (cancelled) return;
        // token 失效，清掉
        clearUserToken();
        setUser(null);
        setToken(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async (email: string, password: string) => {
    const res = await authLogin(email, password);
    setUserToken(res.token);
    setUser(res.user);
    setToken(res.token);
  };

  const register = async (input: { name: string; email: string; password: string; role?: UserRole }) => {
    const res = await authRegister(input);
    setUserToken(res.token);
    setUser(res.user);
    setToken(res.token);
  };

  const logout = async () => {
    try {
      await authLogout();
    } catch {
      // ignore network errors on logout
    }
    clearUserToken();
    setUser(null);
    setToken(null);
    navigate('/login');
  };

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, loading, login, register, logout }),
    [user, token, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
