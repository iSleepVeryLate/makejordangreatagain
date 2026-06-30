// ============================================================================
// BuildingsLayer — houses / hotels + per-tile ownership & highlight state (Phase 3).
//
// Driven by props (room.properties + derived maps), NOT the animator store:
//   owner            → a thin ownership ring in the owner's colour (deed-stamp pop)
//   houses 1..4      → that many green houses grow in along the inward edge
//   houses === 5     → a single red hotel
//   mortgaged        → a dark tint overlay on the tile
//   activeTile       → static gold highlight ring (the current player's tile)
//   auctionTile      → pulsing amber ring (only during the brief auction phase)
//
// Ownable tiles are never corners, so they're all uniform 1-track tiles → one
// shared ring/tint geometry. Pure draw layer: reads props, mutates nothing.
// ============================================================================
import * as THREE from 'three'
import { TILE_CENTERS_3D, INWARD, SURFACE_Y, INNER_TRACK } from './coords3d.js'

const RISE_MS = 280
const POP_MS = 360
const HOUSE = INNER_TRACK * 0.17
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)
const easeOutBack = (k) => { const c1 = 1.70158; const c3 = c1 + 1; return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2) }
const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3)

export default class BuildingsLayer {
  constructor(host) {
    this.host = host
    this.tiles = new Map() // tileIdx -> entry
    this._disposables = new Set()
    this._anim = new Set() // entries with running grow/pop tweens
    this._auctionTile = null

    this._houseGeo = new THREE.BoxGeometry(HOUSE, HOUSE, HOUSE)
    this._hotelGeo = new THREE.BoxGeometry(HOUSE * 2.2, HOUSE * 1.1, HOUSE * 1.25)
    // A5: satin plastic that catches the IBL — slightly glossier + a touch metallic.
    this._houseMat = new THREE.MeshStandardMaterial({ color: 0x2f9e54, roughness: 0.42, metalness: 0.12, envMapIntensity: 0.9 })
    this._hotelMat = new THREE.MeshStandardMaterial({ color: 0xd0392b, roughness: 0.42, metalness: 0.12, envMapIntensity: 0.9 })
    this._ringGeo = new THREE.PlaneGeometry(INNER_TRACK * 0.95, INNER_TRACK * 0.95)
    this._tintGeo = new THREE.PlaneGeometry(INNER_TRACK * 0.95, INNER_TRACK * 0.95)
    this._frameTex = this._makeFrameTexture()
    this._track(this._houseGeo, this._hotelGeo, this._houseMat, this._hotelMat, this._ringGeo, this._tintGeo, this._frameTex)

    // shared highlight rings (one active, one auction) repositioned per sync
    this._activeRing = this._makeRing(0xffd36a, 0.7); this._activeRing.visible = false
    this._auctionRing = this._makeRing(0xff9d3c, 0.85); this._auctionRing.visible = false
    host.scene.add(this._activeRing); host.scene.add(this._auctionRing)

    // "YOU ARE HERE" pin — a solid colour-fill disc UNDER the active ring so the current
    // tile reads boldly even at the play camera (the thin gold frame alone is subtle).
    // Tinted to the active player's colour per sync. Static (no pulse → loop parks).
    this._hereGeo = new THREE.CircleGeometry(INNER_TRACK * 0.40, 40)
    this._hereMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.32, depthWrite: false })
    this._track(this._hereGeo, this._hereMat)
    this._hereDisc = new THREE.Mesh(this._hereGeo, this._hereMat)
    this._hereDisc.rotation.x = -Math.PI / 2; this._hereDisc.position.y = SURFACE_Y + 0.018
    this._hereDisc.renderOrder = 2; this._hereDisc.visible = false
    host.scene.add(this._hereDisc)

    // "YOU'LL LAND HERE" — a distinct BRIGHT target ring at the destination tile + a pool
    // of small dot markers tracing the path the token will pass over. Driven by the roll
    // slice (syncRoll): appears the moment the roll is known, CLEARS when the move ends.
    // The destination ring PULSES (only while a roll is showing — like the auction ring —
    // so the loop parks once it clears); under reduced motion it's static.
    this._destRing = this._makeRing(0x6fe3ff, 0.95); this._destRing.visible = false // bright cyan — reads as a target, distinct from the gold "here"
    this._destRing.scale.set(1.04, 1.04, 1.04)
    host.scene.add(this._destRing)
    this._rollShowing = false
    // path dot markers (reused; sized for the inner track). A small fixed pool covers a
    // max dice walk of 12 tiles; never grows in the loop.
    this._pathGeo = new THREE.CircleGeometry(INNER_TRACK * 0.12, 20)
    this._pathMat = new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0.8, depthWrite: false })
    this._track(this._pathGeo, this._pathMat)
    this._pathDots = []
    for (let k = 0; k < 12; k++) {
      const d = new THREE.Mesh(this._pathGeo, this._pathMat)
      d.rotation.x = -Math.PI / 2; d.position.y = SURFACE_Y + 0.016; d.renderOrder = 2; d.visible = false
      host.scene.add(d); this._pathDots.push(d)
    }
  }

  _track(...o) { for (const x of o) if (x) this._disposables.add(x) }

  // White square frame (transparent centre) → tinted per-use via material.color.
  _makeFrameTexture() {
    const SZ = 128; const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, SZ, SZ)
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = SZ * 0.12
    const r = SZ * 0.11; const m = SZ * 0.1
    ctx.beginPath(); ctx.roundRect(m, m, SZ - 2 * m, SZ - 2 * m, r); ctx.stroke()
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  _makeRing(color, opacity) {
    const mat = new THREE.MeshBasicMaterial({ map: this._frameTex, color, transparent: true, opacity, depthWrite: false })
    this._track(mat)
    const m = new THREE.Mesh(this._ringGeo, mat)
    m.rotation.x = -Math.PI / 2
    m.position.y = SURFACE_Y + 0.02
    m.renderOrder = 3
    return m
  }

  _placeRing(ring, tile) {
    if (tile == null) { ring.visible = false; return }
    const c = TILE_CENTERS_3D[tile] || TILE_CENTERS_3D[0] // guard: never throw in the rAF loop
    ring.position.set(c.x, SURFACE_Y + 0.02, c.z)
    ring.visible = true
  }

  _entry(tile) {
    let e = this.tiles.get(tile)
    if (!e) {
      // The ring/tint live at the TILE centre (the group stays at the origin, so the
      // absolutely-placed houses in _buildHouses are unaffected). Without this they
      // all collapse onto the board centre — a long-standing bug the old steep camera
      // hid but the clearer framing exposes.
      const c = TILE_CENTERS_3D[tile] || TILE_CENTERS_3D[0]
      const group = new THREE.Group()
      this.host.scene.add(group)
      // ownership ring (own material so colour can be tinted per owner)
      const ringMat = new THREE.MeshBasicMaterial({ map: this._frameTex, color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false })
      this._track(ringMat)
      const ring = new THREE.Mesh(this._ringGeo, ringMat)
      ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, SURFACE_Y + 0.015, c.z); ring.visible = false; ring.renderOrder = 2
      group.add(ring)
      // mortgage tint
      const tintMat = new THREE.MeshBasicMaterial({ color: 0x05080a, transparent: true, opacity: 0.46, depthWrite: false })
      this._track(tintMat)
      const tint = new THREE.Mesh(this._tintGeo, tintMat)
      tint.rotation.x = -Math.PI / 2; tint.position.set(c.x, SURFACE_Y + 0.01, c.z); tint.visible = false; tint.renderOrder = 1
      group.add(tint)
      e = { tile, group, ring, ringMat, tint, ownerKey: null, count: -1, houses: [], hotel: null, popT0: 0, rise: [] }
      this.tiles.set(tile, e)
    }
    return e
  }

  // inward-edge anchor + the perpendicular "along" axis for lining up houses
  _layout(tile) {
    const c = TILE_CENTERS_3D[tile] || TILE_CENTERS_3D[0] // guard: never throw in the rAF loop
    const inw = INWARD[c.side]
    const along = { x: -inw.z, z: inw.x }
    const depth = (c.side === 'top' || c.side === 'bottom') ? c.l : c.w
    const width = (c.side === 'top' || c.side === 'bottom') ? c.w : c.l
    const ax = c.x + inw.x * depth * 0.24
    const az = c.z + inw.z * depth * 0.24
    return { ax, az, along, width }
  }

  _clearBuildings(e) {
    for (const h of e.houses) e.group.remove(h)
    e.houses = []
    if (e.hotel) { e.group.remove(e.hotel); e.hotel = null }
    e.rise = []
    // Keep the entry in _anim if its deed-stamp pop is still running, else update()
    // would never reset the ring scale (frozen at a partial pop).
    if (!e.popT0) this._anim.delete(e)
  }

  _buildHouses(e, count) {
    this._clearBuildings(e)
    const { ax, az, along, width } = this._layout(e.tile)
    const restY = SURFACE_Y + HOUSE / 2
    if (count === 5) {
      const hotel = new THREE.Mesh(this._hotelGeo, this._hotelMat)
      hotel.castShadow = true
      hotel.position.set(ax, restY, az)
      e.group.add(hotel); e.hotel = hotel
      e.rise = [{ mesh: hotel, restY, t0: now() }]
    } else {
      const spacing = Math.min(HOUSE * 1.25, width / (count + 1))
      for (let k = 0; k < count; k++) {
        const off = (k - (count - 1) / 2) * spacing
        const h = new THREE.Mesh(this._houseGeo, this._houseMat)
        h.castShadow = true
        h.position.set(ax + along.x * off, restY, az + along.z * off)
        e.group.add(h); e.houses.push(h)
      }
      e.rise = e.houses.map((mesh) => ({ mesh, restY, t0: now() }))
    }
    // Meshes are created at restY with scale 1, so reduced motion just skips the
    // grow-in (no _anim entry → nothing to animate).
    if (e.rise.length) { if (this.host.reducedMotion) e.rise = []; else this._anim.add(e) }
  }

  sync(properties, playerColor, activeTile, auctionTile, activeColor) {
    const seen = new Set()
    for (const p of (properties || [])) {
      const tile = p.tile_index
      if (tile == null) continue
      seen.add(tile)
      const e = this._entry(tile)

      // ownership ring (+ deed-stamp pop on change)
      const ownerKey = p.owner || null
      if (ownerKey !== e.ownerKey) {
        e.ownerKey = ownerKey
        if (ownerKey) {
          e.ringMat.color.set(playerColor?.[ownerKey] || '#ffffff')
          e.ring.visible = true
          if (this.host.reducedMotion) { e.ring.scale.set(1, 1, 1) }
          else { e.popT0 = now(); this._anim.add(e) }
        } else {
          e.ring.visible = false
        }
      }

      // houses / hotel
      const count = Math.max(0, Math.min(5, p.houses || 0))
      if (count !== e.count) { e.count = count; this._buildHouses(e, count) }

      // mortgage tint
      e.tint.visible = !!p.mortgaged
    }
    // tiles no longer present (shouldn't happen — the 28 property rows are stable —
    // but stay symmetric with tokens3d._remove: free this tile's own materials).
    for (const [tile, e] of this.tiles) if (!seen.has(tile)) {
      this.host.scene.remove(e.group)
      for (const m of [e.ringMat, e.tint.material]) { m.dispose(); this._disposables.delete(m) }
      this._anim.delete(e)
      this.tiles.delete(tile)
    }

    // "You are here": bold the active tile in the active player's colour (the gold
    // default reads as "highlight"; their colour reads as "this is MY piece's tile").
    const hereHex = activeColor || '#ffd36a'
    this._activeRing.material.color.set(hereHex)
    this._hereMat.color.set(hereHex)
    this._placeRing(this._activeRing, activeTile)
    if (activeTile == null) { this._hereDisc.visible = false } else {
      const c = TILE_CENTERS_3D[activeTile] || TILE_CENTERS_3D[0]
      this._hereDisc.position.set(c.x, SURFACE_Y + 0.018, c.z); this._hereDisc.visible = true
    }
    this._auctionTile = auctionTile ?? null
    this._placeRing(this._auctionRing, this._auctionTile)
    this.host.invalidate()
  }

  // Drive the "you'll land here" destination ring + path dots from the roll slice.
  // roll = { show, to, path, active } (path excludes the origin, includes the dest).
  // playerColor maps id→hex but the target is intentionally a BRIGHT distinct colour
  // (cyan) so it never blends with the player-coloured "here" pin. Pure read; transient.
  syncRoll(roll, _playerColor) {
    const show = !!(roll && roll.show && roll.to != null)
    this._rollShowing = show
    if (!show) {
      this._destRing.visible = false
      for (const d of this._pathDots) d.visible = false
      this.host.invalidate()
      return
    }
    this._placeRing(this._destRing, roll.to)
    // path dots on each passed tile EXCEPT the destination (the ring marks that).
    const path = Array.isArray(roll.path) ? roll.path : []
    let di = 0
    for (let i = 0; i < path.length && di < this._pathDots.length; i++) {
      const tile = path[i]
      if (tile === roll.to) continue
      const c = TILE_CENTERS_3D[tile] || TILE_CENTERS_3D[0]
      const dot = this._pathDots[di++]
      dot.position.set(c.x, SURFACE_Y + 0.016, c.z); dot.visible = true
    }
    for (; di < this._pathDots.length; di++) this._pathDots[di].visible = false
    this.host.invalidate()
  }

  update(t) {
    let animating = false
    for (const e of [...this._anim]) {
      let active = false
      // deed-stamp pop on the ownership ring
      if (e.popT0) {
        const k = (t - e.popT0) / POP_MS
        if (k >= 1) { e.popT0 = 0; e.ring.scale.set(1, 1, 1) }
        else { const s = easeOutBack(Math.min(k, 1)); e.ring.scale.set(s, s, s); active = true }
      }
      // grow-in of houses/hotel
      if (e.rise.length) {
        let any = false
        for (const r of e.rise) {
          const k = (t - r.t0) / RISE_MS
          if (k >= 1) { r.mesh.scale.set(1, 1, 1); r.mesh.position.y = r.restY }
          else { const s = easeOutBack(Math.min(k, 1)); r.mesh.scale.set(s, s, s); r.mesh.position.y = r.restY * (0.4 + 0.6 * easeOutCubic(Math.min(k, 1))); any = true }
        }
        if (any) active = true; else e.rise = []
      }
      if (active) animating = true; else this._anim.delete(e)
    }
    // pulsing auction ring (only while an auction is live → parking otherwise unaffected).
    // Under reduced motion: a STATIC ring (no per-frame pulse, so the loop can still park).
    if (this._auctionRing.visible) {
      if (this.host.reducedMotion) this._auctionRing.material.opacity = 0.8
      else { this._auctionRing.material.opacity = 0.5 + 0.35 * (0.5 + 0.5 * Math.sin(t * 0.006)); animating = true }
    }
    // pulsing destination "land here" ring — ONLY while a roll is showing (it clears when
    // the move ends, so the loop parks). Static under reduced motion (no pulse → parks).
    if (this._destRing.visible && this._rollShowing) {
      if (this.host.reducedMotion) this._destRing.material.opacity = 0.95
      else { this._destRing.material.opacity = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.008)); animating = true }
    }
    return animating
  }

  // Settle every in-flight grow-in / pop instantly (called when reduced motion turns on).
  snapAll() {
    for (const e of this._anim) {
      if (e.popT0) { e.popT0 = 0; e.ring.scale.set(1, 1, 1) }
      for (const r of e.rise) { r.mesh.scale.set(1, 1, 1); r.mesh.position.y = r.restY }
      e.rise = []
    }
    this._anim.clear()
    if (this._auctionRing.visible) this._auctionRing.material.opacity = 0.8
    if (this._destRing.visible) this._destRing.material.opacity = 0.95 // freeze static — no pulse under reduced motion
  }

  dispose() {
    for (const e of this.tiles.values()) this.host.scene.remove(e.group)
    this.tiles.clear(); this._anim.clear()
    this.host.scene.remove(this._activeRing); this.host.scene.remove(this._auctionRing)
    this.host.scene.remove(this._hereDisc); this.host.scene.remove(this._destRing)
    for (const d of this._pathDots) this.host.scene.remove(d)
    this._pathDots = []
    for (const o of this._disposables) { try { o.dispose?.() } catch { /* gone */ } }
    this._disposables.clear()
  }
}
