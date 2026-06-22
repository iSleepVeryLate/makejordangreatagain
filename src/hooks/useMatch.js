import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'

const SEL =
  '*, ' +
  'p1:profiles!matches_player1_fkey(id,username,global_name,avatar_url), ' +
  'p2:profiles!matches_player2_fkey(id,username,global_name,avatar_url)'

// The heart of real-time sync: subscribe to the match row, reconcile on
// (re)connect, and track presence so we know if the opponent is online.
export function useMatch(matchId) {
  const { profile } = useAuth()
  const myId = profile?.id

  const [match, setMatch] = useState(null)
  const [players, setPlayers] = useState({})
  const [online, setOnline] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const playersRef = useRef({})

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

  const fetchFull = useCallback(async () => {
    const { data, error } = await supabase.from('matches').select(SEL).eq('id', matchId).maybeSingle()
    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }
    if (!data) {
      setError('Match not found')
      setLoading(false)
      return
    }
    cacheProfiles([data.p1, data.p2])
    setMatch(data)
    setLoading(false)
  }, [matchId, cacheProfiles])

  // Apply an authoritative row (from realtime or an RPC return) instantly.
  const applyRow = useCallback(
    (row) => {
      if (!row) return
      setMatch((prev) => ({ ...(prev || {}), ...row }))
      fetchProfiles([row.player1, row.player2])
    },
    [fetchProfiles],
  )

  useEffect(() => {
    if (!matchId) return
    setLoading(true)
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
        fetchFull() // reconcile anything missed while connecting
        ch.track({ online_at: new Date().toISOString() })
      }
    })

    return () => {
      supabase.removeChannel(ch)
    }
  }, [matchId, myId, fetchFull, applyRow])

  return { match, players, online, loading, error, myId, applyRow, refetch: fetchFull }
}
