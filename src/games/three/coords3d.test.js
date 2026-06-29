// Drift guard for the 3D coordinate derivation. Run with: `node --test src/`
//
// The strongest assertion: every tile's normalised world position must map back to
// CENTERS (the 2D %), so the 3D board and the 2D animator can never disagree on
// where a tile is. Plus spot checks on the four corners and the per-side bands.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CENTERS } from '../monopolyGeometry.js'
import {
  TILE_CENTERS_3D, BOARD, BOARD_HALF, tileAtWorld, tileTexel, texelToWorld,
  TOKEN_RADIUS, TOKEN_HEIGHT, TOKEN_REST_Y, HOP_PEAK_Y, SURFACE_Y, INNER_TRACK,
} from './coords3d.js'

const norm = (world) => ((world + BOARD_HALF) / BOARD) * 100 // world → board %
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

test('there are exactly 40 tile placements', () => {
  assert.equal(TILE_CENTERS_3D.length, 40)
})

test('every tile world position matches the 2D CENTERS %', () => {
  for (let i = 0; i < 40; i++) {
    const c3 = TILE_CENTERS_3D[i]
    const c2 = CENTERS[i]
    assert.ok(near(norm(c3.x), c2.x), `tile ${i} x: ${norm(c3.x)} vs ${c2.x}`)
    assert.ok(near(norm(c3.z), c2.y), `tile ${i} z: ${norm(c3.z)} vs ${c2.y}`)
  }
})

test('corners sit at the board extremes with the right quadrant', () => {
  // GO (0) front-right, Jail (10) front-left, Free Parking (20) back-left, Go-to-Jail (30) back-right.
  const go = TILE_CENTERS_3D[0]
  const jail = TILE_CENTERS_3D[10]
  const park = TILE_CENTERS_3D[20]
  const gtj = TILE_CENTERS_3D[30]
  assert.ok(go.x > 0 && go.z > 0, 'GO front-right')
  assert.ok(jail.x < 0 && jail.z > 0, 'Jail front-left')
  assert.ok(park.x < 0 && park.z < 0, 'Free Parking back-left')
  assert.ok(gtj.x > 0 && gtj.z < 0, 'Go-to-Jail back-right')
  // GO and Free Parking are diagonal opposites.
  assert.ok(near(go.x, -park.x, 1e-9) && near(go.z, -park.z, 1e-9), 'GO ⇄ Free Parking diagonal')
  // All four corners are wider/longer than an inner tile (corner_fr > 1fr).
  for (const c of [go, jail, park, gtj]) assert.ok(c.corner && c.w > TILE_CENTERS_3D[1].w)
})

test('inward sides match the four edges', () => {
  assert.equal(TILE_CENTERS_3D[1].side, 'top') // bottom row
  assert.equal(TILE_CENTERS_3D[11].side, 'right') // left col
  assert.equal(TILE_CENTERS_3D[21].side, 'bottom') // top row
  assert.equal(TILE_CENTERS_3D[31].side, 'left') // right col
})

test('baked texture tile centres map onto the 3D tile centres (art↔world drift guard)', () => {
  // boardTexture.js paints each tile via tileTexel(); Scene3D maps the canvas onto
  // the board face. The texel centre, pushed through that plane transform, must land
  // exactly on TILE_CENTERS_3D — otherwise a baked tile drifts from its token.
  const SIZE = 2048
  for (let i = 0; i < 40; i++) {
    const { cx, cy } = tileTexel(i, SIZE)
    const w = texelToWorld(cx, cy, SIZE)
    const c3 = TILE_CENTERS_3D[i]
    assert.ok(near(w.x, c3.x, 1e-9), `tile ${i} texel x: ${w.x} vs ${c3.x}`)
    assert.ok(near(w.z, c3.z, 1e-9), `tile ${i} texel z: ${w.z} vs ${c3.z}`)
  }
})

test('token height/hop constants are internally consistent', () => {
  assert.ok(TOKEN_RADIUS > 0 && TOKEN_HEIGHT > 0, 'positive token size')
  assert.ok(near(TOKEN_REST_Y, SURFACE_Y + TOKEN_HEIGHT / 2), 'rest Y sits the piece on the surface')
  assert.ok(HOP_PEAK_Y > TOKEN_REST_Y, 'hop apex is above the rest height')
  // an inner (1fr) tile's world width should equal one inner track
  assert.ok(near(INNER_TRACK, TILE_CENTERS_3D[1].w, 1e-9), 'INNER_TRACK matches an inner tile width')
})

test('tileAtWorld round-trips every tile centre and rejects the interior', () => {
  for (let i = 0; i < 40; i++) {
    const c = TILE_CENTERS_3D[i]
    assert.equal(tileAtWorld(c.x, c.z), i, `tile ${i} round-trip`)
  }
  assert.equal(tileAtWorld(0, 0), null, 'board centre is not a tile')
  assert.equal(tileAtWorld(99, 99), null, 'off-board is not a tile')
})
