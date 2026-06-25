// Register the offline service worker — production builds only, so it never
// interferes with the Vite dev server's HMR. Failures are non-fatal: the app
// works exactly the same without it, just without offline support.
export function registerSW() {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
