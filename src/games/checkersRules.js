// Shared, pure rules for an 8x8 standard draughts (Checkers / Dama) game.
//
// This module is used by the Checkers board ONLY to guide the UI — it computes
// which pieces can move and where, so the board can highlight legal targets and
// enforce a forced multi-jump. It never writes state. The authoritative referee
// is the `checkers-move` Supabase Edge Function, which re-implements this exact
// logic server-side (so a tampered client can't fake a move or steal Elo).
//
// Board: flat length-64 int array, index = row*8 + col, row 0 at the TOP.
//   0 = empty, 1 = p1 man, 2 = p2 man, 3 = p1 king, 4 = p2 king.
// p1 (player1) sits on rows 5-7 and advances UP (toward row 0); promotes on row 0.
// p2 (player2) sits on rows 0-2 and advances DOWN (toward row 7); promotes on row 7.
// Playable squares are the dark squares where (row + col) is odd.

export const SIZE = 8

export function ownerOf(v) {
  if (v === 1 || v === 3) return 1
  if (v === 2 || v === 4) return 2
  return 0
}
export const isKing = (v) => v === 3 || v === 4
export const opponent = (side) => (side === 1 ? 2 : 1)
export const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE
const rc = (idx) => [Math.floor(idx / SIZE), idx % SIZE]
const toIdx = (r, c) => r * SIZE + c

// Diagonal step directions a piece may use: men advance forward only (p1 up,
// p2 down); kings move in all four diagonal directions.
function dirs(v) {
  if (isKing(v)) return [[-1, -1], [-1, 1], [1, -1], [1, 1]]
  return ownerOf(v) === 1 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]]
}

// Capture moves for the single piece at `idx`: jump an adjacent opponent into the
// empty square just beyond it. Returns [{ from, to, captured }].
export function capturesFor(board, idx) {
  const v = board[idx]
  if (!v) return []
  const me = ownerOf(v)
  const [r, c] = rc(idx)
  const out = []
  for (const [dr, dc] of dirs(v)) {
    const mr = r + dr, mc = c + dc // adjacent square (possible victim)
    const lr = r + 2 * dr, lc = c + 2 * dc // landing square
    if (!inBounds(lr, lc)) continue
    const victim = ownerOf(board[toIdx(mr, mc)])
    if (victim !== 0 && victim !== me && board[toIdx(lr, lc)] === 0) {
      out.push({ from: idx, to: toIdx(lr, lc), captured: toIdx(mr, mc) })
    }
  }
  return out
}

// Non-capturing slides for the piece at `idx`. Returns [{ from, to }].
export function simpleFor(board, idx) {
  const v = board[idx]
  if (!v) return []
  const [r, c] = rc(idx)
  const out = []
  for (const [dr, dc] of dirs(v)) {
    const nr = r + dr, nc = c + dc
    if (inBounds(nr, nc) && board[toIdx(nr, nc)] === 0) {
      out.push({ from: idx, to: toIdx(nr, nc) })
    }
  }
  return out
}

// All legal moves for `side` (1 or 2). Mandatory capture: if any capture exists,
// only captures are legal. `mustJumpFrom` (an index, or null) restricts a turn
// that is mid multi-jump to continuing with that one piece.
export function legalMoves(board, side, mustJumpFrom = null) {
  if (mustJumpFrom != null) return capturesFor(board, mustJumpFrom)
  const caps = []
  const simples = []
  for (let i = 0; i < board.length; i++) {
    if (ownerOf(board[i]) !== side) continue
    const cs = capturesFor(board, i)
    if (cs.length) caps.push(...cs)
    else simples.push(...simpleFor(board, i))
  }
  return caps.length ? caps : simples
}

export function hasAnyMove(board, side) {
  return legalMoves(board, side).length > 0
}

// Apply a validated move and report what happened. A man that lands on the far
// row is promoted to a king, which ENDS the turn even if more jumps existed
// (standard rule). A capturing piece that can still capture must continue.
export function applyMove(board, move) {
  const next = board.slice()
  const v = next[move.from]
  next[move.from] = 0
  const captured = move.captured != null
  if (captured) next[move.captured] = 0

  let piece = v
  let promoted = false
  const lr = Math.floor(move.to / SIZE)
  if (v === 1 && lr === 0) { piece = 3; promoted = true }
  else if (v === 2 && lr === SIZE - 1) { piece = 4; promoted = true }
  next[move.to] = piece

  const canContinue = captured && !promoted && capturesFor(next, move.to).length > 0
  return { board: next, captured, promoted, canContinue }
}

// Starting position: 12 men per side on the dark squares of the three rows
// nearest each player.
export function initialBoard() {
  const board = new Array(SIZE * SIZE).fill(0)
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if ((r + c) % 2 !== 1) continue // dark squares only
      if (r <= 2) board[toIdx(r, c)] = 2 // player2 on top
      else if (r >= 5) board[toIdx(r, c)] = 1 // player1 on bottom
    }
  }
  return board
}
