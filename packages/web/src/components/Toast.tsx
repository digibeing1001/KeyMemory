import { useState, useCallback, useRef, createContext, useContext, type ReactNode } from 'react';

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

const TOAST_COLORS = {
  success: { bg: '#4dab7a', border: '#3d8b62' },
  error: { bg: '#e15759', border: '#c44547' },
  info: { bg: '#37352f', border: '#2d2b27' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const toast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = ++counterRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {toasts.map((t) => {
          const colors = TOAST_COLORS[t.type];
          return (
            <div
              key={t.id}
              className="animate-fade-in px-4 py-2.5 text-sm font-medium"
              style={{
                background: colors.bg,
                color: '#fff',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${colors.border}`,
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                minWidth: 160,
              }}
            >
              {t.message}
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
