import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from './AuthContext.jsx'
import { useToast } from './ToastContext.jsx'
import { useLang } from './LanguageContext.jsx'

// Per-user notification inbox that powers the navbar bell. Mounted once at the
// app shell (like PresenceProvider) so the unread count and live pings survive
// route changes. Everything is read-only from the client — challenges and
// notifications are only ever written by SECURITY DEFINER RPCs/triggers.
const NotificationsContext = createContext({
  notifications: [],
  unreadCount: 0,
  markAllRead: () => {},
  refresh: () => {},
  createChallenge: async () => false,
  respondChallenge: async () => false,
})

// Embed the actor (who triggered it) and, for challenge pings, the live
// challenge status so the bell can show Accept/Decline only while pending.
const SELECT =
  '*, ' +
  'actor:profiles!notifications_actor_id_fkey(id,username,global_name,avatar_url), ' +
  'challenge:challenges!notifications_challenge_id_fkey(id,status,game_type,expires_at)'

// Friendly toast text for a freshly-arrived notification, by type.
function toastFor(t, type) {
  switch (type) {
    case 'challenge':
      return t('notif.toast.challenge')
    case 'challenge_accepted':
      return t('notif.toast.accepted')
    case 'challenge_declined':
      return t('notif.toast.declined')
    case 'your_turn':
      return t('notif.toast.yourTurn')
    default:
      return null
  }
}

export function NotificationsProvider({ children }) {
  const { profile } = useAuth()
  const myId = profile?.id
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useLang()

  const [notifications, setNotifications] = useState([])
  const unreadCount = notifications.reduce((n, x) => n + (x.read_at ? 0 : 1), 0)

  const fetchList = useCallback(async () => {
    if (!myId) return
    const { data } = await supabase
      .from('notifications')
      .select(SELECT)
      .eq('user_id', myId)
      .order('created_at', { ascending: false })
      .limit(30)
    if (data) setNotifications(data)
  }, [myId])

  // Subscribe to my own inbox. RLS scopes the stream to user_id = me, but we
  // keep the server-side filter too so the socket only ships rows we want.
  useEffect(() => {
    if (!myId) {
      setNotifications([])
      return
    }
    fetchList()

    let debounce
    const refresh = () => {
      clearTimeout(debounce)
      debounce = setTimeout(fetchList, 250)
    }

    const ch = supabase
      .channel(`notif:${myId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId}` },
        (payload) => {
          // Nudge the user immediately; refetch to hydrate actor/challenge joins.
          const msg = toastFor(t, payload.new?.type)
          if (msg) toast(msg, 'info')
          refresh()
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${myId}` },
        refresh,
      )
      .subscribe()

    // Safety-net poll + focus catch-up, mirroring the rest of the app.
    const interval = setInterval(() => {
      if (!document.hidden) fetchList()
    }, 20000)
    const onVisible = () => {
      if (!document.hidden) fetchList()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(debounce)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(ch)
    }
    // t/toast are stable; intentionally keyed on identity only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId, fetchList])

  const markAllRead = useCallback(async () => {
    if (!unreadCount) return
    // Optimistic — flip locally, then persist.
    const now = new Date().toISOString()
    setNotifications((list) => list.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    await supabase.rpc('mark_notifications_read', { p_ids: null })
  }, [unreadCount])

  const createChallenge = useCallback(
    async (toId, gameType) => {
      if (!toId || !gameType) return false
      const { error } = await supabase.rpc('create_challenge', { p_to: toId, p_game_type: gameType })
      if (error) {
        const key = `notif.err.${error.message}`
        const friendly = t(key)
        toast(friendly === key ? error.message : friendly, 'error')
        return false
      }
      toast(t('notif.toast.sent'), 'success')
      return true
    },
    [toast, t],
  )

  const respondChallenge = useCallback(
    async (challengeId, accept) => {
      const { data, error } = await supabase.rpc('respond_challenge', {
        p_challenge_id: challengeId,
        p_accept: accept,
      })
      if (error) {
        const key = `notif.err.${error.message}`
        const friendly = t(key)
        toast(friendly === key ? error.message : friendly, 'error')
        fetchList()
        return false
      }
      fetchList()
      if (accept && data?.match_id) navigate(`/play/${data.match_id}`)
      return true
    },
    [toast, t, navigate, fetchList],
  )

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, markAllRead, refresh: fetchList, createChallenge, respondChallenge }}
    >
      {children}
    </NotificationsContext.Provider>
  )
}

export function useNotifications() {
  return useContext(NotificationsContext)
}
