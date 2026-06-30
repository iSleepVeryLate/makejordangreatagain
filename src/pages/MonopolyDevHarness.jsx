import { useRef, useState, useEffect } from 'react'
import MonopolyScene3D from '../games/MonopolyScene3D.jsx'
import MoneyFloatLayer from '../games/MoneyFloat.jsx'
import { createAnimatorStore, ringPath } from '../games/useBoardAnimator.js'
import { CENTERS } from '../games/monopolyGeometry.js'
import { tokenMeta } from '../games/monopolyTokens.js'
import { sound } from '../lib/sound.js'

// DEV-ONLY visual harness for the 3D Monopoly renderer. Registered in App.jsx only
// when __DEV_SERVER__ is true (inlined `false` for prod → tree-shaken out). Lets us
// drive pieces / dice / buildings without a real Discord session / live game.
const MOCK_PLAYERS = [
  { profile_id: 'p1', token: 'car', position: 0, bankrupt: false, cash: 1500, is_present: true },
  { profile_id: 'p2', token: 'hat', position: 0, bankrupt: false, cash: 1500, is_present: true },
  { profile_id: 'p3', token: 'dog', position: 24, bankrupt: false, cash: 1500, is_present: true },
  { profile_id: 'p4', token: 'ship', position: 10, bankrupt: false, cash: 1500, is_present: true },
]
const PLAYER_COLOR = Object.fromEntries(MOCK_PLAYERS.map((p) => [p.profile_id, tokenMeta(p.token).color]))

export default function MonopolyDevHarness() {
  const store = useRef(createAnimatorStore()).current
  const [reduced, setReduced] = useState(false)
  const [muted, setMutedState] = useState(sound.getMuted())
  const [lastTile, setLastTile] = useState(null)
  const [active, setActive] = useState('p1')
  const [lastRoll, setLastRoll] = useState(null)
  const [activeTile, setActiveTile] = useState(0)
  const [auctionTile, setAuctionTile] = useState(null)
  const [props, setProps] = useState([
    { tile_index: 1, owner: 'p1', houses: 2, mortgaged: false },
    { tile_index: 3, owner: 'p1', houses: 5, mortgaged: false },
    { tile_index: 6, owner: 'p2', houses: 1, mortgaged: false },
    { tile_index: 8, owner: 'p2', houses: 0, mortgaged: true },
    { tile_index: 11, owner: 'p3', houses: 3, mortgaged: false },
    { tile_index: 16, owner: 'p4', houses: 4, mortgaged: false },
  ])
  const timers = useRef([])

  useEffect(() => {
    store.snapTokens({ p1: 0, p2: 0, p3: 24, p4: 10 }, 'p1')
    // Arm WebAudio unlock so the G1/G2 juice SFX (land/shimmer/diceImpact) are AUDIBLE in
    // the harness on the first click — the 3D layers fire these directly on the FX events.
    sound.installUnlock()
    return () => { timers.current.forEach(clearTimeout) }
  }, [store])

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  // Walk the active token `steps` tiles forward, hop by hop. Returns the destination.
  // `onArrive` fires after the last hop (used to clear the roll highlight).
  const walkSteps = (steps, onArrive) => {
    const cur = store.getPos(active) ?? 0
    for (let k = 1; k <= steps; k++) {
      const pos = (cur + k) % 40
      timers.current.push(setTimeout(() => {
        store.setTokenPos(active, pos, { hop: true })
        if (k === steps) { setActiveTile(pos); onArrive?.(pos) }
      }, k * 165))
    }
    return (cur + steps) % 40
  }
  const walk = (steps) => { clearTimers(); walkSteps(steps) }
  const glideTo = (tile) => { clearTimers(); store.clearRoll(); store.setTokenPos(active, tile, { glide: true }); setActiveTile(tile) }
  const setActiveP = (id) => { setActive(id); store.setActive(id); store.clearRoll(); setActiveTile(store.getPos(id) ?? 0) }
  // Full "I rolled N → I'm going there → token goes there" demo flow: tumble the dice,
  // settle them, pop the readout + light the destination/path, THEN walk the token to it
  // and clear the highlight on arrival (mirrors the real game's roll→walk→clear cycle).
  const rollDice = () => {
    clearTimers()
    store.clearRoll()
    store.setRolling(true)
    const a = 1 + Math.floor(Math.random() * 6); const b = 1 + Math.floor(Math.random() * 6)
    const total = a + b
    const from = store.getPos(active) ?? 0
    const to = (from + total) % 40
    timers.current.push(setTimeout(() => {
      store.settleDice(a, b); setLastRoll(`${a}+${b}`)
      // readout + "you'll land here" the moment the roll is known
      store.showRoll({ a, b, from, to, path: ringPath(from, total), active })
      // then walk the token to the destination; clear the highlight on arrival
      walkSteps(total, () => store.clearRoll())
    }, 850))
  }
  const buildOn = (tile) => setProps((ps) => ps.map((p) => (p.tile_index === tile ? { ...p, houses: Math.min(5, p.houses + 1) } : p)))

  // G3 — fire the full cash-GAIN payoff at the active token: the 3D coin burst
  // (store.coin → scene.coinReward), the floating "+$N" pop (gold + larger for a big
  // gain, via store.floats → MoneyFloatLayer below), and the ka-ching. Mirrors what
  // fireFloats does in a real game so the coin juice is testable WITHOUT a live game.
  // Under reduced motion the burst is gated downstream (TokenField no-ops); the +$N
  // float still shows (calmer) + the sound still plays — same as the live path.
  const reward = (amount) => {
    const pos = store.getPos(active) ?? 0
    const c = CENTERS[pos] || CENTERS[0]
    store.pushFloat({ amount, x: c.x, y: c.y, color: PLAYER_COLOR[active], big: amount >= 120 })
    store.pushCoin(active, amount) // → 3D coin burst at the active token
    sound.play('coin')
  }

  return (
    <div style={{ maxWidth: 940, margin: '20px auto', padding: '0 16px' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, color: '#cdbf8f', flexWrap: 'wrap' }}>
        <strong style={{ letterSpacing: 1 }}>MONOPOLY 3D · DEV HARNESS</strong>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={reduced} onChange={(e) => setReduced(e.target.checked)} /> reduced motion</label>
        <label style={{ fontSize: 13 }}><input type="checkbox" checked={muted} onChange={() => { sound.toggleMute(); setMutedState(sound.getMuted()) }} /> mute</label>
        <span style={{ fontSize: 13, opacity: 0.7 }}>clicked: {lastTile ?? '—'} · roll: {lastRoll ?? '—'}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: '#9a8' }}>active:</span>
        {MOCK_PLAYERS.map((p) => (
          <button key={p.profile_id} onClick={() => setActiveP(p.profile_id)} style={{ ...btn, border: active === p.profile_id ? '2px solid #d4af37' : '1px solid #444' }}>{p.token}</button>
        ))}
        <button onClick={() => walk(7)} style={btn}>walk +7</button>
        <button onClick={() => glideTo(0)} style={btn}>glide → GO</button>
        <button onClick={rollDice} style={btn}>🎲 roll</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: '#9a8' }}>build:</span>
        <button onClick={() => buildOn(1)} style={btn}>+house tile 1</button>
        <button onClick={() => buildOn(6)} style={btn}>+house tile 6</button>
        <button onClick={() => setAuctionTile(auctionTile == null ? 39 : null)} style={btn}>toggle auction(39)</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: '#9a8' }}>reward:</span>
        <button onClick={() => reward(200)} style={btn}>＋$200 reward</button>
        <button onClick={() => reward(75)} style={btn}>rent ＋$75</button>
        <button onClick={() => reward(15)} style={btn}>card ＋$15</button>
      </div>
      {/* The scene + an overlaid MoneyFloatLayer so the "+$N" pop is visible in the
          harness (the 3D scene itself doesn't mount the float layer — that lives in the
          2D-Lite board). The %-anchored floats map to the board face approximately here;
          this is a dev surface to confirm the pop fires, not a pixel-exact placement. */}
      <div style={{ position: 'relative' }}>
        <MonopolyScene3D
          store={store}
          players={MOCK_PLAYERS}
          properties={props}
          playerColor={PLAYER_COLOR}
          activeTile={activeTile}
          activeColor={PLAYER_COLOR[active] ?? null}
          auctionTile={auctionTile}
          reducedMotion={reduced}
          lang="en"
          debug
          onTile={(i) => setLastTile(i)}
          onContextLost={() => {}}
        >
          <div className="mono-center-inner"><div className="mono-turn-banner you">3D harness</div></div>
        </MonopolyScene3D>
        <MoneyFloatLayer store={store} />
      </div>
    </div>
  )
}

const btn = { padding: '3px 9px', borderRadius: 8, border: '1px solid #444', background: '#1a2620', color: '#eee', cursor: 'pointer' }
