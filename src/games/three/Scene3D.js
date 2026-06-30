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

// Resting camera framing (READABILITY pass over F3). The F3 hero angle (y 9.4 ≈40°
// elevation) read as cinematic but PLAYED badly — too low foreshortens the back row and
// the wide air-margin pushed the board far away. Raised the eye 9.4→10.7 (≈42–43°: still
// a premium 3/4 tilt, NOT flat top-down, but the back row no longer collapses) and the
// fit now frames TIGHT (see _computeFit: air 0.5→0.15, target 0.97→0.99) so the board
// FILLS the frame with only a sliver of premium table at the edges. NB: _computeFit()/
// _restPos() derive the look DIRECTION + base distance purely from these two points and
// scale OUT to fit the aspect, so re-tuning here can never crop the corners — the fit
// loop pulls back as needed. Keep that contract (probe verified across 32:9 … 9:32).
const CAM_REST = { x: 0, y: 10.7, z: 11.3 }
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
    // (READABILITY pass: the F3 BokehPass/DoF was REMOVED — it blurred the far row of
    // tiles and hurt play legibility; the whole board now renders crisp edge to edge.)
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

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120) // F3: widened 38→40 for a touch more cinematic perspective on the lower hero angle
    camera.position.set(CAM_REST.x, CAM_REST.y, CAM_REST.z)
    camera.lookAt(CAM_TARGET.x, CAM_TARGET.y, CAM_TARGET.z)
    this.camera = camera

    this._buildEnvironment() // IBL (procedural RoomEnvironment) — flatters the gold/metal
    this._buildBackdrop() // F1: graded scene.background so the board sits in a space, not a void
    this._buildLights()
    this._buildGround() // F1: dark-walnut PBR tabletop the board rests on (replaces the void plane)
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

  // F1 — the world the board lives in. Two pieces, both static (loop still PARKS):
  //   1. a large dark-walnut PBR tabletop the board visibly rests on (extends well
  //      past the board edges → context + a grounded soft contact shadow), and
  //   2. a graded backdrop (scene.background gradient) so the scene has depth and the
  //      board reads as the HERO in a space, not a slab floating in the CSS void.
  // Procedural canvas textures only — no asset files (the real HDRI is a later step).
  // Soft-degrade: if a texture can't be generated (no document/2d ctx) we fall back to
  // a flat coloured material / no backdrop — never a crash, never a black screen.
  _buildGround() {
    const tex = this._makeWoodTexture()
    const matOpts = { color: 0x6b4a2f, roughness: 0.62, metalness: 0.0, envMapIntensity: 0.5 }
    if (tex) {
      // The same grain canvas doubles as a roughness map (lighter grain = a touch
      // glossier varnish) so raking key light gets micro-variation, not a dead matte.
      matOpts.map = tex
      matOpts.roughnessMap = tex
      matOpts.roughness = 0.78
      matOpts.color = 0xffffff // let the map carry the colour
    }
    const geo = new THREE.PlaneGeometry(60, 60)
    const mat = new THREE.MeshStandardMaterial(matOpts)
    const ground = new THREE.Mesh(geo, mat)
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -BOARD_THICKNESS / 2 - 0.02
    ground.receiveShadow = true
    this.scene.add(ground)
    this._track(geo, mat) // tex is tracked inside _makeWoodTexture
  }

  // Small procedural dark-walnut grain on a 512² canvas → tiled across the tabletop.
  // Returns a tracked CanvasTexture, or null if the 2D canvas is unavailable (SSR /
  // headless without document) so the caller can fall back to a flat material.
  _makeWoodTexture() {
    if (typeof document === 'undefined') return null
    const S = 512
    const canvas = document.createElement('canvas')
    canvas.width = S; canvas.height = S
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    // base walnut tone
    ctx.fillStyle = '#5e3f27'
    ctx.fillRect(0, 0, S, S)
    // long vertical grain streaks with gentle wander — cheap, reads as wood under light
    const streaks = 220
    for (let i = 0; i < streaks; i++) {
      const x = Math.random() * S
      const shade = 0.5 + Math.random() * 0.5
      const r = Math.round(94 * shade + 18)
      const g = Math.round(63 * shade + 12)
      const b = Math.round(39 * shade + 8)
      ctx.strokeStyle = `rgba(${r},${g},${b},${0.10 + Math.random() * 0.18})`
      ctx.lineWidth = 0.6 + Math.random() * 1.8
      ctx.beginPath()
      let xx = x
      ctx.moveTo(xx, 0)
      for (let y = 0; y <= S; y += 16) {
        xx += (Math.random() - 0.5) * 3
        ctx.lineTo(xx, y)
      }
      ctx.stroke()
    }
    // a few soft darker bands for plank/figure variation
    for (let i = 0; i < 7; i++) {
      const y = Math.random() * S
      const grad = ctx.createLinearGradient(0, y - 22, 0, y + 22)
      grad.addColorStop(0, 'rgba(40,26,15,0)')
      grad.addColorStop(0.5, `rgba(40,26,15,${0.12 + Math.random() * 0.12})`)
      grad.addColorStop(1, 'rgba(40,26,15,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, y - 22, S, 44)
    }
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.wrapS = THREE.RepeatWrapping
    tex.wrapT = THREE.RepeatWrapping
    tex.repeat.set(6, 6) // tile across the 60-unit tabletop so the grain stays fine
    tex.anisotropy = this.renderer?.capabilities?.getMaxAnisotropy?.() || 1
    tex.needsUpdate = true
    this._track(tex)
    return tex
  }

  // Graded studio backdrop: a vertical-gradient CanvasTexture set as scene.background
  // (cheapest "atmosphere" — no extra geometry, stays static so the loop PARKS).
  // Lighter just above the horizon behind the board, falling to dark at top + bottom
  // so the eye lands on the board. Tracked + disposed; null-safe soft-degrade (if the
  // texture can't be built we simply leave the background null → CSS void shows through).
  _buildBackdrop() {
    if (!this.scene || typeof document === 'undefined') return
    const W = 16; const H = 256 // tall + narrow: a pure vertical gradient, cheap to upload
    const canvas = document.createElement('canvas')
    canvas.width = W; canvas.height = H
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    // top (far/up) → mid (horizon glow) → bottom (near, settles to dark table shadow)
    const grad = ctx.createLinearGradient(0, 0, 0, H)
    grad.addColorStop(0.00, '#05080a') // deep top
    grad.addColorStop(0.42, '#16242b') // soft cool horizon lift behind the board
    grad.addColorStop(0.60, '#101a1f')
    grad.addColorStop(1.00, '#05070a') // dark base
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, W, H)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.needsUpdate = true
    this.scene.background = tex
    this._track(tex)
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
    const loads = wanted.map((f) => document.fonts.load(f))
    // Arabic lives in a SEPARATE Cairo subset; a Latin-only probe never fetches it. When the
    // board bakes Arabic labels, probe with Arabic text so those glyphs are ready before re-bake.
    if (this.lang === 'ar') loads.push(document.fonts.load('700 1em "Cairo"', 'الحظ'), document.fonts.load('800 1em "Cairo"', 'الخزينة'))
    Promise.all(loads.map((p) => p.catch(() => {}))).then(repaint, () => {})
    // and re-bake again once everything settles (covers any face still in flight)
    document.fonts.ready.then(repaint, () => {})
  }

  // Image-based lighting from a procedural studio room (no asset file → deterministic
  // for the screenshot harness, robust offline). Wrapped: IBL is a bonus, never blocks
  // mount. (F1 sets scene.background to a graded backdrop in _buildBackdrop(); this only
  // drives reflections/environment, not the visible background.) Edge darkness still
  // comes from the vignette pass on top of the backdrop.
  _buildEnvironment() {
    if (!this.renderer || !this.scene) return
    try {
      const pmrem = new THREE.PMREMGenerator(this.renderer)
      const env = new RoomEnvironment()
      this._envRT = pmrem.fromScene(env, 0.04)
      this.scene.environment = this._envRT.texture
      env.dispose() // free the throwaway room (BoxGeometry + ~9 materials) — would leak per mount
      pmrem.dispose() // free the generator's scratch RTs immediately; _envRT lives on
    } catch {
      this._envRT = null
    }
  }

  // Post-processing chain: RenderPass (linear HDR) → bloom (selective via a high
  // threshold) → vignette → OutputPass (the single ACES + sRGB conversion, reading the
  // renderer's toneMapping/exposure/outputColorSpace, ALWAYS last). try/caught →
  // composer=null transparently degrades to the plain-render path (IBL + materials still
  // apply). READABILITY pass: the F3 BokehPass/DoF was removed — it blurred the far tiles
  // and hurt play legibility; the board now renders sharp edge to edge.
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
      // mechanism. Harness diagnostic (bloom-bypass + threshold sweep): the diffuse
      // cream board's linear HDR runs ~1.3-1.5, so at 1.0 the board itself bloomed and
      // washed out (cream band 118->186); not IBL-driven (board envMapIntensity had no
      // effect) but the direct-light diffuse. At 1.5 the cream drops back to the clean
      // bloom-off value (~115) while metal-specular highlights (gold frame, silver
      // tokens, dice glints, HDR>1.5) still bloom — selective bloom on highlights only.
      // Raising the threshold is additive-only (can't over-darken); exposure/lights are
      // confirmed correct by the clean bloom-off render.
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.32, 0.5, 1.5)
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
  syncBuildings(properties, playerColor, activeTile, auctionTile, activeColor) {
    if (this._buildings) this._buildings.sync(properties, playerColor, activeTile, auctionTile, activeColor)
  }

  // Feed the roll slice to the destination/path "you'll land here" highlight (transient).
  syncRoll(roll, playerColor) {
    if (this._buildings) this._buildings.syncRoll(roll, playerColor)
  }

  // G3 — fire the gold coin-reward pop at a player's token on a positive cash gain
  // (delegated to TokenField, which knows the token's world position). No-op under
  // reduced motion / low-power (TokenField guards). Transient + park-safe.
  coinReward(id) { this._tokens?.coinReward(id) }

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
    // decaying spring impulse for the dice/landing payoff ("nudge", not shake). G1/G2:
    // bumped amplitude 0.13→0.18 + a touch slower decay (−6 vs −7) so the kick reads as a
    // satisfying THUMP, not a flicker — still finite (settles well under the 0.6s window) so
    // the loop parks. Shared by the dice-settle punch (G1) and the token-landing punch (G2).
    let punchY = 0; let punchActive = false
    if (this._punchT0) {
      const age = (t - this._punchT0) / 1000
      if (age >= 0.6) this._punchT0 = 0
      else { punchY = 0.18 * Math.exp(-6 * age) * Math.cos(26 * age); punchActive = true }
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
      this.composer.setSize(w, h) // resizes every pass (incl. bloom's own mip-chain target) at DEVICE px — single source of truth; a separate per-pass setSize here would (re)set bloom to half-res on HiDPI
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
    // READABILITY: tight framing. Air trimmed 0.5→0.15 (only the gold frame's ~0.17 half-
    // width + a hair of table) and the fill target raised 0.97→0.99 so the board DOMINATES
    // the viewport instead of floating in empty tabletop. Probe still bounds all 8 corner
    // points (board-face corners incl. frame + corner-token tops), so it can NEVER crop at
    // any aspect — verified 32:9 … 9:32 (worst fill 0.88, binds the near board corner; the
    // loop pulls back wherever the constraining axis needs it).
    const HE = BOARD_HALF + 0.15 // board face + gold frame + a sliver of table
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
      if (maxN <= 0.99) break
      scale *= maxN / 0.975 // gentler step toward the tighter target (avoids overshoot-then-pull cycles)
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
    if (this.scene) { this.scene.environment = null; this.scene.background = null } // F1 backdrop texture is freed via _disposables
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
