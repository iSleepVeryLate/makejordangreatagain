// Client-only visual metadata for the 8 player tokens. (The token KEYS live in
// the shared board module; these emojis/colors are display-only so they are not
// mirrored to the server.)
import { TOKENS } from './monopolyBoard.js'

// `emoji` = the DOM/Lite glyph (lobby picker + 2D token chips + fallback).
// `motif` = the glyph embossed onto the 3D medallion's top face (baked to a small
// CanvasTexture by tokens3d). Kept as its own field so the 3D art can diverge from
// the DOM emoji later without touching the Lite renderer.
export const TOKEN_META = {
  car: { emoji: '🏎️', motif: '🏎️', color: '#d23b32' },
  ship: { emoji: '🚢', motif: '🚢', color: '#3461c7' },
  thimble: { emoji: '🪡', motif: '🪡', color: '#cf5b97' },
  dog: { emoji: '🐕', motif: '🐕', color: '#8d6239' },
  hat: { emoji: '🎩', motif: '🎩', color: '#e9e9ee' },
  boot: { emoji: '👢', motif: '👢', color: '#e08a3c' },
  iron: { emoji: '🧺', motif: '🧺', color: '#2e8b57' },
  wheelbarrow: { emoji: '🛒', motif: '🛒', color: '#f2c94c' },
}

export const tokenMeta = (key) => TOKEN_META[key] || TOKEN_META.car
export { TOKENS }
