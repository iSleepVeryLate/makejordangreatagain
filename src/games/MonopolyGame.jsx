import { useMemo, useState, useCallback, memo } from 'react'
import { Link } from 'react-router-dom'
import { Dice5, LogOut, Trophy, RotateCcw, Home, Banknote, Handshake, X, Crown } from 'lucide-react'
import { supabase } from '../lib/supabaseClient.js'
import { useToast } from '../context/ToastContext.jsx'
import Avatar from '../components/Avatar.jsx'
import Confetti from '../components/Confetti.jsx'
import MonopolyBoard from './MonopolyBoard.jsx'
import TurnTimer from './TurnTimer.jsx'
import { BOARD, COLOR_GROUPS, tileName, JAIL_FINE } from './monopolyBoard.js'
import { tokenMeta } from './monopolyTokens.js'

const DICE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']
const profName = (p) => p?.profile?.global_name || p?.profile?.username || 'player'

export default function MonopolyGame({ hook, t, dir, myId }) {
  const toast = useToast()
  const { room, players, properties, sendAction } = hook
  const [busy, setBusy] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [manageOpen, setManageOpen] = useState(false)
  const [tradeOpen, setTradeOpen] = useState(false)

  const playerById = useMemo(() => Object.fromEntries(players.map((p) => [p.profile_id, p])), [players])
  const playerColor = useMemo(
    () => Object.fromEntries(players.map((p) => [p.profile_id, tokenMeta(p.token).color])), [players])
  const lang = dir === 'rtl' ? 'ar' : 'en'

  // Newest-first log, computed only when the log actually changes (not on every
  // unrelated re-render). `i` is the entry's original index — stable as long as
  // the ring buffer hasn't trimmed; good enough for 40 non-interactive rows.
  const reversedLog = useMemo(() => (room?.log || []).map((e, i) => ({ e, i })).reverse(), [room?.log])

  const turnId = room?.turn_order?.[room?.current_seat]
  const isMyTurn = turnId === myId
  const me = playerById[myId]
  const phase = room?.phase
  const dice = room?.dice
  const isDoubles = Array.isArray(dice) && dice[0] === dice[1]

  const name = useCallback((id) => profName(playerById[id]), [playerById])

  const act = useCallback(async (action, args = {}) => {
    setBusy(true)
    const res = await sendAction(action, args)
    setBusy(false)
    if (res?.error) toast(res.error, 'error')
    return res
  }, [sendAction, toast])

  // Roll wrapper: only roll actions should tumble the dice (a build/mortgage
  // shouldn't). Wraps `act` so buttons still gate on `busy`.
  const rollDice = useCallback(async (action) => {
    setRolling(true)
    const res = await act(action)
    setRolling(false)
    return res
  }, [act])

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
              <span className="draw-score-num">{p.cash} JOD</span>
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

  // ---------------- center action area ----------------
  // A plain render function (NOT a nested component) so its subtree keeps its
  // identity across parent re-renders — otherwise the dice/auction/buy panels
  // would remount and their local state (e.g. the auction bid) would reset.
  const renderCenter = () => {
    const turnName = name(turnId)
    return (
      <div className="mono-center-inner">
        <div className="mono-title-badge"><Home size={14} /> {t('mono.title')}</div>

        <div className={`mono-turn-banner${isMyTurn ? ' you' : ''}`}>
          {isMyTurn ? t('mono.yourTurn') : t('mono.turnOf', { name: turnName })}
        </div>

        <div className="mono-dice" aria-label="dice">
          <span key={`d0-${dice ? dice[0] : 'x'}`} className={`mono-die${rolling ? ' rolling' : ''}`}>{dice ? DICE[dice[0]] : '⚀'}</span>
          <span key={`d1-${dice ? dice[1] : 'x'}`} className={`mono-die${rolling ? ' rolling' : ''}`}>{dice ? DICE[dice[1]] : '⚀'}</span>
        </div>

        {room.phase_ends_at && (
          <TurnTimer phaseEndsAt={room.phase_ends_at} turnSeconds={room.turn_seconds} />
        )}

        {room.last_card && (
          <div className="mono-card-pop"><span className="glabel">{room.last_card.deck === 'chance' ? 'Chance' : 'Chest'}</span>
            <p>{room.last_card.text?.[lang] || room.last_card.text?.en}</p></div>
        )}

        {/* phase-specific actions */}
        <div className="mono-actions">
          {phase === 'roll' && isMyTurn && (
            <>
              {(dice === null || isDoubles) ? (
                <button className="btn btn-green" disabled={busy} onClick={() => rollDice('roll')}>
                  <Dice5 size={16} /> {busy ? t('mono.rolling') : t('mono.roll')}{isDoubles && dice ? ' ↻' : ''}
                </button>
              ) : (
                <button className="btn btn-green" disabled={busy} onClick={() => act('end_turn')}>{t('mono.endTurn')}</button>
              )}
              <button className="btn btn-line btn-sm" onClick={() => setManageOpen(true)}>{t('mono.manage')}</button>
              <button className="btn btn-line btn-sm" onClick={() => setTradeOpen(true)}><Handshake size={14} /> {t('mono.trade')}</button>
            </>
          )}

          {phase === 'buy_decision' && isMyTurn && room.pending_purchase && (
            <BuyPanel pend={room.pending_purchase} lang={lang} t={t} busy={busy} cash={me?.cash || 0}
              onBuy={() => act('buy_property')} onDecline={() => act('decline_buy')} />
          )}
          {phase === 'buy_decision' && !isMyTurn && (
            <p className="muted">{name(turnId)} · {tileName(BOARD[room.pending_purchase?.tile], lang)}</p>
          )}

          {phase === 'jail' && isMyTurn && (
            <div className="mono-jail-actions">
              <span className="mono-jail-tag">{t('mono.inJail')}</span>
              <button className="btn btn-line btn-sm" disabled={busy || (me?.cash || 0) < JAIL_FINE} onClick={() => act('pay_jail_fine')}>{t('mono.payFine')}</button>
              {me?.goojf_cards > 0 && <button className="btn btn-line btn-sm" disabled={busy} onClick={() => act('use_jail_card')}>{t('mono.useCard')}</button>}
              <button className="btn btn-green btn-sm" disabled={busy} onClick={() => rollDice('roll_for_jail')}>{t('mono.rollJail')}</button>
            </div>
          )}
          {phase === 'jail' && !isMyTurn && <p className="muted">{name(turnId)} · {t('mono.inJail')}</p>}

          {phase === 'auction' && (
            <AuctionPanel room={room} myId={myId} name={name} lang={lang} t={t} busy={busy}
              onBid={(amt) => act('auction_bid', { amount: amt })} onPass={() => act('auction_pass')} />
          )}

          {phase === 'trade_review' && room.pending_trade && (
            <TradePanel tr={room.pending_trade} myId={myId} name={name} lang={lang} t={t} busy={busy}
              onAccept={() => act('accept_trade')} onReject={() => act('reject_trade')} onCancel={() => act('cancel_trade')} />
          )}

          {phase === 'awaiting_debt' && room.pending_debt && (
            <div className="mono-debt">
              {room.pending_debt.debtor === myId ? (
                <>
                  <p className="mono-owe">{t('mono.youOwe', { amount: room.pending_debt.amount })}</p>
                  <button className="btn btn-line btn-sm" onClick={() => setManageOpen(true)}>{t('mono.manage')}</button>
                  <button className="btn btn-red btn-sm" disabled={busy} onClick={() => act('declare_bankruptcy')}>{t('mono.declareBankrupt')}</button>
                </>
              ) : (
                <p className="muted">{name(room.pending_debt.debtor)} · {t('mono.waiting')}</p>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mono-game" dir={dir}>
      <div className="mono-players-strip">
        {players.map((p) => (
          <PlayerChip key={p.profile_id} p={p} isTurn={p.profile_id === turnId} isMe={p.profile_id === myId} />
        ))}
      </div>

      <div className="mono-stage">
        <MonopolyBoard players={players} properties={properties} lang={lang} playerColor={playerColor} activeTile={playerById[turnId]?.position} onTile={null}>
          {renderCenter()}
        </MonopolyBoard>
      </div>

      <div className="mono-side">
        <div className="panel mono-log-panel">
          <span className="glabel">{t('mono.log')}</span>
          <div className="mono-log">
            {reversedLog.map(({ e, i }) => (
              <div className="mono-log-row" key={`${e.k}-${e.by ?? ''}-${i}`}>{formatLog(e, name, lang, t)}</div>
            ))}
          </div>
        </div>
        <Link className="btn btn-line btn-sm mono-leave" to="/monopoly"><LogOut size={14} /> {t('mono.leave')}</Link>
      </div>

      {manageOpen && <ManageModal room={room} me={me} properties={properties} lang={lang} t={t} busy={busy} act={act} onClose={() => setManageOpen(false)} />}
      {tradeOpen && <TradeModal room={room} me={me} players={players} properties={properties} lang={lang} t={t} myId={myId} name={name} busy={busy} act={act} onClose={() => setTradeOpen(false)} />}
    </div>
  )
}

// ---------------- sub-panels ----------------
// Memoized so a single player's cash/jail change (or any parent re-render) only
// re-renders that one chip, not the whole strip. Props are primitives + a stable
// row reference, so the memo actually holds.
const PlayerChip = memo(function PlayerChip({ p, isTurn, isMe }) {
  const meta = tokenMeta(p.token)
  return (
    <div className={`mono-pchip${isTurn ? ' turn' : ''}${p.bankrupt ? ' bankrupt' : ''}${isMe ? ' me' : ''}`} style={{ '--tok': meta.color }}>
      <Avatar profile={p.profile} size="sm" />
      <span className="mono-pchip-emoji">{meta.emoji}</span>
      <div className="mono-pchip-info">
        <span className="mono-pchip-name">{profName(p)}</span>
        <span className="mono-pchip-cash"><Banknote size={11} /> {p.cash}</span>
      </div>
      {p.in_jail && <span className="mono-pchip-jail">⛓</span>}
    </div>
  )
})

function BuyPanel({ pend, lang, t, busy, cash, onBuy, onDecline }) {
  const tile = BOARD[pend.tile]
  return (
    <div className="mono-buy">
      <Deed tile={tile} lang={lang} />
      <div className="mono-buy-btns">
        <button className="btn btn-green btn-sm" disabled={busy || cash < pend.price} onClick={onBuy}>{t('mono.buy', { price: pend.price })}</button>
        <button className="btn btn-line btn-sm" disabled={busy} onClick={onDecline}>{t('mono.decline')}</button>
      </div>
    </div>
  )
}

function AuctionPanel({ room, myId, name, lang, t, busy, onBid, onPass }) {
  const a = room.pending_auction
  const [amt, setAmt] = useState((a?.high_bid || 0) + 10)
  if (!a) return null
  const onClock = a.active[a.on_clock]
  const mine = onClock === myId
  return (
    <div className="mono-auction">
      <span className="glabel">{t('mono.auction')} · {tileName(BOARD[a.tile], lang)}</span>
      <p className="mono-auction-bid">{a.high_bidder ? `${name(a.high_bidder)} · ${a.high_bid} JOD` : '—'}</p>
      {mine ? (
        <div className="mono-auction-act">
          <input type="number" min={(a.high_bid || 0) + 1} value={amt} onChange={(e) => setAmt(Number(e.target.value))} />
          <button className="btn btn-green btn-sm" disabled={busy} onClick={() => onBid(amt)}>{t('mono.bid')}</button>
          <button className="btn btn-line btn-sm" disabled={busy} onClick={onPass}>{t('mono.pass')}</button>
        </div>
      ) : (
        <p className="muted">{name(onClock)}…</p>
      )}
    </div>
  )
}

function TradePanel({ tr, myId, name, lang, t, busy, onAccept, onReject, onCancel }) {
  const side = (s) => [
    s.cash ? `${s.cash} JOD` : null,
    ...s.tiles.map((i) => tileName(BOARD[i], lang)),
    s.goojf ? `${s.goojf}× 🔑` : null,
  ].filter(Boolean).join(', ') || '—'
  return (
    <div className="mono-trade-review">
      <span className="glabel">{t('mono.trade')}</span>
      <p className="mono-trade-line"><b>{name(tr.from)}</b> → {side(tr.give)}</p>
      <p className="mono-trade-line"><b>{name(tr.to)}</b> → {side(tr.want)}</p>
      {tr.to === myId && (
        <div className="mono-trade-btns">
          <button className="btn btn-green btn-sm" disabled={busy} onClick={onAccept}>✓</button>
          <button className="btn btn-line btn-sm" disabled={busy} onClick={onReject}>✕</button>
        </div>
      )}
      {tr.from === myId && <button className="btn btn-line btn-sm" disabled={busy} onClick={onCancel}>{t('mono.pass')}</button>}
    </div>
  )
}

function Deed({ tile, lang }) {
  const color = tile.color ? COLOR_GROUPS[tile.color]?.hex : '#444'
  return (
    <div className="mono-deed">
      <div className="mono-deed-head" style={{ background: color }}>{tileName(tile, lang)}</div>
      {tile.rent && (
        <ul className="mono-deed-rent">
          <li>Rent <b>{tile.rent[0]}</b></li>
          <li>+1 🏠 <b>{tile.rent[1]}</b></li>
          <li>+2 🏠 <b>{tile.rent[2]}</b></li>
          <li>+3 🏠 <b>{tile.rent[3]}</b></li>
          <li>+4 🏠 <b>{tile.rent[4]}</b></li>
          <li>🏨 <b>{tile.rent[5]}</b></li>
        </ul>
      )}
      <div className="mono-deed-foot">{tile.price ? `${tile.price} JOD` : ''}{tile.house ? ` · 🏠 ${tile.house}` : ''}</div>
    </div>
  )
}

function ManageModal({ room, me, properties, lang, t, busy, act, onClose }) {
  const mine = useMemo(
    () => properties.filter((p) => p.owner === me?.profile_id).sort((a, b) => a.tile_index - b.tile_index),
    [properties, me?.profile_id],
  )
  return (
    <div className="mono-modal-overlay" onClick={onClose}>
      <div className="mono-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={t('mono.manage')}>
        <div className="mono-modal-head"><h3>{t('mono.manage')}</h3><button className="icon-btn" onClick={onClose}><X size={18} /></button></div>
        <p className="muted" style={{ fontSize: 13 }}>🏠 {room.bank_houses} · 🏨 {room.bank_hotels} · {t('mono.cash')} {me?.cash}</p>
        <div className="mono-manage-list">
          {mine.length === 0 && <p className="muted">—</p>}
          {mine.map((p) => {
            const tile = BOARD[p.tile_index]
            const canBuild = tile.type === 'property'
            return (
              <div className="mono-manage-row" key={p.tile_index}>
                <span className="mono-manage-bar" style={{ background: tile.color ? COLOR_GROUPS[tile.color]?.hex : '#666' }} />
                <span className="mono-manage-name">{tileName(tile, lang)}{p.mortgaged ? ' ⌧' : ''}{p.houses === 5 ? ' 🏨' : p.houses ? ` ${'🏠'.repeat(p.houses)}` : ''}</span>
                <span className="mono-manage-btns">
                  {canBuild && !p.mortgaged && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('build_house', { tile: p.tile_index })}>{t('mono.build')}</button>}
                  {canBuild && p.houses > 0 && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('sell_house', { tile: p.tile_index })}>{t('mono.sell')}</button>}
                  {!p.mortgaged && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('mortgage', { tile: p.tile_index })}>{t('mono.mortgage')}</button>}
                  {p.mortgaged && <button className="btn btn-line btn-xs" disabled={busy} onClick={() => act('unmortgage', { tile: p.tile_index })}>{t('mono.unmortgage')}</button>}
                </span>
              </div>
            )
          })}
        </div>
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
    const res = await act('propose_trade', {
      to,
      give: { cash: Number(giveCash) || 0, tiles: giveTiles, goojf: 0 },
      want: { cash: Number(wantCash) || 0, tiles: wantTiles, goojf: 0 },
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
            <span className="glabel">You give</span>
            <input type="number" min={0} max={me?.cash} value={giveCash} onChange={(e) => setGiveCash(e.target.value)} placeholder="JOD" className="mono-select" />
            <div className="mono-trade-tiles">
              {myProps.map((p) => (
                <button key={p.tile_index} className={`mono-trade-tile${giveTiles.includes(p.tile_index) ? ' on' : ''}`} onClick={() => toggle(giveTiles, setGiveTiles, p.tile_index)}>{tileName(BOARD[p.tile_index], lang)}</button>
              ))}
            </div>
          </div>
          <div>
            <span className="glabel">You want</span>
            <input type="number" min={0} value={wantCash} onChange={(e) => setWantCash(e.target.value)} placeholder="JOD" className="mono-select" />
            <div className="mono-trade-tiles">
              {theirProps.map((p) => (
                <button key={p.tile_index} className={`mono-trade-tile${wantTiles.includes(p.tile_index) ? ' on' : ''}`} onClick={() => toggle(wantTiles, setWantTiles, p.tile_index)}>{tileName(BOARD[p.tile_index], lang)}</button>
              ))}
            </div>
          </div>
        </div>
        <button className="btn btn-green btn-block" disabled={busy || !to} onClick={submit}>{t('mono.trade')}</button>
      </div>
    </div>
  )
}

// ---------------- localized log ----------------
function formatLog(e, name, lang, t) {
  const who = e.by ? name(e.by) : ''
  switch (e.k) {
    case 'start': return '🎲 ' + t('mono.title')
    case 'roll': return `🎲 ${who}: ${e.d?.[0]} + ${e.d?.[1]}`
    case 'buy': return `🏠 ${who} → ${tileName(BOARD[e.tile], lang)} (${e.price})`
    case 'rent': return `💸 ${who} → ${name(e.to)} ${e.amount} JOD`
    case 'tax': return `🧾 ${who} −${e.amount}`
    case 'pass_go': return `✅ ${who} +200 (GO)`
    case 'card': return `🎴 ${who}: ${e.text?.[lang] || e.text?.en}`
    case 'jail': return `⛓ ${who}`
    case 'jail_out': return `🔓 ${who}`
    case 'build': return `🏗 ${who} → ${tileName(BOARD[e.tile], lang)} (${e.houses === 5 ? '🏨' : '🏠'.repeat(e.houses)})`
    case 'sell': return `🔨 ${who} → ${tileName(BOARD[e.tile], lang)}`
    case 'mortgage': return `⌧ ${who} → ${tileName(BOARD[e.tile], lang)}`
    case 'unmortgage': return `✔ ${who} → ${tileName(BOARD[e.tile], lang)}`
    case 'trade': return `🤝 ${name(e.from)} ⇄ ${name(e.to)}`
    case 'auction_win': return `🔨 ${who} → ${tileName(BOARD[e.tile], lang)} (${e.price})`
    case 'auction_none': return `🔨 ${tileName(BOARD[e.tile], lang)} —`
    case 'bankrupt': return `💀 ${who}`
    case 'win': return `🏆 ${who}`
    default: return ''
  }
}
