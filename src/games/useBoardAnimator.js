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
const GLIDE_MS = 460 // card/jail relocation glide
const HOP_THROTTLE = 70 // min ms between hop ticks so fast walks don't machine-gun
const FLOAT_TTL = 2200

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

  return { tokens, dice, floats, getPos, setTokenPos, snapTokens, setActive, settleDice, setRolling, pushFloat }
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

// Build the two-leg path purely from (from, dice, to):
//   LEG 1 — walk from→from+1→…→viaDice (dice total), one tile per step.
//   LEG 2 — if to !== viaDice a card/jail relocation happened: glide there.
function buildPath(from, dice, to) {
  const steps = []
  if (Array.isArray(dice) && dice.length === 2) {
    const total = dice[0] + dice[1]
    const viaDice = (from + total) % 40
    let cur = from
    let guard = 0
    while (cur !== viaDice && guard < 45) {
      cur = (cur + 1) % 40
      steps.push({ pos: cur, leg: 1, go: cur === 0 })
      guard++
    }
    if (to !== viaDice) steps.push({ pos: to, leg: 2 })
  } else {
    steps.push({ pos: to, leg: 2 })
  }
  return steps
}

// Fire +N / −N floats from each player's cash delta, anchored at their token.
function fireFloats(players, prevCash, store) {
  for (const p of players) {
    const before = prevCash[p.profile_id]
    if (before === undefined) continue
    const delta = p.cash - before
    if (delta === 0) continue
    const c = CENTERS[p.position] || CENTERS[0]
    store.pushFloat({ amount: delta, x: c.x, y: c.y, color: tokenMeta(p.token).color })
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

    // ---- FIRST PAINT / GAP / BACKWARD seq → SNAP (no replay, no sound) ----
    const first = lastSeqRef.current === null
    const gap = !first && (seq < lastSeqRef.current || seq - lastSeqRef.current > 1)
    if (first || gap) {
      clearTimers(); walkingRef.current = false
      store.snapTokens(authPos, turnId)
      if (Array.isArray(room.dice)) store.settleDice(room.dice[0], room.dice[1])
      else store.settleDice(null, null)
      lastSeqRef.current = seq
      lastLogLenRef.current = log.length
      prevCashRef.current = authCash
      myTurnSeenRef.current = seq // don't chime on first paint
      return
    }

    store.setActive(turnId)

    // ---- NEW SEQ STEP (exactly +1): consume the log tail for dice + sounds ----
    if (seq > lastSeqRef.current) {
      const events = log.slice(lastLogLenRef.current)
      lastSeqRef.current = seq
      lastLogLenRef.current = log.length
      const rollEv = events.find((e) => e.k === 'roll')
      if (rollEv && Array.isArray(room.dice)) {
        store.settleDice(room.dice[0], room.dice[1])
        p?.('diceLand')
      }
      fireEventSounds(events, p)
    }

    // "It just became your turn" chime — once per turn handoff.
    if (turnId === opts.myId && myTurnSeenRef.current !== seq && room.phase === 'roll') {
      myTurnSeenRef.current = seq
      p?.('turn')
    }

    // ---- WALK (driven by position delta vs what we're rendering) ----
    const movers = players.filter((pl) => !pl.bankrupt && store.getPos(pl.profile_id) !== pl.position)
    if (movers.length === 0) {
      fireFloats(players, prevCashRef.current, store)
      prevCashRef.current = authCash
      return
    }

    // Already mid-walk, or reduced-motion: snap to the latest, no replay.
    // (Sounds are independent of motion and already fired above.)
    if (walkingRef.current || reducedRef.current) {
      clearTimers(); walkingRef.current = false
      store.snapTokens(authPos, turnId)
      fireFloats(players, prevCashRef.current, store)
      prevCashRef.current = authCash
      return
    }

    // Non-primary movers (rare) glide straight to place; the turn player walks.
    for (const pl of movers) {
      if (pl.profile_id !== turnId) store.setTokenPos(pl.profile_id, pl.position, { glide: true })
    }
    const primary = movers.find((pl) => pl.profile_id === turnId)
    if (!primary) {
      fireFloats(players, prevCashRef.current, store)
      prevCashRef.current = authCash
      return
    }

    walkingRef.current = true
    const from = store.getPos(primary.profile_id)
    const path = buildPath(from, room.dice, primary.position)
    const leg1 = path.filter((s) => s.leg === 1)
    const leg2 = path.find((s) => s.leg === 2)
    const prevCashSnapshot = prevCashRef.current

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
    if (leg2) {
      schedule(() => {
        store.setTokenPos(primary.profile_id, leg2.pos, { glide: true })
        p?.(leg2.pos === 10 ? 'jail' : 'card')
      }, t + 40)
      t += GLIDE_MS + 40
    }
    schedule(() => {
      walkingRef.current = false
      fireFloats(players, prevCashSnapshot, store)
    }, t + 90)

    prevCashRef.current = authCash
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, players])

  // Clean up any in-flight timers on unmount.
  useEffect(() => () => { timeoutsRef.current.forEach(clearTimeout) }, [])

  return store
}
