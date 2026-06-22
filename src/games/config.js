// Shared metadata for the four games. Used by the lobby, game page, leaderboard.
export const GAMES = [
  {
    key: 'tictactoe',
    label: 'Tic-Tac-Toe',
    emoji: '⭕',
    desc: 'Classic 3-in-a-row. Quick 1v1 rounds.',
  },
  {
    key: 'connect_four',
    label: 'Connect Four',
    emoji: '🔵',
    desc: 'Drop discs, line up four to win.',
  },
  {
    key: 'chess',
    label: 'Chess',
    emoji: '♟️',
    desc: 'The timeless duel. Full rules, real-time.',
  },
  {
    key: 'trivia',
    label: 'Jordan Trivia',
    emoji: '🧠',
    desc: 'Test your knowledge of Jordan head-to-head.',
  },
]

export const GAME_BY_KEY = Object.fromEntries(GAMES.map((g) => [g.key, g]))

export function gameLabel(key) {
  return GAME_BY_KEY[key]?.label || key
}
