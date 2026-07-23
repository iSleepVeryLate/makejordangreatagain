import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Copy, Check, Play, LogOut, Crown, Ghost, RotateCcw, Zap, Skull, Siren } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { useMundassRoom } from '../hooks/useMundassRoom.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'
import Confetti from '../components/Confetti.jsx'
import MundassCanvas from '../games/mundass/MundassCanvas.jsx'
import MeetingOverlay from '../games/mundass/MeetingOverlay.jsx'
import TaskModal from '../games/mundass/minigames.jsx'
import { COLORS, MANHOLES } from '../games/mundass/map.js'

// المندس room: lobby → the hara (canvas + HUD) → meetings → end reveal.
// All authority is server-side (mundass-action); this page renders state and
// forwards intents. The role banner + kill/sabotage controls key off `me` (my
// secret view) — nothing role-shaped exists for other players in the DOM.

const MIN_PLAYERS = 4

export default function MundassRoom() {
  const { roomId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t, lang, dir } = useLang()
  const {
    room, players, me, online, loading, error, connState, myId,
    refetch, sendAction, sendBroadcast, onMessage, serverNow,
  } = useMundassRoom(roomId)

  const state = room?.state || {}
  const phase = state.phase || 'lobby'
  const iAmGhost = state.alive?.[myId] === false
  const isMundass = me?.role === 'mundass'

  // Refs the canvas loop reads every frame without re-rendering React.
  const stateRef = useRef(state)
  const meRef = useRef(me || {})
  stateRef.current = state
  meRef.current = me || {}
  const canvasRef = useRef(null)

  const [nearest, setNearest] = useState(null)
  const [killTarget, setKillTarget] = useState(null)
  const [openTask, setOpenTask] = useState(null) // task id | 'fix'
  const [chat, setChat] = useState([])
  const [roleCard, setRoleCard] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, forceTick] = useState(0) // 1s HUD ticker (cooldown ring)

  const joinedRef = useRef(false)
  const closedToastRef = useRef(false)
  const roleShownRef = useRef(null)
  const prevPhaseRef = useRef(phase)

  // ---- lifecycle: auto-join from a shared link, best-effort leave ----
  useEffect(() => {
    if (!room || !myId || joinedRef.current) return
    const amMember = players.some((p) => p.profile_id === myId)
    if (!amMember && room.status === 'lobby' && room.code) {
      joinedRef.current = true
      supabase.rpc('mundass_join', { p_code: room.code }).then(
        () => refetch(),
        (err) => toast(err?.message || t('mundass.err.join'), 'error'),
      )
    }
  }, [room, players, myId, refetch, toast, t])

  useEffect(() => {
    return () => {
      supabase.rpc('mundass_leave', { p_room: roomId }).then(() => {}, () => {})
    }
  }, [roomId])

  // Server-closed toast (sweep/admin), draw-style.
  useEffect(() => {
    if (!room?.closed_reason || closedToastRef.current) return
    closedToastRef.current = true
    toast(t(room.closed_reason === 'admin' ? 'mundass.closedAdmin' : 'mundass.closedInactive'), 'info')
  }, [room?.closed_reason, toast, t])

  // ---- role card: shown once per game start ----
  useEffect(() => {
    if (phase !== 'playing' && phase !== 'meeting') return
    if (!me?.role || roleShownRef.current === state.startedAt) return
    roleShownRef.current = state.startedAt
    setRoleCard(true)
    const to = setTimeout(() => setRoleCard(false), 3500)
    return () => clearTimeout(to)
  }, [me?.role, phase, state.startedAt])

  // ---- respawn at the courtyard on start and after every meeting ----
  useEffect(() => {
    const prev = prevPhaseRef.current
    prevPhaseRef.current = phase
    const idx = Math.max(0, players.findIndex((p) => p.profile_id === myId))
    if ((prev === 'lobby' && phase === 'playing') || (prev === 'meeting' && phase === 'playing')) {
      canvasRef.current?.respawn(idx, Math.max(1, players.length))
      setOpenTask(null)
    }
    if (phase === 'meeting' && prev !== 'meeting') {
      setOpenTask(null)
      setChat([]) // each meeting gets a fresh council log
    }
  }, [phase, players, myId])

  // ---- meeting chat over the ephemeral bus ----
  useEffect(() => {
    return onMessage((msg) => {
      if (msg?.t !== 'chat') return
      setChat((c) => [...c.slice(-80), msg])
    })
  }, [onMessage])

  const myName = useCallback(() => {
    const p = players.find((pp) => pp.profile_id === myId)
    return p?.profile?.global_name || p?.profile?.username || '؟'
  }, [players, myId])

  const sendChat = useCallback((text) => {
    const msg = { t: 'chat', name: myName(), text, ghost: iAmGhost }
    sendBroadcast(msg)
    setChat((c) => [...c.slice(-80), msg]) // self:false → echo locally
  }, [sendBroadcast, myName, iAmGhost])

  // ---- 1s HUD ticker (kill cooldown, sabotage pulse) ----
  useEffect(() => {
    if (phase !== 'playing') return undefined
    const iv = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(iv)
  }, [phase])

  // ---- actions ----
  const act = useCallback(async (action, args) => {
    const { error: err } = await sendAction(action, args)
    if (err && err !== 'not_allowed') toast(t(`mundass.rej.${err}`) === `mundass.rej.${err}` ? err : t(`mundass.rej.${err}`), 'error')
  }, [sendAction, toast, t])

  const useNearest = useCallback(() => {
    if (!nearest) return
    if (nearest.kind === 'task') setOpenTask(nearest.taskId)
    else if (nearest.kind === 'breaker') setOpenTask('fix')
    else if (nearest.kind === 'report') act('report', { victim: nearest.victim })
    else if (nearest.kind === 'mihbash') act('emergency')
    else if (nearest.kind === 'manhole') {
      const next = MANHOLES[(nearest.index + 1) % MANHOLES.length]
      canvasRef.current?.teleport(next.x, next.y + 60)
    }
  }, [nearest, act])

  // Keyboard: E / Space = use, Q = kill (mundass).
  useEffect(() => {
    const onKey = (e) => {
      if (phase !== 'playing' || openTask) return
      const k = e.key.toLowerCase()
      if (k === 'e' || k === ' ') useNearest()
      if (k === 'q' && isMundass && killTarget) {
        act('kill', { victim: killTarget.victim, x: Math.round(killTarget.x), y: Math.round(killTarget.y) })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, openTask, useNearest, isMundass, killTarget, act])

  const taskDone = useCallback((taskId) => {
    setOpenTask(null)
    if (taskId === 'fix') act('fix_sabotage')
    else act('task_done', { taskId })
  }, [act])

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/mundass/${roomId}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
      toast(t('mundass.linkCopied'), 'success')
    } catch { /* ignore */ }
  }

  const start = async () => {
    setBusy(true)
    await act('start')
    setBusy(false)
  }

  const reset = async () => {
    setBusy(true)
    const { error: err } = await supabase.rpc('mundass_reset', { p_room: roomId })
    setBusy(false)
    if (err) toast(err.message, 'error')
    else refetch()
  }

  const leave = async () => {
    await supabase.rpc('mundass_leave', { p_room: roomId }).then(() => {}, () => {})
    navigate('/mundass')
  }

  // ---------------- render ----------------
  if (loading) return <div className="page-loader"><div className="spinner" /></div>
  if (error || !room) {
    return (
      <>
        <AppNav />
        <main className="app-main"><div className="app-wrap" dir={dir}>
          <div className="panel" style={{ textAlign: 'center', padding: 40 }}>
            <p>{error || t('mundass.err.notFound')}</p>
            <button className="btn btn-line" onClick={() => navigate('/mundass')}>{t('mundass.back')}</button>
          </div>
        </div></main>
      </>
    )
  }

  const presentCount = players.filter((p) => p.is_present).length
  const iAmHost = room.host === myId

  // ---- LOBBY ----
  if (room.status === 'lobby') {
    return (
      <>
        <AppNav />
        <main className="app-main">
          <div className="app-wrap" dir={dir}>
            <div className="mun-lobby panel">
              <div className="mun-lobby-head">
                <h2><Ghost size={22} /> {t('mundass.title')}</h2>
                <div className="mun-code-row">
                  <span className="mun-code">{room.code}</span>
                  <button className="btn btn-line btn-sm" onClick={copyInvite}>
                    {copied ? <Check size={14} /> : <Copy size={14} />} {t('mundass.invite')}
                  </button>
                </div>
              </div>
              <p className="mun-lobby-sub">
                {t('mundass.lobbyRules', { n: MIN_PLAYERS })}
              </p>
              <div className="mun-lobby-players">
                {players.map((p) => (
                  <div key={p.profile_id} className={`mun-lobby-player ${p.is_present ? '' : 'away'}`}>
                    <span className="mun-meet-chip" style={{ background: COLORS[(p.color || 0) % COLORS.length] }} />
                    <Avatar profile={p.profile} size="sm" />
                    <span className="mun-lobby-name">
                      {p.profile?.global_name || p.profile?.username}
                      {p.profile_id === room.host && <Crown size={13} className="mun-crown" />}
                    </span>
                    <span className={online.includes(p.profile_id) ? 'dot-online' : 'dot-offline'} />
                  </div>
                ))}
              </div>
              <div className="mun-lobby-actions">
                {iAmHost ? (
                  <button className="btn btn-green" onClick={start} disabled={busy || presentCount < MIN_PLAYERS}>
                    <Play size={16} /> {presentCount < MIN_PLAYERS
                      ? t('mundass.needPlayers', { n: MIN_PLAYERS - presentCount })
                      : t('mundass.startGame')}
                  </button>
                ) : (
                  <span className="mun-lobby-wait">{t('mundass.waitingHost')}</span>
                )}
                <button className="btn btn-line" onClick={leave}><LogOut size={15} /> {t('mundass.leave')}</button>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  // ---- FINISHED ----
  if (room.status === 'finished') {
    const winner = state.winner || room.winner
    const reveal = state.reveal || {}
    const iWon = winner && ((winner === 'mundass') === (me?.role === 'mundass')) && me?.role
    return (
      <>
        <AppNav />
        {iWon && <Confetti />}
        <main className="app-main">
          <div className="app-wrap" dir={dir}>
            <div className="mun-end panel">
              <div className={`mun-end-banner ${winner === 'mundass' ? 'mundass' : 'crew'}`}>
                {winner === 'mundass' ? t('mundass.mundassWin') : t('mundass.crewWin')}
              </div>
              <div className="mun-end-list">
                {players.map((p) => (
                  <div key={p.profile_id} className="mun-end-row">
                    <span className="mun-meet-chip" style={{ background: COLORS[(p.color || 0) % COLORS.length] }} />
                    <Avatar profile={p.profile} size="sm" />
                    <span className="mun-lobby-name">{p.profile?.global_name || p.profile?.username}</span>
                    <span className={`mun-end-role ${reveal[p.profile_id] === 'mundass' ? 'mundass' : ''}`}>
                      {reveal[p.profile_id] === 'mundass' ? t('mundass.roleMundass') : t('mundass.roleCrew')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mun-lobby-actions">
                {iAmHost && (
                  <button className="btn btn-green" onClick={reset} disabled={busy}>
                    <RotateCcw size={15} /> {t('mundass.playAgain')}
                  </button>
                )}
                <button className="btn btn-line" onClick={() => navigate('/mundass')}>{t('mundass.back')}</button>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  // ---- PLAYING / MEETING ----
  const killCdLeft = isMundass && me?.killCooldownUntil
    ? Math.max(0, Math.ceil((me.killCooldownUntil - serverNow()) / 1000))
    : 0
  const frozen = phase === 'meeting' || !!openTask || roleCard
  const useLabel = !nearest ? '' : nearest.kind === 'task' ? t('mundass.doTask')
    : nearest.kind === 'report' ? t('mundass.report')
    : nearest.kind === 'mihbash' ? (me?.emergencyUsed ? t('mundass.mihbashUsed') : t('mundass.bangMihbash'))
    : nearest.kind === 'breaker' ? t('mundass.fixPower')
    : t('mundass.useManhole')

  return (
    <div className="mun-game" dir={dir}>
      <MundassCanvas
        ref={canvasRef}
        myId={myId}
        players={players}
        stateRef={stateRef}
        meRef={meRef}
        frozen={frozen}
        sendBroadcast={sendBroadcast}
        onMessage={onMessage}
        onNearest={setNearest}
        onKillTarget={setKillTarget}
        lang={lang}
      />

      {/* top HUD: task bar + status */}
      <div className="mun-hud-top">
        <button className="mun-hud-quit" onClick={leave} title={t('mundass.leave')}><LogOut size={15} /></button>
        <div className="mun-taskbar">
          <div className="mun-taskbar-label">{t('mundass.taskBar')}</div>
          <div className="mun-taskbar-track">
            <div
              className="mun-taskbar-fill"
              style={{ width: `${state.tasksTotal ? (100 * (state.tasksDone || 0)) / state.tasksTotal : 0}%` }}
            />
          </div>
        </div>
        {connState !== 'live' && <span className="mun-conn">{t('mundass.reconnecting')}</span>}
      </div>

      {/* my tasks */}
      {me?.tasks?.length > 0 && (
        <div className="mun-tasklist">
          <div className="mun-tasklist-head">
            {isMundass ? t('mundass.fakeTasks') : t('mundass.yourTasks')}
          </div>
          {me.tasks.map((task) => (
            <div key={task.id} className={`mun-tasklist-item ${task.done ? 'done' : ''}`}>
              {task.done ? '✓ ' : '• '}
              {t(`mundass.task.${task.id}`)}
            </div>
          ))}
        </div>
      )}

      {/* sabotage banner */}
      {state.sabotage === 'power' && (
        <div className="mun-sabotage-banner">⚡ {t('mundass.powerCut')}</div>
      )}
      {iAmGhost && <div className="mun-ghost-banner">👻 {t('mundass.ghostHint')}</div>}

      {/* bottom-right actions */}
      <div className="mun-hud-actions">
        {isMundass && !iAmGhost && (
          <>
            <button
              className="mun-act mun-act-sabotage"
              disabled={!!state.sabotage}
              onClick={() => act('sabotage')}
              title={t('mundass.sabotage')}
            >
              <Zap size={22} />
            </button>
            <button
              className={`mun-act mun-act-kill ${killTarget && !killCdLeft ? 'ready' : ''}`}
              disabled={!killTarget || killCdLeft > 0}
              onClick={() => killTarget && act('kill', {
                victim: killTarget.victim, x: Math.round(killTarget.x), y: Math.round(killTarget.y),
              })}
            >
              {killCdLeft > 0 ? <span className="mun-cd">{killCdLeft}</span> : <Skull size={24} />}
            </button>
          </>
        )}
        {nearest && (
          <button className="mun-act mun-act-use" onClick={useNearest}>
            {nearest.kind === 'report' ? <Siren size={22} /> : null} {useLabel}
          </button>
        )}
      </div>

      {/* role card */}
      {roleCard && me?.role && (
        <div className={`mun-rolecard ${isMundass ? 'mundass' : 'crew'}`}>
          <div className="mun-rolecard-title">
            {isMundass ? t('mundass.youAreMundass') : t('mundass.youAreCrew')}
          </div>
          <div className="mun-rolecard-sub">
            {isMundass ? t('mundass.mundassGoal') : t('mundass.crewGoal')}
          </div>
          {isMundass && me.mates?.length > 0 && (
            <div className="mun-rolecard-mates">
              {t('mundass.yourMate')}: {me.mates.map((uid) => {
                const p = players.find((pp) => pp.profile_id === uid)
                return p?.profile?.global_name || p?.profile?.username
              }).filter(Boolean).join('، ')}
            </div>
          )}
        </div>
      )}

      {/* task minigame */}
      {openTask && (
        <TaskModal taskId={openTask} lang={lang} t={t} onDone={taskDone} onClose={() => setOpenTask(null)} />
      )}

      {/* meeting */}
      {phase === 'meeting' && (
        <MeetingOverlay
          state={state}
          players={players}
          myId={myId}
          iAmGhost={iAmGhost}
          serverNow={serverNow}
          onVote={(target) => act('vote', { target })}
          chat={chat}
          onSendChat={sendChat}
          t={t}
          lang={lang}
          dir={dir}
        />
      )}
    </div>
  )
}
