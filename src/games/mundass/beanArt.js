// المندس character art — the shemagh-wearing bean, drawn procedurally (no image
// assets). Shared by the game canvas (world rendering) and the UI portraits
// (meeting cards, lobby, end screen) so the character looks identical everywhere.

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function shade(hex, f) {
  // hex '#rrggbb' → darkened/lightened css color (f<1 darkens, f>1 lightens)
  const n = parseInt(hex.slice(1), 16)
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)))
  return `rgb(${ch(n >> 16)},${ch((n >> 8) & 255)},${ch(n & 255)})`
}

/**
 * Draw a neighbor at (0,0) = feet center.
 *   facing  1|-1        walk    0..1 gait phase (legs scissor)
 *   bob     px lift     ghost   translucent, legless, wavy tail
 *   dead    lying knocked-out   t     time (ms) for idle/ghost animation
 */
export function drawNeighbor(ctx, color, { facing = 1, bob = 0, walk = 0, ghost = false, dead = false, t = 0 } = {}) {
  ctx.save()
  const dark = shade(color, 0.62)
  const lite = shade(color, 1.25)

  if (ghost) {
    ctx.globalAlpha = 0.5
    ctx.translate(0, -10 + Math.sin(t / 420) * 4) // gentle float
  }
  if (dead) {
    ctx.rotate(Math.PI / 2)
    ctx.translate(4, 12)
  }
  ctx.translate(0, -bob)
  ctx.scale(facing, 1)

  // ground shadow
  if (!dead && !ghost) {
    ctx.fillStyle = 'rgba(0,0,0,0.28)'
    ctx.beginPath()
    ctx.ellipse(0, 2 + bob, 20, 7, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  if (ghost) {
    // wavy spirit tail instead of legs
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(-18, -26)
    for (let i = 0; i <= 4; i++) {
      const x = -18 + i * 9
      const y = -4 + Math.sin(t / 160 + i * 1.6) * 4
      ctx.quadraticCurveTo(x + 4.5, y + 6, x + 9, y)
    }
    ctx.lineTo(18, -26)
    ctx.closePath()
    ctx.fill()
  } else {
    // legs — scissor gait when walking
    const swing = Math.sin(walk * Math.PI * 2) * 6
    ctx.fillStyle = dark
    roundRect(ctx, -16, -18 - Math.max(0, swing) * 0.4, 13, 20 + Math.max(0, swing) * 0.4, 6)
    ctx.fill()
    roundRect(ctx, 3, -18 - Math.max(0, -swing) * 0.4, 13, 20 + Math.max(0, -swing) * 0.4, 6)
    ctx.fill()
  }

  // body capsule with a vertical two-tone (light from the left)
  const grad = ctx.createLinearGradient(-20, 0, 20, 0)
  grad.addColorStop(0, lite)
  grad.addColorStop(0.45, color)
  grad.addColorStop(1, dark)
  ctx.fillStyle = grad
  roundRect(ctx, -20, -62, 40, 52, 18)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.4)'
  ctx.lineWidth = 2.5
  roundRect(ctx, -20, -62, 40, 52, 18)
  ctx.stroke()

  // backpack
  ctx.fillStyle = dark
  roundRect(ctx, -30, -52, 12, 30, 5)
  ctx.fill()
  ctx.stroke()

  // visor
  ctx.fillStyle = ghost ? 'rgba(200,230,255,0.85)' : '#bfe1ff'
  roundRect(ctx, -6, -54, 24, 15, 7)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.32)'
  roundRect(ctx, -6, -54, 24, 15, 7)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.6)'
  roundRect(ctx, 2, -51, 10, 5, 2.5)
  ctx.fill()

  // شماغ — white wrap with the red pattern, held by the black عقال
  ctx.fillStyle = '#f4f1ea'
  ctx.beginPath()
  ctx.arc(0, -60, 17, Math.PI * 0.92, Math.PI * 2.08)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.lineWidth = 2
  ctx.stroke()
  // tail down the back (sways when walking)
  const sway = Math.sin(walk * Math.PI * 2 + 1) * 2.5
  ctx.fillStyle = '#efeadf'
  roundRect(ctx, -25 + sway * 0.4, -60, 10, 27, 4)
  ctx.fill()
  // red crosshatch
  ctx.strokeStyle = '#c22a2a'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  for (let i = -14; i <= 14; i += 6) {
    ctx.moveTo(i, -72)
    ctx.lineTo(i + 4, -66)
    ctx.moveTo(i + 4, -72)
    ctx.lineTo(i, -66)
  }
  ctx.stroke()
  // عقال double band
  ctx.strokeStyle = '#151515'
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.ellipse(0, -66, 15, 6, 0, Math.PI * 1.05, Math.PI * 1.95)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, -62.5, 15.5, 6, 0, Math.PI * 1.08, Math.PI * 1.92)
  ctx.stroke()

  if (dead) {
    // knocked-out swirl + the shemagh slipped off beside them
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(10, -76, 5, 0, Math.PI * 1.6)
    ctx.stroke()
  }
  ctx.restore()
}

/** Render a bust portrait onto a canvas element (UI cards). */
export function paintPortrait(canvas, color, { ghost = false, size = 56 } = {}) {
  if (!canvas) return
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
  canvas.width = size * dpr
  canvas.height = size * dpr
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, size, size)
  ctx.save()
  ctx.translate(size / 2, size * 0.98)
  const s = size / 78
  ctx.scale(s, s)
  drawNeighbor(ctx, color, { ghost })
  ctx.restore()
}
