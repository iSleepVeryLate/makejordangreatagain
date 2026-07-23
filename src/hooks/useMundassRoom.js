import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useHeartbeat } from './useHeartbeat.js'

// Real-time sync for a المندس room. Blends the two existing N-player transports:
//
//   * useMonopolyRoom's authoritative side: seq-gated atomic snapshots
//     ({room, players} applied together, stale generations dropped), an Edge
//     Function sendAction() whose committed snapshot is applied instantly and
//     pushed to peers over a 'snap' broadcast, and a self-healing deadline
//     pumper for meeting stages.
//
//   * useDrawRoom's ephemeral side: a second broadcast channel for
//     high-frequency, worthless-once-seen traffic — here 10 Hz movement and
//     meeting chat (event 'mun', kind in payload.t) — that never touches
//     Postgres.
//
// Plus one thing neither needed: `me` — my SECRET view (role, task list, kill
// cooldown, vote) fetched through the mundass_me RPC. It is re-fetched whenever
// rooms.seq advances during play, because any committed action may have
// changed it (a meeting opening clears votes, a kill resets the cooldown…).
// Roles never ride the row stream, so they never reach other players.

const PLAYER_SEL = '*, profile:profiles(id,username,global_name,avatar_url)'
const POLL_MS = 4000
const HEARTBEAT = 3 // when 'live', only reconcile every 3rd tick (~12s)
const BACKSTOP_BASE_MS = 2500
const BACKSTOP_STAGGER_MS = 600

export function useMundassRoom(roomId) {
  const { profile } = useAuth()
  const myId = profile?.id

  useHeartbeat('mundass', roomId, !!roomId && !!myId)

  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [me, setMe] = useState(null) // my secret: {role, tasks, mates, killCooldownUntil, emergencyUsed, vote}
  const [online, setOnline] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connState, setConnState] = useState('connecting')

  const roomRef = useRef(null)
  const playersRef = useRef([])
  const onlineRef = useRef([])
  const connRef = useRef('connecting')
  const channelRef = useRef(null) // data channel (snap broadcast)
  const bcastRef = useRef(null) // ephemeral channel (positions + chat)
  const listenersRef = useRef(new Set())
  const advancedForRef = useRef(null)
  const meForSeqRef = useRef(-1) // rooms.seq my secret was last fetched at
  const everLoadedRef = useRef(false)
  const missesRef = useRef(0)
  const serverOffsetRef = useRef(0)
  const offsetBasisRef = useRef(0)

  const noteServerClock = useCallback((updatedAt) => {
    if (!updatedAt) return
    const ts = Date.parse(updatedAt)
    if (Number.isFinite(ts) && ts > offsetBasisRef.current) {
      offsetBasisRef.current = ts
      serverOffsetRef.current = ts - Date.now()
    }
  }, [])
  const serverNow = useCallback(() => Date.now() + serverOffsetRef.current, [])

  const setConn = useCallback((s) => {
    connRef.current = s
    setConnState(s)
  }, [])

  // My secret view. Cheap RPC, re-fetched once per committed seq while playing.
  const fetchMe = useCallback(async () => {
    const r = roomRef.current
    if (!r || r.status === 'lobby') return
    const seq = r.seq
    if (meForSeqRef.current === seq) return
    meForSeqRef.current = seq
    supabase.rpc('mundass_me', { p_room: roomId }).then(
      ({ data }) => { if (data) setMe(data) },
      () => { meForSeqRef.current = -1 }, // retry on next reconcile
    )
  }, [roomId])

  // Monotonic merge: drop stale rows so state never rolls backward.
  const applyRoom = useCallback((row) => {
    if (!row) return
    noteServerClock(row.updated_at)
    setRoom((prev) => {
      if (prev && typeof row.seq === 'number' && typeof prev.seq === 'number' && row.seq < prev.seq) {
        return prev
      }
      const next = { ...(prev || {}), ...row }
      roomRef.current = next
      return next
    })
  }, [noteServerClock])

  const applyPlayers = useCallback((rows) => {
    if (!Array.isArray(rows)) return
    setPlayers((prev) => {
      const byId = new Map(prev.map((p) => [p.profile_id, p]))
      const merged = rows.map((r) => ({ ...(byId.get(r.profile_id) || {}), ...r }))
      playersRef.current = merged
      return merged
    })
  }, [])

  // Apply {room, players} as ONE seq-gated snapshot (split-generation guard).
  const applySnapshot = useCallback((roomRow, playersRows) => {
    if (!roomRow) return
    const cur = roomRef.current
    if (cur && typeof roomRow.seq === 'number' && typeof cur.seq === 'number' && roomRow.seq < cur.seq) return
    applyRoom(roomRow)
    if (Array.isArray(playersRows)) applyPlayers(playersRows)
    fetchMe()
  }, [applyRoom, applyPlayers, fetchMe])

  const fetchAll = useCallback(async () => {
    const [rRes, plRes] = await Promise.all([
      supabase.from('mundass_rooms').select('*').eq('id', roomId).maybeSingle(),
      supabase.from('mundass_players').select(PLAYER_SEL).eq('room_id', roomId).order('joined_at', { ascending: true }),
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
    applySnapshot(roomRow, plRes.data)
    setLoading(false)
  }, [roomId, applySnapshot])

  const refetch = fetchAll

  // ---- ephemeral broadcast bus (positions + chat), draw-style ----
  const sendBroadcast = useCallback((payload) => {
    bcastRef.current?.send({ type: 'broadcast', event: 'mun', payload })
  }, [])
  const onMessage = useCallback((fn) => {
    listenersRef.current.add(fn)
    return () => listenersRef.current.delete(fn)
  }, [])

  // Cosmetic broadcast on the data channel (committed-snapshot push to peers).
  const broadcast = useCallback((event, payload = {}) => {
    const ch = channelRef.current
    if (!ch) return
    try { ch.send({ type: 'broadcast', event, payload }) } catch { /* ignore */ }
  }, [])

  // Gameplay action → Edge Function → apply + push the committed snapshot.
  const sendAction = useCallback(
    async (action, args = {}) => {
      const { data, error: err } = await supabase.functions.invoke('mundass-action', {
        body: { room_id: roomId, action, ...args },
      })
      if (err) {
        let msg = ''
        try {
          const body = await err.context?.json?.()
          if (body?.error) msg = body.error
        } catch { /* ignore */ }
        refetch()
        return { error: msg || 'Connection problem — reconnecting…' }
      }
      if (data?.conflict) {
        applySnapshot(data.room, data.players)
        refetch()
        return { conflict: true }
      }
      if (data?.rejected) {
        applySnapshot(data.room, data.players)
        return { error: data.error || 'not_allowed' }
      }
      if (data?.room) {
        applySnapshot(data.room, data.players)
        broadcast('snap', { by: myId, room: data.room, players: data.players })
      }
      return { data }
    },
    [roomId, myId, applySnapshot, refetch, broadcast],
  )

  // Elected meeting-stage pumper: first present+online member (joined_at order);
  // anyone else takes over after a staggered grace (monopoly's backstop pattern).
  const pumpIfDue = useCallback(async () => {
    const r = roomRef.current
    if (!r || r.status !== 'playing' || !r.phase_ends_at) return
    const overdue = (Date.now() + serverOffsetRef.current) - new Date(r.phase_ends_at).getTime()
    if (overdue < 0) return
    const deadline = r.phase_ends_at
    if (advancedForRef.current === deadline) return
    const list = playersRef.current
    const meRow = list.find((p) => p.profile_id === myId)
    if (!meRow) return
    const presentSet = new Set(onlineRef.current)
    const candidates = list.filter((p) => p.is_present && presentSet.has(p.profile_id))
    const elected = (candidates[0] || list[0])?.profile_id
    if (elected !== myId) {
      // Stagger capped: in a 16-player room the last seats shouldn't wait 10s+
      // to rescue a stalled meeting clock.
      const myIdx = Math.max(0, list.findIndex((p) => p.profile_id === myId))
      const grace = BACKSTOP_BASE_MS + Math.min(myIdx, 8) * BACKSTOP_STAGGER_MS
      if (overdue < grace) return
    }
    advancedForRef.current = deadline
    await sendAction('tick')
    if (roomRef.current?.phase_ends_at === deadline) advancedForRef.current = null
  }, [myId, sendAction])

  useEffect(() => {
    if (!roomId || !myId) return undefined
    setLoading(true)
    setConn('connecting')
    roomRef.current = null
    advancedForRef.current = null
    meForSeqRef.current = -1
    everLoadedRef.current = false
    missesRef.current = 0
    serverOffsetRef.current = 0
    offsetBasisRef.current = 0
    setMe(null)
    fetchAll()

    let resyncTimer
    const scheduleResync = () => { clearTimeout(resyncTimer); resyncTimer = setTimeout(fetchAll, 60) }

    const ch = supabase.channel(`mundass-room:${roomId}`, {
      config: { presence: { key: myId || 'anon' } },
    })
    channelRef.current = ch
    ch.on('broadcast', { event: 'snap' }, ({ payload }) => {
      if (!payload || payload.by === myId || !payload.room) return
      applySnapshot(payload.room, payload.players)
    })
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'mundass_rooms', filter: `id=eq.${roomId}` },
      scheduleResync)
    ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'mundass_players', filter: `room_id=eq.${roomId}` },
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

    // Ephemeral channel: movement + chat. Never persisted.
    const bc = supabase.channel(`mundass:${roomId}`, { config: { broadcast: { self: false } } })
    bc.on('broadcast', { event: 'mun' }, ({ payload }) => {
      listenersRef.current.forEach((fn) => fn(payload))
    })
    bc.subscribe()
    bcastRef.current = bc

    let ticks = 0
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      ticks += 1
      if (!(connRef.current === 'live' && ticks % HEARTBEAT !== 0)) refetch()
    }, POLL_MS)

    const driver = setInterval(pumpIfDue, 1000)

    const onVisible = () => { if (!document.hidden) { refetch(); pumpIfDue() } }
    document.addEventListener('visibilitychange', onVisible)
    const onOnline = () => { refetch(); pumpIfDue() }
    window.addEventListener('online', onOnline)

    return () => {
      clearTimeout(resyncTimer)
      clearInterval(interval)
      clearInterval(driver)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      channelRef.current = null
      bcastRef.current = null
      supabase.removeChannel(ch)
      supabase.removeChannel(bc)
    }
  }, [roomId, myId, fetchAll, refetch, applySnapshot, setConn, pumpIfDue])

  return {
    room, players, me, online, loading, error, connState, myId,
    applyRoom, refetch, sendAction, sendBroadcast, onMessage, serverNow,
  }
}
