import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Plus, Link2, Users, Trophy, Check, Crown } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useOnline } from '../context/PresenceContext.jsx'
import { GAMES, GAME_BY_KEY, gameLabel } from '../games/config.js'
import { timeAgo } from '../lib/format.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'
import GameIcon from '../components/GameIcon.jsx'

const CREATOR = 'creator:profiles!matches_player1_fkey(id,username,global_name,avatar_url)'
const P1 = 'p1:profiles!matches_player1_fkey(id,username,global_name,avatar_url)'
const P2 = 'p2:profiles!matches_player2_fkey(id,username,global_name,avatar_url)'

const tintOf = (key) => GAME_BY_KEY[key]?.tint || 'g'
const plural = (n) => (n === 1 ? '' : 's')

export default function Lobby() {
  const { profile } = useAuth()
  const { onlineUsers, onlineCount } = useOnline()
  const navigate = useNavigate()

  const [selected, setSelected] = useState('tictactoe')
  const [openRooms, setOpenRooms] = useState([])
  const [myGames, setMyGames] = useState([])
  const [liveCounts, setLiveCounts] = useState({}) // active games per type (community-wide)
  const [waitingCounts, setWaitingCounts] = useState({}) // open public rooms per type
  const [ratings, setRatings] = useState({}) // `${profileId}:${gameType}` -> rating
  const [topPlayers, setTopPlayers] = useState(null) // null = loading
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const myId = profile?.id

  const fetchData = useCallback(async () => {
    if (!myId) return
    const [rooms, mine, waiting, live] = await Promise.all([
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
      // Open public rooms are readable under RLS, so we can tally them client-side.
      supabase.from('matches').select('game_type').eq('status', 'waiting').eq('is_private', false),
      // Community-wide "live now" needs the live_game_counts() RPC (migration 0002);
      // if it isn't applied yet this errors and we just fall back to waiting counts.
      supabase.rpc('live_game_counts'),
    ])

    const roomRows = rooms.error ? [] : rooms.data || []
    if (!rooms.error) setOpenRooms(roomRows)
    if (!mine.error) setMyGames(mine.data || [])

    if (!waiting.error) {
      const wc = {}
      for (const r of waiting.data || []) wc[r.game_type] = (wc[r.game_type] || 0) + 1
      setWaitingCounts(wc)
    }

    if (!live.error && Array.isArray(live.data)) {
      const lc = {}
      for (const r of live.data) lc[r.game_type] = Number(r.active) || 0
      setLiveCounts(lc)
    }

    // Per-creator rating for the badge on each open room. game_stats is
    // world-readable to authed users, so this is a plain select.
    const creatorIds = [...new Set(roomRows.map((m) => m.creator?.id).filter(Boolean))]
    if (creatorIds.length) {
      const { data: stats } = await supabase
        .from('game_stats')
        .select('profile_id,game_type,rating')
        .in('profile_id', creatorIds)
      const map = {}
      for (const s of stats || []) map[`${s.profile_id}:${s.game_type}`] = s.rating
      setRatings(map)
    } else {
      setRatings({})
    }
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

  // Top players for the selected game (all-time), re-queried on selection.
  useEffect(() => {
    let active = true
    setTopPlayers(null)
    supabase
      .from('leaderboard')
      .select('*')
      .eq('game_type', selected)
      .order('rank', { ascending: true })
      .limit(5)
      .then(({ data }) => {
        if (active) setTopPlayers(data || [])
      })
    return () => {
      active = false
    }
  }, [selected])

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

  const others = onlineUsers.filter((u) => u.id !== myId)
  const liveSel = liveCounts[selected] || 0
  const waitSel = waitingCounts[selected] || 0
  const subline =
    liveSel > 0
      ? `${liveSel} game${plural(liveSel)} live now`
      : waitSel > 0
        ? `${waitSel} open room${plural(waitSel)} waiting`
        : 'Be the first to start one.'

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="hub-head">
            <div>
              <h1>Game hub</h1>
              <p>Pick a game and challenge a fellow Jordanian. Wins earn you rating points.</p>
            </div>
            <div className={`live-pill${onlineCount > 0 ? ' on' : ''}`}>
              <span className="pulse" />
              {onlineCount > 0 ? `${onlineCount} player${plural(onlineCount)} online` : 'Connecting…'}
            </div>
          </div>

          <div className="hub-layout">
            <div className="hub-main">
              <div className="glabel">Choose a game</div>
              <div className="game-grid">
                {GAMES.map((g) => {
                  const live = liveCounts[g.key] || 0
                  const waiting = waitingCounts[g.key] || 0
                  const meta =
                    live > 0 ? `${live} live now` : waiting > 0 ? `${waiting} waiting` : g.hint
                  const isSel = selected === g.key
                  return (
                    <button
                      key={g.key}
                      className={`gcard${isSel ? ' selected' : ''}`}
                      onClick={() => setSelected(g.key)}
                    >
                      {isSel && (
                        <span className="gcheck">
                          <Check size={13} strokeWidth={3} />
                        </span>
                      )}
                      <span className={`gicon ${g.tint}`}>
                        <GameIcon game={g.key} size={22} />
                      </span>
                      <h3>{g.label}</h3>
                      <p>{g.desc}</p>
                      <div className="gmeta">{meta}</div>
                    </button>
                  )
                })}
              </div>

              <div className="setup-bar">
                <span className={`gicon ${tintOf(selected)}`}>
                  <GameIcon game={selected} size={20} />
                </span>
                <div className="setup-info">
                  <div className="setup-title">{gameLabel(selected)} selected</div>
                  <div className="setup-sub">{subline}</div>
                </div>
                <div className="setup-actions">
                  <button className="btn btn-green btn-sm" onClick={quickMatch} disabled={busy}>
                    {busy ? <span className="spinner sm" /> : <><Zap /> Quick match</>}
                  </button>
                  <button className="btn btn-line btn-sm" onClick={() => createRoom(false)} disabled={busy}>
                    <Plus /> Open room
                  </button>
                  <button className="btn btn-line btn-sm" onClick={() => createRoom(true)} disabled={busy}>
                    <Link2 /> Invite
                  </button>
                </div>
              </div>
              {error && <p className="err-text" style={{ marginTop: 14 }}>{error}</p>}
            </div>

            <aside className="hub-rail">
              <div className="rail-card">
                <div className="rail-h">
                  <Users size={15} /> Online now <span className="rail-count">{onlineCount}</span>
                </div>
                {others.length === 0 ? (
                  <div className="rail-empty">Just you for now.</div>
                ) : (
                  <div className="rail-list">
                    {others.slice(0, 8).map((u) => (
                      <div className="online-row" key={u.id}>
                        <Avatar profile={u} />
                        <span className="online-name">{u.global_name || u.username}</span>
                        <span className="online-dot" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rail-card">
                <div className="rail-h">
                  <Trophy size={15} /> Top {gameLabel(selected)}
                </div>
                {topPlayers === null ? (
                  <div className="rail-empty">Loading…</div>
                ) : topPlayers.length === 0 ? (
                  <div className="rail-empty">No ranked games yet.</div>
                ) : (
                  <div className="rail-list">
                    {topPlayers.map((p) => (
                      <div
                        className={`mini-row${p.profile_id === myId ? ' me' : ''}`}
                        key={p.profile_id}
                      >
                        <span className={`medal r${p.rank}`}>
                          {p.rank === 1 ? <Crown size={13} /> : p.rank}
                        </span>
                        <Avatar profile={p} />
                        <span className="mini-name">{p.global_name || p.username}</span>
                        <span className="mini-rating">{p.rating}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
          </div>

          {myGames.length > 0 && (
            <section className="hub-section">
              <div className="glabel">Your games</div>
              <div className="rooms">
                {myGames.map((m) => {
                  const opp = m.player1 === myId ? m.p2 : m.p1
                  return (
                    <div className="room-row" key={m.id}>
                      <div className="who">
                        <span className={`gicon sm ${tintOf(m.game_type)}`}>
                          <GameIcon game={m.game_type} size={16} />
                        </span>
                        <div>
                          <div className="room-name">{gameLabel(m.game_type)}</div>
                          <div className="meta">
                            {m.status === 'waiting'
                              ? 'Waiting for an opponent…'
                              : `vs ${opp?.global_name || opp?.username || 'opponent'}`}
                          </div>
                        </div>
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

          <section className="hub-section">
            <div className="glabel">Open rooms</div>
            {openRooms.length === 0 ? (
              <div className="empty-state">
                No open rooms right now. Hit <strong>Quick match</strong> or open one — others can join you.
              </div>
            ) : (
              <div className="rooms">
                {openRooms.map((m) => {
                  const name = m.creator?.global_name || m.creator?.username || 'A Jordanian'
                  const rating = ratings[`${m.creator?.id}:${m.game_type}`]
                  return (
                    <div className="room-row" key={m.id}>
                      <div className="who">
                        <Avatar profile={m.creator} />
                        <div>
                          <div className="room-name">
                            {name}
                            {rating != null && <span className="rating-badge">{rating}</span>}
                          </div>
                          <div className="meta">wants to play {gameLabel(m.game_type)}</div>
                        </div>
                      </div>
                      <div className="room-right">
                        <span className="tag">{gameLabel(m.game_type)}</span>
                        <span className="room-ago">{timeAgo(m.created_at)}</span>
                        <button className="btn btn-green btn-sm" onClick={() => joinRoom(m.id)} disabled={busy}>
                          Join
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </main>
    </>
  )
}
