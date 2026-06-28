import { useCallback, useEffect, useState } from 'react'
import {
  PUSH_CONFIGURED,
  getPushState,
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from '../lib/push.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'

// Drives the PushToggle UI. `available` is the gate for showing the control at
// all: the app must be a VAPID-configured prod build, the browser must support
// push, and the user must be signed in (subscriptions are tied to a profile).
export function usePushNotifications() {
  const { session } = useAuth()
  const { lang } = useLang()
  const [state, setState] = useState({ supported: false, permission: 'default', subscribed: false })
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!PUSH_CONFIGURED) return
    setState(await getPushState())
  }, [])

  // Re-check whenever the signed-in user changes (e.g. after login).
  useEffect(() => {
    refresh()
  }, [refresh, session])

  // Returns true on success, otherwise the coded error string for a toast.
  const enable = useCallback(async () => {
    setBusy(true)
    try {
      await subscribeToPush(lang)
      await refresh()
      return true
    } catch (e) {
      await refresh()
      return e?.message || 'error'
    } finally {
      setBusy(false)
    }
  }, [lang, refresh])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      await unsubscribeFromPush()
      await refresh()
    } finally {
      setBusy(false)
    }
  }, [refresh])

  return {
    available: PUSH_CONFIGURED && isPushSupported() && !!session,
    permission: state.permission,
    subscribed: state.subscribed,
    busy,
    enable,
    disable,
  }
}
