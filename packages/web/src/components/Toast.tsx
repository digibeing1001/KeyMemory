import { useState, useCallback, useRef, createContext, useContext, type ReactNode } from 'react';
import { CheckCircle, XCircle, Info } from './Icons';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface ToastContextValue {
  toast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const TOAST_ICONS = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
};

const TOAST_COLORS = {
  success: {
    bg: 'rgba(48, 209, 88, 0.95)',
    glow: 'var(--success-glow)',
  },
  error: {
    bg: 'rgba(255, 59, 48, 0.95)',
    glow: 'var(--danger-glow)',
  },
  info: {
    bg: 'rgba(29, 29, 31, 0.92)',
    glow: 'rgba(0, 0, 0, 0.15)',
  },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++counterRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2.5">
        {toasts.map((t, index) => {
          const Icon = TOAST_ICONS[t.type];
          const colors = TOAST_COLORS[t.type];
          return (
            <div
              key={t.id}
              className="animate-slide-up flex items-center gap-2.5 rounded-2xl px-5 py-3 text-sm font-semibold"
              style={{
                background: colors.bg,
                color: '#fff',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: `0 4px 20px ${colors.glow}, 0 1px 3px rgba(0,0,0,0.1)`,
                letterSpacing: '-0.01em',
                animationDelay: `${index * 50}ms`,
                minWidth: 200,
              }}
            >
              <Icon size={16} />
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
