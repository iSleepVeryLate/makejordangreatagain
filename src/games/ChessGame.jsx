import { memo, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import { Volume2, VolumeX } from 'lucide-react'
import { useSound } from '../hooks/useSound.js'
import { useLang } from '../context/LanguageContext.jsx'

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'

// ---- highlight palette (works on both the pale + dark green board squares) ----
const LAST_BG = 'rgba(255,213,74,0.42)'                                   // opponent's last move
const SELECTED_BG = 'rgba(34,194,119,0.5)'                                // the piece you picked up
const CHECK_BG = 'radial-gradient(circle, rgba(255,40,40,.7) 36%, transparent 72%)'
const DOT = { background: 'radial-gradient(circle, rgba(0,0,0,.26) 18%, transparent 20%)' } // empty legal target
const RING = {                                                            // legal capture target
  background: 'radial-gradient(transparent 0 55%, rgba(0,0,0,.24) 57% 70%, transparent 72%)',
  borderRadius: '50%',
}
const PREMOVE_DARK = { backgroundColor: '#b23a48' }
const PREMOVE_LIGHT = { backgroundColor: '#e06a78' }

const GLYPH = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛' }
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 }
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 }

// Captured pieces + material edge, derived purely from the FEN placement field.
// The +N advantage is computed from present-piece values (accurate even after a
// promotion); the captured glyph lists are the simpler "start minus present" diff.
function deriveMaterial(fen, myColor) {
  const placement = (fen || '').split(' ')[0]
  const counts = { w: {}, b: {} }
  for (const ch of placement) {
    const lower = ch.toLowerCase()
    if ('pnbrq'.includes(lower)) {
      const color = ch === lower ? 'b' : 'w'
      counts[color][lower] = (counts[color][lower] || 0) + 1
    }
  }
  const oppColor = myColor === 'w' ? 'b' : 'w'
  const capturedOf = (color) => {
    const list = []
    for (const t of ['q', 'r', 'b', 'n', 'p']) {
      const missing = START_COUNT[t] - (counts[color][t] || 0)
      for (let i = 0; i < Math.max(0, missing); i++) list.push(t)
    }
    return list
  }
  const matVal = (color) =>
    ['q', 'r', 'b', 'n', 'p'].reduce((s, t) => s + (counts[color][t] || 0) * VALUE[t], 0)
  const diff = matVal(myColor) - matVal(oppColor)
  return {
    myCaptured: capturedOf(oppColor), // opponent pieces I took   → my bar (below)
    oppCaptured: capturedOf(myColor), // my pieces opponent took  → opp bar (above)
    myAdv: diff > 0 ? diff : 0,
    oppAdv: diff < 0 ? -diff : 0,
    oppColor,
  }
}

function CapturedRow({ pieces, color, adv }) {
  if (!pieces.length && !adv) return <div className="chess-capstrip" />
  return (
    <div className="chess-capstrip">
      {pieces.map((t, i) => (
        <span key={i} className={`chess-cap pc-${color}`}>{GLYPH[t]}</span>
      ))}
      {adv > 0 && <span className="chess-adv">+{adv}</span>}
    </div>
  )
}

// Fully-interactive chess board: click-to-move + drag, legal-move previews, last-move
// / check / selection highlights, an underpromotion picker, premoves, captured-piece
// strips, a live move list, and per-move sound. The server is still the referee —
// makeMove({from,to,promotion,optimisticFen}) goes through the chess-move Edge Function;
// we only render the authoritative FEN/PGN and play optimistically for instant feel.
//
// Memoised on primitive props (fen/pgn/orientation/myColor/disabled/finished + a stable
// makeMove) so unrelated parent re-renders (poll, presence, ratings, clock tick) never
// repaint the board — only a real position/turn change does.
function ChessGame({ fen, orientation, myColor, makeMove, disabled, finished, pgn }) {
  const { t } = useLang()
  const { play, muted, toggleMute } = useSound()
  const position = fen || START_FEN

  const [selected, setSelected] = useState(null)            // square of the picked-up piece
  const [pendingPromotion, setPendingPromotion] = useState(null) // { from, to } for click-promo
  const prevSoundKeyRef = useRef(null)
  const moveListRef = useRef(null)

  // Single engine instance per position — cheap, and avoids stale mutable state.
  const game = useMemo(() => {
    try { return new Chess(position) } catch { return new Chess(START_FEN) }
  }, [position])

  // Legal targets for the currently-selected piece (empty if nothing selected).
  const legalForSelected = useMemo(
    () => (selected ? game.moves({ square: selected, verbose: true }) : []),
    [game, selected],
  )
  const targetSquares = useMemo(() => new Set(legalForSelected.map((m) => m.to)), [legalForSelected])
  const captureTargets = useMemo(
    () => new Set(legalForSelected.filter((m) => m.flags.includes('c') || m.flags.includes('e')).map((m) => m.to)),
    [legalForSelected],
  )

  // Last move + SAN list, derived from the stored PGN (so it covers the opponent's move too).
  const pgnInfo = useMemo(() => {
    if (!pgn) return { sans: [], lastMove: null }
    try {
      const g = new Chess()
      g.loadPgn(pgn)
      const verbose = g.history({ verbose: true })
      const last = verbose[verbose.length - 1]
      return { sans: verbose.map((m) => m.san), lastMove: last ? { from: last.from, to: last.to } : null }
    } catch {
      return { sans: [], lastMove: null }
    }
  }, [pgn])

  // King square of the side to move, when that side is in check.
  const checkSquare = useMemo(() => {
    if (!game.inCheck()) return null
    const turn = game.turn()
    for (const row of game.board())
      for (const sq of row) if (sq && sq.type === 'k' && sq.color === turn) return sq.square
    return null
  }, [game])

  const material = useMemo(() => deriveMaterial(position, myColor), [position, myColor])

  // One merged style map (low→high priority so the later layers win on collision).
  const customSquareStyles = useMemo(() => {
    const s = {}
    const { lastMove } = pgnInfo
    if (lastMove) {
      s[lastMove.from] = { background: LAST_BG }
      s[lastMove.to] = { background: LAST_BG }
    }
    if (checkSquare) s[checkSquare] = { ...(s[checkSquare] || {}), background: CHECK_BG }
    if (selected) s[selected] = { ...(s[selected] || {}), background: SELECTED_BG }
    for (const sq of targetSquares)
      s[sq] = { ...(s[sq] || {}), ...(captureTargets.has(sq) ? RING : DOT) }
    return s
  }, [pgnInfo, checkSquare, selected, targetSquares, captureTargets])

  // The single funnel both click-to-move and drag converge on. promotion may be
  // undefined for non-promoting moves; the chosen piece flows through to the server.
  const commitMove = useCallback(
    (from, to, promotion) => {
      const g = new Chess(position)
      let move
      try { move = g.move({ from, to, promotion }) } catch { return false }
      if (!move) return false
      makeMove({ from, to, promotion, optimisticFen: g.fen() })
      setSelected(null)
      setPendingPromotion(null)
      return true
    },
    [position, makeMove],
  )

  // Click-to-move (your turn only; premoves are drag-based — see render).
  const onSquareClick = useCallback(
    (square, piece) => {
      if (disabled) { setSelected(null); return }
      if (!selected) {
        if (piece && piece[0] === myColor) setSelected(square)
        return
      }
      if (square === selected) { setSelected(null); return }      // tap again → deselect
      if (piece && piece[0] === myColor) { setSelected(square); return } // switch piece
      if (targetSquares.has(square)) {
        const isPromo = legalForSelected.some((m) => m.to === square && m.flags.includes('p'))
        if (isPromo) { setPendingPromotion({ from: selected, to: square }); return }
        commitMove(selected, square)
        return
      }
      setSelected(null)
    },
    [disabled, selected, myColor, targetSquares, legalForSelected, commitMove],
  )

  // Drag move. react-chessboard intercepts promoting drags via onPromotionCheck and
  // shows its dialog instead of calling this, so a promotion reaching here is the
  // library's post-select re-drop — we reject it (the move already committed) to
  // avoid a double submit / forced queen.
  const onPieceDrop = useCallback(
    (from, to) => {
      if (finished) return false
      const g = new Chess(position)
      if (g.turn() !== myColor) return false       // not your turn → premove handled upstream
      let move
      try { move = g.move({ from, to, promotion: 'q' }) } catch { return false }
      if (!move) return false
      if (move.flags.includes('p')) return false   // promotion handled by the dialog path
      makeMove({ from, to, optimisticFen: g.fen() })
      setSelected(null)
      return true
    },
    [finished, position, myColor, makeMove],
  )

  // Only show the promotion dialog for genuinely legal promotion drags.
  const onPromotionCheck = useCallback(
    (from, to) => {
      if (finished) return false
      const g = new Chess(position)
      if (g.turn() !== myColor) return false
      return g.moves({ square: from, verbose: true }).some((m) => m.to === to && m.flags.includes('p'))
    },
    [finished, position, myColor],
  )

  // Resolves BOTH promotion paths. piece is e.g. "wN"; on cancel it's empty. For the
  // click path promoteFromSquare is null, so fall back to pendingPromotion.
  const onPromotionPieceSelect = useCallback(
    (piece, fromSq, toSq) => {
      if (!piece) { setPendingPromotion(null); setSelected(null); return false }
      const from = fromSq || pendingPromotion?.from
      const to = toSq || pendingPromotion?.to
      if (!from || !to) { setPendingPromotion(null); setSelected(null); return false }
      return commitMove(from, to, piece[1].toLowerCase())
    },
    [pendingPromotion, commitMove],
  )

  const onPieceDragBegin = useCallback(
    (piece, sq) => { if (!disabled && piece[0] === myColor) setSelected(sq) },
    [disabled, myColor],
  )

  const isDraggablePiece = useCallback(
    ({ piece }) => !finished && piece[0] === myColor,
    [finished, myColor],
  )

  // A new authoritative/optimistic position (or a rollback) clears any half-built selection.
  useEffect(() => { setSelected(null); setPendingPromotion(null) }, [position])
  useEffect(() => { if (finished) { setSelected(null); setPendingPromotion(null) } }, [finished])

  // Per-move SFX, for your move AND the opponent's. Deduped so the optimistic-commit →
  // server-reconcile pair (same resulting position + last move) plays exactly once.
  useEffect(() => {
    const { lastMove } = pgnInfo
    const key = lastMove ? `${lastMove.from}${lastMove.to}:${position}` : position
    if (prevSoundKeyRef.current === null) { prevSoundKeyRef.current = key; return } // silent on mount
    if (key === prevSoundKeyRef.current) return
    prevSoundKeyRef.current = key
    if (!pgn) return
    try {
      const g = new Chess()
      g.loadPgn(pgn)
      const h = g.history({ verbose: true })
      const m = h[h.length - 1]
      if (!m) return
      let name = 'chessMove'
      if (g.isGameOver()) name = 'chessGameOver'
      else if (m.flags.includes('p')) name = 'chessPromote'
      else if (m.flags.includes('k') || m.flags.includes('q')) name = 'chessCastle'
      else if (g.inCheck()) name = 'chessCheck'
      else if (m.flags.includes('c') || m.flags.includes('e')) name = 'chessCapture'
      play(name)
    } catch { /* never let a sound glitch touch gameplay */ }
  }, [position, pgn, pgnInfo, play])

  // Keep the move list scrolled to the latest ply.
  useEffect(() => {
    if (moveListRef.current) moveListRef.current.scrollTop = moveListRef.current.scrollHeight
  }, [pgnInfo])

  const moveRows = useMemo(() => {
    const rows = []
    for (let i = 0; i < pgnInfo.sans.length; i += 2)
      rows.push({ no: i / 2 + 1, w: pgnInfo.sans[i], b: pgnInfo.sans[i + 1] })
    return rows
  }, [pgnInfo])

  return (
    <div className="chess-wrap">
      <div className="chess-bar">
        <CapturedRow pieces={material.oppCaptured} color={myColor} adv={material.oppAdv} />
        <button
          type="button"
          className="chess-mute"
          onClick={toggleMute}
          aria-label={muted ? t('app.chess.unmute') : t('app.chess.mute')}
          title={muted ? t('app.chess.unmute') : t('app.chess.mute')}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
      </div>

      <Chessboard
        position={position}
        boardOrientation={orientation}
        arePiecesDraggable={!finished}
        isDraggablePiece={isDraggablePiece}
        onPieceDrop={onPieceDrop}
        onSquareClick={onSquareClick}
        onPieceDragBegin={onPieceDragBegin}
        customSquareStyles={customSquareStyles}
        onPromotionCheck={onPromotionCheck}
        onPromotionPieceSelect={onPromotionPieceSelect}
        showPromotionDialog={!!pendingPromotion}
        promotionToSquare={pendingPromotion?.to}
        arePremovesAllowed
        customPremoveDarkSquareStyle={PREMOVE_DARK}
        customPremoveLightSquareStyle={PREMOVE_LIGHT}
        animationDuration={200}
        customBoardStyle={{ borderRadius: '12px', boxShadow: '0 12px 40px -12px rgba(0,0,0,.6)' }}
        customDarkSquareStyle={{ backgroundColor: '#0f7a47' }}
        customLightSquareStyle={{ backgroundColor: '#e8f5ee' }}
        customDropSquareStyle={{ boxShadow: 'inset 0 0 1px 6px rgba(34,194,119,.55)' }}
      />

      <div className="chess-bar">
        <CapturedRow pieces={material.myCaptured} color={material.oppColor} adv={material.myAdv} />
      </div>

      {moveRows.length > 0 && (
        <div className="chess-movelist">
          <div className="chess-movelist-h">{t('app.chess.moves')}</div>
          <div className="chess-movelist-body" ref={moveListRef}>
            {moveRows.map((r) => (
              <div className="chess-move-row" key={r.no}>
                <span className="chess-move-no">{r.no}.</span>
                <span className="chess-move-san">{r.w}</span>
                <span className="chess-move-san">{r.b || ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(ChessGame)
