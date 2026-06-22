import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'

const ICONS = { success: CheckCircle2, error: AlertCircle, info: Info }

// Stacked, auto-dismissing notifications. The container is a polite live region
// so each toast is announced; individual toasts are status messages.
export default function Toaster({ toasts, dismiss }) {
  return (
    <div className="toaster" role="region" aria-live="polite" aria-label="Notifications">
      {toasts.map((t) => {
        const Icon = ICONS[t.variant] || Info
        return (
          <div key={t.id} className={`toast ${t.variant}`} role="status">
            <Icon size={18} className="toast-ic" aria-hidden="true" />
            <span className="toast-msg">{t.message}</span>
            <button className="toast-x" onClick={() => dismiss(t.id)} aria-label="Dismiss notification">
              <X size={15} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
