// ============================================================================
// Tiny colour helpers shared by the 2D (MonopolyBoard CSS var) and 3D
// (buildings3d bake) ownership markers so both surfaces compute the SAME
// darker-border variant for LIGHT owner colours. Presentation-only; no deps.
//
// WHY: an ownership border tinted to a near-white token colour (e.g. the hat
// #e9e9ee) vanishes against the cream board even with a dark keyline behind it.
// For a LIGHT owner we instead DARKEN + SATURATE that very colour for the BORDER
// itself — the hue is preserved so it still reads as "their colour", just deep
// enough to separate from the board. DARK owners are returned unchanged (their
// own colour already contrasts the cream tile, and darkening would muddy it).
// ============================================================================

// '#rgb' / '#rrggbb' → { r, g, b } in 0..255. Returns null on anything unparseable
// so callers can fall back to the raw string.
export function parseHex(hex) {
  if (typeof hex !== 'string') return null
  let h = hex.trim().replace(/^#/, '')
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')

// Perceptual luminance (Rec. 709), 0..1. Used to decide "is this owner colour light?".
export function luminance(hex) {
  const c = parseHex(hex)
  if (!c) return 0
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
}

// A LIGHT colour reads above this; below it the colour already contrasts the cream
// board and is used as-is. Tuned so the hat (#e9e9ee, ~0.91) and the light-yellow
// wheelbarrow (#f2c94c, ~0.78) both qualify, while mid-tones (the brown dog #8d6239
// ~0.41, the green iron #2e8b57 ~0.49) do not.
export const LIGHT_LUMA = 0.62

// Darken (scale toward black) and boost saturation a touch so the border keeps the
// owner's HUE but reads as a deep, solid version of it. amount in 0..1 = how much
// darker (0.42 → keep 58% of each channel). The saturation lift pushes channels away
// from their average so a near-grey light colour gains a little chroma when darkened.
export function darkenSaturate(hex, amount = 0.42, satBoost = 0.18) {
  const c = parseHex(hex)
  if (!c) return hex
  const avg = (c.r + c.g + c.b) / 3
  const sat = (v) => v + (v - avg) * satBoost // push away from grey to gain chroma
  const keep = 1 - amount
  return '#' + toHex(sat(c.r) * keep) + toHex(sat(c.g) * keep) + toHex(sat(c.b) * keep)
}

// The colour to use for the ownership BORDER: a darkened/saturated variant for LIGHT
// owners (so the border separates from the cream board), the raw colour otherwise.
// Shared by both the 2D CSS (--ow-border) and the 3D bake so they always agree.
export function ownerBorderColor(hex) {
  return luminance(hex) > LIGHT_LUMA ? darkenSaturate(hex) : hex
}
