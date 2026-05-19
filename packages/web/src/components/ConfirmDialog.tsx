import { useEffect, useRef } from 'react';
import { AlertTriangle } from './Icons';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onConfirm();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
    >
      <div
        className="fixed inset-0"
        style={{ 
          background: 'rgba(0, 0, 0, 0.35)', 
          backdropFilter: 'blur(8px)', 
          WebkitBackdropFilter: 'blur(8px)',
        }}
        onClick={onCancel}
      />
      <div
        className="relative rounded-2xl p-7 animate-scale-in"
        style={{
          background: 'rgba(255, 255, 255, 0.96)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.05), 0 0 0 1px rgba(255,255,255,0.5) inset',
          width: 340,
          maxWidth: 'calc(100vw - 48px)',
        }}
      >
        <div className="flex items-start gap-4">
          {danger && (
            <div
              className="shrink-0 rounded-xl p-2.5"
              style={{
                background: 'var(--danger-light)',
                color: 'var(--danger)',
              }}
            >
              <AlertTriangle size={20} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 
              id="confirm-title" 
              className="text-[15px] font-bold"
              style={{ 
                color: 'var(--text-primary)', 
                letterSpacing: '-0.02em',
                lineHeight: 1.4,
              }}
            >
              {title}
            </h3>
            <p 
              id="confirm-message" 
              className="mt-2 text-sm leading-relaxed"
              style={{ color: 'var(--text-secondary)' }}
            >
              {message}
            </p>
          </div>
        </div>
        
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="rounded-xl px-5 py-2.5 text-sm font-semibold"
            style={{
              color: 'var(--text-secondary)',
              background: 'var(--bg-muted)',
              transition: 'all var(--transition-fast)',
              border: '1px solid transparent',
            }}
            onMouseEnter={(e) => { 
              e.currentTarget.style.background = 'var(--bg-hover)'; 
              e.currentTarget.style.borderColor = 'var(--border)';
            }}
            onMouseLeave={(e) => { 
              e.currentTarget.style.background = 'var(--bg-muted)'; 
              e.currentTarget.style.borderColor = 'transparent';
            }}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="rounded-xl px-5 py-2.5 text-sm font-bold text-white"
            style={{
              background: danger 
                ? 'linear-gradient(135deg, #FF3B30 0%, #FF6B6B 100%)' 
                : 'linear-gradient(135deg, var(--accent) 0%, #0051D5 100%)',
              transition: 'all var(--transition-fast)',
              boxShadow: danger 
                ? '0 2px 8px var(--danger-glow)' 
                : '0 2px 8px var(--accent-glow)',
            }}
            onMouseEnter={(e) => { 
              e.currentTarget.style.transform = 'translateY(-1px)'; 
              e.currentTarget.style.boxShadow = danger 
                ? '0 4px 16px var(--danger-glow)' 
                : '0 4px 16px var(--accent-glow)';
            }}
            onMouseLeave={(e) => { 
              e.currentTarget.style.transform = 'translateY(0)'; 
              e.currentTarget.style.boxShadow = danger 
                ? '0 2px 8px var(--danger-glow)' 
                : '0 2px 8px var(--accent-glow)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(0) scale(0.98)';
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
