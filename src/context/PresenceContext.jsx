import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from './AuthContext.jsx'

// Site-wide "who's online" presence. Mounted once at the app shell so the
// online roster survives route changes. Modeled on the presence block in
// src/hooks/useMatch.js, but keyed on the signed-in profile id instead of a
// match. A safe default keeps useOnline() inert (never throws) when there's
// no provider or nobody is signed in.
const PresenceContext = createContext({ onlineUsers: [], onlineCount: 0 })

export function PresenceProvider({ children }) {
  const { profile } = useAuth()
  const id = profile?.id
  const [users, setUsers] = useState([])

  useEffect(() => {
    // Inert until signed in. Clearing here also drops the roster on sign-out.
    if (!id) {
      setUsers([])
      return
    }

    // Snapshot the identity we broadcast to others.
    const meta = {
      id,
      username: profile.username,
      global_name: profile.global_name,
      avatar_url: profile.avatar_url,
      online_at: new Date().toISOString(),
    }

    // Presence is keyed by user id, so multiple tabs collapse to one entry and
    // presenceState() is already de-duped across the user's own connections.
    const ch = supabase.channel('online', { config: { presence: { key: id } } })

    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState()
      setUsers(Object.values(state).map((entries) => entries[0]).filter(Boolean))
    })

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') ch.track(meta)
    })

    // removeChannel untracks + unsubscribes; covers StrictMode double-mount,
    // route changes, and sign-out (when id flips to undefined).
    return () => {
      supabase.removeChannel(ch)
    }
    // Re-subscribe only when identity changes. Profile fields (name/avatar) are
    // stable within a session, so we intentionally omit them to avoid churning
    // the channel. NOTE: presence is started here — never inside AuthContext's
    // onAuthStateChange callback — to avoid the Supabase auth-lock deadlock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <PresenceContext.Provider value={{ onlineUsers: users, onlineCount: users.length }}>
      {children}
    </PresenceContext.Provider>
  )
}

export function useOnline() {
  return useContext(PresenceContext)
}
