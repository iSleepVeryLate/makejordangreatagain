import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useHeartbeat } from './useHeartbeat.js'

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
//   3. A TIERED, self-healing timer driver: a 1s tick fires the deadline 'tick'
//      action. The elected pumper (current player if present, else the lowest-seat
//      present member) fires the instant the deadline passes, so a healthy table
//      never stampedes the Edge Function. But if that pumper's interval is frozen
//      (a backgrounded / mobile tab still reading as "present"), ANY present, non-
//      bankrupt client takes over once the deadline is overdue by a seat-staggered
//      grace margin — so the whole table can never stall on one idle player. A
//      duplicate tick is a harmless seq-conflict, swallowed silently in sendAction.

const PLAYER_SEL = '*, profile:profiles(id,username,global_name,avatar_url)'
const POLL_MS = 4000
const HEARTBEAT = 3 // when 'live', only reconcile every 3rd tick (~12s)
// Backstop window: how long after the deadline a non-elected client may take over
// pumping, staggered by seat so they don't all fire the same tick.
const BACKSTOP_BASE_MS = 2500
const BACKSTOP_STAGGER_MS = 600

export function useMonopolyRoom(roomId) {
  const { profile } = useAuth()
  const myId = profile?.id

  // Server presence heartbeat → reaps players who drop without calling
  // monopoly_leave, keeping is_present (and the pumper election) honest.
  useHeartbeat('monopoly', roomId, !!roomId && !!myId)

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
  const everLoadedRef = useRef(false) // have we ever successfully loaded this room?
  const missesRef = useRef(0) // consecutive null fetches (transient vs real not-found)
  const serverOffsetRef = useRef(0) // estimated (serverClock - clientClock) ms — clock-skew-safe deadlines
  const offsetBasisRef = useRef(0) // updated_at (ms) the offset was computed from; only a NEWER commit re-estimates

  // Anchor the turn timer to SERVER time, not the local wall clock. updated_at and
  // phase_ends_at are written in the same server transaction, so estimating
  // (serverClock - clientClock) from a freshly-received commit lets pumpIfDue fire on
  // the real deadline even if the device clock is minutes off. Only re-estimate on a
  // strictly newer commit, so the 4s poll re-delivering the same row can't re-pin a
  // stale offset (which would freeze "server now" at the old commit time).
  const noteServerClock = useCallback((updatedAt) => {
    if (!updatedAt) return
    const ts = Date.parse(updatedAt)
    if (Number.isFinite(ts) && ts > offsetBasisRef.current) {
      offsetBasisRef.current = ts
      serverOffsetRef.current = ts - Date.now()
    }
  }, [])

  // Server-time "now" — the same skew-corrected clock pumpIfDue uses, exposed so the
  // visible TurnTimer countdown agrees with the deadline that actually fires.
  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, [])

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
    noteServerClock(row.updated_at)
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
  }, [noteServerClock])

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

  // Apply a full {room,players,properties} snapshot as ONE batched, seq-gated update.
  // Gating the WHOLE snapshot on rooms.seq (not just the room row) is the fix for the
  // split-generation desync: a single server action commits seq/dice/positions in one
  // transaction, so the client must apply them together. Applying the room instantly
  // while players lag (the old debounced refetch) let the animator see a new seq next
  // to stale positions (or vice-versa) → stale dice/card, banner flip-flop, teleports.
  const applySnapshot = useCallback((roomRow, playersRows, propsRows) => {
    if (!roomRow) return
    const cur = roomRef.current
    if (cur && typeof roomRow.seq === 'number' && typeof cur.seq === 'number' && roomRow.seq < cur.seq) return
    applyRoom(roomRow)
    if (Array.isArray(playersRows)) applyPlayers(playersRows)
    if (Array.isArray(propsRows)) applyProperties(propsRows)
  }, [applyRoom, applyPlayers, applyProperties])

  // Atomic resync: fetch all three tables together and apply them as ONE seq-gated
  // snapshot. This is the safety-net/realtime reconcile path — every realtime table
  // change and the poll funnel through here so the client never assembles its UI from
  // two different server generations.
  const fetchAll = useCallback(async () => {
    const [rRes, plRes, prRes] = await Promise.all([
      supabase.from('monopoly_rooms').select('*').eq('id', roomId).maybeSingle(),
      supabase.from('monopoly_players').select(PLAYER_SEL).eq('room_id', roomId).order('seat', { ascending: true }),
      supabase.from('monopoly_properties').select('*').eq('room_id', roomId).order('tile_index', { ascending: true }),
    ])
    if (rRes.error) {
      if (!everLoadedRef.current) { setError(rRes.error.message); setLoading(false) }
      return
    }
    const roomRow = rRes.data
    if (!roomRow) {
      missesRef.current += 1
      if (!everLoadedRef.current && missesRef.current >= 2) { setError('Room not found'); setLoading(false) }
      return
    }
    everLoadedRef.current = true
    missesRef.current = 0
    applySnapshot(roomRow, plRes.data, prRes.data)
    setLoading(false)
  }, [roomId, applySnapshot])

  const refetch = fetchAll

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
        applySnapshot(data.room, data.players, data.properties)
        refetch()
        return { conflict: true }
      }
      // An expected rule rejection ("Not your turn", "Not enough cash", …): resync
      // from the returned snapshot so a stale UI self-corrects, then bubble the
      // reason up so the caller can toast it.
      if (data?.rejected) {
        applySnapshot(data.room, data.players, data.properties)
        return { error: data.error || 'That move isn’t allowed' }
      }
      // Apply the freshly-committed snapshot atomically (room+players+properties in one
      // batched, seq-gated update — never split across generations).
      if (data?.room) applySnapshot(data.room, data.players, data.properties)
      // Push it to peers on the realtime channel so they update in ~50-100ms instead of
      // waiting ~300-700ms for the postgres_changes echo. The DB echo + 4s poll stay as
      // the safety net; the seq guards make the redundant delivery a no-op. Peers skip
      // our own echo via `by`.
      if (data?.room) broadcast('snap', { by: myId, room: data.room, players: data.players, properties: data.properties })
      return { data }
    },
    [roomId, myId, applySnapshot, refetch, broadcast],
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

  // Fire the deadline 'tick' at most once per phase_ends_at from this client. The
  // elected pumper fires immediately; any other present, non-bankrupt client fires
  // once the deadline is overdue by a seat-staggered grace margin (the self-healing
  // backstop), so a frozen/backgrounded pumper can never stall the table. Safe to
  // call from both the 1s interval and on tab-focus, since advancedForRef + the
  // server seq-check make a duplicate tick idempotent.
  const pumpIfDue = useCallback(async () => {
    const r = roomRef.current
    if (!r || r.status !== 'playing' || !r.phase_ends_at) return
    const overdue = (Date.now() + serverOffsetRef.current) - new Date(r.phase_ends_at).getTime()
    if (overdue < 0) return
    const deadline = r.phase_ends_at
    if (advancedForRef.current === deadline) return
    const me = playersRef.current.find((p) => p.profile_id === myId)
    if (!me || me.bankrupt) return
    if (!isPumper()) {
      // Backstop: ANY non-bankrupt client may take over after a seat-staggered grace,
      // REGARDLESS of realtime presence — presence rides the same WebSocket the VPN
      // degrades, so it can't gate liveness. The tick is an HTTP Edge call (works even
      // when the socket is down), and a duplicate is harmless (server seq-check). This
      // is what stops the table freezing on "X is taking their turn…".
      const grace = BACKSTOP_BASE_MS + (me.seat || 0) * BACKSTOP_STAGGER_MS
      if (overdue < grace) return
    }
    advancedForRef.current = deadline
    await sendAction('tick')
    // Re-arm if the tick did NOT advance the deadline (dropped / failed / no-op) so a
    // single lost tick can't strand the turn — the next 1s driver pass retries it.
    if (roomRef.current?.phase_ends_at === deadline) advancedForRef.current = null
  }, [isPumper, myId, sendAction])

  useEffect(() => {
    // Wait for a known identity before subscribing. `myId` (profile.id) resolves a
    // beat after the session, so subscribing earlier would build the channel under
    // an 'anon' presence key and then tear it down + re-subscribe (and re-flash the
    // spinner) the instant the profile loads. Gating here means the first real run
    // is the only one — no churn. The early return registers no cleanup/channel.
    if (!roomId || !myId) return undefined
    setLoading(true)
    setConn('connecting')
    roomRef.current = null
    advancedForRef.current = null
    everLoadedRef.current = false
    missesRef.current = 0
    serverOffsetRef.current = 0
    offsetBasisRef.current = 0
    fetchAll()

    // One coalesced ATOMIC resync for every realtime table change. A single server
    // action fires up to three postgres_changes (rooms/players/properties) within a
    // few ms; debouncing them into ONE fetchAll means we always apply a single
    // consistent {room,players,properties} snapshot instead of three split,
    // half-stale updates from different generations.
    let resyncTimer
    const scheduleResync = () => { clearTimeout(resyncTimer); resyncTimer = setTimeout(fetchAll, 60) }

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
    // Authoritative snapshot pushed by the acting client right after its commit — peers
    // apply it immediately instead of waiting for the slower postgres_changes echo.
    // Ignore our own echo; gate on seq so a late/stale broadcast can never roll back.
    ch.on('broadcast', { event: 'snap' }, ({ payload }) => {
      if (!payload || payload.by === myId || !payload.room) return
      applySnapshot(payload.room, payload.players, payload.properties)
    })
    // Every table change funnels through the coalesced atomic resync — we never apply a
    // bare payload.new on its own (that lone-room application, with players arriving on a
    // separate debounced refetch, was the split-generation desync that broke the board).
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'monopoly_rooms', filter: `id=eq.${roomId}` },
      scheduleResync)
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'monopoly_players', filter: `room_id=eq.${roomId}` },
      scheduleResync)
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'monopoly_properties', filter: `room_id=eq.${roomId}` },
      scheduleResync)
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

    // 1s tiered deadline driver (elected pumper + self-healing backstop)
    const driver = setInterval(pumpIfDue, 1000)

    // A returning tab re-evaluates the deadline at once (its interval may have been
    // throttled to a crawl while hidden) and reconciles any missed state.
    const onVisible = () => { if (!document.hidden) { refetch(); pumpIfDue() } }
    document.addEventListener('visibilitychange', onVisible)
    // A network restore should reconcile immediately too — realtime can take a
    // while to notice it's back online.
    const onOnline = () => { refetch(); pumpIfDue() }
    window.addEventListener('online', onOnline)

    return () => {
      clearTimeout(resyncTimer)
      clearTimeout(rollClearRef.current)
      clearInterval(interval)
      clearInterval(driver)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      channelRef.current = null
      supabase.removeChannel(ch)
    }
  }, [roomId, myId, fetchAll, refetch, applySnapshot, setConn, pumpIfDue])

  return {
    room, players, properties, online, loading, error, connState, myId, rollingBy,
    applyRoom, refetch, sendAction, pickToken, broadcast, serverNow,
  }
}
