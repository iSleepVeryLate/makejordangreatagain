// ============================================================================
// SparkleBurst — a finite GOLD dust-ring particle pop (G1/G2 "juice").
//
// A single THREE.Points cloud of N particles. burst(x,y,z) seeds them at a base
// point with outward+upward velocities and a short lifetime, makes the cloud
// visible, and registers ONE tween with the host (pushTween) so Scene3D._loop keeps
// drawing. update(t) advances every live particle; when the lifetime elapses the
// cloud hides and pops its tween (popTween) so the loop can PARK. NOTHING here loops
// forever — a burst is a FIXED-duration animation that self-terminates.
//
// INVARIANTS honoured:
//   • PARK: drives the loop via host.pushTween()/popTween(); zero perpetual rAF. A
//     burst already in flight that's re-fired just restarts its clock (still one tween).
//   • DISPOSE: dispose() frees its geometry + material + sprite texture and removes
//     the Points from the scene. The owner (tokens3d/dice3d) calls dispose() in ITS
//     dispose(), and pops any outstanding tween there too (guarded by `_live`).
//   • reducedMotion / low-power gating is the CALLER's responsibility — it simply
//     doesn't call burst(). This module is a dumb, cheap renderer.
//
// Warm gold on the dark world: bright additive points that read as sparkle, not
// confetti. Small + brief by design (a glint, never a fireworks show).
// ============================================================================
import * as THREE from 'three'

const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)
const LIFE_MS = 560 // total burst lifetime — short, self-terminating
const GRAVITY = 9.0 // world units/s² pulling particles back down (dust settling)

// One soft round sprite (radial gradient → warm gold core, transparent edge) so each
// point reads as a glowing mote, not a hard square. Built once per instance.
function makeSparkTexture() {
  if (typeof document === 'undefined') return null
  const SZ = 64
  const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  const g = ctx.createRadialGradient(SZ / 2, SZ / 2, 0, SZ / 2, SZ / 2, SZ / 2)
  g.addColorStop(0.0, 'rgba(255,246,214,1)') // warm white-gold core
  g.addColorStop(0.35, 'rgba(255,211,106,0.9)') // gold
  g.addColorStop(1.0, 'rgba(255,180,60,0)') // fade out
  ctx.fillStyle = g
  ctx.beginPath(); ctx.arc(SZ / 2, SZ / 2, SZ / 2, 0, Math.PI * 2); ctx.fill()
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export default class SparkleBurst {
  // host: { scene, pushTween, popTween, invalidate }.
  constructor(host, { count = 22, size = 0.34, color = 0xffd66a } = {}) {
    this.host = host
    this.count = count
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

    this._tex = makeSparkTexture()
    this._mat = new THREE.PointsMaterial({
      size,
      map: this._tex || null,
      color,
      transparent: true,
      opacity: 1,
      depthWrite: false, // never occlude / be occluded by the token; pure overlay glint
      blending: THREE.AdditiveBlending, // warm sparkle on the dark world (no dark fringes)
      sizeAttenuation: true,
    })

    this._points = new THREE.Points(this._geo, this._mat)
    this._points.visible = false
    this._points.renderOrder = 5 // draw over the token + glow
    this._points.frustumCulled = false // particles fly outside the token's tight bounds
    host.scene.add(this._points)
  }

  // Seed all particles at (x,y,z) with outward (XZ ring) + upward velocity and start
  // the burst. Idempotent re-fire just restarts the clock (one tween stays pushed).
  burst(x, y, z) {
    if (this._disposed) return
    this._origin.set(x, y, z)
    const posArr = this._geo.attributes.position.array
    for (let i = 0; i < this.count; i++) {
      const a = Math.random() * Math.PI * 2 // ring azimuth
      const speed = 0.9 + Math.random() * 1.4 // outward speed (world u/s)
      const up = 1.6 + Math.random() * 2.0 // upward kick → an arcing dust pop
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
    this._mat.opacity = 1
    if (!this._live) { this._live = true; this.host.pushTween() }
    this.host.invalidate()
  }

  // Advance the burst. Returns true while still animating (so the loop stays awake);
  // on completion hides the cloud + pops the tween exactly once → the loop can PARK.
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
    this._mat.opacity = Math.max(0, 1 - k * k) // ease-out fade so it vanishes cleanly
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
