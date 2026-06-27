// =====================================================================
// Jordan Monopoly — pure, deterministic rules engine (server-authoritative)
// =====================================================================
//
// reduce(state, action, ctx) -> { patch } | { error } | { noop:true }
//
//   state  = the loaded snapshot { room, players[], properties[], secrets }
//            (all DB snake_case, exactly as monopoly_load returns it)
//   action = { action, ...args } from the client / tick
//   ctx    = { uid, now, roll }   (now = ms epoch; roll = () => [d1,d2])
//            roll + now are injected so the engine is fully deterministic and
//            unit-testable (no Math.random / Date.now inside).
//
// The engine NEVER mutates `state`; it works on a deep copy and returns a `patch`
// the DB commit applies atomically. Money is always conserved (a debit to a
// player is a credit to a player or the bank) — assertMoney() guards this.

import * as B from './monopolyBoard.ts'

type Json = Record<string, unknown>
interface PlayerRow {
  profile_id: string; seat: number; token: string; position: number; cash: number
  in_jail: boolean; jail_turns: number; goojf_cards: number; bankrupt: boolean; is_present: boolean
}
interface PropRow { tile_index: number; owner: string | null; houses: number; mortgaged: boolean }
interface RoomRow {
  id: string; status: string; phase: string; current_seat: number; turn_order: string[]
  dice: number[] | null; doubles_count: number; last_card: Json | null; phase_ends_at: string | null
  turn_seconds: number; start_cash: number; max_players: number; bank_houses: number; bank_hotels: number
  seq: number; pending_purchase: Json | null; pending_auction: Json | null; pending_trade: Json | null
  pending_debt: Json | null; winner: string | null; log: Json[]
}
interface State { room: RoomRow; players: PlayerRow[]; properties: PropRow[]; secrets?: Json }
export interface Ctx { uid: string; now: number; roll: () => [number, number] }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const ok = (patch: Json) => ({ patch })
const err = (m: string) => ({ error: m })

// ---------------- working-state helpers ----------------
class W {
  room: RoomRow
  players: PlayerRow[]
  props: Map<number, PropRow>
  secrets: Json
  secretsDirty = false
  now: number
  roll: () => [number, number]
  rngState: number
  constructor(state: State, ctx: Ctx) {
    this.room = clone(state.room)
    this.players = clone(state.players)
    this.props = new Map(clone(state.properties).map((p: PropRow) => [p.tile_index, p]))
    this.secrets = clone(state.secrets || { chance: [], chest: [], chance_pos: 0, chest_pos: 0 })
    this.now = ctx.now
    this.roll = ctx.roll
    // xorshift32 PRNG, seeded off `now` — used only for SHUFFLES (seating + decks);
    // actual dice come from ctx.roll. Advances internally so successive calls differ.
    this.rngState = (((ctx.now >>> 0) ^ 0x9e3779b9) >>> 0) || 1
  }
  rand(): number {
    let x = this.rngState
    x ^= x << 13; x >>>= 0
    x ^= x >>> 17
    x ^= x << 5; x >>>= 0
    this.rngState = x
    return (x % 1000000) / 1000000
  }
  shuffle<T>(arr: T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }
  player(id: string) { return this.players.find((p) => p.profile_id === id) }
  current() { return this.player(this.room.turn_order[this.room.current_seat]) }
  prop(i: number) { return this.props.get(i) }
  deadline(seconds = this.room.turn_seconds) {
    this.room.phase_ends_at = new Date(this.now + seconds * 1000).toISOString()
  }
  log(entry: Json) {
    this.room.log = [...(this.room.log || []), { ts: this.now, ...entry }].slice(-40)
  }
  patch(): Json {
    const out: Json = {
      room: this.room,
      players: this.players,
      properties: [...this.props.values()].sort((a, b) => a.tile_index - b.tile_index),
    }
    if (this.secretsDirty) out.secrets = this.secrets
    return out
  }
}

const tile = (i: number) => B.BOARD[i]
const ownerProps = (w: W, id: string) => [...w.props.values()].filter((p) => p.owner === id)
const groupOwnedAll = (w: W, id: string, color: string) => {
  const grp = B.groupTiles(color)
  return grp.every((i) => w.prop(i)?.owner === id)
}
const setHasBuildings = (w: W, color: string) => B.groupTiles(color).some((i) => (w.prop(i)?.houses || 0) > 0)
const railroadsOwned = (w: W, id: string) => B.railroadTiles().filter((i) => w.prop(i)?.owner === id).length
const utilitiesOwned = (w: W, id: string) => B.utilityTiles().filter((i) => w.prop(i)?.owner === id).length

function rentDue(w: W, idx: number, diceTotal: number, opts: { rrMult?: number; utilForce10?: boolean } = {}): { amount: number; to: string } | null {
  const p = w.prop(idx)
  if (!p || !p.owner || p.mortgaged) return null
  const t = tile(idx)
  if (t.type === 'property') {
    let amount: number
    if (p.houses > 0) amount = t.rent![p.houses]
    else amount = groupOwnedAll(w, p.owner, t.color!) ? t.rent![0] * 2 : t.rent![0]
    return { amount, to: p.owner }
  }
  if (t.type === 'railroad') {
    const n = railroadsOwned(w, p.owner)
    const base = [0, 25, 50, 100, 200][n] || 0
    return { amount: base * (opts.rrMult || 1), to: p.owner }
  }
  if (t.type === 'utility') {
    const n = utilitiesOwned(w, p.owner)
    const mult = opts.utilForce10 ? 10 : n === 2 ? 10 : 4
    return { amount: mult * diceTotal, to: p.owner }
  }
  return null
}

// Net worth = cash + (unmortgaged price | mortgage value) + buildings sell value.
export function netWorth(state: State, id: string): number {
  const pl = state.players.find((p) => p.profile_id === id)
  if (!pl) return 0
  let n = pl.cash
  for (const pr of state.properties) {
    if (pr.owner !== id) continue
    const t = state.properties && B.BOARD[pr.tile_index]
    const price = (t as { price?: number }).price || 0
    n += pr.mortgaged ? Math.floor(price / 2) : price
    if (pr.houses > 0 && (t as { house?: number }).house) {
      n += pr.houses * Math.floor(((t as { house?: number }).house || 0) / 2)
    }
  }
  return n
}

// Total liquid value a player could raise right now (cash + mortgage all + sell all houses).
function maxRaisable(w: W, id: string): number {
  const pl = w.player(id)!
  let n = pl.cash
  for (const pr of ownerProps(w, id)) {
    const t = tile(pr.tile_index)
    if (pr.houses > 0) n += pr.houses * Math.floor((t.house || 0) / 2)
    if (!pr.mortgaged) n += t.mortgage || 0
  }
  return n
}

// ---------------- turn flow ----------------
function nextSeat(w: W): number {
  const order = w.room.turn_order
  let s = w.room.current_seat
  for (let k = 0; k < order.length; k++) {
    s = (s + 1) % order.length
    const pl = w.player(order[s])
    if (pl && !pl.bankrupt) return s
  }
  return w.room.current_seat
}

function beginTurn(w: W) {
  w.room.dice = null
  w.room.doubles_count = 0
  w.room.pending_purchase = null
  const cur = w.current()
  if (cur && cur.in_jail) { w.room.phase = 'jail'; w.deadline() }
  else { w.room.phase = 'roll'; w.deadline() }
}

function endTurn(w: W) {
  w.room.current_seat = nextSeat(w)
  beginTurn(w)
}

function checkWin(w: W): boolean {
  const alive = w.room.turn_order.map((id) => w.player(id)).filter((p) => p && !p.bankrupt)
  if (alive.length <= 1) {
    w.room.status = 'finished'
    w.room.phase = 'ended'
    w.room.phase_ends_at = null
    w.room.winner = alive[0]?.profile_id || null
    if (alive[0]) w.log({ k: 'win', by: alive[0].profile_id })
    return true
  }
  return false
}

function goToJail(w: W, id: string) {
  const pl = w.player(id)!
  pl.position = B.JAIL_INDEX
  pl.in_jail = true
  pl.jail_turns = 0
  w.log({ k: 'jail', by: id })
}

// Charge `amount` from payer to creditor (null = bank). If the payer cannot pay
// from cash, raise the awaiting_debt phase and return false (turn pauses).
function chargeOrDebt(w: W, payerId: string, amount: number, creditorId: string | null, reason: string): boolean {
  const payer = w.player(payerId)!
  if (amount <= 0) return true
  if (payer.cash >= amount) {
    payer.cash -= amount
    if (creditorId) w.player(creditorId)!.cash += amount
    return true
  }
  w.room.pending_debt = { debtor: payerId, creditor: creditorId, amount, reason }
  w.room.phase = 'awaiting_debt'
  w.deadline()
  return false
}

// ---------------- landing resolution ----------------
// Returns true if the turn should pause (a blocking phase was set), false if the
// player is free to continue (roll again / end turn).
function applyLanding(w: W, id: string, diceTotal: number, depth = 0): boolean {
  if (depth > 4) return false
  const pl = w.player(id)!
  const t = tile(pl.position)

  if (t.type === 'go' || t.type === 'jail' || t.type === 'free_parking') return false

  if (t.type === 'go_to_jail') { goToJail(w, id); endTurn(w); return true }

  if (t.type === 'tax') {
    const paid = chargeOrDebt(w, id, t.tax || 0, null, 'tax')
    if (paid) w.log({ k: 'tax', by: id, amount: t.tax })
    return !paid
  }

  if (t.type === 'chance' || t.type === 'chest') {
    return resolveCard(w, id, t.type === 'chance' ? 'chance' : 'chest', diceTotal, depth)
  }

  // ownable tile
  const prop = w.prop(pl.position)
  if (!prop) return false
  if (prop.owner === null) {
    w.room.pending_purchase = { tile: pl.position, price: t.price }
    w.room.phase = 'buy_decision'
    w.deadline()
    return true
  }
  if (prop.owner === id || prop.mortgaged) return false
  const due = rentDue(w, pl.position, diceTotal)
  if (!due) return false
  const paid = chargeOrDebt(w, id, due.amount, due.to, 'rent')
  if (paid) w.log({ k: 'rent', by: id, to: due.to, amount: due.amount, tile: pl.position })
  return !paid
}

function resolveCard(w: W, id: string, deck: 'chance' | 'chest', diceTotal: number, depth: number): boolean {
  const ids = (w.secrets[deck] as string[]) || []
  const posKey = deck === 'chance' ? 'chance_pos' : 'chest_pos'
  let pos = (w.secrets[posKey] as number) || 0
  const list = deck === 'chance' ? B.CHANCE : B.CHEST
  if (ids.length === 0) return false
  const cardId = ids[pos % ids.length]
  pos = (pos + 1) % ids.length
  w.secrets[posKey] = pos
  w.secretsDirty = true
  const card = list.find((c) => c.id === cardId) || list[0]
  const e = card.effect as Json
  w.room.last_card = { deck, id: card.id, text: card.text, by: id }
  w.log({ k: 'card', by: id, deck, text: card.text })

  const pl = w.player(id)!
  switch (e.kind) {
    case 'collect': pl.cash += e.amount as number; return false
    case 'pay': return !chargeOrDebt(w, id, e.amount as number, null, 'card')
    case 'collect_from_each': {
      // capped at each payer's cash (cards from others never bankrupt them — a
      // deliberate simplification to avoid multi-player simultaneous debt)
      for (const o of w.players) {
        if (o.profile_id === id || o.bankrupt) continue
        const take = Math.min(e.amount as number, o.cash)
        o.cash -= take; pl.cash += take
      }
      return false
    }
    case 'pay_each': {
      for (const o of w.players) {
        if (o.profile_id === id || o.bankrupt) continue
        // current player may go into debt to the bank's pool here; pay what we can
        const give = e.amount as number
        if (pl.cash >= give) { pl.cash -= give; o.cash += give }
        else { o.cash += pl.cash; const owed = give - pl.cash; pl.cash = 0
          return !chargeOrDebt(w, id, owed, o.profile_id, 'card') }
      }
      return false
    }
    case 'goojf': pl.goojf_cards += 1; return false
    case 'goto_jail': goToJail(w, id); endTurn(w); return true
    case 'move_to': {
      const target = e.tile as number
      if (e.collectGo && target <= pl.position) { pl.cash += B.GO_SALARY; w.log({ k: 'pass_go', by: id }) }
      pl.position = target
      return applyLanding(w, id, diceTotal, depth + 1)
    }
    case 'move_rel': {
      pl.position = ((pl.position + (e.steps as number)) % 40 + 40) % 40
      return applyLanding(w, id, diceTotal, depth + 1)
    }
    case 'move_to_nearest': {
      const kind = e.kind2 as string
      const list2 = kind === 'railroad' ? B.railroadTiles() : B.utilityTiles()
      let target = list2.find((i) => i > pl.position)
      if (target === undefined) { target = list2[0]; pl.cash += B.GO_SALARY; w.log({ k: 'pass_go', by: id }) }
      pl.position = target
      // forced rent multiplier / utility 10x via a one-off landing
      const prop = w.prop(target)
      if (prop && prop.owner && prop.owner !== id && !prop.mortgaged) {
        const due = rentDue(w, target, w.roll()[0] + w.roll()[1], { rrMult: e.rentMult as number, utilForce10: kind === 'utility' })
        if (due) { const paid = chargeOrDebt(w, id, due.amount, due.to, 'rent')
          if (paid) w.log({ k: 'rent', by: id, to: due.to, amount: due.amount, tile: target }); return !paid }
        return false
      }
      if (prop && prop.owner === null) {
        w.room.pending_purchase = { tile: target, price: tile(target).price }
        w.room.phase = 'buy_decision'; w.deadline(); return true
      }
      return false
    }
    case 'repairs': {
      let total = 0
      for (const pr of ownerProps(w, id)) {
        if (pr.houses === 5) total += e.perHotel as number
        else total += (pr.houses) * (e.perHouse as number)
      }
      return !chargeOrDebt(w, id, total, null, 'card')
    }
  }
  return false
}

// After a non-blocking landing the player keeps the turn in the 'roll' phase.
// Whether the client offers "Roll again" (doubles) or "End turn" is derived purely
// on the client from `dice` — the server phase is identical either way.
function afterMove(w: W, paused: boolean) {
  if (paused) return
  w.room.phase = 'roll'
  w.deadline()
}

// Timeout-only: let the property go unbought with NO auction (the gentle path).
// A *manual* "Decline" still routes through startAuction via doDecline — only an
// idle timeout forfeits the buy silently so the game never surprises a player.
function skipPurchase(w: W) {
  w.room.pending_purchase = null
  afterMove(w, false)
}

// =====================================================================
// ACTION HANDLERS
// =====================================================================
function doStart(w: W, _ctx: Ctx) {
  if (w.room.status !== 'lobby') return err('Game already started')
  const present = w.players.filter((p) => p.is_present)
  if (present.length < B.MIN_PLAYERS) return err('Need at least 2 players')
  // shuffle seating
  const order = w.shuffle(present.map((p) => p.profile_id))
  order.forEach((id, seat) => {
    const pl = w.player(id)!
    pl.seat = seat; pl.position = 0; pl.cash = w.room.start_cash
    pl.in_jail = false; pl.jail_turns = 0; pl.goojf_cards = 0; pl.bankrupt = false
  })
  // seed 28 properties
  w.props = new Map(B.OWNABLE.map((i) => [i, { tile_index: i, owner: null, houses: 0, mortgaged: false }]))
  // shuffle decks (order is secret)
  w.secrets = {
    chance: w.shuffle(B.CHANCE.map((c) => c.id)),
    chest: w.shuffle(B.CHEST.map((c) => c.id)),
    chance_pos: 0, chest_pos: 0,
  }
  w.secretsDirty = true
  w.room.status = 'playing'
  w.room.turn_order = order
  w.room.current_seat = 0
  w.room.bank_houses = B.HOUSE_SUPPLY
  w.room.bank_hotels = B.HOTEL_SUPPLY
  w.room.winner = null
  w.room.log = [{ ts: w.now, k: 'start' }]
  beginTurn(w)
  return ok(w.patch())
}

function doRoll(w: W, id: string) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id) return err('Not your turn')
  if (w.room.phase !== 'roll') return err('Cannot roll right now')
  if (cur.in_jail) return err('You are in jail')
  // must end turn if previous roll was a non-double
  const prev = w.room.dice
  if (Array.isArray(prev) && prev[0] !== prev[1]) return err('You must end your turn')

  const [d1, d2] = w.roll()
  w.room.dice = [d1, d2]
  const doubles = d1 === d2
  if (doubles) {
    w.room.doubles_count += 1
    if (w.room.doubles_count >= 3) {
      goToJail(w, id)
      endTurn(w)
      return ok(w.patch())
    }
  }
  const total = d1 + d2
  const before = cur.position
  cur.position = (before + total) % 40
  if (cur.position < before || cur.position === 0 && total > 0) { cur.cash += B.GO_SALARY; w.log({ k: 'pass_go', by: id }) }
  w.log({ k: 'roll', by: id, d: [d1, d2] })
  const paused = applyLanding(w, id, total)
  afterMove(w, paused)
  return ok(w.patch())
}

function doBuy(w: W, id: string) {
  if (w.room.phase !== 'buy_decision') return err('Nothing to buy')
  const cur = w.current()
  if (!cur || cur.profile_id !== id) return err('Not your turn')
  const pend = w.room.pending_purchase as { tile: number; price: number } | null
  if (!pend) return err('Nothing to buy')
  if (cur.cash < pend.price) return err('Not enough cash')
  cur.cash -= pend.price
  w.prop(pend.tile)!.owner = id
  w.log({ k: 'buy', by: id, tile: pend.tile, price: pend.price })
  w.room.pending_purchase = null
  afterMove(w, false)
  return ok(w.patch())
}

function startAuction(w: W) {
  const pend = w.room.pending_purchase as { tile: number; price: number } | null
  if (!pend) return
  const order = w.room.turn_order
  const start = (w.room.current_seat) % order.length
  const participants: string[] = []
  for (let k = 0; k < order.length; k++) {
    const seat = (start + k) % order.length
    const pl = w.player(order[seat])
    if (pl && !pl.bankrupt) participants.push(pl.profile_id)
  }
  w.room.pending_auction = { tile: pend.tile, high_bid: 0, high_bidder: null, active: participants, on_clock: 0 }
  w.room.pending_purchase = null
  w.room.phase = 'auction'
  w.deadline()
}

function doDecline(w: W, id: string) {
  if (w.room.phase !== 'buy_decision') return err('Nothing to decline')
  const cur = w.current()
  if (!cur || cur.profile_id !== id) return err('Not your turn')
  startAuction(w)
  return ok(w.patch())
}

function awardAuction(w: W) {
  const a = w.room.pending_auction as { tile: number; high_bid: number; high_bidder: string | null }
  if (a.high_bidder && a.high_bid > 0) {
    const winner = w.player(a.high_bidder)!
    winner.cash -= a.high_bid
    w.prop(a.tile)!.owner = a.high_bidder
    w.log({ k: 'auction_win', by: a.high_bidder, tile: a.tile, price: a.high_bid })
  } else {
    w.log({ k: 'auction_none', tile: a.tile })
  }
  w.room.pending_auction = null
  afterMove(w, false)
}

function doAuctionBid(w: W, id: string, amount: number) {
  const a = w.room.pending_auction as { tile: number; high_bid: number; high_bidder: string | null; active: string[]; on_clock: number } | null
  if (!a || w.room.phase !== 'auction') return err('No auction running')
  if (a.active[a.on_clock] !== id) return err('Not your bid')
  amount = Math.floor(Number(amount))
  if (!(amount > a.high_bid)) return err('Bid must beat the current bid')
  const pl = w.player(id)!
  if (amount > pl.cash) return err('You cannot afford that bid')
  a.high_bid = amount; a.high_bidder = id
  a.on_clock = (a.on_clock + 1) % a.active.length
  w.deadline()
  return ok(w.patch())
}

function doAuctionPass(w: W, id: string) {
  const a = w.room.pending_auction as { tile: number; high_bid: number; high_bidder: string | null; active: string[]; on_clock: number } | null
  if (!a || w.room.phase !== 'auction') return err('No auction running')
  if (a.active[a.on_clock] !== id) return err('Not your turn to pass')
  a.active.splice(a.on_clock, 1)
  if (a.on_clock >= a.active.length) a.on_clock = 0
  if (a.active.length === 0) { awardAuction(w); return ok(w.patch()) }
  if (a.active.length === 1 && a.high_bidder && a.active[0] === a.high_bidder) { awardAuction(w); return ok(w.patch()) }
  w.deadline()
  return ok(w.patch())
}

// ---------------- jail ----------------
function leaveJailAndRoll(w: W, id: string) {
  const pl = w.player(id)!
  pl.in_jail = false; pl.jail_turns = 0
  const [d1, d2] = w.roll()
  w.room.dice = [d1, d2]
  const total = d1 + d2
  const before = pl.position
  pl.position = (before + total) % 40
  if (pl.position < before) { pl.cash += B.GO_SALARY; w.log({ k: 'pass_go', by: id }) }
  w.log({ k: 'roll', by: id, d: [d1, d2] })
  const paused = applyLanding(w, id, total)
  if (!paused) { w.room.phase = 'roll'; w.deadline() } // no jail bonus roll
}

function doPayFine(w: W, id: string) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id || !cur.in_jail) return err('Not in jail')
  if (cur.cash < B.JAIL_FINE) return err('Not enough cash for the fine')
  cur.cash -= B.JAIL_FINE
  w.log({ k: 'jail_out', by: id, how: 'fine' })
  leaveJailAndRoll(w, id)
  return ok(w.patch())
}

function doUseJailCard(w: W, id: string) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id || !cur.in_jail) return err('Not in jail')
  if (cur.goojf_cards < 1) return err('No jail card')
  cur.goojf_cards -= 1
  w.log({ k: 'jail_out', by: id, how: 'card' })
  leaveJailAndRoll(w, id)
  return ok(w.patch())
}

function doRollForJail(w: W, id: string) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id || !cur.in_jail) return err('Not in jail')
  const [d1, d2] = w.roll()
  w.room.dice = [d1, d2]
  w.log({ k: 'roll', by: id, d: [d1, d2] })
  if (d1 === d2) {
    cur.in_jail = false; cur.jail_turns = 0
    const total = d1 + d2
    cur.position = (cur.position + total) % 40
    w.log({ k: 'jail_out', by: id, how: 'roll' })
    const paused = applyLanding(w, id, total)
    if (!paused) { w.room.phase = 'roll'; w.deadline() }
    return ok(w.patch())
  }
  cur.jail_turns += 1
  if (cur.jail_turns >= 3) {
    // forced to pay the fine (or liquidate) then move
    if (!chargeOrDebt(w, id, B.JAIL_FINE, null, 'jail')) return ok(w.patch())
    w.log({ k: 'jail_out', by: id, how: 'forced' })
    leaveJailAndRoll(w, id)
    return ok(w.patch())
  }
  endTurn(w)
  return ok(w.patch())
}

// ---------------- build / mortgage ----------------
function doBuild(w: W, id: string, t: number) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id || w.room.phase !== 'roll') return err('Cannot build now')
  const prop = w.prop(t); const def = tile(t)
  if (!prop || prop.owner !== id || def.type !== 'property') return err('You do not own that')
  if (!groupOwnedAll(w, id, def.color!)) return err('You need the whole color set')
  const grp = B.groupTiles(def.color!)
  if (grp.some((i) => w.prop(i)!.mortgaged)) return err('Unmortgage the set first')
  if (prop.houses >= 5) return err('Already a hotel')
  // even build: no tile in set may be 2+ ahead
  const minH = Math.min(...grp.map((i) => w.prop(i)!.houses))
  if (prop.houses > minH) return err('Build evenly across the set')
  if (cur.cash < (def.house || 0)) return err('Not enough cash')
  if (prop.houses === 4) {
    if (w.room.bank_hotels <= 0) return err('No hotels left in the bank')
    w.room.bank_hotels -= 1; w.room.bank_houses += 4 // return 4 houses
  } else {
    if (w.room.bank_houses <= 0) return err('No houses left in the bank')
    w.room.bank_houses -= 1
  }
  cur.cash -= def.house || 0
  prop.houses += 1
  w.log({ k: 'build', by: id, tile: t, houses: prop.houses })
  return ok(w.patch())
}

function doSell(w: W, id: string, t: number) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id || w.room.phase !== 'roll') return err('Cannot sell now')
  const prop = w.prop(t); const def = tile(t)
  if (!prop || prop.owner !== id || def.type !== 'property') return err('You do not own that')
  if (prop.houses <= 0) return err('Nothing to sell')
  const grp = B.groupTiles(def.color!)
  const maxH = Math.max(...grp.map((i) => w.prop(i)!.houses))
  if (prop.houses < maxH) return err('Sell evenly across the set')
  if (prop.houses === 5) {
    if (w.room.bank_houses < 4) return err('Not enough houses in the bank to break the hotel')
    w.room.bank_hotels += 1; w.room.bank_houses -= 4
  } else {
    w.room.bank_houses += 1
  }
  prop.houses -= 1
  cur.cash += Math.floor((def.house || 0) / 2)
  w.log({ k: 'sell', by: id, tile: t, houses: prop.houses })
  settleDebtIfAble(w)
  return ok(w.patch())
}

function doMortgage(w: W, id: string, t: number) {
  const cur = w.player(id)
  if (!cur) return err('Not in game')
  if (!(w.room.phase === 'roll' || (w.room.phase === 'awaiting_debt' && (w.room.pending_debt as Json)?.debtor === id))) return err('Cannot mortgage now')
  const prop = w.prop(t); const def = tile(t)
  if (!prop || prop.owner !== id) return err('You do not own that')
  if (prop.mortgaged) return err('Already mortgaged')
  if (def.color && setHasBuildings(w, def.color)) return err('Sell buildings on the set first')
  prop.mortgaged = true
  cur.cash += def.mortgage || 0
  w.log({ k: 'mortgage', by: id, tile: t })
  settleDebtIfAble(w)
  return ok(w.patch())
}

function doUnmortgage(w: W, id: string, t: number) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id || w.room.phase !== 'roll') return err('Cannot unmortgage now')
  const prop = w.prop(t); const def = tile(t)
  if (!prop || prop.owner !== id) return err('You do not own that')
  if (!prop.mortgaged) return err('Not mortgaged')
  const cost = Math.ceil((def.mortgage || 0) * (1 + B.MORTGAGE_INTEREST))
  if (cur.cash < cost) return err('Not enough cash')
  cur.cash -= cost
  prop.mortgaged = false
  w.log({ k: 'unmortgage', by: id, tile: t })
  return ok(w.patch())
}

// ---------------- trading ----------------
type TradeSide = { cash: number; tiles: number[]; goojf: number }
function validSide(w: W, id: string, side: TradeSide): string | null {
  const pl = w.player(id); if (!pl) return 'Player not in game'
  if (side.cash < 0 || side.goojf < 0) return 'Invalid trade'
  if (side.cash > pl.cash) return 'Not enough cash'
  if (side.goojf > pl.goojf_cards) return 'Not enough jail cards'
  for (const t of side.tiles) {
    const prop = w.prop(t); const def = tile(t)
    if (!prop || prop.owner !== id) return 'You do not own a traded tile'
    if (def.color && setHasBuildings(w, def.color)) return 'Sell buildings on traded color sets first'
  }
  return null
}

function doPropose(w: W, id: string, to: string, give: TradeSide, want: TradeSide) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id || w.room.phase !== 'roll') return err('Cannot trade now')
  const other = w.player(to)
  if (!other || other.bankrupt || to === id) return err('Invalid trade partner')
  const e1 = validSide(w, id, give); if (e1) return err(e1)
  const e2 = validSide(w, to, want); if (e2) return err(e2)
  w.room.pending_trade = { from: id, to, give, want }
  w.room.phase = 'trade_review'
  w.deadline()
  return ok(w.patch())
}

function doAcceptTrade(w: W, id: string) {
  const tr = w.room.pending_trade as { from: string; to: string; give: TradeSide; want: TradeSide } | null
  if (!tr || w.room.phase !== 'trade_review') return err('No trade to accept')
  if (tr.to !== id) return err('This trade is not for you')
  const e1 = validSide(w, tr.from, tr.give); if (e1) return err(e1)
  const e2 = validSide(w, tr.to, tr.want); if (e2) return err(e2)
  const from = w.player(tr.from)!; const to = w.player(tr.to)!
  from.cash -= tr.give.cash; to.cash += tr.give.cash
  to.cash -= tr.want.cash; from.cash += tr.want.cash
  from.goojf_cards -= tr.give.goojf; to.goojf_cards += tr.give.goojf
  to.goojf_cards -= tr.want.goojf; from.goojf_cards += tr.want.goojf
  for (const t of tr.give.tiles) w.prop(t)!.owner = tr.to
  for (const t of tr.want.tiles) w.prop(t)!.owner = tr.from
  w.log({ k: 'trade', from: tr.from, to: tr.to })
  w.room.pending_trade = null
  w.room.phase = 'roll'
  w.deadline()
  return ok(w.patch())
}

function doRejectTrade(w: W, id: string, asFrom: boolean) {
  const tr = w.room.pending_trade as { from: string; to: string } | null
  if (!tr || w.room.phase !== 'trade_review') return err('No trade pending')
  if (asFrom && tr.from !== id) return err('Not your trade')
  if (!asFrom && tr.to !== id) return err('This trade is not for you')
  w.room.pending_trade = null
  w.room.phase = 'roll'
  w.deadline()
  return ok(w.patch())
}

// ---------------- debt / bankruptcy ----------------
function settleDebtIfAble(w: W) {
  if (w.room.phase !== 'awaiting_debt') return
  const d = w.room.pending_debt as { debtor: string; creditor: string | null; amount: number } | null
  if (!d) return
  const debtor = w.player(d.debtor)!
  if (debtor.cash >= d.amount) {
    debtor.cash -= d.amount
    if (d.creditor) w.player(d.creditor)!.cash += d.amount
    w.room.pending_debt = null
    w.room.phase = 'roll'
    w.deadline()
  }
}

function doBankrupt(w: W, id: string) {
  const d = w.room.pending_debt as { debtor: string; creditor: string | null; amount: number } | null
  const debtor = w.player(id)
  if (!debtor) return err('Not in game')
  if (w.room.phase !== 'awaiting_debt' || !d || d.debtor !== id) return err('You are not in debt')
  const creditorId = d.creditor
  if (creditorId) {
    const cr = w.player(creditorId)!
    cr.cash += debtor.cash
    for (const pr of ownerProps(w, id)) {
      pr.owner = creditorId
      // mortgaged props transfer with a 10% fee to unmortgage later — modeled as
      // an immediate fee paid by the receiver on mortgaged value.
      if (pr.mortgaged) cr.cash -= Math.ceil((tile(pr.tile_index).mortgage || 0) * B.BANKRUPTCY_FEE)
    }
  } else {
    // to the bank: estate returns houseless + unmortgaged (auctioned in M4)
    for (const pr of ownerProps(w, id)) {
      if (pr.houses === 5) w.room.bank_hotels += 1
      else w.room.bank_houses += pr.houses
      pr.owner = null; pr.houses = 0; pr.mortgaged = false
    }
  }
  debtor.cash = 0
  debtor.bankrupt = true
  debtor.goojf_cards = 0
  w.log({ k: 'bankrupt', by: id, to: creditorId })
  w.room.pending_debt = null
  if (checkWin(w)) return ok(w.patch())
  endTurn(w)
  return ok(w.patch())
}

function doEndTurn(w: W, id: string) {
  const cur = w.current()
  if (!cur || cur.profile_id !== id) return err('Not your turn')
  if (w.room.phase !== 'roll') return err('Resolve the current step first')
  const d = w.room.dice
  if (d === null) return err('Roll first')
  if (Array.isArray(d) && d[0] === d[1] && !cur.in_jail) return err('You rolled doubles — roll again')
  endTurn(w)
  return ok(w.patch())
}

// ---------------- the timer pump ----------------
function doTick(w: W) {
  if (w.room.status !== 'playing' || !w.room.phase_ends_at) return { noop: true } as const
  if (w.now < Date.parse(w.room.phase_ends_at)) return { noop: true } as const
  const cur = w.current()
  switch (w.room.phase) {
    case 'roll': {
      if (!cur) return { noop: true } as const
      // Gentle timeout: if they haven't rolled yet, roll once so play progresses;
      // otherwise just end the turn. We never chain a doubles re-roll on a timeout —
      // that could send a player to jail on a third double they never chose to roll.
      if (w.room.dice === null) return doRoll(w, cur.profile_id)
      endTurn(w)
      return ok(w.patch())
    }
    case 'jail': return cur ? doRollForJail(w, cur.profile_id) : { noop: true } as const
    // Gentle timeout: forfeit the buy with NO auction (vs a manual decline, which
    // auctions). The property stays bank-owned and the player keeps their turn.
    case 'buy_decision': {
      if (!cur) return { noop: true } as const
      skipPurchase(w)
      return ok(w.patch())
    }
    case 'auction': {
      const a = w.room.pending_auction as { active: string[]; on_clock: number } | null
      if (a && a.active[a.on_clock]) return doAuctionPass(w, a.active[a.on_clock])
      return { noop: true } as const
    }
    case 'trade_review': {
      const tr = w.room.pending_trade as { to: string } | null
      return tr ? doRejectTrade(w, tr.to, false) : { noop: true } as const
    }
    case 'awaiting_debt': {
      const d = w.room.pending_debt as { debtor: string; amount: number } | null
      if (!d) return { noop: true } as const
      // auto-liquidate: if even maximum raisable can't cover it, bankrupt; else
      // mortgage/sell until covered.
      if (maxRaisable(w, d.debtor) < d.amount) return doBankrupt(w, d.debtor)
      autoLiquidate(w, d.debtor, d.amount)
      settleDebtIfAble(w)
      if (w.room.phase === 'awaiting_debt') return doBankrupt(w, d.debtor)
      return ok(w.patch())
    }
  }
  return { noop: true } as const
}

function autoLiquidate(w: W, id: string, target: number) {
  const pl = w.player(id)!
  // sell houses first (evenly, highest first), then mortgage
  let guard = 0
  while (pl.cash < target && guard++ < 200) {
    const withHouses = ownerProps(w, id).filter((p) => p.houses > 0)
      .sort((a, b) => b.houses - a.houses)
    if (withHouses.length === 0) break
    const r = doSell(w, id, withHouses[0].tile_index)
    if ('error' in r) break
  }
  guard = 0
  while (pl.cash < target && guard++ < 200) {
    const mortgageable = ownerProps(w, id).filter((p) => !p.mortgaged && !setHasBuildings(w, tile(p.tile_index).color || ''))
    if (mortgageable.length === 0) break
    const r = doMortgage(w, id, mortgageable[0].tile_index)
    if ('error' in r) break
  }
}

// =====================================================================
// PUBLIC ENTRY
// =====================================================================
export function reduce(state: State, action: Json, ctx: Ctx): { patch: Json } | { error: string } | { noop: true } {
  const w = new W(state, ctx)
  const id = ctx.uid
  const a = action.action as string

  // membership
  if (!w.player(id) && a !== 'tick') return err('You are not in this game')

  switch (a) {
    case 'start': {
      // host gate handled by Edge Function (it knows room.host); double-check here
      if (state.room['host'] && state.room['host'] !== id) return err('Only the host can start')
      return doStart(w, ctx)
    }
    case 'roll': return doRoll(w, id)
    case 'buy_property': return doBuy(w, id)
    case 'decline_buy': return doDecline(w, id)
    case 'auction_bid': return doAuctionBid(w, id, Number(action.amount))
    case 'auction_pass': return doAuctionPass(w, id)
    case 'pay_jail_fine': return doPayFine(w, id)
    case 'use_jail_card': return doUseJailCard(w, id)
    case 'roll_for_jail': return doRollForJail(w, id)
    case 'build_house': return doBuild(w, id, Number(action.tile))
    case 'sell_house': return doSell(w, id, Number(action.tile))
    case 'mortgage': return doMortgage(w, id, Number(action.tile))
    case 'unmortgage': return doUnmortgage(w, id, Number(action.tile))
    case 'propose_trade': return doPropose(w, id, String(action.to), action.give as TradeSide, action.want as TradeSide)
    case 'accept_trade': return doAcceptTrade(w, id)
    case 'reject_trade': return doRejectTrade(w, id, false)
    case 'cancel_trade': return doRejectTrade(w, id, true)
    case 'declare_bankruptcy': return doBankrupt(w, id)
    case 'end_turn': return doEndTurn(w, id)
    case 'tick': return doTick(w)
    default: return err('Unknown action')
  }
}
