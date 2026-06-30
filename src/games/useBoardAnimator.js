import { useEffect, useRef } from 'react'
import { CENTERS } from './monopolyGeometry.js'
import { tokenMeta } from './monopolyTokens.js'

// ============================================================================
// Delta-driven animation orchestrator (the heart of the "pro" upgrade).
//
// PRINCIPLE: the committed snapshot is truth. Animations are a cosmetic replay
// of the transition between the snapshot we last displayed and the new one. They
// always converge to the snapshot and never block, gate, or alter gameplay.
//
// To avoid re-rendering the 40 tiles / the log on every hop, the animator drives
// THREE tiny external stores (token positions, dice, money floats). Only the
// overlay components that subscribe (TokenLayer, DiceBox, MoneyFloatLayer)
// re-render as a piece hops — MonopolyGame and the board stay put until the next
// real seq bump.
// ============================================================================

const STEP_MS = 165 // per-tile dice walk
const GLIDE_MS = 460 // card/jail relocation glide (only when too far to walk)
const HOP_THROTTLE = 70 // min ms between hop ticks so fast walks don't machine-gun
const FLOAT_TTL = 2200
const RELOC_WALK_CAP = 13 // a card/jail relocation farther than this glides instead of walking the ring

// A minimal subscribable slice (useSyncExternalStore-compatible). get() returns a
// stable reference until set() swaps in a new one, so React won't loop.
function makeSlice(initial) {
  let state = initial
  const ls = new Set()
  return {
    get: () => state,
    set: (next) => { state = next; ls.forEach((l) => l()) },
    subscribe: (l) => { ls.add(l); return () => ls.delete(l) },
  }
}

let FLOAT_KEY = 0

export function createAnimatorStore() {
  const tokens = makeSlice({ pos: {}, hopSeq: {}, mode: {}, active: null })
  const dice = makeSlice({ a: null, b: null, rolling: false, nonce: 0 })
  const floats = makeSlice([])
  // G3 — CASH-GAIN reward signal. Bumped (a fresh {id, amount, nonce}) whenever a player
  // GAINS cash, so the 3D scene can fire a coin burst at that token. Renderer-agnostic:
  // the animator owns the gameplay-derived signal; the 3D wrapper subscribes and calls
  // scene.coinReward(id). The 2D-Lite path simply ignores it (the DOM +$N float carries
  // the gain there). Self-clearing isn't needed — it's an edge signal, not held state.
  const coin = makeSlice({ id: null, amount: 0, nonce: 0 })
  // ROLL READOUT + "you'll land here" slice. Populated the moment a roll is known
  // (dice committed + we can read from→to off the authoritative delta) and CLEARED
  // when the move ends. Drives BOTH the DOM readout overlay (MonopolyScene3D) and the
  // 3D destination/path highlight (BuildingsLayer) — presentation only, never gameplay.
  //   show  — readout visible
  //   a,b   — the two committed faces (a+b = total)
  //   from  — the tile the active token started this move from
  //   to    — the tile it will land on (from + total around the ring)
  //   path  — the tiles it passes over (exclusive of `from`, inclusive of `to`)
  //   active— the active player's id (so the highlight tints in their colour)
  //   nonce — bumps on each new roll so subscribers re-read
  const roll = makeSlice({ show: false, a: null, b: null, from: null, to: null, path: [], active: null, nonce: 0 })

  const getPos = (id) => tokens.get().pos[id]

  const setTokenPos = (id, pos, { hop = false, glide = false } = {}) => {
    const s = tokens.get()
    tokens.set({
      ...s,
      pos: { ...s.pos, [id]: pos },
      hopSeq: hop ? { ...s.hopSeq, [id]: (s.hopSeq[id] || 0) + 1 } : s.hopSeq,
      mode: { ...s.mode, [id]: glide ? 'glide' : 'hop' },
    })
  }

  // Instantly place everyone at their authoritative tiles (no slide, no sound).
  const snapTokens = (posMap, active) => {
    const s = tokens.get()
    tokens.set({ pos: { ...posMap }, hopSeq: s.hopSeq, mode: {}, active: active ?? s.active })
  }

  const setActive = (id) => {
    const s = tokens.get()
    if (s.active === id) return
    tokens.set({ ...s, active: id })
  }

  const settleDice = (a, b) => {
    const d = dice.get()
    dice.set({ a, b, rolling: false, nonce: d.nonce + 1 })
  }

  const setRolling = (rolling) => {
    const d = dice.get()
    if (d.rolling === rolling) return
    dice.set({ ...d, rolling })
  }

  const pushFloat = (f) => {
    const key = ++FLOAT_KEY
    floats.set([...floats.get(), { ...f, key }])
    setTimeout(() => { floats.set(floats.get().filter((x) => x.key !== key)) }, FLOAT_TTL)
  }

  // G3 — signal a cash GAIN at a token (drives the 3D coin burst). Edge signal: each call
  // bumps the nonce so a subscriber re-reads even on an identical id+amount (two equal
  // rents back-to-back still each fire). No-op for non-positive amounts (losses don't pay out).
  const pushCoin = (id, amount) => {
    if (!id || !(amount > 0)) return
    coin.set({ id, amount, nonce: coin.get().nonce + 1 })
  }

  // Show the roll readout + destination/path. Idempotent re-show with the same target is
  // a no-op-ish nonce bump; callers pass a fresh nonce per real roll.
  const showRoll = ({ a, b, from, to, path = [], active = null }) => {
    roll.set({ show: true, a, b, from, to, path, active, nonce: roll.get().nonce + 1 })
  }
  // Clear when the move ends (token arrived). Keeps nonce so a later same-faces roll
  // still re-renders. No-op if already hidden (avoids a redundant subscriber tick).
  const clearRoll = () => {
    const r = roll.get()
    if (!r.show) return
    roll.set({ show: false, a: null, b: null, from: null, to: null, path: [], active: null, nonce: r.nonce })
  }

  return { tokens, dice, floats, roll, coin, getPos, setTokenPos, snapTokens, setActive, settleDice, setRolling, pushFloat, pushCoin, showRoll, clearRoll }
}

const posMap = (players) => {
  const m = {}
  for (const p of players) if (!p.bankrupt) m[p.profile_id] = p.position
  return m
}
const cashMap = (players) => {
  const m = {}
  for (const p of players) m[p.profile_id] = p.cash
  return m
}

// Append a card/jail RELOCATION as a perimeter walk the SHORT way around the ring
// (so the piece travels along the board edge, not diagonally through the middle).
// Forward steps cross GO; a relocation too far to read as a walk falls back to a
// single glide. Always lands exactly on `to`.
function appendReloc(out, from, to) {
  const fwd = (to - from + 40) % 40
  const bwd = (from - to + 40) % 40
  const dist = Math.min(fwd, bwd)
  if (dist === 0) return
  if (dist > RELOC_WALK_CAP) { out.push({ pos: to, mode: 'glide' }); return }
  const dir = fwd <= bwd ? 1 : -1
  let cur = from
  for (let k = 0; k < dist; k++) {
    cur = (cur + dir + 40) % 40
    out.push({ pos: cur, mode: 'hop', go: dir === 1 && cur === 0 })
  }
}

// Build the walk from (from, dice, to). Returns { leg1, leg2 }:
//   LEG 1 — tile-by-tile hop from→…→viaDice (dice total) — only when we TRUST the
//           dice (a contiguous +1 step whose dice belong to this very move).
//   LEG 2 — the second half of a roll+card/jail relocation (walked around the ring),
//           OR the whole move when we DON'T trust the dice (a seq gap / no dice).
//           Walking/gliding the real path beats walking a bogus dice count (the
//           "piece walks the wrong way then jumps" bug) and an instant teleport.
function buildPath(from, dice, to, trustDice) {
  const leg1 = []
  const leg2 = []
  const total = Array.isArray(dice) && dice.length === 2 ? dice[0] + dice[1] : null
  if (trustDice && total != null) {
    const viaDice = (from + total) % 40
    let cur = from
    let guard = 0
    while (cur !== viaDice && guard < 45) {
      cur = (cur + 1) % 40
      leg1.push({ pos: cur, go: cur === 0 })
      guard++
    }
    if (viaDice !== to) appendReloc(leg2, viaDice, to)
  } else {
    appendReloc(leg2, from, to)
  }
  return { leg1, leg2 }
}

// The tiles a forward dice walk passes over: from+1 … from+total (mod 40), inclusive
// of the destination, EXCLUSIVE of the origin. Used to light up "you'll land here" +
// the path the moment the roll is known (presentation only). total is clamped to a
// sane dice range so a bad value can never spin a huge array. Exported so the dev
// harness can drive the same highlight without a live game.
export function ringPath(from, total) {
  const out = []
  if (from == null || !Number.isFinite(total)) return out
  const n = Math.max(0, Math.min(24, Math.floor(total)))
  for (let k = 1; k <= n; k++) out.push((from + k) % 40)
  return out
}

// A cash GAIN at/above this reads as a "big" payoff → the +$N float renders larger +
// golden (the coin burst always fires for any gain). Tuned so GO salary (200) and most
// rents qualify, while a small +$N (e.g. a $15 card) stays the calm default float.
const BIG_GAIN = 120

// Fire +N / −N floats from each player's cash delta, anchored at their token. On a
// POSITIVE delta (G3) also bump the coin slice (→ 3D coin burst at that token) and play
// the ka-ching once. Big gains tag the float `big` so MoneyFloat renders it gold + larger.
// `play` may be undefined (no sound); reducedMotion only gates the SOUND repeat cap here —
// the coin burst itself is gated downstream (TokenField no-ops under reduced motion).
function fireFloats(players, prevCash, store, play) {
  let gainPlayed = false
  for (const p of players) {
    const before = prevCash[p.profile_id]
    if (before === undefined) continue
    const delta = p.cash - before
    if (delta === 0) continue
    const c = CENTERS[p.position] || CENTERS[0]
    const gain = delta > 0
    const big = delta >= BIG_GAIN
    store.pushFloat({ amount: delta, x: c.x, y: c.y, color: tokenMeta(p.token).color, big: gain && big })
    if (gain) {
      store.pushCoin(p.profile_id, delta) // 3D coin burst at this token (no-op in 2D-Lite)
      // one ka-ching per snapshot even if several players gained at once (avoids a chord)
      if (!gainPlayed) { play?.('coin'); gainPlayed = true }
    }
  }
}

// Non-movement landing sounds (movement-tied hop/go fire during the walk; rent/tax
// floats fire from the cash delta). One sound per relevant log entry in the tail.
function fireEventSounds(events, play) {
  if (!play) return
  for (const e of events) {
    switch (e.k) {
      case 'buy': case 'auction_win': play('buy'); break
      case 'rent': play('rent'); break
      case 'tax': play('rent'); break
      case 'build': play('build'); break
      case 'sell': play('build'); break
      case 'card': play('card'); break
      case 'mortgage': case 'unmortgage': play('ui'); break
      case 'jail': play('jail'); break
      case 'jail_out': play('jailOut'); break
      case 'bankrupt': play('bankrupt'); break
      case 'win': play('win'); break
      default: break
    }
  }
}

export function useBoardAnimator(room, players, properties, opts = {}) {
  const { play, reducedMotion = false } = opts
  const storeRef = useRef(null)
  if (!storeRef.current) storeRef.current = createAnimatorStore()
  const store = storeRef.current

  const lastSeqRef = useRef(null)
  const lastLogLenRef = useRef(0)
  const prevCashRef = useRef({})
  // The AUTHORITATIVE positions we've accepted (committed to rendering toward). The
  // walk origin — NOT the rendered pos, which after a snap already equals the
  // destination, so walking from it would step zero tiles or the wrong count.
  const prevAuthPosRef = useRef(null)
  // The authoritative positions the in-flight walk is converging to, so a redundant
  // mid-walk snapshot with the SAME target can let the walk finish instead of snapping.
  const walkTargetRef = useRef(null)
  const timeoutsRef = useRef([])
  const walkingRef = useRef(false)
  const lastHopRef = useRef(0)
  const playRef = useRef(play); playRef.current = play
  const reducedRef = useRef(reducedMotion); reducedRef.current = reducedMotion
  const myTurnSeenRef = useRef(null) // last current_seat actor we chimed a "your turn" for

  useEffect(() => {
    if (!room || room.status !== 'playing') return
    const p = playRef.current
    const seq = typeof room.seq === 'number' ? room.seq : 0
    const log = Array.isArray(room.log) ? room.log : []
    const authPos = posMap(players)
    const authCash = cashMap(players)
    const turnId = room.turn_order?.[room.current_seat] ?? null

    const clearTimers = () => { timeoutsRef.current.forEach(clearTimeout); timeoutsRef.current = [] }
    const schedule = (fn, ms) => { const id = setTimeout(fn, ms); timeoutsRef.current.push(id); return id }

    // ---- FIRST PAINT or BACKWARD seq → hard SNAP (no replay, no sound) ----
    // A seq GAP no longer forces a snap (that was the teleport bug under degraded
    // realtime): we drive the walk off the authoritative position delta below and
    // glide — not teleport — when the dice can't be trusted.
    const first = lastSeqRef.current === null
    const prevSeq = lastSeqRef.current
    const backward = !first && seq < prevSeq
    if (first || backward) {
      clearTimers(); walkingRef.current = false; walkTargetRef.current = null
      store.clearRoll() // fresh paint / rewind → no stale destination prediction
      store.snapTokens(authPos, turnId)
      if (Array.isArray(room.dice)) store.settleDice(room.dice[0], room.dice[1])
      else store.settleDice(null, null)
      lastSeqRef.current = seq
      lastLogLenRef.current = log.length
      prevAuthPosRef.current = authPos
      prevCashRef.current = authCash
      myTurnSeenRef.current = seq // don't chime on first paint
      return
    }
    const gap = seq - prevSeq > 1

    store.setActive(turnId)

    // Did THIS step commit a fresh dice roll? Drives the "you'll land here" readout +
    // destination/path highlight below (we only predict a destination off the dice when
    // we actually trust them — a real roll this step, contiguous, by the turn player).
    let rolledThisStep = false

    // ---- NEW SEQ STEP: consume the log tail for dice + sounds ----
    if (seq > prevSeq) {
      const events = log.slice(lastLogLenRef.current)
      lastSeqRef.current = seq
      lastLogLenRef.current = log.length
      const rollEv = events.find((e) => e.k === 'roll')
      if (rollEv && Array.isArray(room.dice)) {
        rolledThisStep = true
        store.settleDice(room.dice[0], room.dice[1])
        p?.('diceLand')
      } else {
        // No roll on this step (a turn handoff nulls room.dice, or a buy/build/card) —
        // reconcile the dice faces to authoritative so the previous roller's pips don't
        // linger into the next player's turn.
        if (Array.isArray(room.dice)) store.settleDice(room.dice[0], room.dice[1])
        else store.settleDice(null, null)
      }
      fireEventSounds(events, p)
    }

    // "It just became your turn" chime — once per turn handoff.
    if (turnId === opts.myId && myTurnSeenRef.current !== seq && room.phase === 'roll') {
      myTurnSeenRef.current = seq
      p?.('turn')
    }

    // ---- WALK (driven by the AUTHORITATIVE position delta, not the rendered pos) ----
    const prevAuth = prevAuthPosRef.current || authPos
    const movers = players.filter((pl) => !pl.bankrupt && (prevAuth[pl.profile_id] ?? pl.position) !== pl.position)
    if (movers.length === 0) {
      store.clearRoll() // nothing moved → drop any stale destination prediction
      fireFloats(players, prevCashRef.current, store, p)
      prevAuthPosRef.current = authPos
      prevCashRef.current = authCash
      return
    }

    // Mid-walk: a snapshot landed while a walk is animating. If it does NOT change where
    // we're heading (the common duplicate-delivery / no-op case), let the walk FINISH
    // instead of collapsing it into a teleport. Only abort + snap if the target moved.
    if (walkingRef.current) {
      const tgt = walkTargetRef.current
      const sameTarget = tgt && players.every((pl) => pl.bankrupt || (tgt[pl.profile_id] ?? pl.position) === pl.position)
      if (sameTarget) {
        prevAuthPosRef.current = authPos
        prevCashRef.current = authCash
        return
      }
      clearTimers(); walkingRef.current = false; walkTargetRef.current = null
      store.clearRoll() // target moved under us → the prediction is stale; drop it
      store.snapTokens(authPos, turnId)
      fireFloats(players, prevCashRef.current, store, p)
      prevAuthPosRef.current = authPos
      prevCashRef.current = authCash
      return
    }

    // Reduced-motion: snap to place (sounds already fired). Still show the STATIC readout
    // + destination highlight (no path-trace animation) for a dice-driven move so the
    // player gets "I rolled N → I'm here now"; a short timer clears it (no walk to end it).
    if (reducedRef.current) {
      const primaryRM = movers.find((pl) => pl.profile_id === turnId)
      if (rolledThisStep && !gap && primaryRM && Array.isArray(room.dice)) {
        const fromRM = prevAuth[primaryRM.profile_id] ?? primaryRM.position
        const total = room.dice[0] + room.dice[1]
        const toRM = (fromRM + total) % 40
        // Only predict when the authoritative landing matches the dice sum (a plain move,
        // not a card/jail relocation that happens to share this step).
        if (toRM === primaryRM.position) {
          store.showRoll({ a: room.dice[0], b: room.dice[1], from: fromRM, to: toRM, path: ringPath(fromRM, total), active: turnId })
          schedule(() => store.clearRoll(), 2400)
        } else store.clearRoll()
      } else store.clearRoll()
      store.snapTokens(authPos, turnId)
      fireFloats(players, prevCashRef.current, store, p)
      prevAuthPosRef.current = authPos
      prevCashRef.current = authCash
      return
    }

    // Non-primary movers (rare) glide straight to place; the turn player walks.
    for (const pl of movers) {
      if (pl.profile_id !== turnId) store.setTokenPos(pl.profile_id, pl.position, { glide: true })
    }
    const primary = movers.find((pl) => pl.profile_id === turnId)
    if (!primary) {
      store.clearRoll() // only a non-turn mover relocated → no dice prediction to show
      fireFloats(players, prevCashRef.current, store, p)
      prevAuthPosRef.current = authPos
      prevCashRef.current = authCash
      return
    }

    // Walk from the AUTHORITATIVE previous tile, and only trust the dice on a
    // contiguous step (not a gap) — otherwise glide straight to the destination so we
    // never walk a bogus dice count nor teleport.
    walkingRef.current = true
    walkTargetRef.current = authPos
    const from = prevAuth[primary.profile_id] ?? primary.position
    const to = primary.position
    const { leg1, leg2 } = buildPath(from, room.dice, to, !gap)
    const prevCashSnapshot = prevCashRef.current

    // "YOU'LL LAND HERE" — the moment the roll is known, light up the destination + the
    // path. Only when we TRUST the dice (a real roll this step, contiguous, by the turn
    // player) AND the dice sum lands exactly where the authoritative move ends (so a
    // card/jail relocation sharing this step doesn't paint a wrong target). The
    // destination/path are then CLEARED in the walk-completion schedule below — so the
    // highlight lives only for the brief roll→arrive window and the WebGL loop can PARK.
    if (rolledThisStep && !gap && Array.isArray(room.dice)) {
      const total = room.dice[0] + room.dice[1]
      const viaDice = (from + total) % 40
      if (viaDice === to) store.showRoll({ a: room.dice[0], b: room.dice[1], from, to, path: ringPath(from, total), active: turnId })
      else store.clearRoll()
    } else store.clearRoll()

    let t = 0
    leg1.forEach((s) => {
      schedule(() => {
        store.setTokenPos(primary.profile_id, s.pos, { hop: true })
        const nowt = Date.now()
        if (nowt - lastHopRef.current > HOP_THROTTLE) { p?.('hop'); lastHopRef.current = nowt }
        if (s.go) p?.('go')
      }, t)
      t += STEP_MS
    })
    // Relocation: walk the ring the short way (or glide if far). The card/jail SOUND
    // is already played by fireEventSounds when the log tail is consumed, so we don't
    // re-play it here (that was a double-trigger); only the movement cues fire.
    leg2.forEach((s) => {
      const glide = s.mode === 'glide'
      schedule(() => {
        store.setTokenPos(primary.profile_id, s.pos, glide ? { glide: true } : { hop: true })
        if (s.go) p?.('go')
        if (!glide) {
          const nowt = Date.now()
          if (nowt - lastHopRef.current > HOP_THROTTLE) { p?.('hop'); lastHopRef.current = nowt }
        }
      }, t + (glide ? 40 : 0))
      t += glide ? GLIDE_MS + 40 : STEP_MS
    })
    schedule(() => {
      walkingRef.current = false
      walkTargetRef.current = null
      store.clearRoll() // token has ARRIVED → clear the destination/path so the loop parks
      fireFloats(players, prevCashSnapshot, store, p)
    }, t + 90)

    prevAuthPosRef.current = authPos
    prevCashRef.current = authCash
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, players])

  // Clean up any in-flight timers on unmount.
  useEffect(() => () => { timeoutsRef.current.forEach(clearTimeout) }, [])

  return store
}
