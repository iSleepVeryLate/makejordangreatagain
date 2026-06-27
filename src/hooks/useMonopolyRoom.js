import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'

// Real-time sync for a Jordan Monopoly room. Mirrors useDrawRoom.js's transport
// (row subscriptions + presence + a safety-net poll) for an N-player room, and
// adds the three things this game needs:
//
//   1. THREE postgres_changes subscriptions — monopoly_rooms (the state machine),
//      monopoly_players (cash/position/jail), and monopoly_properties (ownership).
//      Player/property bursts are coalesced (250ms) so one action that touches
//      several rows triggers a single refetch.
//
//   2. A MONOTONIC seq reconcile: every authoritative write bumps rooms.seq, so we
//      drop any incoming room row whose seq is older than what we already have.
//      This kills flicker/rollback when realtime or the poll delivers out of order
//      (the acting client has already applied the newer snapshot locally).
//
//   3. A SINGLE-PUMPER timer driver: a 1s tick fires the deadline 'tick' action,
//      but only from ONE client (the current player if present, else the lowest-
//      seat present member) so a full table doesn't stampede the Edge Function.
//      A small jittered backstop covers the pumper disconnecting.

const PLAYER_SEL = '*, profile:profiles(id,username,global_name,avatar_url)'
const POLL_MS = 4000
const HEARTBEAT = 3 // when 'live', only reconcile every 3rd tick (~12s)

export function useMonopolyRoom(roomId) {
  const { profile } = useAuth()
  const myId = profile?.id

  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [properties, setProperties] = useState([])
  const [online, setOnline] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connState, setConnState] = useState('connecting')
  const [rollingBy, setRollingBy] = useState(null) // ephemeral "X is rolling…" presence

  const roomRef = useRef(null)
  const playersRef = useRef([])
  const onlineRef = useRef([])
  const connRef = useRef('connecting')
  const channelRef = useRef(null) // for ephemeral broadcasts (roll-start)
  const rollClearRef = useRef(null) // safety timer that clears a stuck "rolling…"
  const advancedForRef = useRef(null) // phase_ends_at we've already pumped
  const pickSeqRef = useRef(0) // monotonic id of the latest token pick
  const pendingTokenRef = useRef(null) // optimistic token held until the server echoes it

  // Re-apply the optimistically-chosen token on top of any incoming player
  // snapshot (realtime echo, debounced refetch, or the 4s poll) so a write that
  // hasn't propagated yet can't momentarily revert my pick. Clears itself once
  // the authoritative snapshot already carries the chosen token.
  const withPending = useCallback((rows) => {
    const pend = pendingTokenRef.current
    if (!pend || !myId || !Array.isArray(rows)) return rows
    const mine = rows.find((r) => r.profile_id === myId)
    if (mine && mine.token === pend) { pendingTokenRef.current = null; return rows }
    return rows.map((r) => (r.profile_id === myId ? { ...r, token: pend } : r))
  }, [myId])

  const setConn = useCallback((s) => {
    connRef.current = s
    setConnState(s)
  }, [])

  // Monotonic merge: ignore stale rows (older seq) so we never roll back.
  const applyRoom = useCallback((row) => {
    if (!row) return
    setRoom((prev) => {
      if (prev && typeof row.seq === 'number' && typeof prev.seq === 'number' && row.seq < prev.seq) {
        return prev
      }
      // A genuinely newer committed snapshot has arrived — the roll resolved, so
      // any ephemeral "X is rolling…" indicator is now stale; clear it.
      if (!prev || typeof prev.seq !== 'number' || (typeof row.seq === 'number' && row.seq > prev.seq)) {
        setRollingBy(null)
      }
      const next = { ...(prev || {}), ...row }
      roomRef.current = next
      return next
    })
  }, [])

  // Best-effort, purely-cosmetic broadcast on the SAME realtime channel (e.g. the
  // instant a player clicks Roll). Never mutates state; if it's missed the
  // committed snapshot still drives the full animation.
  const broadcast = useCallback((event, payload = {}) => {
    const ch = channelRef.current
    if (!ch) return
    try { ch.send({ type: 'broadcast', event, payload }) } catch { /* ignore */ }
  }, [])

  // Merge engine-returned player rows into the joined list, keeping each row's
  // already-fetched `profile` (the snapshot carries only ids).
  const applyPlayers = useCallback((rows) => {
    if (!Array.isArray(rows)) return
    setPlayers((prev) => {
      const byId = new Map(prev.map((p) => [p.profile_id, p]))
      const merged = rows.map((r) => ({ ...(byId.get(r.profile_id) || {}), ...r }))
      const next = withPending(merged)
      playersRef.current = next
      return next
    })
  }, [withPending])

  const applyProperties = useCallback((rows) => {
    if (Array.isArray(rows)) setProperties(rows)
  }, [])

  const fetchPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('monopoly_players')
      .select(PLAYER_SEL)
      .eq('room_id', roomId)
      .order('seat', { ascending: true })
    if (data) {
      const next = withPending(data)
      playersRef.current = next
      setPlayers(next)
    }
  }, [roomId, withPending])

  const fetchProperties = useCallback(async () => {
    const { data } = await supabase
      .from('monopoly_properties')
      .select('*')
      .eq('room_id', roomId)
      .order('tile_index', { ascending: true })
    if (data) setProperties(data)
  }, [roomId])

  const fetchRoom = useCallback(
    async ({ silent = false } = {}) => {
      const { data, error: err } = await supabase
        .from('monopoly_rooms')
        .select('*')
        .eq('id', roomId)
        .maybeSingle()
      if (err) {
        if (!silent) { setError(err.message); setLoading(false) }
        return
      }
      if (!data) {
        if (!silent) { setError('Room not found'); setLoading(false) }
        return
      }
      roomRef.current = data
      setRoom(data)
      if (!silent) setLoading(false)
    },
    [roomId],
  )

  const refetch = useCallback(async () => {
    await Promise.all([fetchRoom({ silent: true }), fetchPlayers(), fetchProperties()])
  }, [fetchRoom, fetchPlayers, fetchProperties])

  // Optimistic lobby token pick: flip my token locally at 0ms, then persist.
  // A monotonic seq tags each pick so a slow/failed earlier RPC can't revert a
  // newer choice (last-write-wins). `pendingTokenRef` keeps the choice sticky
  // against in-flight refetches until the server snapshot confirms it.
  const pickToken = useCallback(async (token) => {
    if (!myId) return {}
    const seq = ++pickSeqRef.current
    const prevToken = playersRef.current.find((p) => p.profile_id === myId)?.token ?? null
    if (token === prevToken) return {}
    pendingTokenRef.current = token
    setPlayers((prev) => {
      const next = prev.map((p) => (p.profile_id === myId ? { ...p, token } : p))
      playersRef.current = next
      return next
    })
    const { error: err } = await supabase.rpc('monopoly_set_token', { p_room: roomId, p_token: token })
    if (seq !== pickSeqRef.current) return {} // superseded by a newer pick — ignore this result
    if (err) {
      pendingTokenRef.current = null
      setPlayers((prev) => {
        const next = prev.map((p) => (p.profile_id === myId ? { ...p, token: prevToken } : p))
        playersRef.current = next
        return next
      })
      return { error: err.message }
    }
    return {} // keep the optimistic overlay until the authoritative snapshot echoes it
  }, [myId, roomId])

  // Send a gameplay action through the Edge Function and apply the returned
  // snapshot instantly (no waiting for the realtime echo). A `conflict` snapshot
  // (stale seq — someone already acted) is reconciled, never surfaced as an error.
  const sendAction = useCallback(
    async (action, args = {}) => {
      const { data, error: err } = await supabase.functions.invoke('monopoly-action', {
        body: { room_id: roomId, action, ...args },
      })
      if (err) {
        // Only genuine faults reach here now — 401 (auth), 404 (missing room),
        // 500 (server). Expected rule rejections and races come back as 200 with a
        // flag (handled below). Surface a specific message if the body carries one,
        // else a friendly generic, and refetch to recover from any transient drop.
        let msg = ''
        try {
          const body = await err.context?.json?.()
          if (body?.error) msg = body.error
        } catch { /* ignore */ }
        refetch()
        return { error: msg || 'Connection problem — reconnecting…' }
      }
      // A racing / duplicate submit (someone else's action won the seq race):
      // reconcile silently from the snapshot, never surface as an error.
      if (data?.conflict) {
        refetch()
        applyRoom(data.room)
        applyPlayers(data.players)
        applyProperties(data.properties)
        return { conflict: true }
      }
      // An expected rule rejection ("Not your turn", "Not enough cash", …): resync
      // from the returned snapshot so a stale UI self-corrects, then bubble the
      // reason up so the caller can toast it.
      if (data?.rejected) {
        applyRoom(data.room)
        applyPlayers(data.players)
        applyProperties(data.properties)
        return { error: data.error || 'That move isn’t allowed' }
      }
      if (data?.room) applyRoom(data.room)
      if (data?.players) applyPlayers(data.players)
      if (data?.properties) applyProperties(data.properties)
      return { data }
    },
    [roomId, applyRoom, applyPlayers, applyProperties, refetch],
  )

  // Is THIS client the elected timer pumper? Current player if present, else the
  // lowest-seat present member. Keeps deadline ticks to a single Edge call.
  const isPumper = useCallback(() => {
    const r = roomRef.current
    if (!r || !Array.isArray(r.turn_order)) return false
    const present = new Set(onlineRef.current)
    const cur = r.turn_order[r.current_seat]
    if (cur && present.has(cur)) return cur === myId
    // current player is away — lowest-seat present, non-bankrupt member pumps
    const ordered = [...playersRef.current]
      .filter((p) => present.has(p.profile_id) && !p.bankrupt)
      .sort((a, b) => a.seat - b.seat)
    return ordered.length > 0 && ordered[0].profile_id === myId
  }, [myId])

  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    setConn('connecting')
    roomRef.current = null
    advancedForRef.current = null
    fetchRoom()
    fetchPlayers()
    fetchProperties()

    let pDebounce
    const refreshPlayers = () => { clearTimeout(pDebounce); pDebounce = setTimeout(fetchPlayers, 250) }
    let prDebounce
    const refreshProps = () => { clearTimeout(prDebounce); prDebounce = setTimeout(fetchProperties, 250) }

    const ch = supabase.channel(`monopoly-room:${roomId}`, {
      config: { presence: { key: myId || 'anon' } },
    })
    channelRef.current = ch
    // Ephemeral roll-start presence: show a remote player's dice tumbling the
    // instant they click, before the Edge round-trip lands. Ignore my own echo
    // (my dice already tumble locally). Auto-expire after 2.5s so a dropped
    // snapshot can't leave the indicator stuck.
    ch.on('broadcast', { event: 'roll' }, ({ payload }) => {
      if (!payload || payload.by === myId) return
      setRollingBy(payload.by)
      clearTimeout(rollClearRef.current)
      rollClearRef.current = setTimeout(() => setRollingBy(null), 2500)
    })
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'monopoly_rooms', filter: `id=eq.${roomId}` },
      (payload) => applyRoom(payload.new))
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'monopoly_players', filter: `room_id=eq.${roomId}` },
      refreshPlayers)
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'monopoly_properties', filter: `room_id=eq.${roomId}` },
      refreshProps)
    ch.on('presence', { event: 'sync' }, () => {
      const ids = Object.keys(ch.presenceState())
      onlineRef.current = ids
      setOnline(ids)
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConn('live')
        refetch()
        ch.track({ at: new Date().toISOString() })
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setConn('reconnecting')
      }
    })

    // safety-net poll
    let ticks = 0
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      ticks += 1
      if (!(connRef.current === 'live' && ticks % HEARTBEAT !== 0)) refetch()
    }, POLL_MS)

    // 1s single-pumper deadline driver
    const driver = setInterval(() => {
      const r = roomRef.current
      if (!r || r.status !== 'playing' || !r.phase_ends_at) return
      if (Date.now() < new Date(r.phase_ends_at).getTime()) return
      if (advancedForRef.current === r.phase_ends_at) return
      if (!isPumper()) return
      advancedForRef.current = r.phase_ends_at
      sendAction('tick')
    }, 1000)

    const onVisible = () => { if (!document.hidden) refetch() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(pDebounce)
      clearTimeout(prDebounce)
      clearTimeout(rollClearRef.current)
      clearInterval(interval)
      clearInterval(driver)
      document.removeEventListener('visibilitychange', onVisible)
      channelRef.current = null
      supabase.removeChannel(ch)
    }
  }, [roomId, myId, fetchRoom, fetchPlayers, fetchProperties, refetch, applyRoom, setConn, isPumper, sendAction])

  return {
    room, players, properties, online, loading, error, connState, myId, rollingBy,
    applyRoom, refetch, sendAction, pickToken, broadcast,
  }
}
