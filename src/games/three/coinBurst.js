// ============================================================================
// CoinBurst — a finite GOLD COIN reward pop (G3 "cash-gain juice").
//
// Sibling of SparkleBurst, same park-safe contract, but tuned as a COIN PAYOFF
// rather than a landing glint: a spray of small gold coin discs that pop UP and
// out, arc on gravity, and fade — the Monopoly-GO "you got paid" moment, in the
// dark-premium key. Fired on a POSITIVE cash delta at the gaining token, NOT on
// landing (which keeps the cooler SparkleBurst glint). Distinct sprite (a flat
// minted coin with a bright rim) so it never reads as the same effect.
//
// INVARIANTS honoured (identical to SparkleBurst — see that file's header):
//   • PARK: drives the loop via host.pushTween()/popTween(); zero perpetual rAF.
//     A burst is a FIXED-duration animation that self-terminates; a re-fire just
//     restarts its clock (still exactly one tween pushed).
//   • DISPOSE: dispose() frees geometry + material + sprite texture, removes the
//     Points from the scene, and pops any outstanding tween. The owner (tokens3d)
//     calls dispose() in ITS dispose().
//   • reducedMotion / low-power gating is the CALLER's responsibility — it simply
//     doesn't call burst(). This module is a dumb, cheap renderer.
// ============================================================================
import * as THREE from 'three'

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)
const LIFE_MS = 720 // a touch longer than the sparkle so the coins read as a satisfying shower
const GRAVITY = 11.0 // world units/s² — coins arc up then fall back, heavier than dust

// One soft round GOLD-COIN sprite: a minted disc (bright rim, warm gold body, a tiny
// specular hotspot) on a transparent ground. Reads as a coin, not a spark. Built once.
function makeCoinTexture() {
  if (typeof document === 'undefined') return null
  const SZ = 64
  const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  const c = SZ / 2; const r = SZ * 0.42
  // soft outer glow so the coin reads on the dark world under additive blend
  const glow = ctx.createRadialGradient(c, c, r * 0.5, c, c, SZ / 2)
  glow.addColorStop(0, 'rgba(255,210,110,0.55)')
  glow.addColorStop(1, 'rgba(255,180,60,0)')
  ctx.fillStyle = glow
  ctx.beginPath(); ctx.arc(c, c, SZ / 2, 0, Math.PI * 2); ctx.fill()
  // coin body — warm gold, lit from upper-left (offset gradient → minted, not flat)
  const body = ctx.createRadialGradient(c - r * 0.35, c - r * 0.35, r * 0.1, c, c, r)
  body.addColorStop(0.0, 'rgba(255,248,212,1)') // hotspot
  body.addColorStop(0.45, 'rgba(255,214,106,1)') // gold
  body.addColorStop(1.0, 'rgba(196,140,40,1)') // shaded rim
  ctx.fillStyle = body
  ctx.beginPath(); ctx.arc(c, c, r, 0, Math.PI * 2); ctx.fill()
  // bright rim keyline so the disc reads as a struck coin
  ctx.strokeStyle = 'rgba(255,245,200,0.9)'; ctx.lineWidth = SZ * 0.04
  ctx.beginPath(); ctx.arc(c, c, r * 0.92, 0, Math.PI * 2); ctx.stroke()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export default class CoinBurst {
  // host: { scene, pushTween, popTween, invalidate }.
  constructor(host, { count = 16, size = 0.46, color = 0xffd98c, peakOpacity = 0.95 } = {}) {
    this.host = host
    this.count = count
    this._peakOpacity = Math.max(0, Math.min(1, peakOpacity))
    this._t0 = 0
    this._live = false // a tween is currently pushed for us
    this._disposed = false

    // per-particle kinematics (CPU-side; the geometry holds only current positions)
    this._vel = new Float32Array(count * 3)
    this._origin = new THREE.Vector3()

    this._geo = new THREE.BufferGeometry()
    const pos = new Float32Array(count * 3) // all at origin until first burst
    this._geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    this._geo.setDrawRange(0, count)

    this._tex = makeCoinTexture()
    this._mat = new THREE.PointsMaterial({
      size,
      map: this._tex || null,
      color,
      transparent: true,
      opacity: this._peakOpacity,
      depthWrite: false, // pure overlay — never occlude / be occluded by the token
      blending: THREE.AdditiveBlending, // warm gold on the dark world (no dark fringes)
      sizeAttenuation: true,
    })

    this._points = new THREE.Points(this._geo, this._mat)
    this._points.visible = false
    this._points.renderOrder = 6 // over the token, glow, AND the landing sparkle
    this._points.frustumCulled = false // coins fly outside the token's tight bounds
    host.scene.add(this._points)
  }

  // Seed all coins at (x,y,z) with a mostly-UPWARD kick + a little outward spread (a
  // fountain, not a flat ring) and start the burst. Idempotent re-fire restarts the clock.
  burst(x, y, z) {
    if (this._disposed) return
    this._origin.set(x, y, z)
    const posArr = this._geo.attributes.position.array
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2 // azimuth
      const speed = 0.5 + Math.random() * 1.0 // gentle outward spread (coins fountain up, not out)
      const up = 3.0 + Math.random() * 2.6 // strong upward kick → an arcing coin shower
      this._vel[i * 3] = Math.cos(a) * speed
      this._vel[i * 3 + 1] = up
      this._vel[i * 3 + 2] = Math.sin(a) * speed
      posArr[i * 3] = x
      posArr[i * 3 + 1] = y
      posArr[i * 3 + 2] = z
    }
    this._geo.attributes.position.needsUpdate = true
    this._t0 = now()
    this._points.visible = true
    this._mat.opacity = this._peakOpacity
    if (!this._live) { this._live = true; this.host.pushTween() }
    this.host.invalidate()
  }

  // Advance the burst. Returns true while still animating; on completion hides the
  // cloud + pops the tween exactly once → the loop can PARK.
  update(t) {
    if (!this._live) return false
    const age = (t - this._t0) / 1000
    const k = (t - this._t0) / LIFE_MS
    if (k >= 1) {
      this._points.visible = false
      this._live = false
      this.host.popTween()
      return false
    }
    const posArr = this._geo.attributes.position.array
    const ox = this._origin.x; const oy = this._origin.y; const oz = this._origin.z
    for (let i = 0; i < this.count; i++) {
      // closed-form integration from the seed (no per-frame accumulation drift):
      // p = origin + v*age − ½·g·age² on Y. Drag-free outward; gravity on the vertical.
      const vx = this._vel[i * 3]; const vy = this._vel[i * 3 + 1]; const vz = this._vel[i * 3 + 2]
      let py = oy + vy * age - 0.5 * GRAVITY * age * age
      if (py < oy) py = oy // settle onto the base plane, never sink through it
      posArr[i * 3] = ox + vx * age
      posArr[i * 3 + 1] = py
      posArr[i * 3 + 2] = oz + vz * age
    }
    this._geo.attributes.position.needsUpdate = true
    // hold full brightness then fade out late (ease-out) so the coins read before they vanish
    this._mat.opacity = this._peakOpacity * Math.max(0, 1 - Math.pow(k, 2.4))
    return true
  }

  // Snap to done (called when reduced motion turns on mid-burst). Pops any live tween.
  snap() {
    if (this._live) { this._live = false; this.host.popTween() }
    if (this._points) this._points.visible = false
  }

  dispose() {
    this._disposed = true
    // If a burst was mid-flight, release its tween so the owner's tween count zeroes.
    if (this._live) { this._live = false; try { this.host.popTween() } catch { /* host gone */ } }
    try { if (this._points) this.host.scene?.remove?.(this._points) } catch { /* gone */ }
    try { this._geo?.dispose?.() } catch { /* gone */ }
    try { this._mat?.dispose?.() } catch { /* gone */ }
    try { this._tex?.dispose?.() } catch { /* gone */ }
    this._points = null; this._geo = null; this._mat = null; this._tex = null
  }
}
