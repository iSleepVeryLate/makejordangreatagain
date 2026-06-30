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

// Bundled webfonts (already loaded by index.html). Plus Jakarta Sans for Latin body
// text; Cairo carries Arabic (per-glyph canvas fallback) + the display weights. The
// board canvas re-bakes once these resolve (Scene3D._rebakeOnFonts).
const FONT_TEXT = '"Plus Jakarta Sans", "Cairo", system-ui, sans-serif'
const FONT_DISPLAY = '"Cairo", "Plus Jakarta Sans", system-ui, sans-serif'

const isCorner = (i) => i === 0 || i === 10 || i === 20 || i === 30

// Which vector glyph a non-property tile shows. Drawn as crisp canvas art (drawIcon),
// not emoji — original Jordan identity, no Hasbro art.
function tileIconKind(t) {
  if (t.type === 'railroad') return 'train'
  if (t.type === 'utility') return t.i === 12 ? 'bulb' : 'drop'
  if (t.type === 'chance') return 'question'
  if (t.type === 'chest') return 'gift'
  if (t.type === 'tax') return 'gem'
  return ''
}

// Hand-drawn vector glyphs (centred at the current origin, fitting a box of side `s`).
// Stroke-and-fill in ink/gold so they read as designed marks. Caller sets transform.
function drawIcon(ctx, kind, s, color = INK) {
  const r = s / 2
  ctx.save()
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'
  ctx.strokeStyle = color; ctx.fillStyle = color
  ctx.lineWidth = s * 0.085
  switch (kind) {
    case 'train': { // locomotive: body + cab + chimney + wheels + headlight
      ctx.fillStyle = color
      roundRect(ctx, -r * 0.85, -r * 0.45, r * 1.55, r * 1.0, r * 0.18); ctx.fill()
      roundRect(ctx, -r * 0.85, -r * 0.85, r * 0.7, r * 0.45, r * 0.1); ctx.fill() // cab
      ctx.fillRect(r * 0.35, -r * 0.85, r * 0.22, r * 0.42) // chimney
      ctx.fillStyle = CREAM
      roundRect(ctx, -r * 0.62, -r * 0.3, r * 0.42, r * 0.42, r * 0.08); ctx.fill() // window
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(-r * 0.4, r * 0.62, r * 0.26, 0, Math.PI * 2); ctx.fill()
      ctx.beginPath(); ctx.arc(r * 0.35, r * 0.62, r * 0.26, 0, Math.PI * 2); ctx.fill()
      break
    }
    case 'bulb': { // lightbulb: glass circle + screw base + filament
      ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.55, 0, Math.PI * 2); ctx.fill()
      ctx.fillRect(-r * 0.28, r * 0.32, r * 0.56, r * 0.16)
      ctx.fillRect(-r * 0.22, r * 0.52, r * 0.44, r * 0.14)
      ctx.fillRect(-r * 0.16, r * 0.7, r * 0.32, r * 0.12)
      break
    }
    case 'drop': { // water droplet: rounded teardrop
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.85)
      ctx.bezierCurveTo(r * 0.72, -r * 0.05, r * 0.6, r * 0.8, 0, r * 0.8)
      ctx.bezierCurveTo(-r * 0.6, r * 0.8, -r * 0.72, -r * 0.05, 0, -r * 0.85)
      ctx.closePath(); ctx.fill()
      break
    }
    case 'question': { // chance: a designed query mark
      ctx.fillStyle = color
      ctx.font = `800 ${Math.round(s * 1.05)}px ${FONT_DISPLAY}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('?', 0, s * 0.04)
      break
    }
    case 'gift': { // treasury: a ribboned box
      roundRect(ctx, -r * 0.7, -r * 0.25, r * 1.4, r * 1.0, r * 0.1); ctx.fill()
      ctx.fillRect(-r * 0.12, -r * 0.25, r * 0.24, r * 1.0) // vertical ribbon
      ctx.fillStyle = color
      ctx.beginPath() // bow
      ctx.moveTo(0, -r * 0.25)
      ctx.bezierCurveTo(-r * 0.6, -r * 0.85, -r * 0.7, -r * 0.1, 0, -r * 0.25)
      ctx.bezierCurveTo(r * 0.7, -r * 0.1, r * 0.6, -r * 0.85, 0, -r * 0.25)
      ctx.fill()
      break
    }
    case 'gem': { // tax: a faceted diamond
      ctx.beginPath()
      ctx.moveTo(0, -r * 0.7)
      ctx.lineTo(r * 0.72, -r * 0.12)
      ctx.lineTo(0, r * 0.8)
      ctx.lineTo(-r * 0.72, -r * 0.12)
      ctx.closePath(); ctx.fill()
      ctx.strokeStyle = CREAM; ctx.lineWidth = s * 0.05
      ctx.beginPath() // facet lines
      ctx.moveTo(-r * 0.72, -r * 0.12); ctx.lineTo(r * 0.72, -r * 0.12)
      ctx.moveTo(-r * 0.3, -r * 0.12); ctx.lineTo(0, r * 0.8)
      ctx.moveTo(r * 0.3, -r * 0.12); ctx.lineTo(0, r * 0.8)
      ctx.stroke()
      break
    }
    case 'lock': { // jail: padlock
      ctx.lineWidth = s * 0.12
      ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.42, Math.PI, 0); ctx.stroke() // shackle
      ctx.fillStyle = color
      roundRect(ctx, -r * 0.6, -r * 0.1, r * 1.2, r * 0.9, r * 0.12); ctx.fill()
      ctx.fillStyle = CREAM
      ctx.beginPath(); ctx.arc(0, r * 0.25, r * 0.13, 0, Math.PI * 2); ctx.fill()
      ctx.fillRect(-r * 0.06, r * 0.25, r * 0.12, r * 0.28)
      break
    }
    case 'parking': { // free parking: a "P" plate
      ctx.fillStyle = color
      roundRect(ctx, -r * 0.62, -r * 0.72, r * 1.24, r * 1.44, r * 0.22); ctx.fill()
      ctx.fillStyle = CREAM
      ctx.font = `800 ${Math.round(s * 0.95)}px ${FONT_DISPLAY}`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('P', 0, s * 0.02)
      break
    }
    case 'arrow-lock': { // go to jail: arrow into a small lock
      ctx.lineWidth = s * 0.1
      ctx.beginPath(); ctx.moveTo(-r * 0.8, -r * 0.3); ctx.lineTo(r * 0.1, -r * 0.3); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(r * 0.1, -r * 0.55); ctx.lineTo(r * 0.45, -r * 0.3); ctx.lineTo(r * 0.1, -r * 0.05); ctx.closePath(); ctx.fill()
      ctx.fillStyle = color
      roundRect(ctx, -r * 0.45, r * 0.05, r * 0.9, r * 0.6, r * 0.1); ctx.fill()
      ctx.beginPath(); ctx.arc(0, r * 0.05, r * 0.28, Math.PI, 0); ctx.lineWidth = s * 0.09; ctx.stroke()
      break
    }
    default: break
  }
  ctx.restore()
}

// Text rotation (radians) so each side's labels read from OUTSIDE the board.
const SIDE_ANGLE = { top: 0, bottom: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

// A small monochrome noise tile → linen/felt grain when pattern-filled under 'overlay'.
function makeGrain(size = 256) {
  const c = document.createElement('canvas'); c.width = size; c.height = size
  const ctx = c.getContext('2d')
  const img = ctx.createImageData(size, size)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 180 + ((Math.random() * 75) | 0)
    img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v
    img.data[i + 3] = (Math.random() * 26) | 0
  }
  ctx.putImageData(img, 0, 0)
  return c
}

// Lighten (amt>0, toward white) / darken (amt<0, toward black) a #hex color.
function shade(hex, amt) {
  const c = hex.replace('#', '')
  const n = parseInt(c.length === 3 ? c.split('').map((x) => x + x).join('') : c, 16)
  let r = (n >> 16) & 255; let g = (n >> 8) & 255; let b = n & 255
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt }
  else { r *= (1 + amt); g *= (1 + amt); b *= (1 + amt) }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`
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

  // ---- surface depth: a faint linen grain, then a soft inner vignette so raking
  // light shows texture and the board edges fall off cinematically ----
  try {
    const pat = ctx.createPattern(makeGrain(256), 'repeat')
    if (pat) {
      ctx.save()
      ctx.globalAlpha = 0.5
      ctx.globalCompositeOperation = 'overlay'
      ctx.fillStyle = pat
      ctx.fillRect(0, 0, SIZE, SIZE)
      ctx.restore()
    }
  } catch { /* pattern unsupported — skip grain */ }
  const vg = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.22, SIZE / 2, SIZE / 2, SIZE * 0.72)
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.20)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, SIZE, SIZE)
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
  // colour band on the inward edge — embossed: a cross-band gradient (light rim →
  // base → darker interior edge) + a thin highlight rim + an inner shadow, so it
  // reads as a raised strip rather than a flat fill.
  if (isProp && t.color) {
    const base = COLOR_GROUPS[t.color]?.hex || '#888'
    const bd = 0.27
    let bx; let by; let bw; let bh; let corners; let g0; let g1
    if (side === 'top') { bx = rx; by = ry; bw = rw; bh = rh * bd; corners = [r, r, 0, 0]; g0 = [rx, ry]; g1 = [rx, ry + bh] }
    else if (side === 'bottom') { bx = rx; by = ry + rh * (1 - bd); bw = rw; bh = rh * bd; corners = [0, 0, r, r]; g0 = [rx, by + bh]; g1 = [rx, by] }
    else if (side === 'right') { bx = rx + rw * (1 - bd); by = ry; bw = rw * bd; bh = rh; corners = [0, r, r, 0]; g0 = [bx + bw, ry]; g1 = [bx, ry] }
    else { bx = rx; by = ry; bw = rw * bd; bh = rh; corners = [r, 0, 0, r]; g0 = [bx + bw, ry]; g1 = [bx, ry] }
    const grad = ctx.createLinearGradient(g0[0], g0[1], g1[0], g1[1])
    grad.addColorStop(0, shade(base, 0.18)); grad.addColorStop(0.5, base); grad.addColorStop(1, shade(base, -0.20))
    ctx.fillStyle = grad
    roundRect(ctx, bx, by, bw, bh, corners); ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.30)'; ctx.lineWidth = UNIT * 0.012
    roundRect(ctx, bx, by, bw, bh, corners); ctx.stroke()
    // thin highlight rim along the outer edge
    ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = UNIT * 0.02
    ctx.beginPath()
    if (side === 'top') { ctx.moveTo(bx + r, ry + UNIT * 0.02); ctx.lineTo(bx + bw - r, ry + UNIT * 0.02) }
    else if (side === 'bottom') { ctx.moveTo(bx + r, by + bh - UNIT * 0.02); ctx.lineTo(bx + bw - r, by + bh - UNIT * 0.02) }
    else if (side === 'right') { ctx.moveTo(bx + bw - UNIT * 0.02, by + r); ctx.lineTo(bx + bw - UNIT * 0.02, by + bh - r) }
    else { ctx.moveTo(bx + UNIT * 0.02, by + r); ctx.lineTo(bx + UNIT * 0.02, by + bh - r) }
    ctx.stroke()
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
  ctx.font = `700 ${nameFont}px ${FONT_TEXT}`
  const nameW = longPx * 0.88
  const lines = wrapLines(ctx, tileName(t, lang), nameW, 2)
  const kind = tileIconKind(t)
  // band occupies ~27% on the inward side; nudge text toward the OUTWARD half
  const outward = (horiz ? rh : rw) * 0.12
  let ty = -outward - ((lines.length - 1) * nameFont) / 2
  if (kind) {
    ctx.save()
    ctx.translate(0, ty - nameFont * 1.15)
    drawIcon(ctx, kind, UNIT * 0.34, kind === 'gem' ? '#b9982f' : INK)
    ctx.restore()
    ctx.fillStyle = INK
  }
  ctx.font = `700 ${nameFont}px ${FONT_TEXT}`
  ctx.textBaseline = 'middle'
  for (const ln of lines) { ctx.fillText(ln, 0, ty); ty += nameFont * 1.02 }
  // price for ownable, unowned
  if (t.price) {
    ctx.fillStyle = INK_SOFT
    ctx.font = `700 ${Math.round(UNIT * 0.12)}px ${FONT_TEXT}`
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
  let kind = ''; let main = tileName(t, lang); let sub = ''; let glyphColor = '#3a342a'
  if (t.type === 'jail') { kind = 'lock'; main = 'JAIL'; sub = 'JUST VISITING' }
  else if (t.type === 'free_parking') { kind = 'parking'; glyphColor = '#2a6f9e' }
  else if (t.type === 'go_to_jail') { kind = 'arrow-lock'; main = 'GO TO JAIL'; glyphColor = '#9c2b22' }

  if (t.type === 'go') {
    ctx.fillStyle = GOLD
    ctx.font = `800 ${Math.round(U * 0.34)}px ${FONT_DISPLAY}`
    ctx.fillText('GO', 0, -U * 0.06)
    ctx.fillStyle = '#2a6f47'
    ctx.font = `800 ${Math.round(U * 0.2)}px ${FONT_DISPLAY}`
    ctx.fillText('↓', 0, U * 0.2)
    ctx.fillStyle = INK_SOFT
    ctx.font = `700 ${Math.round(U * 0.12)}px ${FONT_TEXT}`
    ctx.fillText('COLLECT 200', 0, U * 0.36)
  } else {
    ctx.save(); ctx.translate(0, -U * 0.16); drawIcon(ctx, kind, U * 0.34, glyphColor); ctx.restore()
    ctx.fillStyle = INK
    ctx.font = `800 ${Math.round(U * 0.13)}px ${FONT_DISPLAY}`
    const ml = wrapLines(ctx, main, U * 0.9, 2)
    let ty = U * 0.12
    for (const ln of ml) { ctx.fillText(ln, 0, ty); ty += U * 0.15 }
    if (sub) {
      ctx.fillStyle = INK_SOFT
      ctx.font = `700 ${Math.round(U * 0.085)}px ${FONT_TEXT}`
      ctx.fillText(sub, 0, ty)
    }
  }
  ctx.restore()
}

function drawCrest(ctx, y, w, color) {
  ctx.save(); ctx.translate(0, y)
  ctx.fillStyle = color
  const h = w * 0.62
  ctx.beginPath()
  ctx.moveTo(-w / 2, h * 0.5)
  ctx.lineTo(-w / 2, -h * 0.05)
  ctx.lineTo(-w * 0.25, h * 0.22)
  ctx.lineTo(0, -h * 0.5)
  ctx.lineTo(w * 0.25, h * 0.22)
  ctx.lineTo(w / 2, -h * 0.05)
  ctx.lineTo(w / 2, h * 0.5)
  ctx.closePath(); ctx.fill()
  ctx.fillRect(-w / 2, h * 0.4, w, h * 0.24) // base bar
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
  // double gold bevel frame
  ctx.strokeStyle = GOLD; ctx.lineWidth = SIZE * 0.0032
  roundRect(ctx, -bw / 2, -bh / 2, bw, bh, bh * 0.16); ctx.stroke()
  ctx.strokeStyle = 'rgba(255,236,170,0.5)'; ctx.lineWidth = SIZE * 0.0012
  roundRect(ctx, -bw / 2 + SIZE * 0.004, -bh / 2 + SIZE * 0.004, bw - SIZE * 0.008, bh - SIZE * 0.008, bh * 0.14); ctx.stroke()
  // small gold crest above the wordmark
  drawCrest(ctx, -bh * 0.6, bw * 0.12, GOLD)

  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const sh = SIZE * 0.0016
  // "JORDAN" overline (letter-spaced), embossed gold leaf
  ctx.save(); ctx.letterSpacing = `${Math.round(bh * 0.14)}px`
  ctx.font = `700 ${Math.round(bh * 0.2)}px ${FONT_DISPLAY}`
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText('JORDAN', sh, -bh * 0.27 + sh)
  ctx.fillStyle = GOLD; ctx.fillText('JORDAN', 0, -bh * 0.27)
  ctx.fillStyle = 'rgba(255,244,200,0.45)'; ctx.fillText('JORDAN', -sh * 0.6, -bh * 0.27 - sh * 0.6)
  ctx.restore()
  // "MONOPOLY" fitted to the plate width, embossed off-white
  let fs = Math.round(bh * 0.46)
  ctx.font = `800 ${fs}px ${FONT_DISPLAY}`
  while (ctx.measureText('MONOPOLY').width > bw * 0.86 && fs > 8) { fs -= 2; ctx.font = `800 ${fs}px ${FONT_DISPLAY}` }
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText('MONOPOLY', sh, bh * 0.14 + sh)
  ctx.fillStyle = '#fdf6e6'; ctx.fillText('MONOPOLY', 0, bh * 0.14)
  ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillText('MONOPOLY', -sh * 0.6, bh * 0.14 - sh * 0.6)
  ctx.restore()

  // Chance / Treasury deck slots on the cross-diagonal (vector glyphs, not emoji)
  const slot = (dx, dy, rot, label, kind, color) => {
    ctx.save()
    ctx.translate(cx + dx, cy + dy)
    ctx.rotate(rot)
    const w = innerSize * 0.34; const h = innerSize * 0.2
    ctx.fillStyle = 'rgba(8,14,10,0.78)'
    roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.12); ctx.fill()
    ctx.strokeStyle = color; ctx.lineWidth = SIZE * 0.0022
    roundRect(ctx, -w / 2, -h / 2, w, h, h * 0.12); ctx.stroke()
    ctx.save(); ctx.translate(0, -h * 0.1); drawIcon(ctx, kind, h * 0.42, color); ctx.restore()
    ctx.fillStyle = '#e9e2cf'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `800 ${Math.round(h * 0.18)}px ${FONT_DISPLAY}`
    ctx.fillText(label, 0, h * 0.28)
    ctx.restore()
  }
  const off = innerSize * 0.26
  slot(off, -off, Math.PI / 4, lang === 'ar' ? 'الحظ' : 'CHANCE', 'question', '#e0a33c')
  slot(-off, off, Math.PI / 4, lang === 'ar' ? 'الخزينة' : 'TREASURY', 'gift', '#5fd39a')

  // dice-tray footprint (centre, where the 3D dice settle)
  ctx.save()
  ctx.translate(cx, cy)
  const ts = innerSize * 0.2
  ctx.strokeStyle = 'rgba(212,175,55,0.3)'; ctx.lineWidth = SIZE * 0.0018
  ctx.setLineDash([SIZE * 0.01, SIZE * 0.008])
  roundRect(ctx, -ts / 2, -ts / 2, ts, ts, ts * 0.16); ctx.stroke()
  ctx.restore()
}
