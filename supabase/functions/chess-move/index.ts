// =====================================================================
// Jordan Stand Tall — server-authoritative chess move validation
// =====================================================================
//
// Why this exists:
//   TicTacToe / ConnectFour / Trivia are fully refereed inside Postgres
//   RPCs. Chess could not be — Postgres has no chess engine — so the old
//   make_move() chess branch trusted the client's fen/pgn/outcome. A modified
//   client could submit any position or claim "checkmate" to steal Elo.
//
//   This Edge Function is the chess referee: it re-derives the move from the
//   stored FEN with chess.js, computes the authoritative next position and
//   outcome server-side, and writes the row with the service role. The client
//   only ever sends {match_id, from, to, promotion} — never a board it made up.
//
// Deploy:   supabase functions deploy chess-move
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected
//  automatically; no manual secrets needed. Leave JWT verification ON.)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Chess } from 'npm:chess.js@1.0.0-beta.8'

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '').trim()
    if (!jwt) return json({ error: 'Not authenticated' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    // Identify the caller from their JWT (anon client scoped to their token).
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
    const promotion = body?.promotion || 'q'
    if (!match_id || !from || !to) return json({ error: 'Missing move' }, 400)

    // Service role bypasses RLS so we can read + write the authoritative row.
    const admin = createClient(url, service)
    const { data: m, error: mErr } = await admin
      .from('matches')
      .select('*')
      .eq('id', match_id)
      .maybeSingle()
    if (mErr) return json({ error: mErr.message }, 500)
    if (!m) return json({ error: 'Match not found' }, 404)
    if (m.game_type !== 'chess') return json({ error: 'Not a chess match' }, 400)
    if (m.status !== 'active') return json({ error: 'Match is not active' }, 409)
    if (uid !== m.player1 && uid !== m.player2) return json({ error: 'You are not in this match' }, 403)
    if (m.current_turn !== uid) return json({ error: 'Not your turn' }, 409)

    const isP1 = uid === m.player1
    const myColor = isP1 ? 'w' : 'b'

    // Re-derive from the stored history — the client's board is never trusted.
    // Loading the full PGN (not just the FEN) preserves move history so the
    // engine can detect threefold repetition; fall back to the FEN if the PGN
    // is empty (first move) or unparseable.
    const storedFen = m.board_state?.fen
    const storedPgn = m.board_state?.pgn
    const game = new Chess()
    let loaded = false
    if (storedPgn && storedPgn.trim()) {
      try {
        game.loadPgn(storedPgn)
        loaded = !storedFen || game.fen() === storedFen
      } catch {
        loaded = false
      }
    }
    if (!loaded) game.load(storedFen)
    if (game.turn() !== myColor) return json({ error: 'Not your turn' }, 409)

    let move
    try {
      move = game.move({ from, to, promotion })
    } catch {
      return json({ error: 'Illegal move' }, 400)
    }
    if (!move) return json({ error: 'Illegal move' }, 400)

    // Outcome is decided by the engine, not by the client.
    let status = m.status
    let winner = m.winner
    let result = m.result
    let current_turn = m.current_turn
    let finished_at = m.finished_at
    const now = new Date().toISOString()

    if (game.isCheckmate()) {
      status = 'finished'
      winner = uid
      result = isP1 ? 'p1' : 'p2'
      finished_at = now
    } else if (game.isGameOver()) {
      // stalemate, insufficient material, 50-move, threefold
      status = 'finished'
      winner = null
      result = 'draw'
      finished_at = now
    } else {
      current_turn = isP1 ? m.player2 : m.player1
    }

    const board_state = { fen: game.fen(), pgn: game.pgn() }

    // The extra .eq('current_turn', uid) is an optimistic-lock: a duplicate /
    // racing submit updates zero rows and is rejected, so a move can't apply twice.
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
      .eq('current_turn', uid)
      .select('*')
      .maybeSingle()

    if (upErr) return json({ error: upErr.message }, 500)
    if (!updated) return json({ error: 'Move no longer valid' }, 409)
    return json(updated)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
