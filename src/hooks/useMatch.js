import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useHeartbeat } from './useHeartbeat.js'

const SEL =
  '*, ' +
  'p1:profiles!matches_player1_fkey(id,username,global_name,avatar_url), ' +
  'p2:profiles!matches_player2_fkey(id,username,global_name,avatar_url)'

// Base cadence of the safety-net poll. Realtime is the primary transport; this
// catches anything it drops (missed event, degraded socket, expired token) so a
// turn-based game can never get permanently stuck on a stale board. While the
// socket is healthy we only actually reconcile every Nth tick (see HEARTBEAT).
const POLL_MS = 5000
// When realtime is 'live', reconcile this many ticks apart (5s * 3 = 15s) — a
// quiet heartbeat instead of hammering a full fetch every 5s during normal play.
const HEARTBEAT = 3

// Reject an out-of-order row that would move the game BACKWARD. Realtime events
// and the safety poll race each other, so a read begun before a move committed
// (or a late-delivered socket event) can resolve carrying an OLDER board than
// what's already on screen. Applied blindly it snaps the pieces back to an
// earlier position — the "pieces jump back to where they were" bug.
//
// move_count is the server's monotonic per-ply counter (chess-move /
// make_move both do move_count + 1), so a strictly-lower count is always
// stale. A terminal transition (finish/abandon) is never blocked, even if its
// count looks equal, so a game-ending update can always land.
function isStale(prev, next) {
  if (!prev || !next) return false
  const terminal = next.status === 'finished' || next.status === 'abandoned'
  const wasTerminal = prev.status === 'finished' || prev.status === 'abandoned'
  if (terminal && !wasTerminal) return false
  if (typeof prev.move_count === 'number' && typeof next.move_count === 'number')
    return next.move_count < prev.move_count
  return false
}

// Has anything the UI cares about actually changed? Move count + last_move_at
// move together on every move, so this also covers board_state without a deep
// compare. Lets the poll skip setState when the row is identical (no re-render).
function rowChanged(prev, next) {
  if (!prev) return true
  return (
    prev.status !== next.status ||
    prev.current_turn !== next.current_turn ||
    prev.last_move_at !== next.last_move_at ||
    prev.move_count !== next.move_count ||
    prev.winner !== next.winner ||
    prev.result !== next.result
  )
}

// The heart of real-time sync: subscribe to the match row, reconcile on
// (re)connect, poll as a fallback, and track presence so we know if the
// opponent is online.
export function useMatch(matchId) {
  const { profile } = useAuth()
  const myId = profile?.id

  // Tell the server we're here, so it can reap a ghost opponent and size the 1v1
  // reconnect-grace window. Runs beside Supabase Presence below.
  useHeartbeat('match', matchId, !!matchId && !!myId)

  const [match, setMatch] = useState(null)
  const [players, setPlayers] = useState({})
  const [online, setOnline] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // 'connecting' | 'live' | 'reconnecting' — drives the connection indicator.
  const [connState, setConnState] = useState('connecting')
  const playersRef = useRef({})
  const matchRef = useRef(null)
  // Mirror connState into a ref so the poll loop can read it without re-subscribing.
  const connRef = useRef('connecting')
  const setConn = useCallback((s) => {
    connRef.current = s
    setConnState(s)
  }, [])

  const cacheProfiles = useCallback((list) => {
    setPlayers((prev) => {
      const next = { ...prev }
      for (const p of list) if (p) next[p.id] = p
      playersRef.current = next
      return next
    })
  }, [])

  const fetchProfiles = useCallback(
    async (ids) => {
      const need = ids.filter((id) => id && !playersRef.current[id])
      if (!need.length) return
      const { data } = await supabase
        .from('profiles')
        .select('id,username,global_name,avatar_url')
        .in('id', need)
      if (data) cacheProfiles(data)
    },
    [cacheProfiles],
  )

  // Authoritative full fetch. `silent` is used by the background poll and
  // reconnect paths: a transient network blip during polling must never wipe
  // the board or flash an error screen, so silent fetches swallow failures.
  const fetchFull = useCallback(
    async ({ silent = false } = {}) => {
      const { data, error } = await supabase.from('matches').select(SEL).eq('id', matchId).maybeSingle()
      if (error) {
        if (!silent) {
          setError(error.message)
          setLoading(false)
        }
        return
      }
      if (!data) {
        if (!silent) {
          // Stable code (not a user-facing string) so the page can localize it.
          setError('not_found')
          setLoading(false)
        }
        return
      }
      cacheProfiles([data.p1, data.p2])
      // Drop a slow read that resolved AFTER newer state already landed (a
      // realtime move, or our own optimistic commit) — applying it would roll
      // the board backward. This is the core "pieces snap back" guard.
      if (matchRef.current && isStale(matchRef.current, data)) {
        if (!silent) setLoading(false)
        return
      }
      // Skip the state update when a background reconcile returns an identical
      // row — avoids a re-render (and any board repaint) every poll tick.
      if (matchRef.current && silent && !rowChanged(matchRef.current, data)) return
      matchRef.current = data
      setMatch(data)
      if (!silent) setLoading(false)
    },
    [matchId, cacheProfiles],
  )

  // Apply an authoritative row (from realtime or an RPC return) instantly.
  // Realtime/poll-driven calls are guarded so a stale, out-of-order row can't
  // roll the board back; the local action path (optimistic commit, authoritative
  // reconcile, rollback-on-reject) passes { force: true } because it's ordered
  // and a rollback intentionally restores an EARLIER move_count.
  const applyRow = useCallback(
    (row, { force = false } = {}) => {
      if (!row) return
      setMatch((prev) => {
        if (!force && isStale(prev, row)) return prev // drop out-of-order update
        const next = { ...(prev || {}), ...row }
        matchRef.current = next
        return next
      })
      fetchProfiles([row.player1, row.player2])
    },
    [fetchProfiles],
  )

  useEffect(() => {
    if (!matchId) return
    setLoading(true)
    setConn('connecting')
    matchRef.current = null
    fetchFull()

    const ch = supabase.channel(`match:${matchId}`, {
      config: { presence: { key: myId || 'anon' } },
    })

    ch.on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      (payload) => applyRow(payload.new),
    )
    ch.on('presence', { event: 'sync' }, () => setOnline(Object.keys(ch.presenceState())))

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConn('live')
        fetchFull({ silent: true }) // reconcile anything missed while connecting
        ch.track({ online_at: new Date().toISOString() })
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // supabase-js auto-rejoins; surface the gap and lean on the poll meanwhile.
        setConn('reconnecting')
      }
    })

    // Force an immediate reconcile (focus/online events) regardless of cadence.
    const reconcile = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const st = matchRef.current?.status
      if (st === 'finished' || st === 'abandoned') return
      fetchFull({ silent: true })
    }
    // Safety-net poll. When realtime is live we only reconcile on the heartbeat
    // (~15s) since the socket already delivers moves; when degraded we poll at
    // the full 5s cadence so a turn-based game never stalls on a stale board.
    let ticks = 0
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      const st = matchRef.current?.status
      if (st === 'finished' || st === 'abandoned') return
      ticks += 1
      if (connRef.current === 'live' && ticks % HEARTBEAT !== 0) return
      fetchFull({ silent: true })
    }
    const interval = setInterval(tick, POLL_MS)
    const onVisible = () => {
      if (!document.hidden) reconcile()
    }
    const onOnline = () => reconcile()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      supabase.removeChannel(ch)
    }
  }, [matchId, myId, fetchFull, applyRow, setConn])

  return { match, players, online, loading, error, connState, myId, applyRow, refetch: fetchFull, matchRef }
}
