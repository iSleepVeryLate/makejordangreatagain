import { useMemo, useState } from 'react'
import {
  Landmark, Volume2, Maximize, Box, Handshake, Dice5, LogOut,
} from 'lucide-react'
import { useLang } from '../context/LanguageContext.jsx'
import {
  PlayerCard, BuyPanel, AuctionPanel, TradePanel, Deed, DeedPopover,
  ManageModal, TradeModal, formatLog,
} from '../games/MonopolyGame.jsx'
import Dice3D from '../games/Dice3D.jsx'
import TurnTimer from '../games/TurnTimer.jsx'
import { COLOR_GROUPS, safeTile, JAIL_FINE } from '../games/monopolyBoard.js'
import { tokenMeta } from '../games/monopolyTokens.js'
import * as aff from '../games/monopolyAffordance.js'

// =====================================================================
// DEV-ONLY: Monopoly HUD harness (route /__dev/monopoly-hud)
// =====================================================================
// Renders EVERY Monopoly HUD surface with MOCK data so the enterprise HUD can be
// reviewed WITHOUT a Discord login or a 2nd player (the real game needs 2 players
// to start, so the HUD is otherwise unviewable solo).
//
// Registered in App.jsx ONLY behind `__DEV_SERVER__` (inlined `false` for every
// `vite build` → this whole page + its route are tree-shaken out of production),
// exactly like the sibling 3D harness (MonopolyDevHarness.jsx, /__dev/monopoly3d).
//
// Faithfulness: wrapped in a real <div className="mono-game"> so the scoped `--mg-*`
// tokens + all `.mono-*` styles apply as in-game. Where a HUD sub-component is
// exported by MonopolyGame.jsx it is REUSED with mock props (PlayerCard, Deed,
// DeedPopover, BuyPanel, AuctionPanel, TradePanel, ManageModal, TradeModal,
// formatLog) so the harness can't drift from the game. The control dock and the
// jail/debt moment panels are inline JSX in MonopolyGame (they close over live game
// state), so their REAL class structure is reproduced here with mock content — the
// enterprise pass was CSS-only, so the byte-accurate classNames drive the look.
//
// NOTHING here touches the engine, realtime, or the monopoly-action Edge Function.

// ---------------- mock players ----------------
// profile shape matches profName(): p.profile.global_name || username.
const mkPlayer = (id, token, name, cash, position, extra = {}) => ({
  profile_id: id,
  token,
  cash,
  position,
  bankrupt: false,
  is_present: true,
  in_jail: false,
  goojf_cards: 0,
  profile: { global_name: name, username: name.toLowerCase() },
  ...extra,
})

const MOCK_PLAYERS = [
  mkPlayer('p1', 'car', 'You', 1500, 16),                       // active turn (see turnId below) + me
  mkPlayer('p2', 'ship', 'Layla', 540, 11, { in_jail: true }),  // in jail
  mkPlayer('p3', 'hat', 'Omar', 2100, 24),                      // next up
  mkPlayer('p4', 'dog', 'Sara', 0, 8, { bankrupt: true }),      // bankrupt
  mkPlayer('p5', 'iron', 'Yousef', 830, 31, { is_present: false }), // offline
]

// ---------------- mock owned properties (monopoly_properties rows) ----------------
// tile_index → { owner, houses, mortgaged }. Chosen so PlayerCard group pips, the
// holdings legend, net worth, and the Manage modal all have realistic content:
//   p1 owns the full orange set (16/18/19) with even houses → build/sell offered
//   p3 owns the full red set (21/23/24), one with a hotel
//   p1 also owns a mortgaged railroad → unmortgage offered
const MOCK_PROPERTIES = [
  { tile_index: 16, owner: 'p1', houses: 3, mortgaged: false }, // Jerash (orange)
  { tile_index: 18, owner: 'p1', houses: 3, mortgaged: false }, // Ma'an (orange)
  { tile_index: 19, owner: 'p1', houses: 2, mortgaged: false }, // Wadi Rum (orange)
  { tile_index: 5, owner: 'p1', houses: 0, mortgaged: true },   // Queen Alia Airport (mortgaged rail)
  { tile_index: 21, owner: 'p3', houses: 5, mortgaged: false }, // Dead Sea (red, hotel)
  { tile_index: 23, owner: 'p3', houses: 4, mortgaged: false }, // Dana Reserve (red)
  { tile_index: 24, owner: 'p3', houses: 4, mortgaged: false }, // Petra (red)
  { tile_index: 6, owner: 'p2', houses: 0, mortgaged: false },  // Zarqa (cyan)
  { tile_index: 12, owner: 'p2', houses: 0, mortgaged: false }, // Electricity (utility)
]

// A mock event log covering EVERY event kind formatLog handles, so all the
// .mono-ev-* chips render at once.
const MOCK_LOG = [
  { k: 'start' },
  { k: 'roll', by: 'p1', d: [4, 3] },
  { k: 'buy', by: 'p1', tile: 16, price: 180 },
  { k: 'rent', by: 'p3', to: 'p1', amount: 70 },
  { k: 'tax', by: 'p2', amount: 200 },
  { k: 'pass_go', by: 'p3' },
  { k: 'card', by: 'p2', text: { en: 'Bank pays you a dividend of 50 JOD.', ar: 'يدفع لك البنك 50 دينارًا.' } },
  { k: 'jail', by: 'p2' },
  { k: 'jail_out', by: 'p2' },
  { k: 'build', by: 'p1', tile: 18, houses: 3 },
  { k: 'sell', by: 'p1', tile: 19 },
  { k: 'mortgage', by: 'p1', tile: 5 },
  { k: 'unmortgage', by: 'p3', tile: 23 },
  { k: 'trade', from: 'p1', to: 'p3' },
  { k: 'auction_win', by: 'p3', tile: 39, price: 260 },
  { k: 'auction_none', tile: 37 },
  { k: 'bankrupt', by: 'p4' },
  { k: 'resign', by: 'p4' },
  { k: 'win', by: 'p1' },
]

const TURN_ID = 'p1'
const NEXT_ID = 'p3'
const MY_ID = 'p1'

// A mock room object shaped like the real one, enough for ManageModal / TradeModal
// gating (mirrors monopoly_rooms columns those two read).
const MOCK_ROOM = {
  id: 'dev-room',
  status: 'playing',
  phase: 'roll',
  turn_order: ['p1', 'p2', 'p3', 'p4', 'p5'],
  current_seat: 0,
  bank_houses: 22,
  bank_hotels: 9,
  pending_debt: null,
}

const MOMENTS = ['none', 'buy', 'auction', 'jail', 'debt', 'trade']

export default function MonopolyHudHarness() {
  const { t, dir: docDir, setLang, lang } = useLang()
  const [dir, setDir] = useState(docDir)
  const [moment, setMoment] = useState('none')
  const [manageOpen, setManageOpen] = useState(false)
  const [tradeOpen, setTradeOpen] = useState(false)
  const [deedOpen, setDeedOpen] = useState(false)
  const [rolling, setRolling] = useState(false)

  const money = (n) => t('mono.amount', { amount: n })
  const name = (id) => {
    const p = MOCK_PLAYERS.find((x) => x.profile_id === id)
    return p?.profile?.global_name || '—'
  }
  const noop = () => {}

  const playerById = useMemo(() => Object.fromEntries(MOCK_PLAYERS.map((p) => [p.profile_id, p])), [])
  const playerColor = useMemo(() => Object.fromEntries(MOCK_PLAYERS.map((p) => [p.profile_id, tokenMeta(p.token).color])), [])
  const propByTile = useMemo(() => Object.fromEntries(MOCK_PROPERTIES.map((p) => [p.tile_index, p])), [])
  // Per-player owned colour-group pips (same derivation as MonopolyGame).
  const groupsByPlayer = useMemo(() => {
    const res = {}
    for (const p of MOCK_PLAYERS) {
      const owned = {}
      for (const pr of MOCK_PROPERTIES) {
        if (pr.owner !== p.profile_id) continue
        const c = safeTile(pr.tile_index).color
        if (c) owned[c] = (owned[c] || 0) + 1
      }
      res[p.profile_id] = Object.entries(owned).map(([c, n]) => ({ hex: COLOR_GROUPS[c]?.hex || '#888', full: n === (COLOR_GROUPS[c]?.size || 99) }))
    }
    return res
  }, [])
  const holdings = useMemo(() => MOCK_PLAYERS
    .map((p) => ({ id: p.profile_id, name: name(p.profile_id), color: tokenMeta(p.token).color, count: MOCK_PROPERTIES.filter((pr) => pr.owner === p.profile_id).length }))
    .filter((h) => h.count > 0), [])
  const reversedLog = useMemo(() => MOCK_LOG.map((e, i) => ({ e, i })).reverse(), [])

  const me = playerById[MY_ID]
  const turnMeta = tokenMeta(playerById[TURN_ID].token)

  // ----- mock decision-moment payloads (shapes match the real pending_* objects) -----
  const pendingPurchase = { tile: 16, price: 180 } // Jerash
  const auctionRoom = {
    pending_auction: {
      tile: 39, high_bid: 210, high_bidder: 'p3', on_clock: 0,
      active: ['p1', 'p3', 'p5'],
    },
  }
  const pendingTrade = {
    from: 'p3', to: 'p1',
    give: { cash: 150, tiles: [21], goojf: 0 },
    want: { cash: 0, tiles: [16, 18], goojf: 1 },
  }
  const debtAmount = 320

  const setDir2 = (d) => { setDir(d); setLang(d === 'rtl' ? 'ar' : 'en') }

  // The moment scrim + panel (reproduces MonopolyGame.renderMoment's wrapper + kind).
  const renderMoment = () => {
    if (moment === 'none') return null
    let kind = moment
    let body = null
    if (moment === 'buy') {
      body = <BuyPanel pend={pendingPurchase} lang={lang} t={t} money={money} busy={false} cash={me.cash} onBuy={noop} onDecline={noop} />
    } else if (moment === 'auction') {
      body = <AuctionPanel room={auctionRoom} myId={MY_ID} name={name} lang={lang} t={t} money={money} busy={false}
        playerById={playerById} playerColor={playerColor} onBid={noop} onPass={noop} />
    } else if (moment === 'jail') {
      // inline JSX in the real game (closes over game state) → real markup, mock content.
      body = (
        <div className="mono-jail-moment">
          <span className="mono-jail-tag">⛓ {t('mono.inJail')}</span>
          <div className="mono-jail-actions">
            <button className="btn btn-line btn-sm" disabled={me.cash < JAIL_FINE}>{t('mono.payFine')}</button>
            <button className="btn btn-line btn-sm">{t('mono.useCard')}</button>
            <button className="btn btn-gold btn-sm">{t('mono.rollJail')}</button>
          </div>
        </div>
      )
    } else if (moment === 'debt') {
      body = (
        <div className="mono-debt">
          <p className="mono-owe">{t('mono.youOweShort', { amount: debtAmount })}</p>
          <div className="mono-debt-btns">
            <button className="btn btn-line btn-sm" onClick={() => setManageOpen(true)}>{t('mono.manage')}</button>
            <button className="btn btn-red btn-sm">{t('mono.declareBankrupt')}</button>
          </div>
        </div>
      )
    } else if (moment === 'trade') {
      kind = 'trade'
      body = <TradePanel tr={pendingTrade} myId={MY_ID} name={name} lang={lang} t={t} money={money} busy={false}
        onAccept={noop} onReject={noop} onCancel={noop} />
    }
    if (!body) return null
    return (
      <div className={`mono-moment-scrim mono-moment-${kind}`} dir={dir}>
        <div className="mono-moment" role="dialog" aria-modal="false">{body}</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#0d130f' }}>
      {/* ---- dev chrome (NOT part of the game HUD) ---- */}
      <div style={devBar}>
        <strong style={{ letterSpacing: 1, color: '#cdbf8f' }}>MONOPOLY HUD · DEV HARNESS</strong>
        <span style={devLabel}>moment:</span>
        {MOMENTS.map((m) => (
          <button key={m} onClick={() => setMoment(m)} style={{ ...devBtn, ...(moment === m ? devBtnOn : null) }}>{m}</button>
        ))}
        <span style={devLabel}>modals:</span>
        <button onClick={() => setManageOpen((v) => !v)} style={{ ...devBtn, ...(manageOpen ? devBtnOn : null) }}>Manage</button>
        <button onClick={() => setTradeOpen((v) => !v)} style={{ ...devBtn, ...(tradeOpen ? devBtnOn : null) }}>Trade</button>
        <button onClick={() => setDeedOpen((v) => !v)} style={{ ...devBtn, ...(deedOpen ? devBtnOn : null) }}>Deed popover</button>
        <span style={devLabel}>dir:</span>
        <button onClick={() => setDir2('ltr')} style={{ ...devBtn, ...(dir === 'ltr' ? devBtnOn : null) }}>LTR</button>
        <button onClick={() => setDir2('rtl')} style={{ ...devBtn, ...(dir === 'rtl' ? devBtnOn : null) }}>RTL (AR)</button>
        <span style={devLabel}>state:</span>
        <button onClick={() => setRolling((v) => !v)} style={{ ...devBtn, ...(rolling ? devBtnOn : null) }}>You rolling</button>
      </div>

      {/* ---- the REAL game HUD, scoped by .mono-game ---- */}
      <div className="mono-game" dir={dir} style={{ maxWidth: 1180, margin: '0 auto' }}>
        {/* Header */}
        <div className="mono-header">
          <div className="mono-brand">
            <div className="mono-crest"><Landmark size={20} /></div>
            <div className="mono-brand-text">
              <span className="mono-brand-over">JORDAN</span>
              <span className="mono-brand-name">MONOPOLY</span>
            </div>
          </div>
          <div className="mono-header-tools">
            <span className="mono-live-pill"><span className="mono-live-dot" /> 4 · {t('mono.live')}</span>
            <button className="mono-icon-btn" aria-label={t('mono.3dMode')} title={t('mono.3dMode')}><Box size={18} /></button>
            <button className="mono-icon-btn" aria-label={t('mono.soundOn')} title={t('mono.soundOn')}><Volume2 size={18} /></button>
            <button className="mono-icon-btn" aria-label={t('mono.fullscreen')} title={t('mono.fullscreen')}><Maximize size={18} /></button>
          </div>
        </div>

        {/* Player rail — normal / active-turn / next / rolling / bankrupt / in-jail / offline */}
        <div className="mono-players-strip">
          {MOCK_PLAYERS.map((p) => (
            <PlayerCard key={p.profile_id} p={p}
              isTurn={p.profile_id === TURN_ID}
              isNext={p.profile_id === NEXT_ID}
              isMe={p.profile_id === MY_ID}
              rolling={rolling && p.profile_id === TURN_ID}
              isOnline={p.is_present !== false}
              offlineText={t('mono.offline')}
              rollText={t('mono.rolling')} nextText={t('mono.next')} money={money}
              worth={aff.netWorth(p, propByTile)} worthLabel={t('mono.netWorth')}
              groups={groupsByPlayer[p.profile_id]} reduced setCardRef={noop} />
          ))}
        </div>

        {/* Stage: standalone deed card + the moment overlay + the control dock */}
        <div className="mono-stage" style={{ position: 'relative', minHeight: 360, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', justifyItems: 'center', alignItems: 'center', padding: 24 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Deed tile={safeTile(19)} lang={lang} t={t} money={money} />
            <Deed tile={safeTile(5)} lang={lang} t={t} money={money} />
            <Deed tile={safeTile(12)} lang={lang} t={t} money={money} />
          </div>
          {renderMoment()}

          {/* Control dock — inline JSX in the real game; real class structure, mock content.
              justifySelf:stretch is harness-only chrome: the stage here is a
              place-items:center grid, so without it the row collapses to
              max-content and can't show the full-width three-zone layout the
              real game's wider board stage provides. */}
          <div className="mono-dock-row" style={{ justifySelf: 'stretch' }}>
            <div className="mono-dock" dir={dir}>
              {/* LEFT zone: context — whose turn + (in 2D-Lite) the dice */}
              <div className="mono-dock-left">
                <div className={`mono-turnchip you${rolling ? ' rolling' : ''}`} aria-live="polite">
                  <span className="mono-turnchip-av" style={{ '--tok': turnMeta.color }}>{turnMeta.emoji}</span>
                  <span className="mono-turnchip-txt">
                    <b>{t('mono.yourTurn')}</b>
                    {rolling && <i>{t('mono.rolling')}</i>}
                  </span>
                </div>

                <div className="mono-dice">
                  <Dice3D value={3} rolling={rolling} />
                  <Dice3D value={5} rolling={rolling} />
                </div>
              </div>

              {/* CENTER zone: the primary action / spectator status line */}
              <div className="mono-dock-main">
                <div className="mono-actions">
                  <button className="btn btn-gold"><Dice5 size={16} /> {t('mono.roll')}</button>
                  <button className="btn btn-line btn-sm" onClick={() => setManageOpen(true)}>{t('mono.manage')}</button>
                  <button className="btn btn-line btn-sm" onClick={() => setTradeOpen(true)}><Handshake size={14} /> {t('mono.trade')}</button>
                </div>
              </div>

              {/* Drawn Chance/Chest — an in-flow full-width banner row atop the dock's
                  controls (CSS: order:-1, flex:0 0 100%); stays below the board. */}
              <div className="mono-card-pop chance">
                <span className="mono-card-deck">❓ {t('mono.chance')}</span>
                <p>Advance to the nearest transit hub and pay double rent.</p>
              </div>

              {/* RIGHT zone: the countdown, anchored to the far end */}
              <TurnTimer phaseEndsAt={new Date(Date.now() + 42_000).toISOString()} turnSeconds={60} serverNow={Date.now} />
            </div>
          </div>
        </div>

        {/* Side: game log (every event chip) + holdings legend + leave */}
        <div className="mono-side">
          <div className="panel mono-log-panel">
            <span className="glabel">{t('mono.log')}</span>
            <div className="mono-log">
              {reversedLog.map(({ e, i }) => (
                <div className={`mono-log-row mono-ev-${e.k}`} key={`${e.k}-${e.by ?? ''}-${i}`}>{formatLog(e, name, lang, t)}</div>
              ))}
            </div>
          </div>
          <details className="panel mono-legend" open>
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
          <span className="btn btn-line btn-sm mono-leave"><LogOut size={14} /> {t('mono.leave')}</span>
        </div>

        {/* Modals + deed popover — all reused real components */}
        {manageOpen && <ManageModal room={MOCK_ROOM} me={me} properties={MOCK_PROPERTIES} propByTile={propByTile} lang={lang} t={t} busy={false} act={noop} onClose={() => setManageOpen(false)} />}
        {tradeOpen && <TradeModal room={MOCK_ROOM} me={me} players={MOCK_PLAYERS} properties={MOCK_PROPERTIES} lang={lang} t={t} myId={MY_ID} name={name} busy={false} act={noop} onClose={() => setTradeOpen(false)} />}
        {deedOpen && <DeedPopover tileIndex={16} propByTile={propByTile} lang={lang} t={t} money={money} name={name} playerColor={playerColor} room={MOCK_ROOM} myId={MY_ID} isMyTurn cash={me.cash} busy={false} act={noop} onClose={() => setDeedOpen(false)} />}
      </div>
    </div>
  )
}

// ---- dev-chrome inline styles (deliberately NOT .mono-* so they read as "dev") ----
// opaque bg (no backdrop-filter) so this sticky dev-chrome bar never re-blurs the
// HUD scrolling beneath it — keeps even the dev harness smooth (matches the perf pass).
const devBar = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '10px 16px', background: '#0f1512', borderBottom: '1px solid #24302a', fontSize: 13, position: 'sticky', top: 0, zIndex: 50 }
const devLabel = { color: '#7f8a80', marginInlineStart: 6 }
const devBtn = { padding: '3px 9px', borderRadius: 8, border: '1px solid #384', background: '#1a2620', color: '#dfe7df', cursor: 'pointer' }
const devBtnOn = { border: '2px solid #d4af37', background: '#22301f' }
