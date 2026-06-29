// ============================================================================
// Scene3D — framework-agnostic Three.js renderer core for the Monopoly board.
//
// Owns the renderer, camera, lighting, the felt ground, and the board slab with
// its baked face. Subsystems (tokens / dice / buildings) attach in later phases
// via the `scene` + `camera` + `invalidate()` it exposes. No React in here.
//
// Render-on-demand: the rAF loop only calls renderer.render when something is
// dirty or a tween is running, so an idle board costs ~0 GPU. invalidate() marks
// a redraw; pushTween()/popTween() keep the loop drawing while animating. The
// loop pauses entirely when the canvas is offscreen or the tab is hidden.
// ============================================================================
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { paintBoardCanvas } from './boardTexture.js'
import TokenField from './tokens3d.js'
import DicePair from './dice3d.js'
import BuildingsLayer from './buildings3d.js'
import {
  BOARD, BOARD_HALF, BOARD_THICKNESS, SURFACE_Y, TILE_CENTERS_3D, tileAtWorld,
} from './coords3d.js'

const TEX_SIZE = 2048
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)

// Resting camera framing (tuned for the board to fill the frame at a ~48° tilt).
const CAM_REST = { x: 0, y: 9.6, z: 9.0 }
const CAM_TARGET = { x: 0, y: 0, z: 0.4 }

export default class Scene3D {
  constructor({ reducedMotion = false, lang = 'en', onContextLost = null, preserveDrawingBuffer = false } = {}) {
    this.reducedMotion = reducedMotion
    this.lang = lang
    this.onContextLost = onContextLost
    this._preserveDrawingBuffer = preserveDrawingBuffer // dev-only: keeps frames capturable

    this.canvas = null
    this.renderer = null
    this.scene = null
    this.camera = null
    this.raycaster = new THREE.Raycaster()
    this._faceMesh = null
    this._tokens = null // TokenField (Phase 1)
    this._dice = null // DicePair (Phase 2)
    this._buildings = null // BuildingsLayer (Phase 3)
    this._followX = CAM_TARGET.x // eased camera look-at (camera follows the active token)
    this._followZ = CAM_TARGET.z
    this._disposables = new Set() // geometries/materials/textures to free on teardown

    this._raf = 0
    this._dirty = true
    this._tweens = 0 // >0 → keep rendering each frame
    this._visible = true
    this._mounted = false
    this._introUntil = 0

    this._ro = null
    this._io = null
    this._onVisibility = null
    this._onLost = null
    this._onRestored = null
  }

  // -------------------------------------------------------------- lifecycle
  mount(canvas) {
    if (!canvas) return
    if (this._mounted && this.renderer) return // idempotent — a 2nd mount would leak the first
    this.canvas = canvas
    this._mounted = true

    // WebGLRenderer's constructor can still throw (GPU reset, too many live
    // contexts after rapid route churn) even after capability.js's cheap probe
    // passed — route that to the 2D fallback instead of a dead canvas.
    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', preserveDrawingBuffer: this._preserveDrawingBuffer })
    } catch {
      this._mounted = false
      this.onContextLost?.()
      return
    }
    renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap // PCFSoftShadowMap deprecated in r185; softening via shadow.radius
    this.renderer = renderer

    const scene = new THREE.Scene()
    this.scene = scene

    const camera = new THREE.PerspectiveCamera(44, 1, 0.1, 120)
    camera.position.set(CAM_REST.x, CAM_REST.y, CAM_REST.z)
    camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
    this.camera = camera

    this._buildLights()
    this._buildGround()
    this._buildBoard()
    this._tokens = new TokenField(this) // host = this (provides scene/invalidate/pushTween/popTween)
    this._dice = new DicePair(this)
    this._buildings = new BuildingsLayer(this)

    // sizing + visibility + context-loss
    this._installObservers()
    this.resize()

    // reveal: a short camera ease unless reduced-motion
    if (!this.reducedMotion) {
      this._introUntil = now() + 850
      camera.position.set(CAM_REST.x, CAM_REST.y + 3.2, CAM_REST.z + 2.6)
    }
    this._loop()
  }

  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x2a2118, 0.7)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff2d8, 1.15)
    key.position.set(6.5, 15, 7.5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 4
    key.shadow.camera.far = 40
    const s = 9
    key.shadow.camera.left = -s; key.shadow.camera.right = s
    key.shadow.camera.top = s; key.shadow.camera.bottom = -s
    key.shadow.bias = -0.0005
    key.shadow.radius = 4
    this.scene.add(key)
    this.scene.add(key.target)

    const ambient = new THREE.AmbientLight(0xffffff, 0.18)
    this.scene.add(ambient)

    // Track for deterministic teardown: DirectionalLight.dispose() frees its 2048²
    // shadow render target — otherwise that GPU memory rides on forceContextLoss alone.
    this._track(hemi, key, ambient)
  }

  _buildGround() {
    const geo = new THREE.PlaneGeometry(80, 80)
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a120d, roughness: 1, metalness: 0 })
    const ground = new THREE.Mesh(geo, mat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -BOARD_THICKNESS / 2 - 0.02
    ground.receiveShadow = true
    this.scene.add(ground)
    this._track(geo, mat)
  }

  _buildBoard() {
    // base slab (slightly larger than the tile face → a physical border)
    const rim = 0.62
    const baseGeo = new RoundedBoxGeometry(BOARD + rim, BOARD_THICKNESS, BOARD + rim, 4, 0.12)
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x12201a, roughness: 0.7, metalness: 0.15 })
    const base = new THREE.Mesh(baseGeo, baseMat)
    base.castShadow = true
    base.receiveShadow = true
    this.scene.add(base)
    this._track(baseGeo, baseMat)

    // gold frame ring (4 thin bars just outside the tile face)
    const fw = 0.17; const fh = 0.10
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.34, metalness: 0.75 })
    this._track(goldMat)
    const frameY = SURFACE_Y + fh / 2 - 0.01
    const edge = BOARD_HALF + fw / 2
    const bars = [
      [BOARD + 2 * fw, fh, fw, 0, frameY, -edge],
      [BOARD + 2 * fw, fh, fw, 0, frameY, edge],
      [fw, fh, BOARD + 2 * fw, -edge, frameY, 0],
      [fw, fh, BOARD + 2 * fw, edge, frameY, 0],
    ]
    for (const [w, h, d, x, y, z] of bars) {
      const g = new THREE.BoxGeometry(w, h, d)
      const m = new THREE.Mesh(g, goldMat)
      m.position.set(x, y, z)
      m.castShadow = true
      this.scene.add(m)
      this._track(g)
    }

    // baked board face
    const canvas = (typeof document !== 'undefined') ? document.createElement('canvas') : null
    let mat
    if (canvas) {
      canvas.width = TEX_SIZE; canvas.height = TEX_SIZE
      const ctx = canvas.getContext('2d')
      paintBoardCanvas(ctx, TEX_SIZE, this.lang)
      const tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy()
      tex.needsUpdate = true
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, metalness: 0.02 })
      this._track(tex)
    } else {
      mat = new THREE.MeshStandardMaterial({ color: 0xf0e9d6, roughness: 0.9 })
    }
    const faceGeo = new THREE.PlaneGeometry(BOARD, BOARD)
    const face = new THREE.Mesh(faceGeo, mat)
    face.rotation.x = -Math.PI / 2
    face.position.y = SURFACE_Y + 0.004
    face.receiveShadow = true
    this.scene.add(face)
    this._faceMesh = face
    this._track(faceGeo, mat)
  }

  // ----------------------------------------------------------------- public
  setReducedMotion(b) {
    this.reducedMotion = !!b
    // Turning reduced-motion ON mid-flight should snap everything to its end state.
    if (this.reducedMotion && this.camera) {
      if (this._introUntil > 0) {
        this._introUntil = 0
        this.camera.position.set(CAM_REST.x, CAM_REST.y, CAM_REST.z)
      }
      // snap the camera-follow look-at to centre (no easing)
      this._followX = CAM_TARGET.x; this._followZ = CAM_TARGET.z
      this.camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
      // settle any in-flight subsystem tweens
      this._tokens?.snapAll()
      this._dice?.snapAll()
      this._buildings?.snapAll()
    }
    this.invalidate()
  }

  // Feed the animator's token slice + the player list to the 3D pieces (Phase 1).
  syncTokens(tok, players) {
    if (this._tokens && tok && Array.isArray(players)) this._tokens.sync(tok, players)
  }

  // Feed the animator's dice slice to the 3D dice (Phase 2).
  syncDice(d) { if (this._dice && d) this._dice.sync(d) }

  // Feed property rows + derived maps to the buildings / tile-state layer (Phase 3).
  syncBuildings(properties, playerColor, activeTile, auctionTile) {
    if (this._buildings) this._buildings.sync(properties, playerColor, activeTile, auctionTile)
  }

  // Ease the camera's look-at toward the active token's tile (a gentle "follow").
  // Returns true while still easing. Disabled under reduced motion (fixed framing).
  _updateFollow() {
    let gx = CAM_TARGET.x; let gz = CAM_TARGET.z
    const tile = this._tokens?.activeTile
    if (tile != null && !this.reducedMotion) {
      // Subtle bias toward the active tile — enough to "follow", not so much it
      // rotates/crops the board out of frame. Guard the index (a sentinel/out-of-range
      // value must never throw inside the rAF loop and kill the scene).
      const c = TILE_CENTERS_3D[tile] || TILE_CENTERS_3D[0]
      gx = c.x * 0.18
      gz = CAM_TARGET.z + c.z * 0.18
    }
    const dx = gx - this._followX; const dz = gz - this._followZ
    if (Math.abs(dx) < 1e-3 && Math.abs(dz) < 1e-3) {
      if (this._followX !== gx || this._followZ !== gz) { this._followX = gx; this._followZ = gz; this.camera.lookAt(this._followX, 0, this._followZ) }
      return false
    }
    this._followX += dx * 0.08; this._followZ += dz * 0.08
    this.camera.lookAt(this._followX, 0, this._followZ)
    return true
  }

  invalidate() { this._dirty = true; this._wake() }
  // Synchronous one-shot render (bypasses rAF — used by the dev harness where the
  // headless tab pauses requestAnimationFrame).
  forceRender() {
    if (!this.renderer || !this.scene || !this.camera) return
    this._tickCamera()
    if (this._introUntil === 0) this._updateFollow()
    this._tokens?.update(now())
    this._dice?.update(now())
    this._buildings?.update(now())
    this.renderer.render(this.scene, this.camera)
    this._dirty = false
  }
  pushTween() { this._tweens++; this._wake() }
  popTween() { this._tweens = Math.max(0, this._tweens - 1); this.invalidate() }

  // Diagnostic: last frame's draw stats + buffer size (used by the dev harness).
  renderStats() {
    const info = this.renderer?.info?.render
    return {
      calls: info?.calls ?? 0,
      triangles: info?.triangles ?? 0,
      drawW: this.renderer?.domElement?.width ?? 0,
      drawH: this.renderer?.domElement?.height ?? 0,
      parked: this._raf === 0,
    }
  }

  resize() {
    if (!this.renderer || !this.canvas) return
    const parent = this.canvas.parentElement
    const w = (parent?.clientWidth || this.canvas.clientWidth || 0)
    const h = (parent?.clientHeight || this.canvas.clientHeight || 0)
    if (w === 0 || h === 0) return // 0×0 mount (preview gotcha) — wait for a real size
    // Re-apply the DPR cap so moving the window to another-density monitor / zoom is picked up.
    this.renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, 2))
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.invalidate()
  }

  // ndc in [-1,1] → perimeter tile index or null
  raycast(ndcX, ndcY) {
    if (!this._faceMesh || !this.camera) return null
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera)
    const hit = this.raycaster.intersectObject(this._faceMesh, false)[0]
    if (!hit) return null
    return tileAtWorld(hit.point.x, hit.point.z)
  }

  // world Vec3-like {x,y,z} → screen px relative to the canvas. `visible` is false
  // when the point is behind the camera (NDC z>1), where x/y mirror and are bogus —
  // DOM overlays (money floats, later phase) should hide on !visible.
  project(p) {
    if (!this.camera || !this.canvas) return { x: 0, y: 0, visible: false }
    const v = new THREE.Vector3(p.x, p.y, p.z).project(this.camera)
    const r = this.canvas.getBoundingClientRect()
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 }
  }

  // --------------------------------------------------------------- internals
  _installObservers() {
    if (typeof ResizeObserver !== 'undefined' && this.canvas?.parentElement) {
      this._ro = new ResizeObserver(() => this.resize())
      this._ro.observe(this.canvas.parentElement)
    }
    if (typeof IntersectionObserver !== 'undefined' && this.canvas) {
      this._io = new IntersectionObserver((entries) => {
        const e = entries[0]
        this._visible = !!e && e.isIntersecting
        if (this._visible) this.invalidate()
      })
      this._io.observe(this.canvas)
    }
    if (typeof document !== 'undefined') {
      this._onVisibility = () => { if (!document.hidden) this.invalidate() }
      document.addEventListener('visibilitychange', this._onVisibility)
    }
    if (this.canvas) {
      this._onLost = (e) => { e.preventDefault(); this._stopLoop(); this.onContextLost?.() }
      // onContextLost makes React fall back to 2D + unmount us; only resume if we're
      // still mounted (a transient loss the app didn't abandon).
      this._onRestored = () => { if (this._mounted) { this.invalidate() } }
      this.canvas.addEventListener('webglcontextlost', this._onLost, false)
      this.canvas.addEventListener('webglcontextrestored', this._onRestored, false)
    }
  }

  _tickCamera() {
    if (this._introUntil <= 0) return false
    const t = now()
    if (t >= this._introUntil) {
      this.camera.position.set(CAM_REST.x, CAM_REST.y, CAM_REST.z)
      this.camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
      this._introUntil = 0
      return false
    }
    const k = 1 - (this._introUntil - t) / 850 // 0→1
    const e = 1 - Math.pow(1 - k, 3) // easeOutCubic
    this.camera.position.set(
      CAM_REST.x,
      CAM_REST.y + 3.2 * (1 - e),
      CAM_REST.z + 2.6 * (1 - e),
    )
    this.camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
    return true
  }

  // Wake the render loop for at least one frame (called by invalidate / observers).
  _wake() {
    const hidden = typeof document !== 'undefined' && document.hidden
    if (!this._mounted || !this._visible || hidden || !this.renderer) return
    if (!this._raf) this._loop()
  }

  _loop() {
    cancelAnimationFrame(this._raf)
    const frame = () => {
      const hidden = typeof document !== 'undefined' && document.hidden
      if (!this._mounted || !this._visible || hidden || !this.renderer) { this._raf = 0; return }
      const t = now()
      const introMoving = this._tickCamera()
      const followMoving = this._introUntil === 0 ? this._updateFollow() : false
      const tokMoving = this._tokens ? this._tokens.update(t) : false
      const diceMoving = this._dice ? this._dice.update(t) : false
      const bldMoving = this._buildings ? this._buildings.update(t) : false
      if (this._dirty || this._tweens > 0 || introMoving || followMoving || tokMoving || diceMoving || bldMoving) {
        this.renderer.render(this.scene, this.camera)
        this._dirty = false
      }
      // Keep the loop alive only while something is animating; otherwise PARK
      // (a perpetual idle rAF wastes GPU and keeps "page idle" waiters — e.g. the
      // screenshot tool — from ever settling). invalidate()/observers re-wake it.
      // NB the active-token glow + active ring are STATIC (no per-frame pulse) so this can park;
      // the auction ring pulses, but only during the brief auction phase.
      if (this._tweens > 0 || this._introUntil > 0 || followMoving || tokMoving || diceMoving || bldMoving) this._raf = requestAnimationFrame(frame)
      else this._raf = 0
    }
    this._raf = requestAnimationFrame(frame)
  }

  _stopLoop() { cancelAnimationFrame(this._raf); this._raf = 0 }

  _track(...objs) { for (const o of objs) if (o) this._disposables.add(o) }

  dispose() {
    this._mounted = false
    this._stopLoop()
    this._ro?.disconnect(); this._ro = null
    this._io?.disconnect(); this._io = null
    if (this._onVisibility && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVisibility)
    if (this.canvas) {
      if (this._onLost) this.canvas.removeEventListener('webglcontextlost', this._onLost)
      if (this._onRestored) this.canvas.removeEventListener('webglcontextrestored', this._onRestored)
    }
    try { this._tokens?.dispose() } catch { /* gone */ }
    this._tokens = null
    try { this._dice?.dispose() } catch { /* gone */ }
    this._dice = null
    try { this._buildings?.dispose() } catch { /* gone */ }
    this._buildings = null
    for (const o of this._disposables) {
      try { o.dispose?.() } catch { /* already gone */ }
    }
    this._disposables.clear()
    if (this.scene) { this.scene.clear() }
    try { this.renderer?.dispose() } catch { /* noop */ }
    try { this.renderer?.forceContextLoss?.() } catch { /* noop */ }
    this.renderer = null; this.scene = null; this.camera = null; this._faceMesh = null; this.canvas = null
  }
}
