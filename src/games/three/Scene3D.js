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
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { VignetteShader } from 'three/examples/jsm/shaders/VignetteShader.js'
import { paintBoardCanvas } from './boardTexture.js'
import TokenField from './tokens3d.js'
import DicePair from './dice3d.js'
import BuildingsLayer from './buildings3d.js'
import {
  BOARD, BOARD_HALF, BOARD_THICKNESS, SURFACE_Y, TOKEN_HEIGHT, TILE_CENTERS_3D, tileAtWorld,
} from './coords3d.js'

const TEX_SIZE = 2048
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)

// Resting camera framing. A LONGER lens (narrow FOV) sat FARTHER back flattens the
// near→far tile-size disparity (the old 44°/short-lens framing shrank the back row
// to an illegible sliver) while keeping a premium 3/4 "official board game" tilt.
const CAM_REST = { x: 0, y: 11.7, z: 10.6 }
const CAM_TARGET = { x: 0, y: 0, z: 0.25 }
// How far the camera pulls up/back for the intro reveal ease (scaled with the framing).
const INTRO_DY = 3.7
const INTRO_DZ = 3.0

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
    this._faceTex = null // baked board CanvasTexture (re-baked after webfonts load — C)
    this._faceCanvas = null
    this._tokens = null // TokenField (Phase 1)
    this._dice = null // DicePair (Phase 2)
    this._buildings = null // BuildingsLayer (Phase 3)
    this._followX = CAM_TARGET.x // eased camera look-at (camera follows the active token)
    this._followZ = CAM_TARGET.z
    this._fit = 1 // distance multiplier (>=1) computed per-resize so the WHOLE board fits the container aspect
    this._disposables = new Set() // geometries/materials/textures to free on teardown

    // Post-processing (A2): composer + its passes. composer===null → plain render
    // (soft degrade; never routed to onContextLost). _envRT is the IBL render target.
    this.composer = null
    this._bloomPass = null
    this._vignettePass = null
    this._outputPass = null
    this._envRT = null

    // Cinematic camera moments (A4): additive offsets on the fitted rest pose, all
    // eased/decayed so they settle back home and the loop can PARK. Zeroed under
    // reduced motion. _zoom = roll dolly-in (0..1); _punchT0 = dice-land spring impulse;
    // _focusBoostUntil = brief stronger look-at bias toward the landing tile.
    this._zoomCur = 0
    this._zoomTarget = 0
    this._punchT0 = 0
    this._focusBoostUntil = 0

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
    renderer.toneMappingExposure = 0.95 // trimmed from 1.05 so the cream board doesn't blow out under IBL + bloom
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap // PCFSoftShadowMap deprecated in r185; softening via shadow.radius
    this.renderer = renderer

    const scene = new THREE.Scene()
    this.scene = scene

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120)
    camera.position.set(CAM_REST.x, CAM_REST.y, CAM_REST.z)
    camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
    this.camera = camera

    this._buildEnvironment() // IBL (procedural RoomEnvironment) — flatters the gold/metal
    this._buildLights()
    this._buildGround()
    this._buildBoard()
    this._tokens = new TokenField(this) // host = this (provides scene/invalidate/pushTween/popTween)
    this._dice = new DicePair(this)
    this._buildings = new BuildingsLayer(this)

    // sizing + visibility + context-loss
    this._installObservers()
    this.resize()
    this._buildComposer() // post-processing (bloom + vignette + ACES output) — after the first resize() so the RTs match the canvas

    // reveal: a short camera ease unless reduced-motion (resize() above already
    // computed _fit, so _restPos() reflects the real container aspect).
    if (!this.reducedMotion) {
      this._introUntil = now() + 850
      const r = this._restPos()
      camera.position.set(r.x, r.y + INTRO_DY, r.z + INTRO_DZ)
    }
    this._loop()
  }

  _buildLights() {
    // Re-balanced for IBL (A1): the RoomEnvironment now carries most of the fill, so
    // the analytic rig is dialled back to avoid double-lighting. The key stays the
    // SOLE shadow caster (IBL gives no sharp shadows).
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x2a2118, 0.35)
    this.scene.add(hemi)

    const key = new THREE.DirectionalLight(0xfff2d8, 1.0)
    key.position.set(6.5, 15, 7.5)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 4
    key.shadow.camera.far = 40
    const s = 9
    key.shadow.camera.left = -s; key.shadow.camera.right = s
    key.shadow.camera.top = s; key.shadow.camera.bottom = -s
    // Small high-curvature metal tokens (metalness 0.9) stress shadow acne more than
    // the flat slab → a slightly deeper bias + a normalBias to push the comparison off
    // the silhouette.
    key.shadow.bias = -0.0006
    key.shadow.normalBias = 0.02
    key.shadow.radius = 4
    this.scene.add(key)
    this.scene.add(key.target)

    const ambient = new THREE.AmbientLight(0xffffff, 0.10)
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
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x12201a, roughness: 0.6, metalness: 0.15, envMapIntensity: 0.8 })
    const base = new THREE.Mesh(baseGeo, baseMat)
    base.castShadow = true
    base.receiveShadow = true
    this.scene.add(base)
    this._track(baseGeo, baseMat)

    // gold frame ring (4 thin bars just outside the tile face)
    const fw = 0.17; const fh = 0.10
    const goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.30, metalness: 0.75, envMapIntensity: 1.1 })
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
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.02, envMapIntensity: 0.6 })
      this._faceTex = tex // kept so C can re-bake after fonts load
      this._faceCanvas = canvas
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
    this._rebakeOnFonts() // C: re-paint with the bundled webfonts once they resolve
  }

  // The baked board uses bundled webfonts (Cairo / Plus Jakarta Sans). They may not be
  // ready at first paint (the canvas bakes once at mount), so re-bake when they resolve.
  // Guarded so a teardown mid-load is a no-op.
  _rebakeOnFonts() {
    if (typeof document === 'undefined' || !document.fonts || !this._faceCanvas || !this._faceTex) return
    const repaint = () => {
      if (!this._faceCanvas || !this._faceTex || !this.renderer) return
      try {
        const ctx = this._faceCanvas.getContext('2d')
        ctx.clearRect(0, 0, TEX_SIZE, TEX_SIZE)
        paintBoardCanvas(ctx, TEX_SIZE, this.lang)
        this._faceTex.needsUpdate = true
        this.invalidate()
      } catch { /* canvas gone */ }
    }
    // CRITICAL: canvas text does NOT trigger webfont loading, and document.fonts.ready
    // only waits on faces the DOM already requested. The board leans on the 700/800
    // DISPLAY weights that nothing in the DOM uses, so ready alone would resolve and we
    // would still bake faux-bold. Explicitly load every family+weight we draw with, THEN
    // re-bake. (Arabic glyphs come from Cairo via the same faces.)
    const wanted = [
      '400 1em "Plus Jakarta Sans"', '700 1em "Plus Jakarta Sans"', '800 1em "Plus Jakarta Sans"',
      '400 1em "Cairo"', '700 1em "Cairo"', '800 1em "Cairo"',
    ]
    Promise.all(wanted.map((f) => document.fonts.load(f).catch(() => {}))).then(repaint, () => {})
    // and re-bake again once everything settles (covers any face still in flight)
    document.fonts.ready.then(repaint, () => {})
  }

  // Image-based lighting from a procedural studio room (no asset file → deterministic
  // for the screenshot harness, robust offline). Wrapped: IBL is a bonus, never blocks
  // mount. scene.background stays null so the canvas is transparent over the CSS void;
  // cinematic edge darkness comes from the vignette, not a background.
  _buildEnvironment() {
    if (!this.renderer || !this.scene) return
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      this._envRT = pmrem.fromScene(new RoomEnvironment(), 0.04)
      this.scene.environment = this._envRT.texture
      pmrem.dispose() // free the generator's scratch RTs immediately; _envRT lives on
    } catch {
      this._envRT = null
    }
  }

  // Post-processing chain: RenderPass (linear HDR) → bloom (selective via a high
  // threshold) → vignette → OutputPass (the single ACES + sRGB conversion, reading the
  // renderer's toneMapping/exposure/outputColorSpace). try/caught → composer=null
  // transparently degrades to the plain-render path (IBL + materials still apply).
  _buildComposer() {
    if (!this.renderer || !this.scene || !this.camera) return
    try {
      const size = this.renderer.getSize(new THREE.Vector2())
      const w = Math.max(1, size.x); const h = Math.max(1, size.y)
      const composer = new EffectComposer(this.renderer) // auto HalfFloat RGBA RT → HDR + alpha preserved
      composer.setPixelRatio(this.renderer.getPixelRatio())
      composer.setSize(w, h)
      composer.addPass(new RenderPass(this.scene, this.camera))
      // strength, radius, threshold — the HIGH threshold IS the selective-bloom
      // mechanism. Verified in the harness: at 0.82 the bright cream board itself
      // bloomed and washed out; at 1.0 only genuine HDR highlights (specular gold
      // trim, the active gold glow, dice glints) push above it and bloom.
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.5, 1.0)
      composer.addPass(bloom)
      const vignette = new ShaderPass(VignetteShader)
      vignette.uniforms.offset.value = 0.95
      vignette.uniforms.darkness.value = 1.05
      composer.addPass(vignette)
      const output = new OutputPass() // MUST be last — consumes renderer tone-map/colour-space
      composer.addPass(output)
      this.composer = composer
      this._bloomPass = bloom
      this._vignettePass = vignette
      this._outputPass = output
    } catch {
      this.composer = null // soft degrade — NOT a context loss
    }
  }

  // One composed frame when the composer is up, else the plain render. Used by both
  // the rAF loop and the synchronous forceRender (dev harness). renderer.info still
  // populates either way → renderStats() unaffected.
  _draw() {
    if (this.composer) this.composer.render()
    else this.renderer.render(this.scene, this.camera)
  }

  // ----------------------------------------------------------------- public
  setReducedMotion(b) {
    this.reducedMotion = !!b
    // Turning reduced-motion ON mid-flight should snap everything to its end state.
    if (this.reducedMotion && this.camera) {
      if (this._introUntil > 0) {
        this._introUntil = 0
        const r = this._restPos()
        this.camera.position.set(r.x, r.y, r.z)
      }
      // snap the camera-follow look-at to centre (no easing)
      this._followX = CAM_TARGET.x; this._followZ = CAM_TARGET.z
      this.camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
      // zero any in-flight cinematic camera moments + pin to the fitted rest pose
      this._zoomCur = 0; this._zoomTarget = 0; this._punchT0 = 0; this._focusBoostUntil = 0
      if (this._introUntil === 0) { const rp = this._restPos(); this.camera.position.set(rp.x, rp.y, rp.z) }
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
    // focusTile() (A4) briefly sharpens the bias when the active token's hop lands.
    const boosted = now() < this._focusBoostUntil
    if (tile != null && !this.reducedMotion) {
      // Subtle bias toward the active tile — enough to "follow", not so much it
      // rotates/crops the board out of frame. Guard the index (a sentinel/out-of-range
      // value must never throw inside the rAF loop and kill the scene).
      const c = TILE_CENTERS_3D[tile] || TILE_CENTERS_3D[0]
      const bias = boosted ? 0.30 : 0.18
      gx = c.x * bias
      gz = CAM_TARGET.z + c.z * bias
    }
    const dx = gx - this._followX; const dz = gz - this._followZ
    if (Math.abs(dx) < 1e-3 && Math.abs(dz) < 1e-3) {
      if (this._followX !== gx || this._followZ !== gz) { this._followX = gx; this._followZ = gz; this.camera.lookAt(this._followX, 0, this._followZ) }
      // Keep the loop alive while the boost window is open so its expiry eases back.
      return boosted
    }
    this._followX += dx * 0.08; this._followZ += dz * 0.08
    this.camera.lookAt(this._followX, 0, this._followZ)
    return true
  }

  // --------------------------------------------------- cinematic camera moments (A4)
  // All additive on the fitted rest pose so they ALWAYS ease back home; all no-ops
  // under reduced motion. Each calls _wake() so a parked loop resumes for the moment.
  pushIn() { if (this.reducedMotion) return; this._zoomTarget = 1; this._wake() }
  releaseZoom() { this._zoomTarget = 0; this._wake() }
  cameraPunch() { if (this.reducedMotion) return; this._punchT0 = now(); this._wake() }
  focusTile() { if (this.reducedMotion) return; this._focusBoostUntil = now() + 700; this._wake() }

  // Apply the zoom dolly-in + dice-land punch to camera.position (relative to the
  // fitted rest pose). Returns true while still settling so _loop keeps the frame alive
  // and then PARKS. Called only after the intro ease completes.
  _applyCameraMoments(t) {
    if (this.reducedMotion || this._introUntil > 0 || !this.camera) return false
    // ease the roll dolly toward its target
    this._zoomCur += (this._zoomTarget - this._zoomCur) * 0.10
    if (Math.abs(this._zoomCur - this._zoomTarget) < 0.002) this._zoomCur = this._zoomTarget
    // decaying spring impulse for the dice landing ("nudge", not shake)
    let punchY = 0; let punchActive = false
    if (this._punchT0) {
      const age = (t - this._punchT0) / 1000
      if (age >= 0.6) this._punchT0 = 0
      else { punchY = 0.13 * Math.exp(-7 * age) * Math.cos(26 * age); punchActive = true }
    }
    const zoomActive = Math.abs(this._zoomCur) > 0.002 || this._zoomTarget !== 0
    const r = this._restPos()
    if (!zoomActive && !punchActive) {
      // settled → pin exactly to the rest pose once, then let the loop park
      this.camera.position.set(r.x, r.y, r.z)
      return false
    }
    const z = 0.09 * this._zoomCur // up to ~9% closer to the target on a roll
    this.camera.position.set(
      r.x + (CAM_TARGET.x - r.x) * z,
      r.y + (CAM_TARGET.y - r.y) * z + punchY,
      r.z + (CAM_TARGET.z - r.z) * z,
    )
    return zoomActive || punchActive
  }

  invalidate() { this._dirty = true; this._wake() }
  // Synchronous one-shot render (bypasses rAF — used by the dev harness where the
  // headless tab pauses requestAnimationFrame).
  forceRender() {
    if (!this.renderer || !this.scene || !this.camera) return
    this._tickCamera()
    if (this._introUntil === 0) { this._applyCameraMoments(now()); this._updateFollow() }
    this._tokens?.update(now())
    this._dice?.update(now())
    this._buildings?.update(now())
    this._draw()
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
    // Keep the post-processing RTs locked to the renderer (DPR + size), incl. bloom's
    // own mip-chain target. No-op when the composer failed to build (plain-render path).
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio())
      this.composer.setSize(w, h)
      this._bloomPass?.setSize(w, h)
    }
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    // Re-fit the framing to the new aspect so the near corners + corner tokens never
    // crop off the sides (a fixed FOV alone clips them on square/narrow panels).
    this._computeFit()
    if (this._introUntil === 0) {
      const r = this._restPos()
      this.camera.position.set(r.x, r.y, r.z)
      this.camera.lookAt(this._followX, 0, this._followZ)
    }
    this.invalidate()
  }

  // Distance multiplier so the board's four corners (incl. gold frame) + a token's
  // height on each fit within the frame at the current aspect. Pure read of a cloned
  // camera; never mutates the live one.
  _computeFit() {
    if (!this.camera) return
    const t = new THREE.Vector3(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
    const base = new THREE.Vector3(CAM_REST.x, CAM_REST.y, CAM_REST.z)
    const dir = base.clone().sub(t).normalize()
    const baseDist = base.distanceTo(t)
    const HE = BOARD_HALF + 0.5 // board face + gold frame + a little air
    const TH = SURFACE_Y + TOKEN_HEIGHT // top of a token standing on a corner tile
    const pts = []
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      pts.push(new THREE.Vector3(sx * HE, SURFACE_Y, sz * HE))
      pts.push(new THREE.Vector3(sx * BOARD_HALF, TH, sz * BOARD_HALF))
    }
    const probe = this.camera.clone() // copies fov/aspect/near/far
    let scale = 1
    for (let i = 0; i < 18; i++) {
      probe.position.copy(dir).multiplyScalar(baseDist * scale).add(t)
      probe.lookAt(t)
      probe.updateMatrixWorld(true)
      probe.updateProjectionMatrix()
      let maxN = 0
      for (const p of pts) { const v = p.clone().project(probe); maxN = Math.max(maxN, Math.abs(v.x), Math.abs(v.y)) }
      if (maxN <= 0.97) break
      scale *= maxN / 0.95
    }
    this._fit = scale
  }

  // The resting camera position for the current fit (CAM_REST scaled out from the target).
  _restPos() {
    const f = this._fit
    return {
      x: CAM_TARGET.x + (CAM_REST.x - CAM_TARGET.x) * f,
      y: CAM_TARGET.y + (CAM_REST.y - CAM_TARGET.y) * f,
      z: CAM_TARGET.z + (CAM_REST.z - CAM_TARGET.z) * f,
    }
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
    const r = this._restPos()
    if (t >= this._introUntil) {
      this.camera.position.set(r.x, r.y, r.z)
      this.camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
      this._introUntil = 0
      return false
    }
    const k = 1 - (this._introUntil - t) / 850 // 0→1
    const e = 1 - Math.pow(1 - k, 3) // easeOutCubic
    this.camera.position.set(
      r.x,
      r.y + INTRO_DY * (1 - e),
      r.z + INTRO_DZ * (1 - e),
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
      // Camera moments set position; follow sets look-at — apply moments FIRST.
      const camMoving = this._introUntil === 0 ? this._applyCameraMoments(t) : false
      const followMoving = this._introUntil === 0 ? this._updateFollow() : false
      const tokMoving = this._tokens ? this._tokens.update(t) : false
      const diceMoving = this._dice ? this._dice.update(t) : false
      const bldMoving = this._buildings ? this._buildings.update(t) : false
      if (this._dirty || this._tweens > 0 || introMoving || camMoving || followMoving || tokMoving || diceMoving || bldMoving) {
        this._draw()
        this._dirty = false
      }
      // Keep the loop alive only while something is animating; otherwise PARK
      // (a perpetual idle rAF wastes GPU and keeps "page idle" waiters — e.g. the
      // screenshot tool — from ever settling). invalidate()/observers re-wake it.
      // NB the active-token glow + active ring are STATIC (no per-frame pulse) so this can park;
      // the auction ring pulses, but only during the brief auction phase.
      if (this._tweens > 0 || this._introUntil > 0 || camMoving || followMoving || tokMoving || diceMoving || bldMoving) this._raf = requestAnimationFrame(frame)
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
    // Post-processing: composer.dispose() frees only its 2 RTs — free each pass's own
    // GPU resources (bloom's mip chain, vignette/output materials) explicitly. Then the
    // IBL render target.
    try {
      this._bloomPass?.dispose?.()
      this._vignettePass?.dispose?.()
      this._outputPass?.dispose?.()
      this.composer?.dispose?.()
    } catch { /* gone */ }
    this.composer = null; this._bloomPass = null; this._vignettePass = null; this._outputPass = null
    try { this._envRT?.dispose?.() } catch { /* gone */ }
    this._envRT = null
    if (this.scene) this.scene.environment = null
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
