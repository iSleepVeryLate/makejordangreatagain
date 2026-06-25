import { memo, useState, useEffect, useMemo } from 'react'
import { Crown } from 'lucide-react'
import { legalMoves, ownerOf, isKing, initialBoard, SIZE } from './checkersRules.js'

// The board renders the authoritative state from the match row. `checkersRules`
// is used only to highlight legal sources/targets and to enforce a forced
// multi-jump in the UI — the `checkers-move` Edge Function is the real referee.
// myColor is 1 (player1) or 2 (player2); player2's view is rotated 180°.
function Checkers({ match, makeMove, myColor, disabled }) {
  const board = match.board_state?.board || initialBoard()
  const mustJumpFrom = match.board_state?.mustJumpFrom ?? null
  const [selected, setSelected] = useState(null)

  // Mid multi-jump, the jumping piece is forced — auto-select it. Otherwise drop
  // any stale selection when the board becomes non-interactive.
  useEffect(() => {
    if (disabled) setSelected(null)
    else if (mustJumpFrom != null) setSelected(mustJumpFrom)
  }, [disabled, mustJumpFrom])

  // Every legal move I have this turn — drives both source and target highlights.
  const myMoves = useMemo(
    () => (disabled ? [] : legalMoves(board, myColor, mustJumpFrom)),
    [board, myColor, mustJumpFrom, disabled],
  )
  const movableFrom = useMemo(() => new Set(myMoves.map((m) => m.from)), [myMoves])
  const targets = useMemo(
    () => new Set(myMoves.filter((m) => m.from === selected).map((m) => m.to)),
    [myMoves, selected],
  )

  const clickSquare = (idx) => {
    if (disabled) return
    // Land on a highlighted target → submit the move.
    if (selected != null && targets.has(idx)) {
      makeMove({ from: selected, to: idx })
      setSelected(null)
      return
    }
    // Otherwise (re)select one of my movable pieces.
    if (movableFrom.has(idx)) setSelected(idx)
  }

  // player1 already sits at the bottom with row 0 on top; player2 is rotated.
  const order = useMemo(() => {
    const idxs = Array.from({ length: SIZE * SIZE }, (_, i) => i)
    return myColor === 2 ? idxs.reverse() : idxs
  }, [myColor])

  return (
    <div className="checkers" role="grid" aria-label="Checkers board">
      {order.map((idx) => {
        const r = Math.floor(idx / SIZE)
        const c = idx % SIZE
        const dark = (r + c) % 2 === 1
        const v = board[idx]
        const owner = ownerOf(v)
        const sel = selected === idx
        const isTarget = targets.has(idx)
        const movable = movableFrom.has(idx) && !sel
        const cls =
          `ck-sq ${dark ? 'dark' : 'light'}` +
          (sel ? ' sel' : '') +
          (isTarget ? ' target' : '') +
          (movable ? ' movable' : '')
        return (
          <button
            key={idx}
            type="button"
            className={cls}
            onClick={() => clickSquare(idx)}
            disabled={disabled || !dark}
            aria-label={`row ${r + 1} column ${c + 1}`}
          >
            {owner !== 0 && (
              <span className={`ck-pc p${owner}${isKing(v) ? ' king' : ''}`}>
                {isKing(v) && <Crown size={16} strokeWidth={2.4} />}
              </span>
            )}
            {isTarget && owner === 0 && <span className="ck-dot" />}
          </button>
        )
      })}
    </div>
  )
}

export default memo(Checkers)
