import { useEffect } from 'react'
import { supabase } from '../lib/supabaseClient.js'

// Server-authoritative presence heartbeat, shared by every room hook.
//
// Calls room_heartbeat() (migration 0015) on a coarse interval to record that
// this client is still alive. The server uses the recorded last_seen to:
//   * reap ghost players (is_present=false) when a tab crashes without leaving;
//   * decide the 1v1 reconnect-grace window for claim_timeout / match_grace_status.
//
// This runs ALONGSIDE Supabase Presence (which drives instant in-room UI). They
// answer different questions: presence = "is a socket attached right now",
// last_seen = "did this client check in within the grace window".
//
// Deliberately suppressed while the tab is hidden — a backgrounded tab going
// stale is CORRECT; that's what lets the server reap an abandoned room. A returning
// tab re-asserts liveness immediately (visibility/online), before the next beat and
// before any opponent's grace countdown can wrongly complete. Errors are swallowed:
// a missed heartbeat must never toast or eject a player. (supabase.rpc() is a
// thenable with no .catch — use .then(ok, err).)
const BEAT_MS = 20000

export function useHeartbeat(system, roomId, enabled = true) {
  useEffect(() => {
    if (!enabled || !roomId || !system) return undefined

    const beat = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      supabase.rpc('room_heartbeat', { p_system: system, p_room: roomId }).then(
        () => {},
        () => {},
      )
    }

    beat() // assert liveness immediately on mount
    const iv = setInterval(beat, BEAT_MS)
    const onVisible = () => { if (!document.hidden) beat() }
    const onOnline = () => beat()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    return () => {
      clearInterval(iv)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [system, roomId, enabled])
}
