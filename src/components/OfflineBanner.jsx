import { useEffect, useState } from 'react'

// Small app-wide indicator shown when the browser goes offline, reassuring the
// user that saved information (cached by the service worker) is still available.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && navigator.onLine === false,
  )

  useEffect(() => {
    const goOnline = () => setOffline(false)
    const goOffline = () => setOffline(true)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  if (!offline) return null
  return (
    <div className="offline-banner" role="status">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M1 1l22 22M16.7 11.7A6 6 0 0 0 8 10M5 12.6a10 10 0 0 1 3-2M2 8.8a14 14 0 0 1 4-2.6M9 16a3 3 0 0 1 4 0M12 20h.01" />
      </svg>
      You’re offline — showing saved information.
    </div>
  )
}
