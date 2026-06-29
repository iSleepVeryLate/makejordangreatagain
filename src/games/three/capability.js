// ============================================================================
// Capability detection + render-mode preference for the Monopoly board.
//
// Decides 3D vs the retained 2D DOM renderer: 3D when WebGL is supported and the
// user hasn't opted into "Lite", otherwise 2D. SSR-safe (no window → 2D). The
// choice persists in localStorage so the Lite/3D toggle sticks across sessions.
// ============================================================================

export const RENDER_PREF_KEY = 'jst_mono_render' // '3d' | '2d'

// Cached: each probe creates a throwaway <canvas> + real GL context, and callers
// may invoke this on a hot render path — capability is session-stable, so probe
// once. (SSR is never cached, so the first real client call still probes.)
let _webglProbe
export function supportsWebGL() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (_webglProbe !== undefined) return _webglProbe
  try {
    const c = document.createElement('canvas')
    _webglProbe = !!(window.WebGLRenderingContext &&
      (c.getContext('webgl2') || c.getContext('webgl') || c.getContext('experimental-webgl')))
  } catch {
    _webglProbe = false
  }
  return _webglProbe
}

// Coarse low-power heuristic: very few cores or very little memory → favour Lite.
// (Conservative — only trips on clearly weak devices so we don't punish phones.)
export function lowPower() {
  if (typeof navigator === 'undefined') return false
  const cores = navigator.hardwareConcurrency
  const mem = navigator.deviceMemory
  if (typeof cores === 'number' && cores > 0 && cores <= 2) return true
  if (typeof mem === 'number' && mem > 0 && mem <= 1) return true
  return false
}
// (reduced-motion is read live by MonopolyGame's useReducedMotion hook, so no
// prefers-reduced-motion helper is exported here.)

export function getRenderPref() {
  if (typeof localStorage === 'undefined') return null
  try {
    const v = localStorage.getItem(RENDER_PREF_KEY)
    return v === '3d' || v === '2d' ? v : null
  } catch {
    return null
  }
}

export function setRenderPref(v) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(RENDER_PREF_KEY, v)
  } catch {
    /* private mode / storage disabled — preference just won't persist */
  }
}

// The initial render choice: explicit user pref wins; else 3D when WebGL is
// available and the device isn't clearly low-power. Reduced-motion still gets 3D
// (the scene honours it with a static camera + instant moves) unless WebGL is out.
export function shouldUse3D() {
  if (!supportsWebGL()) return false
  const pref = getRenderPref()
  if (pref) return pref === '3d'
  return !lowPower()
}
