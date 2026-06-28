// Deterministic unit tests for the Monopoly rules engine. Dice are injected, so
// every scenario is reproducible. Run:  deno test supabase/functions/_shared/
import { assert, assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { reduce } from './monopolyEngine.ts'
import * as B from './monopolyBoard.ts'

function lobby(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `p${i}`)
  return {
    room: {
      id: 'r', host: 'p0', status: 'lobby', phase: 'waiting', current_seat: 0, turn_order: [],
      dice: null, doubles_count: 0, last_card: null, phase_ends_at: null, turn_seconds: 45,
      start_cash: 1500, max_players: 8, bank_houses: 32, bank_hotels: 12, seq: 0,
      pending_purchase: null, pending_auction: null, pending_trade: null, pending_debt: null,
      winner: null, log: [],
    },
    players: ids.map((id, i) => ({
      profile_id: id, seat: i, token: 'car', position: 0, cash: 1500, in_jail: false,
      jail_turns: 0, goojf_cards: 0, bankrupt: false, is_present: true,
    })),
    properties: [] as any[],
    secrets: { chance: [], chest: [], chance_pos: 0, chest_pos: 0 },
  }
}

class Game {
  state: any
  queue: [number, number][] = []
  now = 1_000_000
  constructor(n: number) { this.state = lobby(n) }
  ctx(uid: string) { return { uid, now: this.now, roll: () => (this.queue.length ? this.queue.shift()! : [1, 2] as [number, number]) } }
  act(uid: string, body: any, rolls: [number, number][] = []) {
    this.queue.push(...rolls)
    const r: any = reduce(this.state, body, this.ctx(uid))
    if (r && r.patch) {
      this.state = {
        room: r.patch.room, players: r.patch.players, properties: r.patch.properties,
        secrets: r.patch.secrets || this.state.secrets,
      }
      // mimic the DB seq bump so successive optimistic-lock expectations hold
      this.state.room.seq = (this.state.room.seq || 0) + 1
    }
    return r
  }
  start() { return this.act('p0', { action: 'start' }) }
  cur() { return this.state.room.turn_order[this.state.room.current_seat] }
  other() { return this.state.room.turn_order.find((x: string) => x !== this.cur()) }
  P(id: string) { return this.state.players.find((p: any) => p.profile_id === id) }
  prop(i: number) { return this.state.properties.find((p: any) => p.tile_index === i) }
  setOwner(i: number, owner: string | null) { this.prop(i).owner = owner }
  totalCash() { return this.state.players.reduce((s: number, p: any) => s + p.cash, 0) }
}

const noNegativeCash = (g: Game) => g.state.players.every((p: any) => p.cash >= 0)

Deno.test('start: seats, cash, 28 properties, full decks', () => {
  const g = new Game(3)
  g.start()
  assertEquals(g.state.room.status, 'playing')
  assertEquals(g.state.room.phase, 'roll')
  assertEquals(g.state.properties.length, 28)
  assert(g.state.properties.every((p: any) => p.owner === null))
  assertEquals(g.state.players.every((p: any) => p.cash === 1500), true)
  assertEquals(g.state.secrets.chance.length, 16)
  assertEquals(g.state.secrets.chest.length, 16)
  assertEquals(g.state.room.turn_order.length, 3)
})

Deno.test('roll + buy a property', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.act(me, { action: 'roll' }, [[1, 2]]) // → tile 3 (Irbid, 60)
  assertEquals(g.P(me).position, 3)
  assertEquals(g.state.room.phase, 'buy_decision')
  assertEquals(g.state.room.pending_purchase.tile, 3)
  g.act(me, { action: 'buy_property' })
  assertEquals(g.prop(3).owner, me)
  assertEquals(g.P(me).cash, 1440)
  assertEquals(g.state.room.phase, 'roll')
})

Deno.test('rent: base, monopoly double, and conservation', () => {
  const g = new Game(2); g.start()
  const roller = g.cur(); const owner = g.other()
  g.setOwner(3, owner) // single brown
  const before = g.totalCash()
  g.act(roller, { action: 'roll' }, [[1, 2]]) // roller lands on 3, pays base rent 4
  assertEquals(g.P(roller).position, 3)
  assertEquals(g.totalCash(), before) // pure transfer, no bank flow
  assertEquals(g.P(owner).cash, 1504)
  assertEquals(g.P(roller).cash, 1496)
})

Deno.test('rent: monopoly doubles the base rent', () => {
  const g = new Game(2); g.start()
  const roller = g.cur(); const owner = g.other()
  g.setOwner(1, owner); g.setOwner(3, owner) // full brown set
  g.act(roller, { action: 'roll' }, [[1, 2]]) // lands on 3 → base 4 * 2 = 8
  assertEquals(g.P(roller).cash, 1492)
  assertEquals(g.P(owner).cash, 1508)
})

Deno.test('railroad rent scales with count', () => {
  const g = new Game(2); g.start()
  const roller = g.cur(); const owner = g.other()
  g.setOwner(5, owner) // one railroad
  g.act(roller, { action: 'roll' }, [[2, 3]]) // → tile 5, rent 25
  assertEquals(g.P(roller).cash, 1475)
  // give a second railroad and land again
  const g2 = new Game(2); g2.start()
  const roller2 = g2.cur(); const owner2 = g2.other()
  g2.setOwner(5, owner2); g2.setOwner(15, owner2)
  g2.act(roller2, { action: 'roll' }, [[2, 3]]) // → tile 5, rent 50
  assertEquals(g2.P(roller2).cash, 1450)
})

Deno.test('utility rent = 4x dice for one utility', () => {
  const g = new Game(2); g.start()
  const roller = g.cur(); const owner = g.other()
  g.setOwner(12, owner)
  g.P(roller).position = 5
  g.act(roller, { action: 'roll' }, [[3, 4]]) // 5 + 7 → tile 12, rent 4*7 = 28
  assertEquals(g.P(roller).position, 12)
  assertEquals(g.P(roller).cash, 1472)
})

Deno.test('three doubles sends you to jail', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.state.secrets.chance = []; g.state.secrets.chest = [] // benign card tiles
  g.setOwner(6, me) // self-owned so the 2nd landing doesn't pause on a purchase
  g.act(me, { action: 'roll' }, [[1, 1]]) // → tile 2 (chest, empty)
  g.act(me, { action: 'roll' }, [[2, 2]]) // → tile 6 (self-owned)
  g.act(me, { action: 'roll' }, [[3, 3]]) // 3rd double → jail before moving
  assertEquals(g.P(me).in_jail, true)
  assertEquals(g.P(me).position, B.JAIL_INDEX)
  assert(g.cur() !== me) // turn passed
})

Deno.test('passing GO pays salary', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.P(me).position = 37
  g.act(me, { action: 'roll' }, [[1, 2]]) // 37 + 3 → GO (tile 0), passed GO
  assertEquals(g.P(me).position, 0)
  assertEquals(g.P(me).cash, 1700) // +200 from GO, no card
})

Deno.test('income tax deducts 200', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.act(me, { action: 'roll' }, [[1, 3]]) // → tile 4 income tax
  assertEquals(g.P(me).cash, 1300)
})

Deno.test('go to jail tile', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.P(me).position = 27
  g.act(me, { action: 'roll' }, [[1, 2]]) // → tile 30 go_to_jail
  assertEquals(g.P(me).in_jail, true)
  assertEquals(g.P(me).position, B.JAIL_INDEX)
})

Deno.test('chance card: collect 50', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.state.secrets.chance = ['c10'] // bank pays 50
  g.state.secrets.chance_pos = 0
  g.act(me, { action: 'roll' }, [[3, 4]]) // → tile 7 chance
  assertEquals(g.P(me).cash, 1550)
})

Deno.test('jail: pay fine then move', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.P(me).in_jail = true; g.P(me).position = B.JAIL_INDEX
  g.state.room.phase = 'jail'
  g.act(me, { action: 'pay_jail_fine' }, [[1, 2]])
  assertEquals(g.P(me).in_jail, false)
  assertEquals(g.P(me).cash, 1450) // -50 fine
  assertEquals(g.P(me).position, 13)
})

Deno.test('build houses requires full set + even build + supply', () => {
  const g = new Game(2); g.start()
  const a = g.cur()
  g.setOwner(1, a); g.setOwner(3, a) // full brown
  // build on 1 then 3 then 1 (even)
  assert('patch' in g.act(a, { action: 'build_house', tile: 1 }))
  assertEquals(g.prop(1).houses, 1)
  assertEquals(g.state.room.bank_houses, 31)
  // can't build a 2nd house on 1 before 3 catches up
  assert('error' in g.act(a, { action: 'build_house', tile: 1 }))
  assert('patch' in g.act(a, { action: 'build_house', tile: 3 }))
  assertEquals(g.P(a).cash, 1500 - 100) // two houses at 50 each
})

Deno.test('mortgage and unmortgage with interest', () => {
  const g = new Game(2); g.start()
  const a = g.cur()
  g.setOwner(3, a)
  g.act(a, { action: 'mortgage', tile: 3 })
  assertEquals(g.prop(3).mortgaged, true)
  assertEquals(g.P(a).cash, 1530) // +30 mortgage value
  g.act(a, { action: 'unmortgage', tile: 3 })
  assertEquals(g.prop(3).mortgaged, false)
  assertEquals(g.P(a).cash, 1530 - 33) // 30 * 1.1
})

Deno.test('decline triggers an auction that resolves to the bidder', () => {
  const g = new Game(3); g.start()
  const me = g.cur()
  g.act(me, { action: 'roll' }, [[1, 2]]) // tile 3, buy_decision
  g.act(me, { action: 'decline_buy' })
  assertEquals(g.state.room.phase, 'auction')
  const a = g.state.room.pending_auction
  const first = a.active[a.on_clock]
  g.act(first, { action: 'auction_bid', amount: 50 })
  // everyone else passes
  let guard = 0
  while (g.state.room.phase === 'auction' && guard++ < 10) {
    const au = g.state.room.pending_auction
    const onClock = au.active[au.on_clock]
    g.act(onClock, { action: 'auction_pass' })
  }
  assertEquals(g.prop(3).owner, first)
  assertEquals(g.P(first).cash, 1450)
})

Deno.test('atomic trade swaps cash + property', () => {
  const g = new Game(2); g.start()
  const a = g.cur(); const b = g.other()
  g.setOwner(3, a)
  g.act(a, { action: 'propose_trade', to: b, give: { cash: 0, tiles: [3], goojf: 0 }, want: { cash: 100, tiles: [], goojf: 0 } })
  assertEquals(g.state.room.phase, 'trade_review')
  g.act(b, { action: 'accept_trade' })
  assertEquals(g.prop(3).owner, b)
  assertEquals(g.P(a).cash, 1600)
  assertEquals(g.P(b).cash, 1400)
  assertEquals(g.state.room.phase, 'roll')
})

Deno.test('bankruptcy: unpayable rent → bankrupt → win', () => {
  const g = new Game(2); g.start()
  const debtor = g.cur(); const owner = g.other()
  // owner has the full blue set with a hotel on 39: enormous rent
  g.setOwner(37, owner); g.setOwner(39, owner)
  g.prop(39).houses = 5
  g.P(debtor).cash = 10 // can't possibly pay
  g.P(debtor).position = 36
  g.act(debtor, { action: 'roll' }, [[1, 2]]) // → 39, rent way over 10
  assertEquals(g.state.room.phase, 'awaiting_debt')
  g.act(debtor, { action: 'declare_bankruptcy' })
  assertEquals(g.P(debtor).bankrupt, true)
  assertEquals(g.state.room.status, 'finished')
  assertEquals(g.state.room.winner, owner)
})

Deno.test('bankruptcy to a creditor never drives the creditor (winner) negative', () => {
  const g = new Game(2); g.start()
  const debtor = g.cur(); const creditor = g.other()
  // creditor owns the full blue set with a hotel on 39 → enormous unpayable rent
  g.setOwner(37, creditor); g.setOwner(39, creditor)
  g.prop(39).houses = 5
  // debtor holds a mortgage-heavy estate: each mortgaged tile carries a 10%
  // inheritance fee the creditor would otherwise pay immediately out of pocket.
  for (const t of [1, 3, 6, 8, 9, 11, 13, 14]) { g.setOwner(t, debtor); g.prop(t).mortgaged = true }
  g.P(creditor).cash = 5 // cash-poor creditor
  g.P(debtor).cash = 10  // can't pay the rent
  g.P(debtor).position = 36
  g.act(debtor, { action: 'roll' }, [[1, 2]]) // → 39, rent far over 10
  assertEquals(g.state.room.phase, 'awaiting_debt')
  g.act(debtor, { action: 'declare_bankruptcy' })
  assertEquals(g.P(debtor).bankrupt, true)
  assert(g.P(creditor).cash >= 0) // the fee is clamped — winner is never negative
  assert(noNegativeCash(g))
  // and the mortgaged estate transferred to the creditor
  assertEquals(g.prop(1).owner, creditor)
  assertEquals(g.prop(1).mortgaged, true)
})

Deno.test('debtor CAN sell houses during awaiting_debt to settle (manual)', () => {
  const g = new Game(2); g.start()
  const debtor = g.cur(); const owner = g.other()
  g.setOwner(1, debtor); g.setOwner(3, debtor) // full brown set
  g.prop(1).houses = 2; g.prop(3).houses = 2   // 4 houses, each resells for 25
  g.P(debtor).cash = 10
  g.state.room.phase = 'awaiting_debt'
  g.state.room.pending_debt = { debtor, creditor: owner, amount: 60, reason: 'rent' }
  assert('patch' in g.act(debtor, { action: 'sell_house', tile: 1 })) // was 'Cannot sell now' before fix
  assertEquals(g.P(debtor).cash, 35)
  assert('patch' in g.act(debtor, { action: 'sell_house', tile: 3 })) // even-sell from the higher tile
  // raised 60 → debt auto-settles, turn resumes, player NOT bankrupt
  assertEquals(g.state.room.phase, 'roll')
  assertEquals(g.P(debtor).bankrupt, false)
  assertEquals(g.P(debtor).cash, 0)
  assertEquals(g.P(owner).cash, 1560)
})

Deno.test('awaiting_debt TIMEOUT auto-liquidates houses instead of bankrupting a SOLVENT player', () => {
  const g = new Game(2); g.start()
  const debtor = g.cur(); const owner = g.other()
  g.setOwner(1, debtor); g.setOwner(3, debtor)
  g.prop(1).houses = 2; g.prop(3).houses = 2 // 100 raisable via house sales
  g.P(debtor).cash = 10
  g.state.room.phase = 'awaiting_debt'
  g.state.room.pending_debt = { debtor, creditor: owner, amount: 60, reason: 'rent' }
  g.state.room.phase_ends_at = new Date(g.now - 1000).toISOString()
  g.act('p0', { action: 'tick' }) // gentle timeout → autoLiquidate must SELL houses, not bankrupt
  assertEquals(g.P(debtor).bankrupt, false) // FAILS before the doSell-in-debt fix (would be bankrupt)
  assertEquals(g.state.room.status, 'playing')
  assertEquals(g.state.room.phase, 'roll')
  assert(g.P(owner).cash >= 1560) // got paid
  assert(noNegativeCash(g))
})

Deno.test('pay_each pays EVERY opponent (capped at cash) — never skips a player', () => {
  const g = new Game(4); g.start()
  const me = g.cur()
  g.state.secrets.chance = ['c14']; g.state.secrets.chest = []; g.state.secrets.chance_pos = 0 // c14 = pay each 50
  g.P(me).cash = 70 // can fully pay one opponent, partly a second, nothing for a third
  const before = g.totalCash()
  g.act(me, { action: 'roll' }, [[3, 4]]) // → tile 7 chance → c14
  assertEquals(g.P(me).cash, 0)            // paid out everything it had
  assertEquals(g.totalCash(), before)      // pure transfer, no money lost (was lost before the fix)
  assert(noNegativeCash(g))                // no one driven negative
  assert(g.state.room.phase !== 'awaiting_debt') // no bogus single-creditor debt
  const opponents = g.state.players.filter((p: any) => p.profile_id !== me)
  assertEquals(opponents.reduce((s: number, p: any) => s + (p.cash - 1500), 0), 70) // all 70 distributed
})

Deno.test('move_to_nearest (utility) rolls ONCE — deterministic rent', () => {
  const g = new Game(2); g.start()
  const me = g.cur(); const owner = g.other()
  g.setOwner(12, owner) // owns the first utility
  g.state.secrets.chance = ['c7']; g.state.secrets.chest = []; g.state.secrets.chance_pos = 0 // c7 = advance to nearest utility
  // queue: [3,4] lands me on the chance tile (7); [5,6] is the SINGLE forced-rent roll.
  g.act(me, { action: 'roll' }, [[3, 4], [5, 6]])
  assertEquals(g.P(me).position, 12)
  // utility force-10 rent = 10 * (5+6) = 110 with the single-roll fix.
  // The old double-roll bug consumed [5,6][0]=5 + default[1,2][1]=2 → 70.
  assertEquals(g.P(me).cash, 1500 - 110)
  assertEquals(g.P(owner).cash, 1500 + 110)
})

Deno.test('no action ever leaves a player with negative cash', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.act(me, { action: 'roll' }, [[1, 3]]) // income tax
  assert(noNegativeCash(g))
})

Deno.test('tick before deadline is a no-op', () => {
  const g = new Game(2); g.start()
  g.state.room.phase_ends_at = new Date(g.now + 60_000).toISOString()
  const r: any = reduce(g.state, { action: 'tick' }, g.ctx('p0'))
  assert(r.noop === true)
})

Deno.test('tick after deadline auto-rolls for the current player', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.state.room.phase_ends_at = new Date(g.now - 1000).toISOString()
  g.act(me, { action: 'tick' }, [[1, 2]])
  assertEquals(g.P(me).position, 3) // auto-rolled and moved
})

Deno.test('tick in roll after a double ends the turn — never a surprise jail', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  // A double was already rolled and resolved: dice present, still in 'roll'.
  g.state.room.dice = [3, 3]
  g.state.room.doubles_count = 2
  g.state.room.phase = 'roll'
  g.state.room.phase_ends_at = new Date(g.now - 1000).toISOString()
  // A queued double is intentionally provided; the gentle path must NOT consume it.
  g.act(me, { action: 'tick' }, [[3, 3]])
  assert(g.cur() !== me) // turn passed cleanly
  assertEquals(g.P(me).in_jail, false) // not jailed by an auto third double
})

Deno.test('tick in buy_decision forfeits the buy with no auction (gentle)', () => {
  const g = new Game(3); g.start()
  const me = g.cur()
  g.act(me, { action: 'roll' }, [[1, 2]]) // → tile 3, buy_decision
  assertEquals(g.state.room.phase, 'buy_decision')
  g.state.room.phase_ends_at = new Date(g.now - 1000).toISOString()
  g.act(me, { action: 'tick' })
  assertEquals(g.state.room.phase, 'roll') // back to roll, NOT auction
  assertEquals(g.state.room.pending_auction, null)
  assertEquals(g.prop(3).owner, null) // tile stays bank-owned
  assertEquals(g.cur(), me) // still my turn (I rolled a non-double)
})

Deno.test('manual decline_buy still opens an auction (vs a timeout)', () => {
  const g = new Game(3); g.start()
  const me = g.cur()
  g.act(me, { action: 'roll' }, [[1, 2]]) // → tile 3, buy_decision
  g.act(me, { action: 'decline_buy' })
  assertEquals(g.state.room.phase, 'auction')
  assert(g.state.room.pending_auction !== null)
})

Deno.test('jail: rolling doubles to get out moves but grants NO bonus roll', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.P(me).in_jail = true; g.P(me).position = B.JAIL_INDEX
  g.state.room.phase = 'jail'; g.state.room.doubles_count = 0
  g.setOwner(16, me) // 10 + 6 = 16, self-owned so the landing doesn't pause
  g.act(me, { action: 'roll_for_jail' }, [[3, 3]])
  assertEquals(g.P(me).in_jail, false)
  assertEquals(g.P(me).position, 16) // moved by the doubles total
  assertEquals(g.state.room.phase, 'roll')
  assertEquals(g.state.room.doubles_count, 0) // no doubles chain started
  // The turn must be endable — a jail-exit double must not force another roll.
  const r: any = g.act(me, { action: 'end_turn' })
  assert('patch' in r)
  assert(g.cur() !== me)
})

Deno.test('jail: pay fine then roll doubles grants NO bonus roll', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.P(me).in_jail = true; g.P(me).position = B.JAIL_INDEX
  g.state.room.phase = 'jail'
  g.setOwner(14, me) // 10 + 4 = 14, self-owned, no pause
  g.act(me, { action: 'pay_jail_fine' }, [[2, 2]])
  assertEquals(g.P(me).in_jail, false)
  assertEquals(g.P(me).position, 14)
  assertEquals(g.P(me).cash, 1450) // -50 fine
  assertEquals(g.state.room.doubles_count, 0)
  assert('patch' in g.act(me, { action: 'end_turn' })) // not trapped into a re-roll
})

Deno.test('jail: third failed roll pays the fine and moves by THAT roll (no re-roll)', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.P(me).in_jail = true; g.P(me).jail_turns = 2; g.P(me).position = B.JAIL_INDEX
  g.state.room.phase = 'jail'
  g.setOwner(13, me) // 10 + 3 = 13, self-owned, no purchase pause
  g.act(me, { action: 'roll_for_jail' }, [[1, 2]]) // 3rd attempt, non-double
  assertEquals(g.P(me).in_jail, false)
  assertEquals(g.P(me).position, 13) // moved by the [1,2] just rolled, not a fresh roll
  assertEquals(g.P(me).cash, 1500 - B.JAIL_FINE) // fine charged exactly once
  assertEquals(g.state.room.phase, 'roll')
  assert(noNegativeCash(g))
})

Deno.test('a non-double roll forces you to end the turn (cannot roll again)', () => {
  const g = new Game(2); g.start()
  const me = g.cur()
  g.setOwner(3, me) // self-owned so landing doesn't pause
  g.act(me, { action: 'roll' }, [[1, 2]]) // non-double → tile 3
  assertEquals(g.state.room.doubles_count, 0)
  assert('error' in g.act(me, { action: 'roll' })) // a second roll is rejected
  assert('patch' in g.act(me, { action: 'end_turn' }))
})
