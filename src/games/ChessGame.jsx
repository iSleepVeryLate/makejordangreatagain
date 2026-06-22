import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

export default function ChessGame({ match, myId, makeMove, disabled }) {
  const fen = match.board_state?.fen || START_FEN
  const isP1 = myId === match.player1
  const myColor = isP1 ? 'w' : 'b'
  const orientation = isP1 ? 'white' : 'black'

  const onDrop = (from, to) => {
    if (disabled) return false
    // Local legality check is only for instant UX feedback (snap-back on an
    // illegal drag). The server re-derives and is the source of truth, so we
    // send just the coordinates — never the resulting board.
    const game = new Chess(fen)
    if (game.turn() !== myColor) return false

    let move
    try {
      move = game.move({ from, to, promotion: 'q' })
    } catch {
      return false
    }
    if (!move) return false

    makeMove({ from, to, promotion: 'q' })
    return true
  }

  return (
    <div className="chess-wrap">
      <Chessboard
        position={fen}
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
