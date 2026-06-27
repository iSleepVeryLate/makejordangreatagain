// Display-only affordance helpers for on-board interactivity. These MIRROR the
// server engine rules (supabase/functions/_shared/monopolyEngine.ts: doBuild L569,
// doSell L595, doMortgage L617, doUnmortgage L632, netWorth L131, rentDue L107) so
// the UI only offers moves the server will accept. The engine remains authoritative
// — a stale UI just gets a harmless {rejected} that self-corrects.
//
// All take `propByTile` (an object keyed by tile_index) and a small `ctx`:
//   { id, phase, isMyTurn, cash, room, debtorMe }
import { BOARD, COLOR_GROUPS, groupTiles, railroadTiles, utilityTiles, MORTGAGE_INTEREST } from './monopolyBoard.js'

export const ownsFullSet = (propByTile, color, id) =>
  !!color && groupTiles(color).every((i) => propByTile[i]?.owner === id)

export const setHasBuildings = (propByTile, color) =>
  !!color && groupTiles(color).some((i) => (propByTile[i]?.houses || 0) > 0)

export const setAnyMortgaged = (propByTile, color) =>
  !!color && groupTiles(color).some((i) => propByTile[i]?.mortgaged)

// Color keys whose every tile is owned by `id` — drives the board "set complete"
// glow and the holdings legend.
export function fullSetsOwned(propByTile, id) {
  const s = new Set()
  for (const color of Object.keys(COLOR_GROUPS)) {
    if (ownsFullSet(propByTile, color, id)) s.add(color)
  }
  return s
}

// build/sell/unmortgage require it to be your turn in the roll phase (engine
// requires current()===id && phase==='roll'). Mortgage is ALSO allowed for the
// debtor during awaiting_debt (engine doMortgage L620) so you can raise funds.
export function canBuild(tileDef, prop, propByTile, ctx) {
  if (!ctx.isMyTurn || ctx.phase !== 'roll') return false
  if (tileDef.type !== 'property' || !prop || prop.owner !== ctx.id) return false
  if (!ownsFullSet(propByTile, tileDef.color, ctx.id)) return false
  if (setAnyMortgaged(propByTile, tileDef.color)) return false
  if (prop.houses >= 5) return false
  const minH = Math.min(...groupTiles(tileDef.color).map((i) => propByTile[i]?.houses || 0))
  if (prop.houses > minH) return false // even-build
  if ((ctx.cash || 0) < (tileDef.house || 0)) return false
  if (prop.houses === 4) return (ctx.room.bank_hotels || 0) > 0
  return (ctx.room.bank_houses || 0) > 0
}

export function canSell(tileDef, prop, propByTile, ctx) {
  if (!ctx.isMyTurn || ctx.phase !== 'roll') return false
  if (tileDef.type !== 'property' || !prop || prop.owner !== ctx.id) return false
  if ((prop.houses || 0) <= 0) return false
  const maxH = Math.max(...groupTiles(tileDef.color).map((i) => propByTile[i]?.houses || 0))
  if (prop.houses < maxH) return false // even-sell
  if (prop.houses === 5 && (ctx.room.bank_houses || 0) < 4) return false
  return true
}

export function canMortgage(tileDef, prop, propByTile, ctx) {
  // Engine doMortgage resolves the actor with player(id), NOT current(), and gates
  // only on phase — so ANY owner may mortgage their own property during a roll
  // phase (to raise cash), not just on their own turn. Mirror that (unlike
  // build/sell/unmortgage, which the engine ties to current()).
  const allowed = ctx.phase === 'roll' || (ctx.phase === 'awaiting_debt' && ctx.debtorMe)
  if (!allowed) return false
  if (!prop || prop.owner !== ctx.id || prop.mortgaged) return false
  if (tileDef.color && setHasBuildings(propByTile, tileDef.color)) return false
  return true
}

export const unmortgageCost = (tileDef) => Math.ceil((tileDef.mortgage || 0) * (1 + MORTGAGE_INTEREST))

export function canUnmortgage(tileDef, prop, ctx) {
  if (!ctx.isMyTurn || ctx.phase !== 'roll') return false
  if (!prop || prop.owner !== ctx.id || !prop.mortgaged) return false
  return (ctx.cash || 0) >= unmortgageCost(tileDef)
}

// A light, board-level "you could build here" cue (the precise gate lives in the
// popover buttons). Intentionally ignores cash/even-build so the hint stays calm.
export function buildableHint(tileDef, prop, propByTile, id) {
  return tileDef.type === 'property' && prop?.owner === id &&
    ownsFullSet(propByTile, tileDef.color, id) && !setAnyMortgaged(propByTile, tileDef.color) &&
    (prop.houses || 0) < 5
}

// Liquidation value: cash + (mortgaged ? floor(price/2) : price) + houses*floor(house/2).
export function netWorth(player, propByTile) {
  if (!player) return 0
  let n = player.cash || 0
  for (const key in propByTile) {
    const p = propByTile[key]
    if (!p || p.owner !== player.profile_id) continue
    const t = BOARD[p.tile_index]
    const price = t.price || 0
    n += p.mortgaged ? Math.floor(price / 2) : price
    if (p.houses > 0 && t.house) n += p.houses * Math.floor(t.house / 2)
  }
  return n
}

// Current rent for the tooltip. Utilities are dice-dependent → return a multiplier
// rather than a fixed figure. null = no rent (unowned / mortgaged / non-rentable).
export function rentNow(tileDef, prop, propByTile) {
  if (!prop || !prop.owner || prop.mortgaged) return null
  if (tileDef.type === 'property') {
    const amount = prop.houses > 0
      ? tileDef.rent[prop.houses]
      : (ownsFullSet(propByTile, tileDef.color, prop.owner) ? tileDef.rent[0] * 2 : tileDef.rent[0])
    return { kind: 'fixed', amount }
  }
  if (tileDef.type === 'railroad') {
    const n = railroadTiles().filter((i) => propByTile[i]?.owner === prop.owner).length
    return { kind: 'fixed', amount: [0, 25, 50, 100, 200][n] || 0 }
  }
  if (tileDef.type === 'utility') {
    const n = utilityTiles().filter((i) => propByTile[i]?.owner === prop.owner).length
    return { kind: 'dice', mult: n === 2 ? 10 : 4 }
  }
  return null
}
