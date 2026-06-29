// Client-only board geometry for Jordan Monopoly.
//
// The 40 perimeter tiles map onto an 11×11 CSS grid whose CORNER tracks are wider
// than the inner ones (`<CORNER>fr repeat(9,1fr) <CORNER>fr`). Token positions,
// money-float anchors, and any overlay must agree on the EXACT tile centres or
// pieces drift on the corners — so this is the single source of truth, imported
// by TokenLayer, useBoardAnimator, and MonopolyBoard. (Display-only; it is NOT
// the frozen board data in monopolyBoard.js.)

export const CORNER_FR = 1.42 // must match .mono-board grid-template-* in app.css
// TOTAL/EDGES are exported so the 3D renderer (src/games/three/coords3d.js) derives
// its world-space tile centres from the SAME track-edge math the 2D board uses —
// they can never drift. (Display-only geometry; not the frozen board data.)
export const TOTAL = CORNER_FR * 2 + 9

// Perimeter index → 1-based grid {row,col}. Same mapping as the old duplicated
// gridPos in MonopolyBoard/TokenLayer, now centralised.
export function gridPos(i) {
  if (i <= 10) return { row: 11, col: 11 - i } // bottom row, right→left
  if (i <= 20) return { row: 21 - i, col: 1 } // left col, bottom→top
  if (i <= 30) return { row: 1, col: i - 19 } // top row, left→right
  return { row: i - 29, col: 11 } // right col, top→bottom
}

// Which edge of a tile faces the board centre (where the color band / houses go).
export function tileSide(i) {
  if (i <= 10) return 'top' // bottom row → inward edge is the top
  if (i <= 20) return 'right' // left col → inward edge is the right
  if (i <= 30) return 'bottom' // top row → inward edge is the bottom
  return 'left' // right col → inward edge is the left
}

// Cumulative track edges in fr units (12 entries: the 11 boundaries + 0). Exported
// for the 3D coordinate derivation (see TOTAL above).
export const EDGES = [0]
for (let k = 0; k < 11; k++) EDGES.push(EDGES[k] + (k === 0 || k === 10 ? CORNER_FR : 1))

const centerPct = (track1based) => ((EDGES[track1based - 1] + EDGES[track1based]) / 2 / TOTAL) * 100

// Percentage centre of every tile within the board's content box.
export const CENTERS = Array.from({ length: 40 }, (_, i) => {
  const { row, col } = gridPos(i)
  return { x: centerPct(col), y: centerPct(row) }
})
