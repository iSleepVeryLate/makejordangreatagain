import { useMemo, useState, useCallback, useEffect, useRef, memo, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import {
  Dice5, LogOut, Trophy, RotateCcw, Banknote, Handshake, X,
  Volume2, VolumeX, Maximize, Landmark, Flag, Box, Layers,
} from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useToast } from '../context/ToastContext.jsx'
import Confetti from '../components/Confetti.jsx'
import MonopolyBoard from './MonopolyBoard.jsx'
import MonopolyScene3D from './MonopolyScene3D.jsx'
import { shouldUse3D, setRenderPref, supportsWebGL } from './three/capability.js'
import TurnTimer from './TurnTimer.jsx'
import Dice3D from './Dice3D.jsx'
import { useSound } from '../hooks/useSound.js'
import { useBoardAnimator } from './useBoardAnimator.js'
import { COLOR_GROUPS, tileName, JAIL_FINE, isOwnable, safeTile, OWNABLE } from './monopolyBoard.js'
import { tokenMeta } from './monopolyTokens.js'
import * as aff from './monopolyAffordance.js'

const profName = (p) => p?.profile?.global_name || p?.profile?.username || 'player'

// Live OS-level "reduce motion" preference, kept current.
function useReducedMotion() {
  const [r, setR] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const h = () => setR(mq.matches)
    mq.addEventListener?.('change', h)
    return () => mq.removeEventListener?.('change', h)
  }, [])
  return r
}

// Smoothly counts the displayed number toward `value` (cash ticks up/down instead
// of snapping). Honors reduced motion (snaps). Format keeps JOD/locale formatting.
function CountUp({ value, format, reduced }) {
  const [display, setDisplay] = useState(value)
  const dispRef = useRef(value) // the value actually on screen right now
  const rafRef = useRef(0)
  useEffect(() => {
    const from = dispRef.current // start from what's shown, not a stale completion value
    const to = value
    if (from === to) return undefined
    if (reduced) { dispRef.current = to; setDisplay(to); return undefined }
    const start = performance.now()
    // G3 — a GAIN should read as a snappy "ticking up" payoff; a loss stays the calm glide.
    // Gains: shorter + a back-out ease (a tiny settle past the target) so the number feels
    // like it RACES up then locks. Losses: the gentle easeOutCubic at the original pace.
    const gain = to > from
    const dur = gain ? 460 : 600
    const ease = gain
      ? (k) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2) } // easeOutBack — a quick overshoot-and-settle "tick"
      : (k) => 1 - Math.pow(1 - k, 3) // easeOutCubic
    cancelAnimationFrame(rafRef.current)
    const tick = (t) => {
      const k = Math.min(1, (t - start) / dur)
      const v = Math.round(from + (to - from) * ease(k))
      dispRef.current = v
      setDisplay(v)
      if (k < 1) rafRef.current = requestAnimationFrame(tick)
      else { dispRef.current = to; setDisplay(to) } // land exactly on target (easeOutBack overshoots mid-flight)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, reduced])
  return <>{format ? format(display) : display}</>
}

// The two 3D dice, fed by the animator's dice slice (reflects broadcast "rolling"
// then the committed "settled" faces). Subscribing here keeps the tumble/settle
// off MonopolyGame's render path.
function DiceBox({ store, canRoll, onRoll, hint }) {
  const dice = useSyncExternalStore(store.dice.subscribe, store.dice.get)
  const interactive = !!canRoll && !dice.rolling
  return (
    <div
      className={`mono-dice${interactive ? ' clickable' : ''}`}
      aria-label={interactive ? hint : 'dice'}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={interactive ? onRoll : undefined}
      onKeyDown={interactive ? (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); onRoll() } } : undefined}
    >
      <Dice3D value={dice.a} rolling={dice.rolling} />
      <Dice3D value={dice.b} rolling={dice.rolling} />
    </div>
  )
}

export default function MonopolyGame({ hook, t, dir, myId }) {
  const toast = useToast()
  const { room, players, properties, sendAction, rollingBy, broadcast, online, serverNow } = hook
  const { play, muted, toggleMute } = useSound()
  const reducedMotion = useReducedMotion()
  const animator = useBoardAnimator(room, players, properties, { play, reducedMotion, myId })

  const [busy, setBusy] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [tradeOpen, setTradeOpen] = useState(false)
  const [deedTile, setDeedTile] = useState(null)
  // Renderer choice: 3D WebGL board vs the retained 2D DOM board ("Lite"). Defaults
  // per device capability + persisted preference; the header toggle flips it live.
  const [render3D, setRender3D] = useState(() => shouldUse3D())
  const canToggle3D = useMemo(() => supportsWebGL(), []) // probe once, never on a render hot path
  const rootRef = useRef(null)
  const busyRef = useRef(false) // synchronous in-flight lock so a double-click can't double-submit

  const money = useCallback((n) => t('mono.amount', { amount: n }), [t])

  const playerById = useMemo(() => Object.fromEntries(players.map((p) => [p.profile_id, p])), [players])
  const playerColor = useMemo(
    () => Object.fromEntries(players.map((p) => [p.profile_id, tokenMeta(p.token).color])), [players])
  // tile_index → property row, memoized once and shared with the board, popover,
  // and net-worth/affordance math (the board no longer builds its own).
  const propByTile = useMemo(() => {
    const m = {}
    for (const p of properties) m[p.tile_index] = p
    return m
  }, [properties])
  const myFullSets = useMemo(() => aff.fullSetsOwned(propByTile, myId), [propByTile, myId])
  const nameById = useMemo(() => Object.fromEntries(players.map((p) => [p.profile_id, profName(p)])), [players])
  // Compact holdings legend: who owns how many tiles (only those with any).
  const holdings = useMemo(() => players
    .map((p) => ({ id: p.profile_id, name: profName(p), color: tokenMeta(p.token).color, count: properties.filter((pr) => pr.owner === p.profile_id).length }))
    .filter((h) => h.count > 0), [players, properties])
  // Per-player owned colour groups (one pip per group; "full" when the set is complete)
  // — a glance-able read of who's close to a monopoly. Shown on each player card.
  const groupsByPlayer = useMemo(() => {
    const res = {}
    for (const p of players) {
      const owned = {}
      for (const pr of properties) {
        if (pr.owner !== p.profile_id) continue
        const c = safeTile(pr.tile_index).color
        if (c) owned[c] = (owned[c] || 0) + 1
      }
      res[p.profile_id] = Object.entries(owned)
        .map(([c, n]) => ({ hex: COLOR_GROUPS[c]?.hex || '#888', full: n === (COLOR_GROUPS[c]?.size || 99) }))
    }
    return res
  }, [players, properties])
  const lang = dir === 'rtl' ? 'ar' : 'en'

  const reversedLog = useMemo(() => (room?.log || []).map((e, i) => ({ e, i })).reverse(), [room?.log])

  const turnId = room?.turn_order?.[room?.current_seat]
  const isMyTurn = turnId === myId
  const me = playerById[myId]
  const phase = room?.phase
  const dice = room?.dice
  // Whether the player has an OUTSTANDING bonus roll. Mirrors the server, which
  // tracks this via doubles_count (not raw dice equality) so a jail-exit roll
  // that happens to be doubles never offers a free re-roll. dice === null means
  // the first roll of the turn hasn't happened yet.
  const canRollAgain = dice === null || (room?.doubles_count || 0) > 0

  // Who, if anyone, has dice tumbling right now: a remote roller (broadcast) or me.
  const rollingId = rollingBy || (rolling ? myId : null)

  const name = useCallback((id) => profName(playerById[id]), [playerById])

  // Away = the SERVER heartbeat says absent (is_present === false) AND realtime
  // presence doesn't list them either. Presence rides the same WebSocket the VPN
  // degrades, so on its own it falsely greys out an opponent who is actively playing
  // (their HTTP heartbeat + Edge actions land fine). is_present is the reliable signal.
  const isAway = useCallback(
    (p) => !!p && p.is_present === false && !(Array.isArray(online) && online.includes(p.profile_id)),
    [online],
  )

  // The next non-bankrupt player in seat order — surfaced as "up next" so whose
  // turn it is (and who follows) reads at a glance from the player rail.
  const nextTurnId = useMemo(() => {
    const order = room?.turn_order
    if (!Array.isArray(order) || order.length === 0) return null
    for (let k = 1; k <= order.length; k++) {
      const id = order[(room.current_seat + k) % order.length]
      const p = playerById[id]
      if (p && !p.bankrupt && id !== turnId) return id
    }
    return null
  }, [room?.turn_order, room?.current_seat, playerById, turnId])

  // Mirror remote roll-start presence into the dice tumble.
  useEffect(() => { if (rollingBy) animator.setRolling(true) }, [rollingBy, animator])

  const act = useCallback(async (action, args = {}) => {
    if (busyRef.current) return { busy: true } // already sending — ignore the extra click
    busyRef.current = true
    setBusy(true)
    const res = await sendAction(action, args)
    busyRef.current = false
    setBusy(false)
    if (res?.error) toast(res.error, 'error')
    return res
  }, [sendAction, toast])

  // Roll wrapper: tumble the dice locally AND broadcast roll-start so remote
  // players see it before the Edge round-trip lands. Both are best-effort cosmetic.
  const rollDice = useCallback(async (action) => {
    if (busyRef.current) return undefined // don't tumble/broadcast a roll we won't send
    setRolling(true)
    animator.setRolling(true)
    broadcast?.('roll', { by: myId })
    play('diceRoll')
    const res = await act(action)
    setRolling(false)
    return res
  }, [act, animator, broadcast, myId, play])

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) document.exitFullscreen?.()
    else el.requestFullscreen?.()
  }, [])

  const onTile = useCallback((i) => { if (isOwnable(i)) { setDeedTile(i); play('select') } }, [play])

  // WebGL context lost / scene-load failure → fall back to the 2D renderer once.
  const lostToastRef = useRef(false)
  const toggle3D = useCallback(() => {
    setRender3D((on) => {
      const next = !on
      if (next) lostToastRef.current = false // re-arm the one-shot fallback toast on re-enable
      setRenderPref(next ? '3d' : '2d')
      return next
    })
  }, [])

  const onContextLost = useCallback(() => {
    if (lostToastRef.current) return
    lostToastRef.current = true
    // Session-only fallback: a TRANSIENT loss (GPU/driver reset, sleep-wake) or a
    // one-off chunk-load failure must NOT pin the device to Lite forever. Persistence
    // is owned solely by the explicit toggle3D — next session retries 3D.
    setRender3D(false)
    toast(t('mono.glLost'), 'info')
  }, [toast, t])

  // ---------------- FINISHED ----------------
  if (room?.status === 'finished') {
    const winner = playerById[room.winner]
    const ranked = [...players].sort((a, b) => Number(a.bankrupt) - Number(b.bankrupt) || b.cash - a.cash)
    const iWon = room.winner === myId
    const isHost = room.host === myId
    return (
      <div className="board-panel mono-finish">
        {iWon && <Confetti />}
        <Trophy size={40} className="draw-podium-trophy" />
        <h2>{t('mono.gameOver')}</h2>
        <p className="mono-winner-name">{t('mono.winner', { name: winner ? name(room.winner) : '—' })}</p>
        <div className="mono-final-list">
          {ranked.map((p, i) => (
            <div className={`draw-score-row${p.profile_id === myId ? ' me' : ''}`} key={p.profile_id}>
              <span className="draw-rank">{i + 1}</span>
              <span className="mono-token-emoji">{tokenMeta(p.token).emoji}</span>
              <span className="draw-pname">{name(p.profile_id)}{p.bankrupt ? ` · ${t('mono.bankrupt')}` : ''}</span>
              <span className="draw-score-num">{money(p.cash)}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 22, justifyContent: 'center' }}>
          {isHost && (
            <button className="btn btn-green" disabled={busy} onClick={async () => {
              setBusy(true); const { data } = await supabase.rpc('monopoly_reset', { p_room: room.id })
              setBusy(false); if (data) hook.applyRoom(data)
            }}><RotateCcw size={16} /> {t('mono.playAgain')}</button>
          )}
          <Link className="btn btn-line" to="/monopoly">{t('mono.backHome')}</Link>
        </div>
      </div>
    )
  }

  if (!room || room.status !== 'playing') return <div className="page-loader"><div className="spinner" /></div>

  // ---------------- control dock (slim, non-covering) ----------------
  // The persistent HUD: whose turn + state, the primary action (roll / end turn) or
  // a spectator status line, and the timer. Transient DECISIONS (buy / auction / jail
  // / trade / debt) live in the centred MonoMoment overlay instead, so the board is
  // never permanently covered. Passed as children into both the 3D and 2D boards.
  const renderCenter = () => {
    const turnName = name(turnId)
    const tileLabel = (i) => (i != null ? tileName(safeTile(i), lang) : '')
    const turnMeta = tokenMeta(playerById[turnId]?.token)
    // What everyone who is NOT the active player sees: one clear, phase-aware line.
    let statusLine = null
    if (!isMyTurn) {
      const turnAway = isAway(playerById[turnId])
      if (rollingId && rollingId !== myId) statusLine = t('mono.statusRolling', { name: name(rollingId) })
      else if (turnAway) statusLine = t('mono.statusAway', { name: turnName })
      else if (phase === 'roll') statusLine = t('mono.statusThinking', { name: turnName })
      else if (phase === 'buy_decision') statusLine = t('mono.statusBuying', { name: turnName, tile: tileLabel(room.pending_purchase?.tile) })
      else if (phase === 'auction') statusLine = t('mono.statusAuction', { tile: tileLabel(room.pending_auction?.tile) })
      else if (phase === 'jail') statusLine = t('mono.statusJail', { name: turnName })
      else if (phase === 'trade_review') statusLine = t('mono.statusTrade', { name: name(room.pending_trade?.to) })
      else if (phase === 'awaiting_debt') statusLine = t('mono.statusDebt', { name: name(room.pending_debt?.debtor) })
    }
    // Bidi-safe turn label: a token avatar + the player's name on its own + a small
    // state tag — never the English "{name}'s" possessive glued to an Arabic name.
    const turnSub = rollingId ? t('mono.rolling') : (isMyTurn ? null : t('mono.turnTag'))
    return (
      <div className="mono-dock" dir={dir}>
        <div className={`mono-turnchip${isMyTurn ? ' you' : ''}${rollingId ? ' rolling' : ''}`} aria-live="polite">
          <span className="mono-turnchip-av" style={{ '--tok': turnMeta.color }}>{turnMeta.emoji}</span>
          <span className="mono-turnchip-txt">
            <b>{isMyTurn ? t('mono.yourTurn') : turnName}</b>
            {turnSub && <i>{turnSub}</i>}
          </span>
        </div>

        {!render3D && (
          <DiceBox store={animator}
            canRoll={isMyTurn && phase === 'roll' && canRollAgain && !busy}
            onRoll={() => rollDice('roll')} hint={t('mono.rollHint')} />
        )}

        <div className="mono-dock-main">
          {isMyTurn && phase === 'roll' && (
            <div className="mono-actions">
              {canRollAgain ? (
                <button className="btn btn-gold" disabled={busy} onClick={() => rollDice('roll')}>
                  <Dice5 size={16} /> {busy ? t('mono.rolling') : (dice ? t('mono.rollAgain') : t('mono.roll'))}
                </button>
              ) : (
                <button className="btn btn-gold" disabled={busy} onClick={() => act('end_turn')}>{t('mono.endTurn')}</button>
              )}
              <button className="btn btn-line btn-sm" onClick={() => setManageOpen(true)}>{t('mono.manage')}</button>
              <button className="btn btn-line btn-sm" onClick={() => setTradeOpen(true)}><Handshake size={14} /> {t('mono.trade')}</button>
            </div>
          )}
          {statusLine && <div className="mono-wait-status" aria-live="polite"><span className="mono-roll-dot" />{statusLine}</div>}
        </div>

        {room.last_card && room.last_card.by === turnId && (
          <div key={room.last_card.text?.en || room.seq} className={`mono-card-pop ${room.last_card.deck === 'chance' ? 'chance' : 'chest'}`}>
            <span className="mono-card-deck">{room.last_card.deck === 'chance' ? `❓ ${t('mono.chance')}` : `🎁 ${t('mono.chest')}`}</span>
            <p>{room.last_card.text?.[lang] || room.last_card.text?.en}</p>
          </div>
        )}

        {room.phase_ends_at && (
          <TurnTimer phaseEndsAt={room.phase_ends_at} turnSeconds={room.turn_seconds} serverNow={serverNow} />
        )}
      </div>
    )
  }

  // ---------------- decision moment (centred overlay over the board) ----------------
  // Cinematic, transient. Shown only to players who actually act (auction shows to
  // everyone — it's a shared event). The board dims gently behind it, like the
  // official game's property pop-ups; spectators otherwise keep watching the board.
  const renderMoment = () => {
    let kind = null
    let body = null
    if (phase === 'buy_decision' && isMyTurn && room.pending_purchase) {
      kind = 'buy'
      body = <BuyPanel pend={room.pending_purchase} lang={lang} t={t} money={money} busy={busy} cash={me?.cash || 0}
        onBuy={() => act('buy_property')} onDecline={() => act('decline_buy')} />
    } else if (phase === 'auction') {
      kind = 'auction'
      body = <AuctionPanel room={room} myId={myId} name={name} lang={lang} t={t} money={money} busy={busy}
        playerById={playerById} playerColor={playerColor}
        onBid={(amt) => act('auction_bid', { amount: amt })} onPass={() => act('auction_pass')} />
    } else if (phase === 'jail' && isMyTurn) {
      kind = 'jail'
      body = (
        <div className="mono-jail-moment">
          <span className="mono-jail-tag">⛓ {t('mono.inJail')}</span>
          <div className="mono-jail-actions">
            <button className="btn btn-line btn-sm" disabled={busy || (me?.cash || 0) < JAIL_FINE} onClick={() => act('pay_jail_fine')}>{t('mono.payFine')}</button>
            {me?.goojf_cards > 0 && <button className="btn btn-line btn-sm" disabled={busy} onClick={() => act('use_jail_card')}>{t('mono.useCard')}</button>}
            <button className="btn btn-gold btn-sm" disabled={busy} onClick={() => rollDice('roll_for_jail')}>{t('mono.rollJail')}</button>
          </div>
        </div>
      )
    } else if (phase === 'trade_review' && room.pending_trade && (room.pending_trade.to === myId || room.pending_trade.from === myId)) {
      kind = 'trade'
      body = <TradePanel tr={room.pending_trade} myId={myId} name={name} lang={lang} t={t} money={money} busy={busy}
        onAccept={() => act('accept_trade')} onReject={() => act('reject_trade')} onCancel={() => act('cancel_trade')} />
    } else if (phase === 'awaiting_debt' && room.pending_debt && room.pending_debt.debtor === myId) {
      kind = 'debt'
      body = (
        <div className="mono-debt">
          <p className="mono-owe">{t('mono.youOweShort', { amount: room.pending_debt.amount })}</p>
          <div className="mono-debt-btns">
            <button className="btn btn-line btn-sm" onClick={() => setManageOpen(true)}>{t('mono.manage')}</button>
            <button className="btn btn-red btn-sm" disabled={busy} onClick={() => act('declare_bankruptcy')}>{t('mono.declareBankrupt')}</button>
          </div>
        </div>
      )
    }
    if (!body) return null
    return (
      <div className={`mono-moment-scrim mono-moment-${kind}`} dir={dir}>
        <div className="mono-moment" role="dialog" aria-modal="false">{body}</div>
      </div>
    )
  }

  const presentCount = players.filter((p) => p.is_present && !p.bankrupt).length

  return (
    <div className="mono-game" dir={dir} ref={rootRef}>
      <div className="mono-header">
        <div className="mono-brand">
          <div className="mono-crest"><Landmark size={20} /></div>
          <div className="mono-brand-text">
            <span className="mono-brand-over">JORDAN</span>
            <span className="mono-brand-name">MONOPOLY</span>
          </div>
        </div>
        <div className="mono-header-tools">
          <span className="mono-live-pill"><span className="mono-live-dot" /> {presentCount} · {t('mono.live')}</span>
          {canToggle3D && (
            <button className="mono-icon-btn" onClick={toggle3D}
              aria-label={render3D ? t('mono.liteMode') : t('mono.3dMode')}
              title={render3D ? t('mono.liteMode') : t('mono.3dMode')}>
              {render3D ? <Layers size={18} /> : <Box size={18} />}
            </button>
          )}
          <button className="mono-icon-btn" onClick={toggleMute} aria-label={muted ? t('mono.soundOff') : t('mono.soundOn')} title={muted ? t('mono.soundOff') : t('mono.soundOn')}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button className="mono-icon-btn" onClick={toggleFullscreen} aria-label={t('mono.fullscreen')} title={t('mono.fullscreen')}>
            <Maximize size={18} />
          </button>
        </div>
      </div>

      <div className="mono-players-strip">
        {players.map((p) => (
          <PlayerCard key={p.profile_id} p={p} isTurn={p.profile_id === turnId} isNext={p.profile_id === nextTurnId}
            isMe={p.profile_id === myId} rolling={p.profile_id === rollingId}
            isOnline={!isAway(p)} offlineText={t('mono.offline')}
            rollText={t('mono.rolling')} nextText={t('mono.next')} money={money}
            worth={aff.netWorth(p, propByTile)} worthLabel={t('mono.netWorth')}
            groups={groupsByPlayer[p.profile_id]} reduced={reducedMotion} />
        ))}
      </div>

      <div className="mono-stage">
        {render3D ? (
          <>
            <MonopolyScene3D onTile={onTile} store={animator} reducedMotion={reducedMotion} lang={lang}
              players={players} properties={properties} propByTile={propByTile} playerColor={playerColor}
              auctionTile={room.pending_auction?.tile ?? null} activeTile={playerById[turnId]?.position}
              activeColor={playerColor[turnId] ?? null}
              myId={myId} onContextLost={onContextLost} moment={renderMoment()}>
              {renderCenter()}
            </MonopolyScene3D>
            {/* The WebGL canvas is aria-hidden; this narrates board state to AT. */}
            <div className="sr-only" role="status" aria-live="polite">
              {t('mono.turnOf', { name: name(turnId) })} · {tileName(safeTile(playerById[turnId]?.position), lang)}
            </div>
            {/* Keyboard/screen-reader parity with the 2D board: a focusable list of
                ownable tiles that opens the same deed popover via onTile(). */}
            <div className="sr-only">
              <h3>{t('mono.title')}</h3>
              <ul>
                {OWNABLE.map((i) => {
                  const prop = propByTile[i]
                  const owner = prop?.owner ? name(prop.owner) : t('mono.deedUnowned')
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => onTile(i)}>
                        {tileName(safeTile(i), lang)} — {owner}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </>
        ) : (
          <MonopolyBoard players={players} properties={properties} propByTile={propByTile} lang={lang}
            playerColor={playerColor} nameById={nameById} myId={myId} myFullSets={myFullSets}
            auctionTile={room.pending_auction?.tile ?? null} activeTile={playerById[turnId]?.position}
            onTile={onTile} store={animator} tt={t} moment={renderMoment()}>
            {renderCenter()}
          </MonopolyBoard>
        )}
      </div>

      <div className="mono-side">
        <div className="panel mono-log-panel">
          <span className="glabel">{t('mono.log')}</span>
          <div className="mono-log">
            {reversedLog.map(({ e, i }) => (
              <div className={`mono-log-row mono-ev-${e.k}`} key={`${e.k}-${e.by ?? ''}-${i}`}>{formatLog(e, name, lang, t)}</div>
            ))}
          </div>
        </div>
        {holdings.length > 0 && (
          <details className="panel mono-legend">
            <summary>{t('mono.legend')}</summary>
            <div className="mono-legend-list">
              {holdings.map((h) => (
                <div className="mono-legend-row" key={h.id}>
                  <span className="mono-owner-dot" style={{ background: h.color }} />
                  <span className="mono-legend-name">{h.name}</span>
                  <span className="mono-legend-count">{t('mono.propsCount', { n: h.count })}</span>
                </div>
              ))}
            </div>
          </details>
        )}
        <Link className="btn btn-line btn-sm mono-leave" to="/monopoly"><LogOut size={14} /> {t('mono.leave')}</Link>
      </div>

      {manageOpen && <ManageModal room={room} me={me} properties={properties} propByTile={propByTile} lang={lang} t={t} busy={busy} act={act} onClose={() => setManageOpen(false)} />}
      {tradeOpen && <TradeModal room={room} me={me} players={players} properties={properties} lang={lang} t={t} myId={myId} name={name} busy={busy} act={act} onClose={() => setTradeOpen(false)} />}
      {deedTile !== null && <DeedPopover tileIndex={deedTile} propByTile={propByTile} lang={lang} t={t} money={money} name={name} playerColor={playerColor} room={room} myId={myId} isMyTurn={isMyTurn} cash={me?.cash || 0} busy={busy} act={act} onClose={() => setDeedTile(null)} />}
    </div>
  )
}

// ---------------- sub-panels ----------------
const PlayerCard = memo(function PlayerCard({ p, isTurn, isNext, isMe, rolling, isOnline = true, offlineText, rollText, nextText, money, worth, worthLabel, groups, reduced }) {
  const meta = tokenMeta(p.token)
  const away = !isOnline && !p.bankrupt
  return (
    <div className={`mono-pcard${isTurn ? ' turn' : ''}${isNext ? ' next' : ''}${p.bankrupt ? ' bankrupt' : ''}${isMe ? ' me' : ''}`}
      style={{ '--tok': meta.color, ...(away ? { opacity: 0.55 } : null) }}>
      <div className="mono-pcard-av">{meta.emoji}</div>
      <div className="mono-pcard-info">
        <span className="mono-pcard-name">{profName(p)}</span>
        {rolling
          ? <span className="mono-pcard-roll"><span className="mono-roll-dot" />{rollText}</span>
          : <span className="mono-pcard-cash"><Banknote size={12} /> <CountUp value={p.cash} format={money || ((n) => n)} reduced={reduced} /></span>}
        {!rolling && !p.bankrupt && worth != null && (
          <span className="mono-pcard-worth" title={worthLabel}>{worthLabel}: {money ? money(worth) : worth}</span>
        )}
        {Array.isArray(groups) && groups.length > 0 && (
          <span className="mono-pcard-pips" aria-hidden>
            {groups.map((g, i) => <i key={i} className={`mono-pip${g.full ? ' full' : ''}`} style={{ background: g.hex }} />)}
          </span>
        )}
      </div>
      {isNext && !isTurn && !p.bankrupt && <span className="mono-pcard-next">{nextText}</span>}
      {p.in_jail && <span className="mono-pcard-jail">⛓</span>}
      {away && <span className="mono-pcard-jail" title={offlineText} aria-label={offlineText} style={{ filter: 'grayscale(1)' }}>📴</span>}
    </div>
  )
})

function BuyPanel({ pend, lang, t, money, busy, cash, onBuy, onDecline }) {
  const tile = safeTile(pend?.tile)
  const afford = cash >= pend.price
  return (
    <div className="mono-buy">
      <span className="mono-moment-eyebrow">{t('mono.landedOn')}</span>
      <Deed tile={tile} lang={lang} t={t} money={money} />
      {!afford && <p className="mono-buy-warn">{t('mono.cantAfford')}</p>}
      <div className="mono-buy-btns">
        <button className="btn btn-gold" disabled={busy || !afford} onClick={onBuy}>{t('mono.buy', { price: pend.price })}</button>
        <button className="btn btn-line" disabled={busy} onClick={onDecline}>{t('mono.decline')}</button>
      </div>
    </div>
  )
}

function AuctionPanel({ room, myId, name, lang, t, money, busy, playerById, playerColor, onBid, onPass }) {
  const a = room.pending_auction
  const minBid = (a?.high_bid || 0) + 1
  const [amt, setAmt] = useState((a?.high_bid || 0) + 10)
  // Keep the custom input a sensible step ahead as the high bid climbs.
  useEffect(() => { setAmt((a?.high_bid || 0) + 10) }, [a?.high_bid])
  if (!a || !Array.isArray(a.active)) return null
  const onClock = a.active[a.on_clock]
  const mine = onClock === myId
  const myCash = playerById?.[myId]?.cash || 0
  const bid = (v) => onBid(Math.max(minBid, Math.floor(v)))
  return (
    <div className="mono-auction">
      <span className="mono-moment-eyebrow">{t('mono.auction')}</span>
      <Deed tile={safeTile(a.tile)} lang={lang} t={t} money={money} />
      <div className="mono-auction-bidbox">
        <span className="glabel">{t('mono.highBid')}</span>
        <p className="mono-auction-bid">{a.high_bidder ? money(a.high_bid) : '—'}</p>
        {a.high_bidder && (
          <span className="mono-auction-bidder">
            <span className="mono-owner-dot" style={{ background: playerColor?.[a.high_bidder] }} />{name(a.high_bidder)}
          </span>
        )}
      </div>
      <div className="mono-auction-players">
        {a.active.map((id, i) => (
          <span key={id} className={`mono-auc-chip${i === a.on_clock ? ' clock' : ''}${id === myId ? ' me' : ''}`}>
            <span className="mono-owner-dot" style={{ background: playerColor?.[id] }} />{id === myId ? t('mono.you') : name(id)}
          </span>
        ))}
      </div>
      {mine ? (
        <div className="mono-auction-act">
          <div className="mono-auction-quick">
            {[10, 50, 100].map((q) => (
              <button key={q} className="mono-chip-btn" disabled={busy || a.high_bid + q > myCash} onClick={() => bid(a.high_bid + q)}>+{q}</button>
            ))}
            <button className="mono-chip-btn allin" disabled={busy || myCash < minBid} onClick={() => bid(myCash)}>{t('mono.allIn')}</button>
          </div>
          <div className="mono-auction-custom">
            <input type="number" min={minBid} max={myCash} value={amt} onChange={(e) => setAmt(Number(e.target.value))} />
            <button className="btn btn-gold btn-sm" disabled={busy || amt < minBid || amt > myCash} onClick={() => bid(amt)}>{t('mono.bid')}</button>
            <button className="btn btn-line btn-sm" disabled={busy} onClick={onPass}>{t('mono.pass')}</button>
          </div>
        </div>
      ) : (
        <p className="mono-auction-wait"><span className="mono-roll-dot" />{t('mono.waitingFor', { name: name(onClock) })}</p>
      )}
    </div>
  )
}

function TradePanel({ tr, myId, name, lang, t, money, busy, onAccept, onReject, onCancel }) {
  const side = (s) => [
    s?.cash ? money(s.cash) : null,
    ...(Array.isArray(s?.tiles) ? s.tiles : []).map((i) => tileName(safeTile(i), lang)),
    s?.goojf ? `${s.goojf}× 🔑` : null,
  ].filter(Boolean).join(', ') || '—'
  if (!tr || !tr.give || !tr.want) return null
  return (
    <div className="mono-trade-review">
      <span className="glabel">{t('mono.trade')}</span>
      <p className="mono-trade-line"><b>{name(tr.from)}</b> → {side(tr.give)}</p>
      <p className="mono-trade-line"><b>{name(tr.to)}</b> → {side(tr.want)}</p>
      {tr.to === myId && (
        <div className="mono-trade-btns">
          <button className="btn btn-gold btn-sm" disabled={busy} onClick={onAccept}>✓</button>
          <button className="btn btn-line btn-sm" disabled={busy} onClick={onReject}>✕</button>
        </div>
      )}
      {tr.from === myId && <button className="btn btn-line btn-sm" disabled={busy} onClick={onCancel}>{t('mono.pass')}</button>}
    </div>
  )
}

// Classic "Title Deed" card — colour header + rent ladder (property), or the
// station / utility rent structure, plus price, house cost and mortgage value.
function Deed({ tile, lang, t, money }) {
  if (!tile || tile.type === 'blank') return null
  const color = tile.color ? COLOR_GROUPS[tile.color]?.hex : (tile.type === 'railroad' ? '#1c1c22' : tile.type === 'utility' ? '#2a5e44' : '#444')
  const head = (tile.color && (COLOR_GROUPS[tile.color]?.hex))
  return (
    <div className="mono-deed">
      <div className="mono-deed-head" style={{ background: color, color: head ? undefined : '#f4efe1' }}>
        <span className="mono-deed-over">{t('mono.titleDeed')}</span>
        {tileName(tile, lang)}
      </div>
      {tile.rent && (
        <ul className="mono-deed-rent">
          <li><span>{t('mono.deedRentBase')}</span><b>{tile.rent[0]}</b></li>
          <li><span>{t('mono.deedRentHouses', { n: 1 })}</span><b>{tile.rent[1]}</b></li>
          <li><span>{t('mono.deedRentHouses', { n: 2 })}</span><b>{tile.rent[2]}</b></li>
          <li><span>{t('mono.deedRentHouses', { n: 3 })}</span><b>{tile.rent[3]}</b></li>
          <li><span>{t('mono.deedRentHouses', { n: 4 })}</span><b>{tile.rent[4]}</b></li>
          <li><span>{t('mono.deedRentHotel')}</span><b>{tile.rent[5]}</b></li>
        </ul>
      )}
      {tile.type === 'railroad' && (
        <ul className="mono-deed-rent">
          <li><span>{t('mono.deedStations')} ×1</span><b>25</b></li>
          <li><span>×2</span><b>50</b></li>
          <li><span>×3</span><b>100</b></li>
          <li><span>×4</span><b>200</b></li>
        </ul>
      )}
      {tile.type === 'utility' && (
        <ul className="mono-deed-rent">
          <li className="mono-deed-util">{t('mono.deedUtilOne')}</li>
          <li className="mono-deed-util">{t('mono.deedUtilBoth')}</li>
        </ul>
      )}
      <div className="mono-deed-foot">
        {tile.price ? <span>{money ? money(tile.price) : tile.price}</span> : <span />}
        {tile.house ? <span>{t('mono.deedHouseCost', { cost: tile.house })}</span> : null}
        {tile.mortgage ? <span>{t('mono.deedMortgageVal')} {tile.mortgage}</span> : null}
      </div>
    </div>
  )
}

// Deed card popover (tap a tile). When it's a property you own and you can act,
// it grows inline Build / Sell / Mortgage / Unmortgage controls (each shown only
// when the engine would accept it). Otherwise read-only. Closes on Esc / outside.
function DeedPopover({ tileIndex, propByTile, lang, t, money, name, playerColor, room, myId, isMyTurn, cash, busy, act, onClose }) {
  const tile = safeTile(tileIndex)
  const prop = propByTile[tileIndex]
  const owner = prop?.owner ? name(prop.owner) : null
  const ownerCol = prop?.owner ? playerColor[prop.owner] : null
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const ctx = { id: myId, phase: room?.phase, isMyTurn, cash, room, debtorMe: room?.pending_debt?.debtor === myId }
  const mine = prop?.owner === myId
  const showBuild = mine && aff.canBuild(tile, prop, propByTile, ctx)
  const showSell = mine && aff.canSell(tile, prop, propByTile, ctx)
  const showMortgage = mine && aff.canMortgage(tile, prop, propByTile, ctx)
  const showUnmortgage = mine && aff.canUnmortgage(tile, prop, ctx)
  const anyAction = showBuild || showSell || showMortgage || showUnmortgage

  return (
    <div className="mono-modal-overlay" onClick={onClose}>
      <div className="mono-deed-pop" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={tileName(tile, lang)}>
        <Deed tile={tile} lang={lang} t={t} money={money} />
        <div className="mono-deed-pop-meta">
          <span>{t('mono.deedOwner')}: {ownerCol && <span className="mono-owner-dot" style={{ background: ownerCol }} />}<b>{owner || t('mono.deedUnowned')}</b></span>
          {prop?.houses > 0 && <span>{prop.houses === 5 ? '🏨' : '🏠'.repeat(prop.houses)}</span>}
          {prop?.mortgaged && <span className="mono-mort-tag">{t('mono.deedMortgaged')}</span>}
        </div>
        {anyAction && (
          <div className="mono-deed-actions">
            <span className="glabel">{t('mono.deedManage')}</span>
            <div className="mono-manage-btns">
              {showBuild && <button className="btn btn-gold btn-xs" disabled={busy} onClick={() => act('build_house', { tile: tileIndex })}>{t('mono.build')}</button>}
              {showSell && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('sell_house', { tile: tileIndex })}>{t('mono.sell')}</button>}
              {showMortgage && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('mortgage', { tile: tileIndex })}>{t('mono.mortgage')}</button>}
              {showUnmortgage && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('unmortgage', { tile: tileIndex })}>{t('mono.unmortgage')}</button>}
            </div>
          </div>
        )}
        <button className="btn btn-line btn-sm" onClick={onClose}>{t('mono.close')}</button>
      </div>
    </div>
  )
}

function ManageModal({ room, me, properties, propByTile, lang, t, busy, act, onClose }) {
  const mine = useMemo(
    () => properties.filter((p) => p.owner === me?.profile_id).sort((a, b) => a.tile_index - b.tile_index),
    [properties, me?.profile_id],
  )
  // Same engine-mirrored gating as the on-board popover, so both surfaces agree.
  const turnId = room.turn_order?.[room.current_seat]
  const ctx = {
    id: me?.profile_id, phase: room.phase, isMyTurn: turnId === me?.profile_id,
    cash: me?.cash || 0, room, debtorMe: room.pending_debt?.debtor === me?.profile_id,
  }
  return (
    <div className="mono-modal-overlay" onClick={onClose}>
      <div className="mono-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('mono.manage')}>
        <div className="mono-modal-head"><h3>{t('mono.manage')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="muted" style={{ fontSize: 13 }}>🏠 {room.bank_houses} · 🏨 {room.bank_hotels} · {t('mono.cash')} {me?.cash}</p>
        <div className="mono-manage-list">
          {mine.length === 0 && <p className="muted">—</p>}
          {mine.map((p) => {
            const tile = safeTile(p.tile_index)
            return (
              <div className="mono-manage-row" key={p.tile_index}>
                <span className="mono-manage-bar" style={{ background: tile.color ? COLOR_GROUPS[tile.color]?.hex : '#666' }} />
                <span className="mono-manage-name">{tileName(tile, lang)}{p.mortgaged ? ' ⌧' : ''}{p.houses === 5 ? ' 🏨' : p.houses ? ` ${'🏠'.repeat(p.houses)}` : ''}</span>
                <span className="mono-manage-btns">
                  {aff.canBuild(tile, p, propByTile, ctx) && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('build_house', { tile: p.tile_index })}>{t('mono.build')}</button>}
                  {aff.canSell(tile, p, propByTile, ctx) && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('sell_house', { tile: p.tile_index })}>{t('mono.sell')}</button>}
                  {aff.canMortgage(tile, p, propByTile, ctx) && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('mortgage', { tile: p.tile_index })}>{t('mono.mortgage')}</button>}
                  {aff.canUnmortgage(tile, p, ctx) && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('unmortgage', { tile: p.tile_index })}>{t('mono.unmortgage')}</button>}
                </span>
              </div>
            )
          })}
        </div>
        {ctx.isMyTurn && (
          <button className="btn btn-red btn-sm" style={{ marginTop: 14, width: '100%' }} disabled={busy}
            onClick={() => { if (typeof window === 'undefined' || window.confirm(t('mono.resignConfirm'))) { act('resign'); onClose() } }}>
            <Flag size={14} /> {t('mono.resign')}
          </button>
        )}
      </div>
    </div>
  )
}

function TradeModal({ me, players, properties, lang, t, myId, name, busy, act, onClose }) {
  const others = useMemo(() => players.filter((p) => p.profile_id !== myId && !p.bankrupt), [players, myId])
  const [to, setTo] = useState(others[0]?.profile_id || '')
  const [giveTiles, setGiveTiles] = useState([])
  const [wantTiles, setWantTiles] = useState([])
  const [giveCash, setGiveCash] = useState(0)
  const [wantCash, setWantCash] = useState(0)
  const myProps = useMemo(() => properties.filter((p) => p.owner === myId), [properties, myId])
  const theirProps = useMemo(() => properties.filter((p) => p.owner === to), [properties, to])
  const toggle = (arr, set, i) => set(arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i])

  const submit = async () => {
    // Clamp to sane bounds client-side so the server rarely has to reject:
    // you can't give more cash than you hold, and neither side can be negative.
    const give = Math.max(0, Math.min(Number(giveCash) || 0, me?.cash || 0))
    const want = Math.max(0, Number(wantCash) || 0)
    const res = await act('propose_trade', {
      to,
      give: { cash: give, tiles: giveTiles, goojf: 0 },
      want: { cash: want, tiles: wantTiles, goojf: 0 },
    })
    if (!res?.error) onClose()
  }

  return (
    <div className="mono-modal-overlay" onClick={onClose}>
      <div className="mono-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('mono.trade')}>
        <div className="mono-modal-head"><h3><Handshake size={18} /> {t('mono.trade')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <label className="glabel">{t('app.game.player2')}</label>
        <select value={to} onChange={(e) => setTo(e.target.value)} className="mono-select">
          {others.map((p) => <option key={p.profile_id} value={p.profile_id}>{profName(p)}</option>)}
        </select>
        <div className="mono-trade-cols">
          <div>
            <span className="glabel">{t('mono.tradeYouGive')}</span>
            <input type="number" min={0} max={me?.cash} value={giveCash} onChange={(e) => setGiveCash(e.target.value)} placeholder={t('mono.currency')} className="mono-select" />
            <div className="mono-trade-tiles">
              {myProps.map((p) => (
                <button key={p.tile_index} className={`mono-trade-tile${giveTiles.includes(p.tile_index) ? ' on' : ''}`} onClick={() => toggle(giveTiles, setGiveTiles, p.tile_index)}>{tileName(safeTile(p.tile_index), lang)}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="glabel">{t('mono.tradeYouWant')}</span>
            <input type="number" min={0} value={wantCash} onChange={(e) => setWantCash(e.target.value)} placeholder={t('mono.currency')} className="mono-select" />
            <div className="mono-trade-tiles">
              {theirProps.map((p) => (
                <button key={p.tile_index} className={`mono-trade-tile${wantTiles.includes(p.tile_index) ? ' on' : ''}`} onClick={() => toggle(wantTiles, setWantTiles, p.tile_index)}>{tileName(safeTile(p.tile_index), lang)}</button>
              ))}
            </div>
          </div>
        </div>
        <button className="btn btn-gold btn-block" disabled={busy || !to} onClick={submit}>{t('mono.trade')}</button>
      </div>
    </div>
  )
}

// ---------------- localized log ----------------
function formatLog(e, name, lang, t) {
  const who = e.by ? name(e.by) : ''
  switch (e.k) {
    // Leading icons are now rendered as per-event vector chips via CSS (.mono-ev-*::before),
    // so the strings carry no leading emoji. Meaningful inline glyphs (house count, ⇄) stay.
    case 'start': return t('mono.title')
    case 'roll': return `${who}: ${e.d?.[0]} + ${e.d?.[1]}`
    case 'buy': return `${who} → ${tileName(safeTile(e.tile), lang)} (${e.price})`
    case 'rent': return `${who} → ${name(e.to)} ${t('mono.amount', { amount: e.amount })}`
    case 'tax': return `${who} −${e.amount}`
    case 'pass_go': return `${who} +200 (GO)`
    case 'card': return `${who}: ${e.text?.[lang] || e.text?.en}`
    case 'jail': return `${who}`
    case 'jail_out': return `${who}`
    case 'build': return `${who} → ${tileName(safeTile(e.tile), lang)} (${e.houses === 5 ? '🏨' : '🏠'.repeat(e.houses)})`
    case 'sell': return `${who} → ${tileName(safeTile(e.tile), lang)}`
    case 'mortgage': return `${who} → ${tileName(safeTile(e.tile), lang)}`
    case 'unmortgage': return `${who} → ${tileName(safeTile(e.tile), lang)}`
    case 'trade': return `${name(e.from)} ⇄ ${name(e.to)}`
    case 'auction_win': return `${who} → ${tileName(safeTile(e.tile), lang)} (${e.price})`
    case 'auction_none': return tileName(safeTile(e.tile), lang)
    case 'bankrupt': return `${who}`
    case 'resign': return `${who}`
    case 'win': return `${who}`
    default: return ''
  }
}
