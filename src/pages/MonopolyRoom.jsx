import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Copy, Check, Play, LogOut, Crown, Landmark } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { useMonopolyRoom } from '../hooks/useMonopolyRoom.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'
import { TOKENS, tokenMeta } from '../games/monopolyTokens.js'
import { MIN_PLAYERS } from '../games/monopolyBoard.js'
import MonopolyGame from '../games/MonopolyGame.jsx'

export default function MonopolyRoom() {
  const { roomId } = useParams()
  const toast = useToast()
  const { profile } = useAuth()
  const { t, dir } = useLang()
  const hook = useMonopolyRoom(roomId)
  const { room, players, online, loading, error, connState, myId } = hook

  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const joinedRef = useRef(false)

  // Auto-join from a shared link while the room is still an open lobby.
  useEffect(() => {
    if (!room || joinedRef.current) return
    const amMember = players.some((p) => p.profile_id === myId)
    if (!amMember && room.status === 'lobby' && room.code) {
      joinedRef.current = true
      supabase.rpc('monopoly_join', { p_code: room.code }).then(() => hook.refetch())
    }
  }, [room, players, myId, hook])

  // Best-effort "I left" on unmount; the turn timer keeps the game moving anyway.
  useEffect(() => {
    return () => { supabase.rpc('monopoly_leave', { p_room: roomId }) }
  }, [roomId])

  const copyLink = useCallback(() => {
    navigator.clipboard?.writeText(`${window.location.origin}/monopoly/${roomId}`)
    setCopied(true)
    toast(t('mono.linkCopied'), 'success')
    setTimeout(() => setCopied(false), 1500)
  }, [roomId, toast, t])

  const pickToken = async (tk) => {
    const { error: err } = await supabase.rpc('monopoly_set_token', { p_room: roomId, p_token: tk })
    if (err) toast(err.message || t('mono.tokenTaken'), 'error')
  }

  const start = async () => {
    setBusy(true)
    const res = await hook.sendAction('start')
    setBusy(false)
    if (res?.error) toast(res.error, 'error')
  }

  if (loading) {
    return (<><AppNav /><div className="page-loader"><div className="spinner" /></div></>)
  }
  if (error || !room) {
    return (
      <>
        <AppNav />
        <main className="app-main"><div className="app-wrap center">
          <div className="empty-state">
            {t('mono.notFound')}
            <div style={{ marginTop: 18 }}><Link className="btn btn-green btn-sm" to="/monopoly">{t('mono.backHome')}</Link></div>
          </div>
        </div></main>
      </>
    )
  }

  const isHost = room.host === myId
  const presentPlayers = players.filter((p) => p.is_present)

  // -------------------- LOBBY --------------------
  if (room.status === 'lobby') {
    const takenBy = {} // token -> profile_id
    players.forEach((p) => { takenBy[p.token] = p.profile_id })
    return (
      <>
        <AppNav />
        <main className="app-main">
          <div className="app-wrap" dir={dir}>
            <div className="draw-room-head">
              <h1><Landmark size={22} style={{ verticalAlign: '-3px', marginInlineEnd: 8 }} />{t('mono.title')}</h1>
              <Link className="btn btn-line btn-sm" to="/monopoly">{t('mono.leave')}</Link>
            </div>

            <div className="draw-lobby">
              <div className="panel draw-lobby-invite">
                <span className="glabel">{t('mono.gameCode')}</span>
                <div className="draw-code-big">{room.code}</div>
                <button className="btn btn-line btn-sm" onClick={copyLink}>
                  {copied ? <><Check size={15} /> {t('mono.copied')}</> : <><Copy size={15} /> {t('mono.copyLink')}</>}
                </button>
                <div className="draw-lobby-meta">
                  {room.turn_seconds}s · {room.start_cash} JOD · {t('mono.maxPlayers')} {room.max_players}
                </div>
              </div>

              <div className="panel">
                <h4>{t('mono.players')} · {presentPlayers.length}/{room.max_players}</h4>
                <div className="draw-lobby-players">
                  {presentPlayers.map((p) => {
                    const prof = p.profile || {}
                    const meta = tokenMeta(p.token)
                    return (
                      <div className="draw-lobby-player" key={p.profile_id}>
                        <Avatar profile={prof} />
                        <span className="mono-token-emoji" title={p.token}>{meta.emoji}</span>
                        <span>{prof.global_name || prof.username || 'player'}</span>
                        {room.host === p.profile_id && <Crown size={13} className="draw-host-ic" />}
                        <span className={online.includes(p.profile_id) ? 'online-dot' : 'dot-offline'} />
                      </div>
                    )
                  })}
                </div>

                <div className="mono-token-pick" style={{ marginTop: 16 }}>
                  <span className="glabel">{t('mono.takeToken')}</span>
                  <div className="mono-token-row">
                    {TOKENS.map((tk) => {
                      const meta = tokenMeta(tk)
                      const owner = takenBy[tk]
                      const mine = owner === myId
                      const taken = owner && !mine
                      return (
                        <button
                          key={tk}
                          className={`mono-token-btn${mine ? ' mine' : ''}`}
                          style={{ '--tok': meta.color }}
                          disabled={taken}
                          onClick={() => pickToken(tk)}
                          aria-label={tk}
                          title={tk}
                        >
                          {meta.emoji}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {isHost ? (
                  <button className="btn btn-green btn-block" onClick={start} disabled={busy || presentPlayers.length < MIN_PLAYERS} style={{ marginTop: 18 }}>
                    {busy ? <span className="spinner sm" /> : <><Play size={16} /> {t('mono.startGame')}</>}
                  </button>
                ) : (
                  <p className="muted" style={{ marginTop: 18, textAlign: 'center' }}>{t('mono.waitHost')}</p>
                )}
                {isHost && presentPlayers.length < MIN_PLAYERS && (
                  <p className="muted" style={{ marginTop: 10, textAlign: 'center', fontSize: 13 }}>{t('mono.needTwo')}</p>
                )}
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  // -------------------- PLAYING / FINISHED --------------------
  return (
    <>
      <AppNav />
      <main className="app-main mono-main">
        <div className="mono-wrap" dir={dir}>
          {connState === 'reconnecting' && (
            <div className="status-banner wait reconnecting"><span className="spinner sm" /> {t('mono.reconnecting')}</div>
          )}
          <MonopolyGame hook={hook} t={t} dir={dir} myId={myId} profile={profile} />
        </div>
      </main>
    </>
  )
}
