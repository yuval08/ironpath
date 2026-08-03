import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

/** Bottom sheet — thumb-friendly modal for one-handed use. */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <div className="card-title">
          <h2>{title}</h2>
          <button className="btn ghost small icon" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'btn danger block',
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  return (
    <button
      className={className}
      onClick={() => {
        if (window.confirm(confirmLabel)) onConfirm();
      }}
    >
      {label}
    </button>
  );
}
