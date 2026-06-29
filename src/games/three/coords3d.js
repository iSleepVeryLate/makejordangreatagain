// ============================================================================
// World-space board geometry for the 3D Monopoly renderer.
//
// Derived from the SAME track-edge math (EDGES/TOTAL) the 2D board uses, so the
// 3D tile centres can never drift from the CSS grid / the animator's CENTERS.
// The board is a square on the XZ plane, Y up, centred at the origin.
//
//   x grows left → right   (grid col 1 → 11)
//   z grows far  → near    (grid row 1 → 11): row 1 (top of the 2D board) maps to
//                           −z (away from the camera), row 11 (the GO row) to +z
//                           (toward the camera) — so GO sits front-right, exactly
//                           like the 2D board.
//
// A unit test (coords3d.test.js) asserts every tile's normalised world position
// matches CENTERS (the 2D %), and that corners/sides line up — this catches drift.
// ============================================================================
import { gridPos, tileSide, EDGES, TOTAL } from '../monopolyGeometry.js'

export const BOARD = 11 // board span in world units (content box, edge-to-edge)
export const BOARD_HALF = BOARD / 2
export const BOARD_THICKNESS = 0.62 // base slab height
export const SURFACE_Y = BOARD_THICKNESS / 2 // top face of the slab — tiles live here

// fr (0..TOTAL) → world (−BOARD/2 .. +BOARD/2), and an fr interval → world length.
export const frToWorld = (f) => (f / TOTAL) * BOARD - BOARD_HALF
const frSpan = (a, b) => ((b - a) / TOTAL) * BOARD

// One inner (1fr) track and one corner track, in world units.
export const INNER_TRACK = frSpan(EDGES[1], EDGES[2])
export const CORNER_TRACK = frSpan(EDGES[0], EDGES[1])

const isCorner = (i) => i === 0 || i === 10 || i === 20 || i === 30

// Per-tile world placement: centre {x,z}, footprint {w,l}, inward edge `side`,
// and `corner`. `w` = width along x (col track), `l` = length along z (row track).
export const TILE_CENTERS_3D = Array.from({ length: 40 }, (_, i) => {
  const { row, col } = gridPos(i)
  const xc = (EDGES[col - 1] + EDGES[col]) / 2
  const zc = (EDGES[row - 1] + EDGES[row]) / 2
  return {
    x: frToWorld(xc),
    z: frToWorld(zc),
    w: frSpan(EDGES[col - 1], EDGES[col]),
    l: frSpan(EDGES[row - 1], EDGES[row]),
    side: tileSide(i),
    corner: isCorner(i),
  }
})

// World-space unit vector (on XZ) pointing from a tile toward the board centre —
// where the colour band / houses / deed labels go. Keyed by tileSide().
export const INWARD = {
  top: { x: 0, z: -1 }, // bottom row (near, +z) → centre is toward −z
  bottom: { x: 0, z: 1 }, // top row (far, −z) → centre is toward +z
  right: { x: 1, z: 0 }, // left col (−x) → centre is toward +x
  left: { x: -1, z: 0 }, // right col (+x) → centre is toward −x
}

// Token rest height + hop apex (Phase 1 reuses these).
export const TOKEN_RADIUS = INNER_TRACK * 0.3
export const TOKEN_HEIGHT = INNER_TRACK * 0.4
export const TOKEN_REST_Y = SURFACE_Y + TOKEN_HEIGHT / 2
export const HOP_PEAK_Y = TOKEN_REST_Y + INNER_TRACK * 0.5

// ---------------------------------------------------------------------------
// Inverse mapping: a world point on the board face → its perimeter tile index
// (or null for the interior). Used by the raycaster for tile clicks.
// ---------------------------------------------------------------------------

// Reverse {row*100+col} → tile index, built from gridPos so it stays in lockstep.
const REV = (() => {
  const m = {}
  for (let i = 0; i < 40; i++) {
    const { row, col } = gridPos(i)
    m[row * 100 + col] = i
  }
  return m
})()

// Which 1-based track (1..11) an fr value falls in.
function bucketTrack(fr) {
  const f = Math.max(0, Math.min(TOTAL - 1e-6, fr))
  for (let k = 1; k <= 11; k++) if (f < EDGES[k]) return k
  return 11
}

// Texture-space rect (px) for tile i on a SIZE×SIZE board-face canvas. boardTexture.js
// paints every tile through THIS, so the baked art and TILE_CENTERS_3D share ONE
// mapping; coords3d.test.js asserts the texel centre maps back to the world centre
// (via the same plane transform Scene3D applies), closing the 2D-art ↔ 3D drift gap.
export function tileTexel(i, SIZE) {
  const { row, col } = gridPos(i)
  const x0 = (EDGES[col - 1] / TOTAL) * SIZE
  const x1 = (EDGES[col] / TOTAL) * SIZE
  const y0 = (EDGES[row - 1] / TOTAL) * SIZE
  const y1 = (EDGES[row] / TOTAL) * SIZE
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }
}

// Inverse of the board-face plane transform Scene3D uses (PlaneGeometry rotateX(-90°),
// CanvasTexture flipY): a texture pixel → its world (x,z). Used only by the drift test.
export function texelToWorld(cx, cy, SIZE) {
  return { x: (cx / SIZE) * BOARD - BOARD_HALF, z: (cy / SIZE) * BOARD - BOARD_HALF }
}

export function tileAtWorld(x, z) {
  if (x < -BOARD_HALF || x > BOARD_HALF || z < -BOARD_HALF || z > BOARD_HALF) return null
  const frX = ((x + BOARD_HALF) / BOARD) * TOTAL
  const frZ = ((z + BOARD_HALF) / BOARD) * TOTAL
  const col = bucketTrack(frX)
  const row = bucketTrack(frZ)
  const i = REV[row * 100 + col]
  return i === undefined ? null : i
}
