// Client-only visual metadata for the 8 player tokens. (The token KEYS live in
// the shared board module; these emojis/colors are display-only so they are not
// mirrored to the server.)
import { TOKENS } from './monopolyBoard.js'

export const TOKEN_META = {
  car: { emoji: '🏎️', color: '#d23b32' },
  ship: { emoji: '🚢', color: '#3461c7' },
  thimble: { emoji: '🪡', color: '#cf5b97' },
  dog: { emoji: '🐕', color: '#8d6239' },
  hat: { emoji: '🎩', color: '#e9e9ee' },
  boot: { emoji: '👢', color: '#e08a3c' },
  iron: { emoji: '🧺', color: '#2e8b57' },
  wheelbarrow: { emoji: '🛒', color: '#f2c94c' },
}

export const tokenMeta = (key) => TOKEN_META[key] || TOKEN_META.car
export { TOKENS }
