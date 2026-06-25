// Deno parity test: the server board MIRROR must stay byte-identical (in data) to
// the client source of truth at src/games/monopolyBoard.js. Run:
//   deno test supabase/functions/_shared/
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import * as server from './monopolyBoard.ts'
// Deno can import the plain-JS client copy directly across the repo.
import * as client from '../../../src/games/monopolyBoard.js'

const norm = (v: unknown) => JSON.parse(JSON.stringify(v))

Deno.test('board parity: BOARD', () => {
  assertEquals(norm(server.BOARD), norm(client.BOARD))
})

Deno.test('board parity: card decks', () => {
  assertEquals(norm(server.CHANCE), norm(client.CHANCE))
  assertEquals(norm(server.CHEST), norm(client.CHEST))
})

Deno.test('board parity: color groups + tokens', () => {
  assertEquals(norm(server.COLOR_GROUPS), norm(client.COLOR_GROUPS))
  assertEquals(norm(server.TOKENS), norm(client.TOKENS))
})

Deno.test('board parity: economy constants', () => {
  const keys = [
    'GO_SALARY', 'JAIL_FINE', 'START_CASH', 'JAIL_INDEX', 'GO_TO_JAIL_INDEX',
    'FREE_PARKING_INDEX', 'MAX_PLAYERS', 'MIN_PLAYERS', 'HOUSE_SUPPLY', 'HOTEL_SUPPLY',
    'MORTGAGE_INTEREST', 'BANKRUPTCY_FEE',
  ] as const
  for (const k of keys) {
    assertEquals((server as Record<string, unknown>)[k], (client as Record<string, unknown>)[k], `constant ${k}`)
  }
})

Deno.test('board invariants', () => {
  assertEquals(server.BOARD.length, 40)
  assertEquals(server.OWNABLE.length, 28)
  // Prices ascend along the classic ladder: brown 60 → blue 400.
  assertEquals(server.BOARD[1].price, 60)
  assertEquals(server.BOARD[39].price, 400)
  // 4 railroads, 2 utilities.
  assertEquals(server.railroadTiles().length, 4)
  assertEquals(server.utilityTiles().length, 2)
})
