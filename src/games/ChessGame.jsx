import { memo } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

// Memoized on primitive props (fen/orientation/myColor/disabled + a stable
// makeMove). Unrelated parent re-renders (poll, presence, ratings) no longer
// repaint or re-instantiate the board — only an actual FEN change does.
function ChessGame({ fen, orientation, myColor, makeMove, disabled }) {
  const position = fen || START_FEN

  const onDrop = (from, to) => {
    if (disabled) return false
    // Local legality check is only for instant UX feedback (snap-back on an
    // illegal drag). The server re-derives and is the source of truth.
    const game = new Chess(position)
    if (game.turn() !== myColor) return false

    let move
    try {
      move = game.move({ from, to, promotion: 'q' })
    } catch {
      return false
    }
    if (!move) return false

    // Hand the resulting board up so the parent can commit it optimistically:
    // the piece stays put through the referee round-trip instead of snapping
    // back to its origin on any re-render that lands mid-flight.
    makeMove({ from, to, promotion: 'q', optimisticFen: game.fen() })
    return true
  }

  return (
    <div className="chess-wrap">
      <Chessboard
        position={position}
        onPieceDrop={onDrop}
        boardOrientation={orientation}
        arePiecesDraggable={!disabled}
        customBoardStyle={{ borderRadius: '12px', boxShadow: '0 12px 40px -12px rgba(0,0,0,.6)' }}
        customDarkSquareStyle={{ backgroundColor: '#0f7a47' }}
        customLightSquareStyle={{ backgroundColor: '#e8f5ee' }}
      />
    </div>
  )
}

export default memo(ChessGame)
