// ============================================================================
// DicePair — the two 3D dice (Phase 2).
//
// Subscribes (via Scene3D) to the animator's dice slice {a,b,rolling,nonce}:
//   rolling=true            → tumble in the centre tray (random angular velocity)
//   a,b set (nonce bumps)   → settle: tween each die so its TOP face shows exactly
//                             the committed value, with a short bounce
//   a,b null (turn handoff) → hide (no phantom pips into the next player's turn)
//
// SCRIPTED, not physics: the dice always land on the server-known result. Sounds
// are owned elsewhere (shell fires `diceRoll` on roll-start; useBoardAnimator fires
// `diceLand` on the committed roll) — this module makes NO sound (avoids double-fire).
// Reduced motion → no tumble, snap straight to the faces.
// ============================================================================
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { SURFACE_Y, INNER_TRACK } from './coords3d.js'
import { sound } from '../../lib/sound.js'
import { lowPower } from './capability.js'
import SparkleBurst from './sparkleBurst.js'

const SETTLE_MS = 540
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)

// Object rotation (Euler) that brings each value's face to +y (up, toward camera).
// Die layout: +x=1 −x=6 +y=2 −y=5 +z=3 −z=4 (opposite faces sum to 7).
const FACE_EULER = {
  1: [0, 0, Math.PI / 2], // +x → +y
  2: [0, 0, 0], // +y
  3: [-Math.PI / 2, 0, 0], // +z → +y
  4: [Math.PI / 2, 0, 0], // −z → +y
  5: [Math.PI, 0, 0], // −y → +y
  6: [0, 0, -Math.PI / 2], // −x → +y
}
// BoxGeometry material order: [+x, −x, +y, −y, +z, −z] → values [1,6,2,5,3,4].
const FACE_VALUES = [1, 6, 2, 5, 3, 4]

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }

const easeOutBack = (k) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2) }

export default class DicePair {
  constructor(host) {
    this.host = host
    this._disposables = new Set()
    // READABILITY pass: 0.58→0.80. At the old size the pips were too small to tell what
    // you rolled at the play camera; this enlarges the faces ~38% so the result reads at a
    // glance. The ±S*0.72 spacing scales WITH S, so the two dice stay separated (edge gap
    // grows, never overlap) and centred under the wordmark; the contact-shadow blobs
    // (S*1.5) and restY (SURFACE_Y + S/2) are both derived from S and follow automatically.
    this.S = INNER_TRACK * 0.80 // larger dice so the pip faces read clearly at the 3/4 play framing
    this.restY = SURFACE_Y + this.S / 2 + 0.02

    const geo = new RoundedBoxGeometry(this.S, this.S, this.S, 3, this.S * 0.14)
    this._track(geo)
    const mats = FACE_VALUES.map((v) => {
      // Satin ivory + bumpMap pips (drilled-hole read). Tuned DOWN from glossy 0.28/1.0:
      // the near-white face at high gloss/IBL spiked past the bloom threshold (1.5) and
      // blew the centre to a white starburst when both dice rest over the wordmark. A
      // higher roughness + lower envMapIntensity keep the specular below the cut so the
      // dice read as a clean satin highlight, not an over-glow.
      const m = new THREE.MeshStandardMaterial({
        map: this._pipTexture(v), bumpMap: this._pipBumpTexture(v), bumpScale: 0.5,
        roughness: 0.42, metalness: 0.05, envMapIntensity: 0.55,
      })
      this._track(m, m.map, m.bumpMap)
      return m
    })

    this.dice = [0, 1].map((i) => {
      const mesh = new THREE.Mesh(geo, mats)
      mesh.castShadow = true
      mesh.position.set((i === 0 ? -1 : 1) * this.S * 0.72, this.restY, 0)
      mesh.visible = false
      host.scene.add(mesh)
      return {
        mesh,
        vel: new THREE.Vector3(),
        settling: false, from: new THREE.Quaternion(), to: new THREE.Quaternion(), t0: 0,
        bob0: 0,
      }
    })

    // A3 contact shadows: a soft dark blob under each die so they don't float. Static,
    // dark (never blooms), depthWrite:false. Positioned under the dice rest spots;
    // toggled with dice visibility.
    this._blobTex = this._makeBlobTexture()
    this._blobGeo = new THREE.PlaneGeometry(this.S * 1.5, this.S * 1.5)
    this._blobMat = new THREE.MeshBasicMaterial({ map: this._blobTex, transparent: true, opacity: 0.34, depthWrite: false })
    this._track(this._blobTex, this._blobGeo, this._blobMat)
    this._blobs = [0, 1].map((i) => {
      const m = new THREE.Mesh(this._blobGeo, this._blobMat)
      m.rotation.x = -Math.PI / 2
      m.position.set((i === 0 ? -1 : 1) * this.S * 0.72, SURFACE_Y + 0.006, 0)
      m.renderOrder = 0
      m.visible = false
      host.scene.add(m)
      return m
    })

    this.rolling = false
    this._settledNonce = -1
    this._lastT = now()
    this._maxTumbleUntil = 0 // safety deadline so a stray roll-start can't tumble forever
    this._lastFaces = null
    this._everSettled = false // first committed settle snaps (joined mid-game) vs. bounces (post-tumble)
    this._tumbledSinceSettle = false
    this._punchPending = false // A4: fire one camera nudge when a bounced settle lands

    // G1 — optional tiny gold spark when the dice physically settle (same finite,
    // self-terminating, park-friendly burst the token landing uses). Smaller + fewer
    // particles than the token pop (the dice already get the camera punch + impact SFX,
    // so this is just a subtle glint). Skipped on low-power. dispose() frees it.
    this._spark = lowPower() ? null : new SparkleBurst(this.host, { count: 12, size: 0.26 })
  }

  // G1 — fire the dice settle glint at the centre tray, between the two dice. Guarded:
  // no-op under reduced motion (the host gates the punch too) or when low-power skipped it.
  _sparkBurst() {
    if (this.host.reducedMotion || !this._spark) return
    this._spark.burst(0, SURFACE_Y + 0.02, 0)
  }

  _track(...o) { for (const x of o) if (x) this._disposables.add(x) }

  _pipTexture(value) {
    const SZ = 160
    const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
    const ctx = cv.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, SZ, SZ)
    // Softer off-white (was near-white #fdfdfb→#e4e4dc): the bright base sat near 1.0
    // and pushed the whole face past the bloom cut. This reads as warm ivory dice
    // without the diffuse surface itself blooming.
    g.addColorStop(0, '#ece9e0'); g.addColorStop(1, '#cfccc2')
    ctx.fillStyle = g; ctx.fillRect(0, 0, SZ, SZ)
    ctx.fillStyle = '#17150f'
    const cells = PIPS[value] || []
    const r = SZ * 0.085
    for (const c of cells) {
      const cxp = (0.5 + (c % 3)) * (SZ / 3)
      const cyp = (0.5 + Math.floor(c / 3)) * (SZ / 3)
      ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill()
    }
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  // Height/bump field for the same face: white ground with soft dark dimples at the pip
  // centres → recessed pips under bumpScale. Linear data (no colour space).
  _pipBumpTexture(value) {
    const SZ = 160
    const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
    const ctx = cv.getContext('2d')
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, SZ, SZ) // raised face
    const cells = PIPS[value] || []
    const r = SZ * 0.10
    for (const c of cells) {
      const cxp = (0.5 + (c % 3)) * (SZ / 3)
      const cyp = (0.5 + Math.floor(c / 3)) * (SZ / 3)
      const g = ctx.createRadialGradient(cxp, cyp, 0, cxp, cyp, r)
      g.addColorStop(0, '#202020'); g.addColorStop(0.7, '#606060'); g.addColorStop(1, '#ffffff')
      ctx.fillStyle = g
      ctx.beginPath(); ctx.arc(cxp, cyp, r, 0, Math.PI * 2); ctx.fill()
    }
    return new THREE.CanvasTexture(cv) // linear by default — correct for a bump map
  }

  // Shared radial-gradient blob for the dice contact shadow.
  _makeBlobTexture() {
    const SZ = 128
    const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
    const ctx = cv.getContext('2d')
    const g = ctx.createRadialGradient(SZ / 2, SZ / 2, 0, SZ / 2, SZ / 2, SZ / 2)
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(0,0,0,0.28)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, SZ, SZ)
    return new THREE.CanvasTexture(cv)
  }

  // Quaternion that shows `value` on top + a fixed slight yaw so a second face reads.
  _faceQuat(value, yaw) {
    const e = FACE_EULER[value] || FACE_EULER[1]
    const qFace = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]))
    const qYaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0))
    return qYaw.multiply(qFace)
  }

  sync(d) {
    if (d.rolling) {
      if (!this.rolling) this._startTumble()
      this.rolling = true
      for (const die of this.dice) die.mesh.visible = true
    } else if (d.a != null && d.b != null) {
      this.rolling = false
      this._maxTumbleUntil = 0
      if (d.nonce !== this._settledNonce) {
        this._settledNonce = d.nonce
        this._beginSettle(d.a, d.b)
      }
      for (const die of this.dice) die.mesh.visible = true
    } else {
      // dice cleared between turns — hide. Leave _settledNonce at the last SETTLED
      // value (not d.nonce): no settle ran here, and overwriting it could suppress a
      // future same-nonce settle. (Unreachable given the animator's monotonic nonce.)
      this.rolling = false
      for (const die of this.dice) { die.mesh.visible = false; die.settling = false }
      this.host.releaseZoom?.() // never leave the camera dollied-in if a roll was abandoned
    }
    for (let i = 0; i < this._blobs.length; i++) this._blobs[i].visible = this.dice[i]?.mesh.visible || false
    this.host.invalidate()
  }

  _startTumble() {
    const rv = () => (Math.random() * 8 + 6) * (Math.random() < 0.5 ? -1 : 1)
    for (const die of this.dice) {
      die.settling = false
      die.vel.set(rv(), rv(), rv())
      die.bob0 = now()
    }
    this._maxTumbleUntil = now() + 3500 // never tumble past this without a committed settle
    this._tumbledSinceSettle = true
    this.host.pushIn?.() // A4: subtle dolly-in for the duration of the roll
  }

  _beginSettle(a, b) {
    this._lastFaces = [a, b]
    const vals = [a, b]
    // Snap (no bounce) under reduced motion, OR on the very first settle that wasn't
    // preceded by a tumble — i.e. a player joining a room with dice already committed.
    const snap = this.host.reducedMotion || (!this._everSettled && !this._tumbledSinceSettle)
    this._everSettled = true
    this._tumbledSinceSettle = false
    // A4: a bounced settle earns a camera nudge on landing; a snap just releases the dolly.
    if (snap) { this._punchPending = false; this.host.releaseZoom?.() } else this._punchPending = true
    for (let i = 0; i < 2; i++) {
      const die = this.dice[i]
      const yaw = (i === 0 ? -0.32 : 0.34)
      const target = this._faceQuat(vals[i], yaw)
      if (snap) {
        die.mesh.quaternion.copy(target); die.mesh.position.y = this.restY; die.settling = false
      } else {
        die.from.copy(die.mesh.quaternion); die.to.copy(target); die.t0 = now(); die.settling = true
      }
    }
  }

  update(t) {
    const dt = Math.min((t - this._lastT) / 1000, 0.05)
    this._lastT = t
    // Safety net: a stray roll-start (e.g. a late out-of-order broadcast under a
    // degraded WS) can flip rolling=true with no settle to follow. Bound the tumble
    // so the loop can't spin forever — reconcile to the last committed faces.
    if (this.rolling && this._maxTumbleUntil && t > this._maxTumbleUntil) {
      this.rolling = false; this._maxTumbleUntil = 0
      if (this._lastFaces) this._beginSettle(this._lastFaces[0], this._lastFaces[1])
      // No committed faces to settle to → hide AND release the dolly, else an abandoned
      // first-ever roll (degraded WS) leaves Scene3D zoom stuck at 1 and the loop never parks.
      else { for (const die of this.dice) die.mesh.visible = false; this.host.releaseZoom?.() }
      // The snap/hide sub-cases set no animating flag, so force a paint — else the
      // loop can park on the last tumbled frame (frozen ghost dice).
      this.host.invalidate()
    }
    let animating = false
    for (const die of this.dice) {
      if (!die.mesh.visible) continue
      if (this.rolling && !die.settling) {
        die.mesh.rotateX(die.vel.x * dt); die.mesh.rotateY(die.vel.y * dt); die.mesh.rotateZ(die.vel.z * dt)
        die.mesh.position.y = this.restY + Math.abs(Math.sin((t - die.bob0) * 0.012)) * this.S * 0.5
        animating = true
      } else if (die.settling) {
        const k = Math.min(1, (t - die.t0) / SETTLE_MS)
        const e = easeOutBack(k)
        die.mesh.quaternion.copy(die.from).slerp(die.to, Math.min(e, 1.0))
        // G1 — a punchier drop + settle on landing (reads as the dice hitting the board).
        // The height now falls along easeInQuad-ish (faster near the floor → harder hit)
        // and adds one small decaying micro-bounce after touch-down so the die "kisses"
        // the board twice instead of a single soft glide. All finite (k∈[0,1]) → parks.
        const drop = (1 - k) * (1 - k) * this.S * 0.92 // steeper, slightly higher than the old linear 0.75
        const bounce = k > 0.82 ? Math.abs(Math.sin((k - 0.82) * 17)) * (1 - k) * this.S * 0.5 : 0
        die.mesh.position.y = this.restY + drop + bounce
        if (k >= 1) {
          die.mesh.quaternion.copy(die.to); die.mesh.position.y = this.restY; die.settling = false
          // First die to land fires the one nudge + releases the dolly + the impact SFX
          // (flag guards the pair so the punch/sound fire ONCE, not per-die).
          if (this._punchPending) {
            this._punchPending = false
            this.host.cameraPunch?.(); this.host.releaseZoom?.()
            sound.play('diceImpact') // crisp tabletop hit at the physical landing frame
            this._sparkBurst?.() // optional tiny gold spark on settle (no-op under reduced motion / low-power)
          }
        } else animating = true
      }
    }
    // G1 — advance the dice settle glint (self-terminates + pops its own tween).
    if (this._spark && this._spark.update(t)) animating = true
    return animating
  }

  // Settle any in-flight tumble/settle instantly (called when reduced motion turns on).
  snapAll() {
    if (this.rolling) { this.rolling = false; this._maxTumbleUntil = 0; if (this._lastFaces) this._beginSettle(this._lastFaces[0], this._lastFaces[1]) }
    for (const die of this.dice) { if (die.settling) { die.mesh.quaternion.copy(die.to); die.mesh.position.y = this.restY; die.settling = false } }
    this._spark?.snap() // kill an in-flight glint + release its tween
  }

  dispose() {
    try { this._spark?.dispose() } catch { /* gone */ } // frees its geo/mat/tex + pops any live tween
    this._spark = null
    for (const die of this.dice) this.host.scene.remove(die.mesh)
    for (const b of (this._blobs || [])) this.host.scene.remove(b)
    this._blobs = []
    this.dice = []
    for (const o of this._disposables) { try { o.dispose?.() } catch { /* gone */ } }
    this._disposables.clear()
  }
}
