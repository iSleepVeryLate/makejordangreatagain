import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'

// Real-time sync for a Draw & Guess room. Mirrors useMatch.js's transport (row
// subscription + a safety-net poll + presence) but for an N-player room, and adds
// two things the 1v1 games don't need:
//
//   1. A second, EPHEMERAL realtime BROADCAST channel for drawing strokes + chat.
//      These are high-frequency and worthless once seen, so they never touch
//      Postgres. All messages use a single broadcast event name ('draw') with the
//      kind in the payload (.t), so components can register before subscribe and
//      still fan out by type.
//
//   2. A timer driver: a 1s tick that calls the idempotent draw_advance() RPC
//      once the local clock passes phase_ends_at. There is no per-room server
//      cron, so the clients themselves pump the state machine; the server
//      re-checks the deadline and the row lock makes concurrent calls safe.

const PLAYER_SEL = '*, profile:profiles(id,username,global_name,avatar_url)'
const POLL_MS = 4000
const HEARTBEAT = 3 // when 'live', only reconcile every 3rd tick (~12s)

export function useDrawRoom(roomId) {
  const { profile } = useAuth()
  const myId = profile?.id

  const [room, setRoom] = useState(null)
  const [players, setPlayers] = useState([])
  const [online, setOnline] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connState, setConnState] = useState('connecting')

  const roomRef = useRef(null)
  const connRef = useRef('connecting')
  const bcastRef = useRef(null) // the broadcast channel
  const listenersRef = useRef(new Set()) // inbound broadcast handlers
  const advancedForRef = useRef(null) // phase_ends_at we've already pumped

  const setConn = useCallback((s) => {
    connRef.current = s
    setConnState(s)
  }, [])

  const applyRoom = useCallback((row) => {
    if (!row) return
    setRoom((prev) => {
      const next = { ...(prev || {}), ...row }
      roomRef.current = next
      return next
    })
  }, [])

  const fetchPlayers = useCallback(async () => {
    const { data } = await supabase
      .from('draw_players')
      .select(PLAYER_SEL)
      .eq('room_id', roomId)
      .order('joined_at', { ascending: true })
    if (data) setPlayers(data)
  }, [roomId])

  const fetchRoom = useCallback(
    async ({ silent = false } = {}) => {
      const { data, error: err } = await supabase
        .from('draw_rooms')
        .select('*')
        .eq('id', roomId)
        .maybeSingle()
      if (err) {
        if (!silent) {
          setError(err.message)
          setLoading(false)
        }
        return
      }
      if (!data) {
        if (!silent) {
          setError('Room not found')
          setLoading(false)
        }
        return
      }
      roomRef.current = data
      setRoom(data)
      if (!silent) setLoading(false)
    },
    [roomId],
  )

  const refetch = useCallback(async () => {
    await Promise.all([fetchRoom({ silent: true }), fetchPlayers()])
  }, [fetchRoom, fetchPlayers])

  // ---- broadcast API exposed to the canvas + guess panel ----
  const sendBroadcast = useCallback((payload) => {
    bcastRef.current?.send({ type: 'broadcast', event: 'draw', payload })
  }, [])
  const onMessage = useCallback((fn) => {
    listenersRef.current.add(fn)
    return () => listenersRef.current.delete(fn)
  }, [])

  // ---- data channel: row + player changes, presence ----
  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    setConn('connecting')
    roomRef.current = null
    advancedForRef.current = null
    fetchRoom()
    fetchPlayers()

    let debounce
    const refreshPlayers = () => {
      clearTimeout(debounce)
      debounce = setTimeout(fetchPlayers, 250)
    }

    const ch = supabase.channel(`draw-room:${roomId}`, {
      config: { presence: { key: myId || 'anon' } },
    })
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'draw_rooms', filter: `id=eq.${roomId}` },
      (payload) => applyRoom(payload.new),
    )
    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'draw_players', filter: `room_id=eq.${roomId}` },
      refreshPlayers,
    )
    ch.on('presence', { event: 'sync' }, () => setOnline(Object.keys(ch.presenceState())))
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        setConn('live')
        refetch()
        ch.track({ at: new Date().toISOString() })
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        setConn('reconnecting')
      }
    })

    // ---- broadcast channel: strokes + chat (ephemeral, never persisted) ----
    const bc = supabase.channel(`draw:${roomId}`, { config: { broadcast: { self: false } } })
    bc.on('broadcast', { event: 'draw' }, ({ payload }) => {
      listenersRef.current.forEach((fn) => fn(payload))
    })
    bc.subscribe()
    bcastRef.current = bc

    // ---- safety-net poll + timer driver ----
    let ticks = 0
    const tick = () => {
      if (typeof document !== 'undefined' && document.hidden) return
      // reconcile cadence
      ticks += 1
      if (!(connRef.current === 'live' && ticks % HEARTBEAT !== 0)) refetch()
    }
    const interval = setInterval(tick, POLL_MS)

    // 1s tick purely to pump the deadline-driven state machine.
    const driver = setInterval(() => {
      const r = roomRef.current
      if (!r || r.status === 'finished' || !r.phase_ends_at) return
      if (!['choosing', 'drawing', 'reveal'].includes(r.phase)) return
      if (Date.now() < new Date(r.phase_ends_at).getTime()) return
      if (advancedForRef.current === r.phase_ends_at) return // already pumped this deadline
      advancedForRef.current = r.phase_ends_at
      supabase.rpc('draw_advance', { p_room: roomId }).then(({ data }) => {
        if (data) applyRoom(data)
      })
    }, 1000)

    const onVisible = () => {
      if (!document.hidden) refetch()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(debounce)
      clearInterval(interval)
      clearInterval(driver)
      document.removeEventListener('visibilitychange', onVisible)
      supabase.removeChannel(ch)
      supabase.removeChannel(bc)
      bcastRef.current = null
    }
  }, [roomId, myId, fetchRoom, fetchPlayers, refetch, applyRoom, setConn])

  return {
    room,
    players,
    online,
    loading,
    error,
    connState,
    myId,
    applyRoom,
    refetch,
    sendBroadcast,
    onMessage,
  }
}
