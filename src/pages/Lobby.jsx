import { useEffect, useState, useCallback } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { GAMES, gameLabel } from '../games/config.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'

const CREATOR = 'creator:profiles!matches_player1_fkey(id,username,global_name,avatar_url)'
const P1 = 'p1:profiles!matches_player1_fkey(id,username,global_name,avatar_url)'
const P2 = 'p2:profiles!matches_player2_fkey(id,username,global_name,avatar_url)'

export default function Lobby() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [selected, setSelected] = useState('tictactoe')
  const [openRooms, setOpenRooms] = useState([])
  const [myGames, setMyGames] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const myId = profile?.id

  const fetchData = useCallback(async () => {
    if (!myId) return
    const [rooms, mine] = await Promise.all([
      supabase
        .from('matches')
        .select(`*, ${CREATOR}`)
        .eq('status', 'waiting')
        .eq('is_private', false)
        .neq('player1', myId)
        .order('created_at', { ascending: true }),
      supabase
        .from('matches')
        .select(`*, ${P1}, ${P2}`)
        .or(`player1.eq.${myId},player2.eq.${myId}`)
        .in('status', ['waiting', 'active'])
        .order('last_move_at', { ascending: false }),
    ])
    if (!rooms.error) setOpenRooms(rooms.data || [])
    if (!mine.error) setMyGames(mine.data || [])
  }, [myId])

  useEffect(() => {
    fetchData()
    const ch = supabase
      .channel('lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => fetchData())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [fetchData])

  const go = (row) => {
    if (row?.id) navigate(`/play/${row.id}`)
  }

  const run = async (fn) => {
    setError('')
    setBusy(true)
    try {
      const { data, error } = await fn()
      if (error) throw error
      go(data)
    } catch (e) {
      setError(e.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const quickMatch = () => run(() => supabase.rpc('join_open_room', { p_game_type: selected }))
  const createRoom = (priv) =>
    run(() => supabase.rpc('create_room', { p_game_type: selected, p_is_private: priv }))
  const joinRoom = (id) => run(() => supabase.rpc('join_by_id', { p_match_id: id }))

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="section-head">
            <h1>Game hub</h1>
            <p>Pick a game and challenge a fellow Jordanian. Wins earn you rating points.</p>
          </div>

          <div className="game-picker">
            {GAMES.map((g) => (
              <button
                key={g.key}
                className={`gtile${selected === g.key ? ' selected' : ''}`}
                onClick={() => setSelected(g.key)}
              >
                <span className="emoji">{g.emoji}</span>
                <h3>{g.label}</h3>
                <p>{g.desc}</p>
              </button>
            ))}
          </div>

          <div className="lobby-actions">
            <button className="btn btn-green" onClick={quickMatch} disabled={busy}>
              {busy ? <span className="spinner sm" /> : `⚡ Quick match · ${gameLabel(selected)}`}
            </button>
            <button className="btn btn-line" onClick={() => createRoom(false)} disabled={busy}>
              Create open room
            </button>
            <button className="btn btn-line" onClick={() => createRoom(true)} disabled={busy}>
              Create private (invite link)
            </button>
          </div>
          {error && <p className="err-text" style={{ marginBottom: 24 }}>{error}</p>}

          {myGames.length > 0 && (
            <section style={{ marginBottom: 40 }}>
              <h4 className="muted" style={{ textTransform: 'uppercase', letterSpacing: '.5px', fontSize: 13, marginBottom: 14 }}>
                Your games
              </h4>
              <div className="rooms">
                {myGames.map((m) => {
                  const opp = m.player1 === myId ? m.p2 : m.p1
                  return (
                    <div className="room-row" key={m.id}>
                      <div className="who">
                        <span className="tag">{gameLabel(m.game_type)}</span>
                        <span className="meta">
                          {m.status === 'waiting'
                            ? 'Waiting for an opponent…'
                            : `vs ${opp?.global_name || opp?.username || 'opponent'}`}
                        </span>
                      </div>
                      <button className="btn btn-green btn-sm" onClick={() => go(m)}>
                        {m.status === 'waiting' ? 'Open room' : 'Resume'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section>
            <h4 className="muted" style={{ textTransform: 'uppercase', letterSpacing: '.5px', fontSize: 13, marginBottom: 14 }}>
              Open rooms
            </h4>
            {openRooms.length === 0 ? (
              <div className="empty-state">
                No open rooms right now. Hit <strong>Quick match</strong> or create one — others can join you.
              </div>
            ) : (
              <div className="rooms">
                {openRooms.map((m) => (
                  <div className="room-row" key={m.id}>
                    <div className="who">
                      <Avatar profile={m.creator} />
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {m.creator?.global_name || m.creator?.username || 'A Jordanian'}
                        </div>
                        <div className="meta">wants to play {gameLabel(m.game_type)}</div>
                      </div>
                    </div>
                    <button className="btn btn-green btn-sm" onClick={() => joinRoom(m.id)} disabled={busy}>
                      Join
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  )
}
