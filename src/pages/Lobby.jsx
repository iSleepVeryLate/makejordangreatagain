import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Plus, Link2, Users, Trophy, Check, Crown, ArrowRight, Palette, Landmark } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useOnline } from '../context/PresenceContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { GAMES, GAME_BY_KEY } from '../games/config.js'
import { timeAgo } from '../lib/format.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'
import GameIcon from '../components/GameIcon.jsx'
import ChallengeButton from '../components/ChallengeButton.jsx'

const CREATOR = 'creator:profiles!matches_player1_fkey(id,username,global_name,avatar_url)'
const P1 = 'p1:profiles!matches_player1_fkey(id,username,global_name,avatar_url)'
const P2 = 'p2:profiles!matches_player2_fkey(id,username,global_name,avatar_url)'

const tintOf = (key) => GAME_BY_KEY[key]?.tint || 'g'

export default function Lobby() {
  const { profile } = useAuth()
  const { onlineUsers, onlineCount } = useOnline()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useLang()
  // Translated game label/description/hint by key.
  const gl = (key) => t(`game.${key}.label`)
  const gdesc = (key) => t(`game.${key}.desc`)
  const ghint = (key) => t(`game.${key}.hint`)

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

    // Realtime fires on every visible match change site-wide; debounce so a
    // burst of moves collapses into a single refetch instead of thrashing.
    let debounce
    const refresh = () => {
      clearTimeout(debounce)
      debounce = setTimeout(fetchData, 400)
    }
    const ch = supabase
      .channel('lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, refresh)
      .subscribe()

    // Fallback so live counts stay fresh even if realtime goes quiet, plus an
    // immediate catch-up whenever the tab regains focus.
    const interval = setInterval(() => {
      if (!document.hidden) fetchData()
    }, 15000)
    const onVisible = () => {
      if (!document.hidden) fetchData()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(debounce)
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
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
      const msg = e.message || t('app.common.somethingWrong')
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  const quickMatch = () => run(() => supabase.rpc('join_open_room', { p_game_type: selected }))
  const createRoom = (priv) =>
    run(() => supabase.rpc('create_room', { p_game_type: selected, p_is_private: priv }))
  const joinRoom = (id) => run(() => supabase.rpc('join_by_id', { p_match_id: id }))

  const others = onlineUsers.filter((u) => u.id !== myId)
  // Surface what needs attention: active games (your move first), then rooms
  // still waiting on an opponent.
  const sortedMyGames = [...myGames].sort((a, b) => {
    const rank = (m) => (m.status === 'active' ? (m.current_turn === myId ? 0 : 1) : 2)
    return rank(a) - rank(b)
  })
  const liveSel = liveCounts[selected] || 0
  const waitSel = waitingCounts[selected] || 0
  const subline =
    liveSel > 0
      ? t('app.hub.sublineLive', { n: liveSel })
      : waitSel > 0
        ? t('app.hub.sublineWaiting', { n: waitSel })
        : t('app.hub.sublineNone')

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="hub-head">
            <div>
              <h1>{t('app.hub.title')}</h1>
              <p>{t('app.hub.subtitle')}</p>
            </div>
            <div className={`live-pill${onlineCount > 0 ? ' on' : ''}`}>
              <span className="pulse" />
              {onlineCount > 0 ? t('app.hub.online', { n: onlineCount }) : t('app.hub.connecting')}
            </div>
          </div>

          <div className="hub-layout">
            <div className="hub-main">
              <div className="glabel">{t('app.hub.chooseGame')}</div>
              <div className="game-grid">
                {GAMES.map((g) => {
                  const live = liveCounts[g.key] || 0
                  const waiting = waitingCounts[g.key] || 0
                  const isSel = selected === g.key
                  return (
                    <button
                      key={g.key}
                      className={`gcard ${g.tint}${isSel ? ' selected' : ''}`}
                      onClick={() => setSelected(g.key)}
                    >
                      <div className="gcard-top">
                        <span className={`gicon ${g.tint}`}>
                          <GameIcon game={g.key} size={23} />
                        </span>
                        {live > 0 ? (
                          <span className="card-badge live">
                            <span className="ld" />
                            {t('app.hub.live', { n: live })}
                          </span>
                        ) : waiting > 0 ? (
                          <span className="card-badge wait">{t('app.hub.waiting', { n: waiting })}</span>
                        ) : (
                          <span className="card-badge dur">{ghint(g.key)}</span>
                        )}
                      </div>
                      <h3>{gl(g.key)}</h3>
                      <p>{gdesc(g.key)}</p>
                      <div className="gcard-foot">
                        <span className="select-hint">{isSel ? t('app.hub.selected') : t('app.hub.tapSelect')}</span>
                        {isSel ? (
                          <Check className="arrow" size={16} strokeWidth={2.6} />
                        ) : (
                          <ArrowRight className="arrow" size={16} />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div className="play-panel">
                <span className={`gicon ${tintOf(selected)}`}>
                  <GameIcon game={selected} size={22} />
                </span>
                <div className="play-info">
                  <div className="play-title">{t('app.hub.gameSelected', { game: gl(selected) })}</div>
                  <div className="play-sub">{subline}</div>
                </div>
                <div className="play-actions">
                  <button className="btn btn-green btn-sm" onClick={quickMatch} disabled={busy}>
                    {busy ? <span className="spinner sm" /> : <><Zap /> {t('app.hub.quickMatch')}</>}
                  </button>
                  <button className="btn btn-line btn-sm" onClick={() => createRoom(false)} disabled={busy}>
                    <Plus /> {t('app.hub.openRoom')}
                  </button>
                  <button className="btn btn-line btn-sm" onClick={() => createRoom(true)} disabled={busy}>
                    <Link2 /> {t('app.hub.invite')}
                  </button>
                </div>
              </div>
              {error && <p className="err-text" style={{ marginTop: 14 }}>{error}</p>}

              <button className="party-card" onClick={() => navigate('/draw')}>
                <span className="gicon v"><Palette size={22} /></span>
                <div className="party-info">
                  <div className="party-title">
                    {t('draw.title')} <span className="party-new">{t('app.hub.partyTag')}</span>
                  </div>
                  <div className="party-sub">
                    {t('app.hub.partySub')}
                  </div>
                </div>
                <span className="party-go">{t('app.hub.partyPlay')} <ArrowRight size={15} /></span>
              </button>

              <button className="party-card" onClick={() => navigate('/monopoly')}>
                <span className="gicon a"><Landmark size={22} /></span>
                <div className="party-info">
                  <div className="party-title">
                    {t('mono.title')} <span className="party-new">{t('app.hub.boardTag')}</span>
                  </div>
                  <div className="party-sub">
                    {t('app.hub.monopolySub')}
                  </div>
                </div>
                <span className="party-go">{t('app.hub.partyPlay')} <ArrowRight size={15} /></span>
              </button>
            </div>

            <aside className="hub-rail">
              <div className="rail-card">
                <div className="rail-h">
                  <Users size={15} /> {t('app.hub.onlineNow')} <span className="rail-count">{onlineCount}</span>
                </div>
                {others.length === 0 ? (
                  <div className="rail-empty">{t('app.hub.justYou')}</div>
                ) : (
                  <div className="rail-list">
                    {others.slice(0, 8).map((u) => (
                      <div className="online-row" key={u.id}>
                        <Avatar profile={u} />
                        <span className="online-name">{u.global_name || u.username}</span>
                        <ChallengeButton toId={u.id} variant="icon" />
                        <span className="online-dot" />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rail-card">
                <div className="rail-h">
                  <Trophy size={15} /> {t('app.hub.topPlayers', { game: gl(selected) })}
                </div>
                {topPlayers === null ? (
                  <div className="rail-list">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton skel-mini" />
                    ))}
                  </div>
                ) : topPlayers.length === 0 ? (
                  <div className="rail-empty">{t('app.hub.noRanked')}</div>
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
              <div className="glabel">{t('app.hub.yourGames')}</div>
              <div className="rooms">
                {sortedMyGames.map((m) => {
                  const opp = m.player1 === myId ? m.p2 : m.p1
                  const yourMove = m.status === 'active' && m.current_turn === myId
                  return (
                    <div className="room-row" key={m.id}>
                      <div className="who">
                        <span className={`gicon sm ${tintOf(m.game_type)}`}>
                          <GameIcon game={m.game_type} size={16} />
                        </span>
                        <div>
                          <div className="room-name">
                            {gl(m.game_type)}
                            {yourMove && <span className="turn-chip">{t('app.hub.yourMove')}</span>}
                          </div>
                          <div className="meta">
                            {m.status === 'waiting'
                              ? t('app.hub.waitingOpponent')
                              : t('app.hub.vs', { name: opp?.global_name || opp?.username || t('app.hub.opponent') })}
                          </div>
                        </div>
                      </div>
                      <button className="btn btn-green btn-sm" onClick={() => go(m)}>
                        {m.status === 'waiting' ? t('app.hub.openRoom') : t('app.hub.resume')}
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          <section className="hub-section">
            <div className="glabel">{t('app.hub.openRooms')}</div>
            {openRooms.length === 0 ? (
              <div className="empty-state">
                {t('app.hub.noOpenRoomsPre')}<strong>{t('app.hub.quickMatch')}</strong>{t('app.hub.noOpenRoomsPost')}
              </div>
            ) : (
              <div className="rooms">
                {openRooms.map((m) => {
                  const name = m.creator?.global_name || m.creator?.username || t('app.hub.aJordanian')
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
                          <div className="meta">{t('app.hub.wantsToPlay', { game: gl(m.game_type) })}</div>
                        </div>
                      </div>
                      <div className="room-right">
                        <span className="tag">{gl(m.game_type)}</span>
                        <span className="room-ago">{timeAgo(m.created_at)}</span>
                        <button className="btn btn-green btn-sm" onClick={() => joinRoom(m.id)} disabled={busy}>
                          {t('app.hub.join')}
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
