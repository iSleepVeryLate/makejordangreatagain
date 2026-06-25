// =====================================================================
// Jordan Stand Tall — server-authoritative Checkers (Dama) move validation
// =====================================================================
//
// Why this exists:
//   TicTacToe / ConnectFour / Trivia are refereed inside Postgres RPCs, and
//   Chess by the chess-move Edge Function. Checkers' rules (mandatory capture,
//   multi-jump continuation, kinging) are too involved to referee safely in SQL,
//   so this Edge Function is the checkers referee: it re-derives the legal moves
//   from the STORED board with a self-contained engine, validates the submitted
//   move, applies it, and writes the row with the service role. The client only
//   ever sends {match_id, from, to} — never a board it made up.
//
// Move/turn protocol:
//   The client submits ONE step at a time. On a capture that can continue, the
//   turn stays with the same player and board_state.mustJumpFrom marks the piece
//   that must keep jumping; otherwise the turn flips. A reached king row ends the
//   turn even mid-jump (standard rule).
//
// Deploy:   supabase functions deploy checkers-move
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
//  automatically; no manual secrets needed. Leave JWT verification ON.)

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

// ---------- checkers engine (mirror of src/games/checkersRules.js) ----------
const SIZE = 8
const DRAW_PLIES = 40

type Move = { from: number; to: number; captured?: number }

const ownerOf = (v: number) => (v === 1 || v === 3 ? 1 : v === 2 || v === 4 ? 2 : 0)
const isKing = (v: number) => v === 3 || v === 4
const opponent = (side: number) => (side === 1 ? 2 : 1)
const inBounds = (r: number, c: number) => r >= 0 && r < SIZE && c >= 0 && c < SIZE
const toIdx = (r: number, c: number) => r * SIZE + c

function dirs(v: number): number[][] {
  if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  return ownerOf(v) === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]
}

function capturesFor(board: number[], idx: number): Move[] {
  const v = board[idx]
  if (!v) return []
  const me = ownerOf(v)
  const r = Math.floor(idx / SIZE), c = idx % SIZE
  const out: Move[] = []
  for (const [dr, dc] of dirs(v)) {
    const mr = r + dr, mc = c + dc
    const lr = r + 2 * dr, lc = c + 2 * dc
    if (!inBounds(lr, lc)) continue
    const victim = ownerOf(board[toIdx(mr, mc)])
    if (victim !== 0 && victim !== me && board[toIdx(lr, lc)] === 0) {
      out.push({ from: idx, to: toIdx(lr, lc), captured: toIdx(mr, mc) })
    }
  }
  return out
}

function simpleFor(board: number[], idx: number): Move[] {
  const v = board[idx]
  if (!v) return []
  const r = Math.floor(idx / SIZE), c = idx % SIZE
  const out: Move[] = []
  for (const [dr, dc] of dirs(v)) {
    const nr = r + dr, nc = c + dc
    if (inBounds(nr, nc) && board[toIdx(nr, nc)] === 0) out.push({ from: idx, to: toIdx(nr, nc) })
  }
  return out
}

function legalMoves(board: number[], side: number, mustJumpFrom: number | null): Move[] {
  if (mustJumpFrom != null) return capturesFor(board, mustJumpFrom)
  const caps: Move[] = []
  const simples: Move[] = []
  for (let i = 0; i < board.length; i++) {
    if (ownerOf(board[i]) !== side) continue
    const cs = capturesFor(board, i)
    if (cs.length) caps.push(...cs)
    else simples.push(...simpleFor(board, i))
  }
  return caps.length ? caps : simples
}

const hasAnyMove = (board: number[], side: number) => legalMoves(board, side, null).length > 0

function applyMove(board: number[], move: Move) {
  const next = board.slice()
  const v = next[move.from]
  next[move.from] = 0
  const captured = move.captured != null
  if (captured) next[move.captured!] = 0
  let piece = v
  let promoted = false
  const lr = Math.floor(move.to / SIZE)
  if (v === 1 && lr === 0) { piece = 3; promoted = true }
  else if (v === 2 && lr === SIZE - 1) { piece = 4; promoted = true }
  next[move.to] = piece
  const canContinue = captured && !promoted && capturesFor(next, move.to).length > 0
  return { board: next, captured, promoted, canContinue }
}

// ---------- request handler ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '').trim()
    if (!jwt) return json({ error: 'Not authenticated' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    })
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser(jwt)
    if (userErr || !user) return json({ error: 'Not authenticated' }, 401)
    const uid = user.id

    const body = await req.json().catch(() => null)
    const match_id = body?.match_id
    const from = body?.from
    const to = body?.to
    if (!match_id || typeof from !== 'number' || typeof to !== 'number') {
      return json({ error: 'Missing move' }, 400)
    }

    const admin = createClient(url, service)
    const { data: m, error: mErr } = await admin
      .from('matches')
      .select('*')
      .eq('id', match_id)
      .maybeSingle()
    if (mErr) return json({ error: mErr.message }, 500)
    if (!m) return json({ error: 'Match not found' }, 404)
    if (m.game_type !== 'checkers') return json({ error: 'Not a checkers match' }, 400)
    if (m.status !== 'active') return json({ error: 'Match is not active' }, 409)
    if (uid !== m.player1 && uid !== m.player2) return json({ error: 'You are not in this match' }, 403)
    if (m.current_turn !== uid) return json({ error: 'Not your turn' }, 409)

    const isP1 = uid === m.player1
    const side = isP1 ? 1 : 2
    const board: number[] = Array.isArray(m.board_state?.board) ? m.board_state.board.slice() : []
    if (board.length !== SIZE * SIZE) return json({ error: 'Corrupt board state' }, 500)
    const mustJumpFrom: number | null = m.board_state?.mustJumpFrom ?? null
    let noProgress: number = Number(m.board_state?.noProgress || 0)

    // Validate the submitted move against the authoritative legal set.
    const legal = legalMoves(board, side, mustJumpFrom)
    const chosen = legal.find((mv) => mv.from === from && mv.to === to)
    if (!chosen) return json({ error: 'Illegal move' }, 400)

    const res = applyMove(board, chosen)

    let current_turn = m.current_turn
    let newMustJump: number | null = null
    if (res.canContinue) {
      current_turn = uid // same player keeps jumping
      newMustJump = to
    } else {
      current_turn = isP1 ? m.player2 : m.player1
      // No-progress draw counter: reset on a capture or promotion, else increment.
      noProgress = res.captured || res.promoted ? 0 : noProgress + 1
    }

    let status = m.status
    let winner = m.winner
    let result = m.result
    let finished_at = m.finished_at
    const now = new Date().toISOString()

    // End-of-game is only evaluated when the turn actually passes to the opponent.
    if (!res.canContinue) {
      const opp = opponent(side)
      if (!hasAnyMove(res.board, opp)) {
        status = 'finished'
        winner = uid
        result = isP1 ? 'p1' : 'p2'
        finished_at = now
      } else if (noProgress >= DRAW_PLIES) {
        status = 'finished'
        winner = null
        result = 'draw'
        finished_at = now
      }
    }

    const board_state = { board: res.board, mustJumpFrom: newMustJump, noProgress }

    // Optimistic lock on move_count: a duplicate / racing submit (same move_count)
    // updates zero rows and is rejected. current_turn alone is insufficient here
    // because multi-jump steps all share the same current_turn.
    const { data: updated, error: upErr } = await admin
      .from('matches')
      .update({
        board_state,
        status,
        current_turn,
        winner,
        result,
        move_count: m.move_count + 1,
        last_move_at: now,
        finished_at,
      })
      .eq('id', m.id)
      .eq('move_count', m.move_count)
      .select('*')
      .maybeSingle()

    if (upErr) return json({ error: upErr.message }, 500)
    if (!updated) return json({ error: 'Move no longer valid' }, 409)
    return json(updated)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
