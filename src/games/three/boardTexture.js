// ============================================================================
// Bakes the STATIC Jordan-Monopoly board face onto a single high-res canvas.
//
// This is the "official-quality" 2D art that lives as the 3D board surface: cream
// deed tiles with property colour bands on the inward edge, special-tile icons,
// the four corners (GO / JAIL / FREE PARKING / GO TO JAIL — our own glyphs), and
// the felt centre carrying the JORDAN MONOPOLY wordmark, a dice-tray footprint,
// and the Chance / Treasury deck slots.
//
// Pure 2D drawing (no THREE) — Scene3D wraps the result in a CanvasTexture. The
// canvas maps 1:1 onto the slab's top face: pixel (fr/TOTAL·SIZE) for both axes,
// so a tile painted here lands exactly under its TILE_CENTERS_3D token position.
// Dynamic state (ownership rings, houses, mortgage tint, highlights, tokens) is
// NEVER baked here — those are separate overlay meshes, so this never re-bakes.
//
// Original "Jordan" identity — evokes the official feel; copies no Hasbro art.
// ============================================================================
import { EDGES, TOTAL, tileSide } from '../monopolyGeometry.js'
import { BOARD as TILES, COLOR_GROUPS, tileName } from '../monopolyBoard.js'
import { tileTexel } from './coords3d.js'

const CREAM = '#f4efe1'
const CREAM_2 = '#e7dcc4'
const INK = '#20201a'
const INK_SOFT = '#6a5f47'
const FELT_1 = '#16241c'
const FELT_2 = '#0b130e'
const GOLD = '#d4af37'
const GOLD_SOFT = '#9c7e26'

const isCorner = (i) => i === 0 || i === 10 || i === 20 || i === 30

// Emoji glyph for the non-property tiles (original, not Hasbro's tokens).
const ICON = {
  railroad: '🚉', utility_power: '💡', utility_water: '💧',
  chance: '❓', chest: '🎁', tax: '💎',
}
function tileIcon(t) {
  if (t.type === 'railroad') return ICON.railroad
  if (t.type === 'utility') return t.i === 12 ? ICON.utility_power : ICON.utility_water
  if (t.type === 'chance') return ICON.chance
  if (t.type === 'chest') return ICON.chest
  if (t.type === 'tax') return ICON.tax
  return ''
}

// Text rotation (radians) so each side's labels read from OUTSIDE the board.
const SIDE_ANGLE = { top: 0, bottom: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

// Wrap `text` to <= maxWidth across up to `maxLines` lines (last line ellipsised).
function wrapLines(ctx, text, maxWidth, maxLines) {
  const words = String(text).split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    const probe = cur ? `${cur} ${w}` : w
    if (ctx.measureText(probe).width > maxWidth && cur) {
      lines.push(cur); cur = w
      if (lines.length === maxLines - 1) break
    } else cur = probe
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  return lines.slice(0, maxLines)
}

export function paintBoardCanvas(ctx, SIZE, lang = 'en') {
  const px = (fr) => (fr / TOTAL) * SIZE
  const UNIT = SIZE / TOTAL // one inner track in px

  // ---- felt frame (fills gaps + outer margin) ----
  const bg = ctx.createLinearGradient(0, 0, SIZE, SIZE)
  bg.addColorStop(0, FELT_1); bg.addColorStop(1, FELT_2)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, SIZE, SIZE)

  // ---- centre felt panel + framing ----
  const inner0 = px(EDGES[1]); const inner1 = px(EDGES[10]); const innerSize = inner1 - inner0
  const cgrad = ctx.createRadialGradient(SIZE / 2, SIZE * 0.42, innerSize * 0.1, SIZE / 2, SIZE / 2, innerSize * 0.8)
  cgrad.addColorStop(0, '#1c3027'); cgrad.addColorStop(1, '#0a110d')
  ctx.fillStyle = cgrad
  ctx.fillRect(inner0, inner0, innerSize, innerSize)
  // gold inner frame line
  ctx.strokeStyle = 'rgba(212,175,55,0.55)'
  ctx.lineWidth = SIZE * 0.0022
  ctx.strokeRect(inner0 - UNIT * 0.04, inner0 - UNIT * 0.04, innerSize + UNIT * 0.08, innerSize + UNIT * 0.08)

  // ---- tiles ----
  for (let i = 0; i < 40; i++) drawTile(ctx, i, lang, SIZE, UNIT)

  // ---- centre decorations ----
  drawCentre(ctx, SIZE, inner0, innerSize, lang)
}

function drawTile(ctx, i, lang, SIZE, UNIT) {
  const t = TILES[i]
  const { x0, y0, w, h } = tileTexel(i, SIZE) // shared mapping → aligns with TILE_CENTERS_3D
  const gap = UNIT * 0.022
  const rx = x0 + gap; const ry = y0 + gap; const rw = w - gap * 2; const rh = h - gap * 2
  const r = UNIT * 0.05

  // cream deed face
  const g = ctx.createLinearGradient(rx, ry, rx, ry + rh)
  g.addColorStop(0, CREAM); g.addColorStop(1, CREAM_2)
  ctx.fillStyle = g
  roundRect(ctx, rx, ry, rw, rh, r); ctx.fill()
  ctx.strokeStyle = 'rgba(120,104,70,0.45)'; ctx.lineWidth = UNIT * 0.012
  roundRect(ctx, rx, ry, rw, rh, r); ctx.stroke()

  if (isCorner(i)) { drawCorner(ctx, t, lang, rx, ry, rw, rh); return }

  const side = tileSide(i)
  const isProp = t.type === 'property'
  // colour band on the inward edge
  if (isProp && t.color) {
    const band = COLOR_GROUPS[t.color]?.hex || '#888'
    ctx.fillStyle = band
    const bd = 0.27
    if (side === 'top') roundRect(ctx, rx, ry, rw, rh * bd, [r, r, 0, 0])
    else if (side === 'bottom') roundRect(ctx, rx, ry + rh * (1 - bd), rw, rh * bd, [0, 0, r, r])
    else if (side === 'right') roundRect(ctx, rx + rw * (1 - bd), ry, rw * bd, rh, [0, r, r, 0])
    else roundRect(ctx, rx, ry, rw * bd, rh, [r, 0, 0, r])
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = UNIT * 0.01; ctx.stroke()
  }

  // text block, rotated so it reads from outside; anchor offset away from the band
  const cx = rx + rw / 2; const cy = ry + rh / 2
  const horiz = side === 'top' || side === 'bottom'
  const longPx = horiz ? rw : rh // text runs along this dimension after rotation
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(SIDE_ANGLE[side])
  // after rotation local +y points outward → push content toward the band (−y a bit)
  const bandShift = longPx * 0 // text already centred in body; band sits at edge
  ctx.translate(0, bandShift)
  ctx.textAlign = 'center'
  ctx.fillStyle = INK

  const nameFont = Math.round(UNIT * 0.155)
  ctx.font = `700 ${nameFont}px "Segoe UI", system-ui, sans-serif`
  const nameW = longPx * 0.88
  const lines = wrapLines(ctx, tileName(t, lang), nameW, 2)
  const icon = tileIcon(t)
  // band occupies ~27% on the inward side; nudge text toward the OUTWARD half
  const outward = (horiz ? rh : rw) * 0.12
  let ty = -outward - ((lines.length - 1) * nameFont) / 2
  if (icon) {
    ctx.font = `${Math.round(UNIT * 0.26)}px "Segoe UI Emoji", system-ui, sans-serif`
    ctx.fillText(icon, 0, ty - nameFont * 0.9)
    ctx.fillStyle = INK
  }
  ctx.font = `700 ${nameFont}px "Segoe UI", system-ui, sans-serif`
  ctx.textBaseline = 'middle'
  for (const ln of lines) { ctx.fillText(ln, 0, ty); ty += nameFont * 1.02 }
  // price for ownable, unowned
  if (t.price) {
    ctx.fillStyle = INK_SOFT
    ctx.font = `700 ${Math.round(UNIT * 0.12)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText(`${t.price}`, 0, (horiz ? rh : rw) * 0.30)
  }
  ctx.restore()
}

function drawCorner(ctx, t, lang, rx, ry, rw, rh) {
  const cx = rx + rw / 2; const cy = ry + rh / 2
  const U = rw // corner ~ square
  ctx.save()
  ctx.translate(cx, cy)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let icon = '🎯'; let main = tileName(t, lang); let sub = ''
  if (t.type === 'go') { icon = '↓'; sub = '+200' }
  else if (t.type === 'jail') { icon = '🔒'; main = 'JAIL'; sub = 'JUST VISITING' }
  else if (t.type === 'free_parking') { icon = '🅿️' }
  else if (t.type === 'go_to_jail') { icon = '🚓'; main = 'GO TO JAIL' }

  if (t.type === 'go') {
    ctx.fillStyle = GOLD
    ctx.font = `800 ${Math.round(U * 0.34)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText('GO', 0, -U * 0.06)
    ctx.fillStyle = '#2a6f47'
    ctx.font = `800 ${Math.round(U * 0.2)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText('↓', 0, U * 0.2)
    ctx.fillStyle = INK_SOFT
    ctx.font = `700 ${Math.round(U * 0.12)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText('COLLECT 200', 0, U * 0.36)
  } else {
    ctx.font = `${Math.round(U * 0.3)}px "Segoe UI Emoji", system-ui, sans-serif`
    ctx.fillText(icon, 0, -U * 0.16)
    ctx.fillStyle = INK
    ctx.font = `800 ${Math.round(U * 0.13)}px "Segoe UI", system-ui, sans-serif`
    const ml = wrapLines(ctx, main, U * 0.9, 2)
    let ty = U * 0.12
    for (const ln of ml) { ctx.fillText(ln, 0, ty); ty += U * 0.15 }
    if (sub) {
      ctx.fillStyle = INK_SOFT
      ctx.font = `700 ${Math.round(U * 0.085)}px "Segoe UI", system-ui, sans-serif`
      ctx.fillText(sub, 0, ty)
    }
  }
  ctx.restore()
}

function drawCentre(ctx, SIZE, inner0, innerSize, lang) {
  const cx = SIZE / 2; const cy = SIZE / 2
  // diagonal wordmark banner (shorter than the felt so it sits clear of the ring)
  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(-Math.PI / 4)
  const bw = innerSize * 0.66; const bh = innerSize * 0.205
  const bgrad = ctx.createLinearGradient(0, -bh / 2, 0, bh / 2)
  bgrad.addColorStop(0, '#c33027'); bgrad.addColorStop(1, '#7d1611')
  ctx.fillStyle = bgrad
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.16); ctx.fill()
  ctx.strokeStyle = GOLD; ctx.lineWidth = SIZE * 0.003
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.16); ctx.stroke()
  // "JORDAN" overline (letter-spaced), then "MONOPOLY" fitted to the plate width
  ctx.fillStyle = GOLD
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `700 ${Math.round(bh * 0.2)}px "Segoe UI", system-ui, sans-serif`
  ctx.save(); ctx.letterSpacing = `${Math.round(bh * 0.14)}px`
  ctx.fillText('JORDAN', 0, -bh * 0.27)
  ctx.restore()
  ctx.fillStyle = '#fdf6e6'
  let fs = Math.round(bh * 0.46)
  ctx.font = `800 ${fs}px "Segoe UI", system-ui, sans-serif`
  while (ctx.measureText('MONOPOLY').width > bw * 0.86 && fs > 8) { fs -= 2; ctx.font = `800 ${fs}px "Segoe UI", system-ui, sans-serif` }
  ctx.fillText('MONOPOLY', 0, bh * 0.14)
  ctx.restore()

  // Chance / Treasury deck slots on the cross-diagonal
  const slot = (dx, dy, rot, label, emoji, color) => {
    ctx.save()
    ctx.translate(cx + dx, cy + dy)
    ctx.rotate(rot)
    const w = innerSize * 0.34; const h = innerSize * 0.2
    ctx.fillStyle = 'rgba(8,14,10,0.78)'
    roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.12); ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = SIZE * 0.0022
    roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.12); ctx.stroke()
    ctx.fillStyle = color
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `${Math.round(h * 0.42)}px "Segoe UI Emoji", system-ui, sans-serif`
    ctx.fillText(emoji, 0, -h * 0.12)
    ctx.fillStyle = '#e9e2cf'
    ctx.font = `800 ${Math.round(h * 0.18)}px "Segoe UI", system-ui, sans-serif`
    ctx.fillText(label, 0, h * 0.26)
    ctx.restore()
  }
  const off = innerSize * 0.26
  slot(off, -off, Math.PI / 4, lang === 'ar' ? 'الحظ' : 'CHANCE', '❓', '#e0a33c')
  slot(-off, off, Math.PI / 4, lang === 'ar' ? 'الخزينة' : 'TREASURY', '🎁', '#5fd39a')

  // dice-tray footprint (centre, where the 3D dice settle)
  ctx.save()
  ctx.translate(cx, cy)
  const ts = innerSize * 0.2
  ctx.strokeStyle = 'rgba(212,175,55,0.3)'; ctx.lineWidth = SIZE * 0.0018
  ctx.setLineDash([SIZE * 0.01, SIZE * 0.008])
  roundRect(ctx, -ts / 2, -ts / 2, ts, ts, ts * 0.16); ctx.stroke()
  ctx.restore()
}
