// ============================================================================
// tokenModels.js — OPTIONAL hand-authored GLB token models (DORMANT by default).
//
// The shipped tokens are procedural silver pieces built in tokens3d.js — no asset
// is required and none ships. This module is the drop-in hook: if a
// public/models/monopoly-tokens.glb ever exists (8 mesh nodes named exactly
// car / ship / thimble / dog / hat / boot / iron / wheelbarrow), loadTokenModels()
// extracts geometry-only, normalises it to the same envelope the procedural pieces
// use, and caches it so TokenField can swap the real sculpts in with ZERO further
// code changes. Any failure — and a 404 IS the default, since no GLB ships — is
// swallowed: the procedural pieces simply stay. This is a soft enhancement, never a
// blocker and never an error surfaced to the user.
//
// GLTFLoader / DRACOLoader are imported LAZILY so they only land in the 3D chunk,
// never the lobby bundle. The Draco decoder wasm is vendored inside `three` and Vite
// emits it to /dist/assets automatically (no CDN, no setDecoderPath()).
//
// Trademark-safe: generic classic-object shapes only — our own Jordan identity, no
// Hasbro art (mirrors boardTexture.js's rationale).
// ============================================================================
import * as THREE from 'three'

const GLB_URL = '/models/monopoly-tokens.glb'
export const TOKEN_KEYS = ['car', 'ship', 'thimble', 'dog', 'hat', 'boot', 'iron', 'wheelbarrow']

let _promise = null
let _ready = false
let _failed = false
const _geos = new Map() // key -> normalized shared BufferGeometry

export function modelsReady() { return _ready }
export function modelsFailed() { return _failed }
export function getTokenGeometry(key) { return _geos.get(key) || null }

// First mesh under a node → its geometry, with the node's world transform baked in.
function extractGeometry(node) {
  let geo = null
  node.updateWorldMatrix(true, true)
  node.traverse((o) => {
    if (!geo && o.isMesh && o.geometry) {
      geo = o.geometry.clone()
      geo.applyMatrix4(o.matrixWorld)
    }
  })
  return geo
}

// Fit to TOKEN_HEIGHT*0.78 tall AND clamp the footprint to TOKEN_RADIUS (whichever
// binds first), centre on XZ, and sit the base at y=0 — exactly the envelope the
// procedural pieces use, so the camera-fit math + hop apex stay valid.
function normalize(geo, R, H) {
  geo.computeBoundingBox()
  let bb = geo.boundingBox
  const size = new THREE.Vector3(); bb.getSize(size)
  const targetH = H * 0.78
  const sH = targetH / (size.y || 1)
  const sF = (R * 1.9) / (Math.max(size.x, size.z) || 1)
  const s = Math.min(sH, sF)
  geo.scale(s, s, s)
  geo.computeBoundingBox(); bb = geo.boundingBox
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2)
  return geo
}

function disposeMat(m) {
  for (const mm of (Array.isArray(m) ? m : [m])) {
    try { for (const k in mm) { const v = mm[k]; if (v && v.isTexture) v.dispose() } mm.dispose?.() } catch { /* gone */ }
  }
}

// De-duped singleton loader. Resolves to true only if at least one geometry loaded.
export function loadTokenModels({ TOKEN_RADIUS, TOKEN_HEIGHT } = {}) {
  if (_promise) return _promise
  _promise = (async () => {
    try {
      // Quiet probe first: a dev SPA-fallback returns index.html (200, text/html) and
      // a static host returns 404 — both mean "no GLB". Bail without invoking the
      // loader so no parse error is logged.
      let head
      try { head = await fetch(GLB_URL, { method: 'HEAD' }) } catch { _failed = true; return false }
      const ct = head.headers.get('content-type') || ''
      if (!head.ok || /text\/html/i.test(ct)) { _failed = true; return false }

      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/DRACOLoader.js'),
      ])
      const draco = new DRACOLoader() // default decoderPaths → vendored wasm via import.meta.url
      const loader = new GLTFLoader()
      loader.setDRACOLoader(draco)
      const gltf = await loader.loadAsync(GLB_URL)
      for (const key of TOKEN_KEYS) {
        const node = gltf.scene.getObjectByName(key)
        if (!node) continue
        const geo = extractGeometry(node)
        if (geo) { normalize(geo, TOKEN_RADIUS, TOKEN_HEIGHT); _geos.set(key, geo) }
      }
      // Drop GLB-shipped materials/textures — the runtime owns the silver look.
      gltf.scene.traverse((o) => { if (o.material) disposeMat(o.material) })
      draco.dispose()
      _ready = _geos.size > 0
      if (!_ready) _failed = true
      return _ready
    } catch {
      _failed = true // no GLB / network / decode failure → procedural pieces remain
      return false
    }
  })()
  return _promise
}

// NB: the geometry cache is a session-stable singleton (like the WebGL capability
// probe) — it is intentionally NOT freed per-scene. It holds at most 8 small shared
// geometries, and keeping it means a route re-mount reuses them instantly instead of
// re-fetching/re-decoding the GLB.
