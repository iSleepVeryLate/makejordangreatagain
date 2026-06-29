// ============================================================================
// TokenField — the 3D player pieces (Phase 1).
//
// One "medallion" mesh per non-bankrupt player, in the player's token colour with
// an embossed motif on its top face. Subscribes (via Scene3D) to the animator's
// token slice: when a player's rendered tile changes it tweens the mesh there with
// an arc HOP (STEP_MS) or a flat GLIDE (GLIDE_MS), re-triggering a landing squash
// on each hopSeq bump. Multiple pieces on a tile fan out. The `active` player's
// piece gets a gold ground-glow (and Scene3D points the camera at its tile).
//
// Pure draw layer: it READS the slice, never writes it. Timings mirror
// useBoardAnimator (STEP_MS/GLIDE_MS) so the 3D motion matches the 2D path.
// ============================================================================
import * as THREE from 'three'
import {
  TILE_CENTERS_3D, TOKEN_RADIUS, TOKEN_HEIGHT, TOKEN_REST_Y, HOP_PEAK_Y, SURFACE_Y, INNER_TRACK,
} from './coords3d.js'
import { tokenMeta } from '../monopolyTokens.js'

const STEP_MS = 165 // per-tile hop — matches useBoardAnimator
const GLIDE_MS = 460 // card/jail relocation glide — matches useBoardAnimator
const SQUASH_MS = 140
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)

// Fan-out offsets (world units) so stacked pieces don't fully overlap (mirrors
// TokenLayer.STACK, scaled to the inner track).
const S = INNER_TRACK * 0.3
const STACK = [[0, 0], [S, -S * 0.7], [-S, S * 0.7], [S, S * 0.7], [-S, -S * 0.7], [0, S * 1.05], [S * 1.1, 0], [-S * 1.1, 0]]

const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3)
const lerp = (a, b, k) => a + (b - a) * k

export default class TokenField {
  constructor(host) {
    this.host = host // { scene, invalidate, pushTween, popTween }
    this.tokens = new Map() // profileId -> entry
    this.activeTile = null
    this._disposables = new Set()

    // Shared geometry across all pieces (one dispose each).
    this._bodyGeo = new THREE.CylinderGeometry(TOKEN_RADIUS, TOKEN_RADIUS * 0.86, TOKEN_HEIGHT, 36)
    this._glowGeo = new THREE.CircleGeometry(TOKEN_RADIUS * 1.7, 40)
    this._track(this._bodyGeo, this._glowGeo)
    this._motifCache = new Map()
  }

  _track(...o) { for (const x of o) if (x) this._disposables.add(x) }

  _motifTexture(key, color) {
    if (this._motifCache.has(key)) return this._motifCache.get(key)
    const meta = tokenMeta(key)
    const SZ = 256
    const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
    const ctx = cv.getContext('2d')
    // light dished disc so the coloured rim reads + the glyph pops
    const g = ctx.createRadialGradient(SZ / 2, SZ * 0.42, SZ * 0.05, SZ / 2, SZ / 2, SZ * 0.55)
    g.addColorStop(0, '#fbf6ea'); g.addColorStop(1, color)
    ctx.fillStyle = g
    ctx.beginPath(); ctx.arc(SZ / 2, SZ / 2, SZ / 2, 0, Math.PI * 2); ctx.fill()
    ctx.font = `${Math.round(SZ * 0.56)}px "Segoe UI Emoji", system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(meta.motif || meta.emoji || '●', SZ / 2, SZ * 0.54)
    const tex = new THREE.CanvasTexture(cv)
    tex.colorSpace = THREE.SRGBColorSpace
    this._motifCache.set(key, tex)
    this._track(tex)
    return tex
  }

  _make(id, key) {
    const hex = tokenMeta(key).color
    const color = new THREE.Color(hex)
    const sideMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35 })
    const topMat = new THREE.MeshStandardMaterial({ map: this._motifTexture(key, hex), roughness: 0.5, metalness: 0.1 })
    const botMat = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.6), roughness: 0.6, metalness: 0.3 })
    this._track(sideMat, topMat, botMat)
    // CylinderGeometry material groups: [side, top, bottom]
    const body = new THREE.Mesh(this._bodyGeo, [sideMat, topMat, botMat])
    body.castShadow = true
    body.position.set(0, TOKEN_REST_Y, 0)

    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.5, depthWrite: false })
    this._track(glowMat)
    const glow = new THREE.Mesh(this._glowGeo, glowMat)
    glow.rotation.x = -Math.PI / 2
    glow.position.y = SURFACE_Y + 0.012
    glow.visible = false
    glow.renderOrder = 2

    const group = new THREE.Group()
    group.add(glow); group.add(body)
    this.host.scene.add(group)

    const entry = {
      id, key, group, body, glow,
      cur: { x: 0, z: 0 }, from: { x: 0, z: 0 }, to: { x: 0, z: 0 },
      t0: 0, dur: 0, arc: false, tweening: false,
      hopSeen: -1, squashT0: 0, tile: -1,
    }
    this.tokens.set(id, entry)
    return entry
  }

  _remove(id) {
    const e = this.tokens.get(id)
    if (!e) return
    if (e.tweening) { e.tweening = false; this.host.popTween() }
    this.host.scene.remove(e.group)
    // Free THIS token's own materials so a mid-game bankruptcy/rejoin doesn't leak
    // them until full dispose(). The shared geometries and the cached motif texture
    // (material.map) are NOT freed here — Material.dispose() leaves .map alone.
    for (const m of [...e.body.material, e.glow.material]) { m.dispose(); this._disposables.delete(m) }
    this.tokens.delete(id)
  }

  // React to a new token slice + the player list.
  sync(tok, players) {
    const live = players.filter((p) => !p.bankrupt)
    const liveIds = new Set(live.map((p) => p.profile_id))
    for (const id of [...this.tokens.keys()]) if (!liveIds.has(id)) this._remove(id)

    // rendered positions + stacking, mirroring TokenLayer (stack by rendered tile)
    const rpos = {}
    for (const p of live) rpos[p.profile_id] = tok.pos[p.profile_id] ?? p.position
    const counts = {}; const stackIdx = {}
    for (const p of live) { const n = counts[rpos[p.profile_id]] || 0; stackIdx[p.profile_id] = n; counts[rpos[p.profile_id]] = n + 1 }

    const activeId = tok.active
    let activeTile = null

    for (const p of live) {
      const id = p.profile_id
      const tile = TILE_CENTERS_3D[rpos[id]] || TILE_CENTERS_3D[0]
      const [dx, dz] = STACK[stackIdx[id] % STACK.length]
      const tx = tile.x + dx; const tz = tile.z + dz
      const newTile = rpos[id]
      let e = this.tokens.get(id)
      if (!e) { e = this._make(id, p.token); e.cur = { x: tx, z: tz }; e.to = { x: tx, z: tz }; e.group.position.set(tx, 0, tz); e.body.position.y = TOKEN_REST_Y; e.hopSeen = tok.hopSeq[id] || 0; e.tile = newTile }

      const moved = Math.abs(tx - e.to.x) > 1e-4 || Math.abs(tz - e.to.z) > 1e-4
      const tileChanged = newTile !== e.tile // false = same tile, only the stack fan-out shifted
      const hop = (tok.hopSeq[id] || 0)
      const glide = tok.mode[id] === 'glide'
      if (moved && this.host.reducedMotion) {
        // Reduced motion: the animator already snapped pos — place instantly, no slide.
        if (e.tweening) { e.tweening = false; this.host.popTween() }
        e.cur = { x: tx, z: tz }; e.to = { x: tx, z: tz }; e.squashT0 = 0
        e.group.position.set(tx, 0, tz); e.body.position.y = TOKEN_REST_Y; e.body.scale.set(1, 1, 1)
        e.hopSeen = hop
      } else if (moved) {
        e.from = { x: e.cur.x, z: e.cur.z }
        e.to = { x: tx, z: tz }
        e.t0 = now(); e.dur = glide ? GLIDE_MS : STEP_MS
        // Only arc when the actual tile changed; a pure stack re-shuffle slides flat.
        e.arc = !glide && tileChanged
        if (!e.tweening) { e.tweening = true; this.host.pushTween() }
      }
      e.tile = newTile
      // squash near landing — scheduled off STEP_MS (a stale e.dur from a prior glide
      // could push it past a parked loop). Only on a real tile change.
      if (hop !== e.hopSeen && tileChanged && !this.host.reducedMotion) { e.hopSeen = hop; e.squashT0 = now() + STEP_MS * 0.6 } else if (hop !== e.hopSeen) e.hopSeen = hop

      // Static gold ground-glow on the active piece (no per-frame pulse, so the
      // render loop can still PARK when nothing is moving — see Scene3D._loop).
      e.glow.visible = id === activeId
      e.glow.material.opacity = id === activeId ? 0.5 : 0
      if (id === activeId) activeTile = rpos[id]
    }

    this.activeTile = activeTile
    this.host.invalidate()
  }

  // Advance tweens; returns true while anything is animating.
  update(t) {
    let animating = false
    for (const e of this.tokens.values()) {
      if (e.tweening) {
        const k = e.dur > 0 ? Math.min(1, (t - e.t0) / e.dur) : 1
        const ek = easeOutCubic(k)
        e.cur.x = lerp(e.from.x, e.to.x, ek)
        e.cur.z = lerp(e.from.z, e.to.z, ek)
        e.group.position.x = e.cur.x
        e.group.position.z = e.cur.z
        if (e.arc) {
          const arcH = HOP_PEAK_Y - TOKEN_REST_Y
          e.body.position.y = TOKEN_REST_Y + arcH * Math.sin(Math.PI * k)
          const s = 1 + 0.14 * Math.sin(Math.PI * k)
          e.body.scale.set(2 - s, s, 2 - s)
        } else {
          e.body.position.y = TOKEN_REST_Y
          e.body.scale.set(1, 1, 1) // glide carries no squash; clear any residual flatten
        }
        if (k >= 1) {
          e.tweening = false
          e.body.position.y = TOKEN_REST_Y
          this.host.popTween()
        } else animating = true
      }
      // landing squash (independent of the arc, retriggered per hopSeq)
      if (e.squashT0) {
        if (t >= e.squashT0) {
          const sk = (t - e.squashT0) / SQUASH_MS
          if (sk >= 1) { e.squashT0 = 0; if (!e.tweening) e.body.scale.set(1, 1, 1) }
          else {
            const dip = Math.sin(Math.PI * sk) // 0→1→0
            e.body.scale.set(1 + 0.12 * dip, 1 - 0.18 * dip, 1 + 0.12 * dip)
            animating = true
          }
        } else {
          animating = true // squash pending → keep the loop awake until it fires
        }
      }
    }
    return animating
  }

  // Settle every in-flight hop/glide/squash instantly (called when reduced motion turns on).
  snapAll() {
    for (const e of this.tokens.values()) {
      if (e.tweening) { e.tweening = false; this.host.popTween() }
      e.cur = { x: e.to.x, z: e.to.z }
      e.group.position.set(e.to.x, 0, e.to.z)
      e.body.position.y = TOKEN_REST_Y
      e.body.scale.set(1, 1, 1)
      e.squashT0 = 0
    }
  }

  dispose() {
    for (const e of this.tokens.values()) this.host.scene.remove(e.group)
    this.tokens.clear()
    for (const o of this._disposables) { try { o.dispose?.() } catch { /* gone */ } }
    this._disposables.clear()
    this._motifCache.clear()
  }
}
