import { memo } from 'react'
import { tokenMeta } from './monopolyTokens.js'

// An absolutely-positioned overlay above the board grid. Each player is ONE
// persistent <span> (keyed by profile_id) whose left/top % change when their
// `position` changes — so a move CSS-slides tile→tile instead of the old
// teleport (tokens used to mount inside each tile, so A→B was unmount/remount
// and no transition could ever run).

// Same perimeter→grid mapping as MonopolyBoard.gridPos (duplicated; 6 lines,
// not worth a shared module). Returns 1-based grid row/col.
function gridPos(i) {
  if (i <= 10) return { row: 11, col: 11 - i }   // bottom row, right→left
  if (i <= 20) return { row: 21 - i, col: 1 }    // left col, bottom→top
  if (i <= 30) return { row: 1, col: i - 19 }    // top row, left→right
  return { row: i - 29, col: 11 }                // right col, top→bottom
}

// The board uses `grid-template-*: 1.5fr repeat(9,1fr) 1.5fr` (12fr total), so
// track centres are NOT evenly spaced — the corner tracks are 1.5×. Precompute
// each track centre as a % of the board content box from the cumulative track
// edges. (The 3px gaps are ignored; that's <2px of error, imperceptible.)
const EDGES = [0, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5, 10.5, 12]
const centerPct = (track1based) => {
  const t = track1based - 1
  return ((EDGES[t] + EDGES[t + 1]) / 2 / 12) * 100
}
const CENTERS = Array.from({ length: 40 }, (_, i) => {
  const { row, col } = gridPos(i)
  return { x: centerPct(col), y: centerPct(row) }
})

// Fan-out offsets (px) so multiple tokens sharing a tile don't fully overlap.
const STACK = [[0, 0], [7, -6], [-7, 6], [7, 6], [-7, -6], [0, 9], [9, 1], [-9, 1]]

function TokenLayer({ players }) {
  const stackIdx = {}
  const counts = {}
  for (const p of players) {
    if (p.bankrupt) continue
    const n = counts[p.position] || 0
    stackIdx[p.profile_id] = n
    counts[p.position] = n + 1
  }
  return (
    <div className="mono-token-layer" aria-hidden>
      {players.map((p) => {
        if (p.bankrupt) return null
        const c = CENTERS[p.position] || CENTERS[0]
        const [dx, dy] = STACK[stackIdx[p.profile_id] % STACK.length]
        const meta = tokenMeta(p.token)
        return (
          <span
            key={p.profile_id}
            className="mono-token-fly"
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)`,
              '--tok': meta.color,
            }}
            title={p.token}
          >
            {meta.emoji}
          </span>
        )
      })}
    </div>
  )
}

export default memo(TokenLayer)
