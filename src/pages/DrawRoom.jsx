import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Copy, Check, Play, LogOut, Crown, Trophy, RotateCcw, Palette } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { useDrawRoom } from '../hooks/useDrawRoom.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'
import Confetti from '../components/Confetti.jsx'
import DrawCanvas from '../games/DrawCanvas.jsx'
import DrawGuessPanel from '../games/DrawGuessPanel.jsx'

// Total seconds per phase, used only to size the countdown bar (the server owns
// the real deadline via phase_ends_at).
const PHASE_TOTAL = (room) =>
  room.phase === 'drawing' ? room.round_seconds : room.phase === 'reveal' ? 6 : 20

export default function DrawRoom() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { profile } = useAuth()
  const { t, dir } = useLang()
  const {
    room, players, online, loading, error, connState, myId,
    applyRoom, refetch, sendBroadcast, onMessage,
  } = useDrawRoom(roomId)

  const myName = profile?.global_name || profile?.username || 'you'
  const [secret, setSecret] = useState(null) // drawer-only { phase, choices, word }
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [nowTs, setNowTs] = useState(() => Date.now())
  const joinedRef = useRef(false)
  const closedToastRef = useRef(false)

  useEffect(() => {
    const i = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(i)
  }, [])

  // Surface a server-initiated close (idle sweep / admin) so a swept player isn't
  // left wondering why the game suddenly ended. The finished podium still renders.
  useEffect(() => {
    if (room?.status === 'finished' && room?.closed_reason && !closedToastRef.current) {
      closedToastRef.current = true
      toast(t(room.closed_reason === 'admin' ? 'draw.closedAdmin' : 'draw.closedInactive'), 'info')
    }
  }, [room?.status, room?.closed_reason, toast, t])

  // Auto-join from a shared link while the room is still an open lobby.
  useEffect(() => {
    if (!room || joinedRef.current) return
    const amMember = players.some((p) => p.profile_id === myId)
    if (!amMember && room.status === 'lobby' && room.code) {
      joinedRef.current = true
      supabase.rpc('draw_join', { p_code: room.code }).then(() => refetch())
    }
  }, [room, players, myId, refetch])

  // Mark myself gone when I leave the page (best-effort; the timer keeps the room
  // moving regardless).
  useEffect(() => {
    return () => {
      supabase.rpc('draw_leave', { p_room: roomId })
    }
  }, [roomId])

  // The drawer pulls their private choices/word (survives reload). Re-fetched
  // whenever the turn or phase changes.
  useEffect(() => {
    if (!room) return
    if (room.drawer !== myId || !['choosing', 'drawing', 'reveal'].includes(room.phase)) {
      setSecret(null)
      return
    }
    let active = true
    supabase.rpc('draw_drawer_view', { p_room: room.id }).then(({ data }) => {
      if (active && data) setSecret(data)
    })
    return () => { active = false }
  }, [room?.drawer, room?.phase, room?.round, room?.turn_index, myId, room?.id])

  const start = async () => {
    setBusy(true)
    const { data, error: err } = await supabase.rpc('draw_start', { p_room: roomId })
    setBusy(false)
    if (err) return toast(err.message, 'error')
    if (data) applyRoom(data)
  }

  const choose = async (idx) => {
    const { data, error: err } = await supabase.rpc('draw_choose_word', { p_room: roomId, p_choice_idx: idx })
    if (err) return toast(err.message, 'error')
    if (data?.room) {
      applyRoom(data.room)
      setSecret({ phase: 'drawing', word: data.word, choices: null })
    }
  }

  const playAgain = async () => {
    setBusy(true)
    const { data, error: err } = await supabase.rpc('draw_reset', { p_room: roomId })
    setBusy(false)
    if (err) return toast(err.message, 'error')
    if (data) applyRoom(data)
  }

  const copyLink = useCallback(() => {
    navigator.clipboard?.writeText(`${window.location.origin}/draw/${roomId}`)
    setCopied(true)
    toast(t('draw.linkCopied'), 'success')
    setTimeout(() => setCopied(false), 1500)
  }, [roomId, toast, t])

  if (loading) {
    return (<><AppNav /><div className="page-loader"><div className="spinner" /></div></>)
  }
  if (error || !room) {
    return (
      <>
        <AppNav />
        <main className="app-main"><div className="app-wrap center">
          <div className="empty-state">
            {t('draw.notFound')}
            <div style={{ marginTop: 18 }}><Link className="btn btn-green btn-sm" to="/draw">{t('draw.backHome')}</Link></div>
          </div>
        </div></main>
      </>
    )
  }

  const isHost = room.host === myId
  const iAmDrawer = room.drawer === myId
  const drawerPlayer = players.find((p) => p.profile_id === room.drawer)
  const drawerName = drawerPlayer?.profile?.global_name || drawerPlayer?.profile?.username || '…'
  const remaining = room.phase_ends_at ? Math.max(0, (new Date(room.phase_ends_at).getTime() - nowTs) / 1000) : 0
  const secsLeft = Math.ceil(remaining)
  const pct = room.phase_ends_at ? Math.min(100, (remaining / PHASE_TOTAL(room)) * 100) : 0
  const roundKey = `${room.round}:${room.turn_index}`

  // -------------------- LOBBY --------------------
  if (room.status === 'lobby') {
    return (
      <>
        <AppNav />
        <main className="app-main">
          <div className="app-wrap" dir={dir}>
            <div className="draw-room-head">
              <h1><Palette size={22} style={{ verticalAlign: '-3px', marginInlineEnd: 8 }} />{t('draw.title')}</h1>
              <Link className="btn btn-line btn-sm" to="/draw">{t('draw.leave')}</Link>
            </div>

            <div className="draw-lobby">
              <div className="panel draw-lobby-invite">
                <span className="glabel">{t('draw.roomCode')}</span>
                <div className="draw-code-big">{room.code}</div>
                <button className="btn btn-line btn-sm" onClick={copyLink}>
                  {copied ? <><Check size={15} /> {t('draw.copied')}</> : <><Copy size={15} /> {t('draw.copyLink')}</>}
                </button>
                <div className="draw-lobby-meta">
                  {room.lang === 'ar' ? 'العربية' : 'English'} · {room.total_rounds} {t('draw.roundsShort')} · {room.round_seconds}s
                </div>
              </div>

              <div className="panel">
                <h4>{t('draw.players')} · {players.length}</h4>
                <div className="draw-lobby-players">
                  {players.map((p) => {
                    const prof = p.profile || {}
                    return (
                      <div className="draw-lobby-player" key={p.profile_id}>
                        <Avatar profile={prof} />
                        <span>{prof.global_name || prof.username || 'player'}</span>
                        {room.host === p.profile_id && <Crown size={13} className="draw-host-ic" />}
                        <span className={online.includes(p.profile_id) ? 'online-dot' : 'dot-offline'} />
                      </div>
                    )
                  })}
                </div>

                {isHost ? (
                  <button className="btn btn-green btn-block" onClick={start} disabled={busy || players.length < 2} style={{ marginTop: 18 }}>
                    {busy ? <span className="spinner sm" /> : <><Play size={16} /> {t('draw.startGame')}</>}
                  </button>
                ) : (
                  <p className="muted" style={{ marginTop: 18, textAlign: 'center' }}>{t('draw.waitHost')}</p>
                )}
                {isHost && players.length < 2 && (
                  <p className="muted" style={{ marginTop: 10, textAlign: 'center', fontSize: 13 }}>{t('draw.needTwo')}</p>
                )}
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  // -------------------- FINISHED (podium) --------------------
  if (room.status === 'finished') {
    const ranked = [...players].sort((a, b) => b.score - a.score)
    const top = ranked.slice(0, 3)
    const iWon = ranked[0]?.profile_id === myId
    return (
      <>
        <AppNav />
        <main className="app-main">
          <div className="app-wrap" dir={dir}>
            <div className="board-panel draw-podium-panel">
              {iWon && <Confetti />}
              <Trophy size={40} className="draw-podium-trophy" />
              <h2>{t('draw.gameOver')}</h2>
              <div className="draw-podium">
                {top.map((p, i) => {
                  const prof = p.profile || {}
                  return (
                    <div className={`draw-podium-spot p${i + 1}`} key={p.profile_id}>
                      <Avatar profile={prof} size="lg" />
                      <span className={`medal r${i + 1}`}>{i + 1}</span>
                      <div className="draw-podium-name">{prof.global_name || prof.username}</div>
                      <div className="draw-podium-score">{p.score}</div>
                    </div>
                  )
                })}
              </div>

              <div className="draw-final-list">
                {ranked.slice(3).map((p, i) => (
                  <div className="draw-score-row" key={p.profile_id}>
                    <span className="draw-rank">{i + 4}</span>
                    <span className="draw-pname">{p.profile?.global_name || p.profile?.username}</span>
                    <span className="draw-score-num">{p.score}</span>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 26 }}>
                {isHost && (
                  <button className="btn btn-green" onClick={playAgain} disabled={busy}>
                    <RotateCcw size={16} /> {t('draw.playAgain')}
                  </button>
                )}
                <Link className="btn btn-line" to="/draw">{t('draw.backHome')}</Link>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  // -------------------- PLAYING (choosing / drawing / reveal) --------------------
  const canDraw = room.phase === 'drawing' && iAmDrawer
  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap" dir={dir}>
          <div className="draw-room-head">
            <div className="draw-round-info">
              <span className="draw-round-badge">{t('draw.round')} {room.round}/{room.total_rounds}</span>
              {room.phase === 'drawing' && (
                iAmDrawer
                  ? <span className="draw-word-you">{t('draw.youAreDrawing')}: <b>{secret?.word || '…'}</b></span>
                  : <span className="draw-word-mask">{(room.word_hint || '').split('').join(' ')}</span>
              )}
              {room.phase === 'choosing' && (
                <span className="muted">{iAmDrawer ? t('draw.pickWord') : `${drawerName} ${t('draw.isChoosing')}`}</span>
              )}
            </div>
            <div className="draw-timer-side">
              {(room.phase === 'drawing' || room.phase === 'choosing') && <span className="draw-secs">{secsLeft}s</span>}
              <Link className="btn btn-line btn-sm" to="/draw"><LogOut size={14} /></Link>
            </div>
          </div>

          {(room.phase === 'drawing' || room.phase === 'choosing') && (
            <div className="draw-timer-bar"><span style={{ width: `${pct}%` }} /></div>
          )}
          {connState === 'reconnecting' && (
            <div className="status-banner wait reconnecting" style={{ marginTop: 12 }}>
              <span className="spinner sm" /> {t('draw.reconnecting')}
            </div>
          )}

          <div className="draw-layout">
            <div className="draw-main">
              <div className="draw-stage">
                <DrawCanvas
                  canDraw={canDraw}
                  roundKey={roundKey}
                  sendBroadcast={sendBroadcast}
                  onMessage={onMessage}
                />

                {room.phase === 'choosing' && (
                  <div className="draw-overlay">
                    {iAmDrawer ? (
                      <div className="draw-choose">
                        <h3>{t('draw.chooseWord')}</h3>
                        <div className="draw-choices">
                          {(secret?.choices || []).map((w, i) => (
                            <button key={i} className="btn btn-green draw-choice" onClick={() => choose(i)}>{w}</button>
                          ))}
                          {!secret?.choices && <span className="spinner sm" />}
                        </div>
                      </div>
                    ) : (
                      <div className="draw-choose">
                        <Avatar profile={drawerPlayer?.profile} size="md" />
                        <p>{drawerName} {t('draw.isChoosing')}</p>
                      </div>
                    )}
                  </div>
                )}

                {room.phase === 'reveal' && (
                  <div className="draw-overlay">
                    <div className="draw-reveal">
                      <span className="glabel">{t('draw.theWordWas')}</span>
                      <div className="draw-reveal-word">{room.reveal_word}</div>
                      <p className="muted">{t('draw.nextUp')}…</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <DrawGuessPanel
              room={room}
              players={players}
              myId={myId}
              myName={myName}
              sendBroadcast={sendBroadcast}
              onMessage={onMessage}
              t={t}
            />
          </div>
        </div>
      </main>
    </>
  )
}
