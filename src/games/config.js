// Shared metadata for the four games. Used by the lobby, game page, leaderboard.
// `emoji` is kept for the Leaderboard/Profile; the lobby uses lucide via GameIcon.
// `tint` selects the lobby icon-tile color (g=green, s=sky, a=amber, r=rose);
// `hint` is the rough round length shown on each game card.
export const GAMES = [
  {
    key: 'tictactoe',
    label: 'Tic-Tac-Toe',
    emoji: '⭕',
    desc: 'Classic 3-in-a-row. Quick 1v1 rounds.',
    tint: 'g',
    hint: '~2 min',
  },
  {
    key: 'connect_four',
    label: 'Connect Four',
    emoji: '🔵',
    desc: 'Drop discs, line up four to win.',
    tint: 's',
    hint: '~5 min',
  },
  {
    key: 'chess',
    label: 'Chess',
    emoji: '♟️',
    desc: 'The timeless duel. Full rules, real-time.',
    tint: 'a',
    hint: '~12 min',
  },
  {
    key: 'trivia',
    label: 'Jordan Trivia',
    emoji: '🧠',
    desc: 'Test your knowledge of Jordan head-to-head.',
    tint: 'r',
    hint: '20 questions',
  },
  {
    key: 'checkers',
    label: 'Checkers (Dama)',
    emoji: '🔴',
    desc: 'The cafe classic — jump, capture, crown your kings.',
    tint: 'v',
    hint: '~8 min',
  },
]

export const GAME_BY_KEY = Object.fromEntries(GAMES.map((g) => [g.key, g]))

export function gameLabel(key) {
  return GAME_BY_KEY[key]?.label || key
}
