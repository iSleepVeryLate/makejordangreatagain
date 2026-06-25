import { Grid3x3, CircleDot, Castle, Brain, Grip, Circle } from 'lucide-react'

// Maps a game key -> a lucide glyph. Chess has no native lucide piece, so we
// borrow Castle (the rook); checkers borrows Grip (a grid of discs). Unknown
// keys fall back to a plain Circle.
const ICONS = {
  tictactoe: Grid3x3,
  connect_four: CircleDot,
  chess: Castle,
  trivia: Brain,
  checkers: Grip,
}

export default function GameIcon({ game, size = 20, ...rest }) {
  const Icon = ICONS[game] || Circle
  return <Icon size={size} {...rest} />
}
