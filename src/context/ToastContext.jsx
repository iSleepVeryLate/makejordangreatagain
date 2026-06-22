import { createContext, useContext, useState, useCallback, useRef } from 'react'
import Toaster from '../components/Toaster.jsx'

const ToastContext = createContext(null)

let idSeq = 0

// Tiny app-wide toast bus. `toast(message, 'success' | 'error' | 'info')` or
// `toast(message, { variant, ttl })`. Auto-dismisses; rendered through a single
// aria-live region so screen readers announce every notification.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef({})

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    if (timers.current[id]) {
      clearTimeout(timers.current[id])
      delete timers.current[id]
    }
  }, [])

  const toast = useCallback(
    (message, opts = {}) => {
      if (!message) return
      const variant = typeof opts === 'string' ? opts : opts.variant || 'info'
      const ttl = (typeof opts === 'object' && opts.ttl) || 3400
      const id = ++idSeq
      setToasts((list) => [...list, { id, message, variant }])
      timers.current[id] = setTimeout(() => dismiss(id), ttl)
      return id
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <Toaster toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

// Returns a stable `toast` fn. Safe to call even outside a provider (no-op).
export function useToast() {
  return useContext(ToastContext) || noop
}

function noop() {}
