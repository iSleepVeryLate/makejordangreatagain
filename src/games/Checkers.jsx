import { memo, useState, useEffect, useMemo } from 'react'
import { Crown } from 'lucide-react'
import { legalMoves, applyMove, ownerOf, isKing, initialBoard, SIZE } from './checkersRules.js'

// The board renders the authoritative state from the match row, but plays moves
// OPTIMISTICALLY for instant feedback: each click is applied locally with the
// shared rules engine, and a whole (possibly multi-jump) turn is submitted to the
// `checkers-move` Edge Function in ONE request when the sequence completes. The
// server re-derives and confirms — visually a no-op — or rejects and we roll back.
// myColor is 1 (player1) or 2 (player2); player2's view is rotated 180°.
function Checkers({ match, makeMove, myColor, disabled }) {
  const serverBoard = match.board_state?.board || initialBoard()
  const serverLast = match.board_state?.lastMove || null
  const moveCount = match.move_count

  // Optimistic overlay while the local player builds a move. `optim.path` is the
  // sequence of squares so far; null means "show the authoritative server board".
  const [optim, setOptim] = useState(null) // { board, mustJumpFrom, path }
  const [submitting, setSubmitting] = useState(false)
  const [selected, setSelected] = useState(null)

  // A fresh authoritative row (new move_count) supersedes any overlay.
  useEffect(() => {
    setOptim(null)
    setSelected(null)
  }, [moveCount])

  const board = optim?.board ?? serverBoard
  const mustJumpFrom = optim?.mustJumpFrom ?? null
  const locked = disabled || submitting

  // Mid multi-jump the continuing piece is forced — keep it selected.
  useEffect(() => {
    if (mustJumpFrom != null) setSelected(mustJumpFrom)
  }, [mustJumpFrom])

  const myMoves = useMemo(
    () => (locked ? [] : legalMoves(board, myColor, mustJumpFrom)),
    [board, myColor, mustJumpFrom, locked],
  )
  const movableFrom = useMemo(() => new Set(myMoves.map((m) => m.from)), [myMoves])
  const targets = useMemo(
    () => new Set(myMoves.filter((m) => m.from === selected).map((m) => m.to)),
    [myMoves, selected],
  )

  // Show the opponent's last move until I start building my own.
  const lastMove = optim ? null : serverLast

  const clickSquare = (idx) => {
    if (locked) return
    // Land on a highlighted target → apply locally; continue or submit.
    if (selected != null && targets.has(idx)) {
      const move = myMoves.find((m) => m.from === selected && m.to === idx)
      const res = applyMove(board, move)
      const path = (optim?.path ?? [selected]).concat(idx)
      if (res.canContinue) {
        setOptim({ board: res.board, mustJumpFrom: idx, path }) // forced: keep jumping locally
      } else {
        setOptim({ board: res.board, mustJumpFrom: null, path }) // show final instantly
        setSelected(null)
        setSubmitting(true)
        Promise.resolve(makeMove({ path })).finally(() => {
          setSubmitting(false)
          setOptim(null) // defer to authoritative row (success) or roll back (reject)
        })
      }
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
        const isLast = !!lastMove && (lastMove[0] === idx || lastMove[1] === idx)
        const jumping = sel && mustJumpFrom === idx
        const cls =
          `ck-sq ${dark ? 'dark' : 'light'}` +
          (sel ? ' sel' : '') +
          (isTarget ? ' target' : '') +
          (movable ? ' movable' : '') +
          (isLast ? ' last' : '') +
          (jumping ? ' jumping' : '')
        return (
          <button
            key={idx}
            type="button"
            className={cls}
            onClick={() => clickSquare(idx)}
            disabled={locked || !dark}
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
