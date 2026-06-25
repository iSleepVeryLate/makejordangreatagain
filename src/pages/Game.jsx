import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useMatch } from '../hooks/useMatch.js'
import { useToast } from '../context/ToastContext.jsx'
import { gameLabel } from '../games/config.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'
import Confetti from '../components/Confetti.jsx'

// Seconds a player must be idle before the opponent can claim the win, mirrored
// from claim_timeout() (chess 180s, checkers 120s, everything else 60s).
const TIMEOUT_MS = (gameType) =>
  gameType === 'chess' ? 180000 : gameType === 'checkers' ? 120000 : 60000
const fmtClock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// Lazy-loaded so each board (and chess's heavy engine + board deps) only ships
// to players who actually open that game.
const TicTacToe = lazy(() => import('../games/TicTacToe.jsx'))
const ConnectFour = lazy(() => import('../games/ConnectFour.jsx'))
const ChessGame = lazy(() => import('../games/ChessGame.jsx'))
const Trivia = lazy(() => import('../games/Trivia.jsx'))
const Checkers = lazy(() => import('../games/Checkers.jsx'))

function Seat({ profile, label, isTurn, isOnline, isYou, rating }) {
  return (
    <div className={`seat${isTurn ? ' turn' : ''}`}>
      <Avatar profile={profile} size="md" />
      <div className="info">
        <div className="nm">
          {profile?.global_name || profile?.username || label}{' '}
          {isYou && <span className="you-badge">you</span>}
        </div>
        <div className="rt">{rating != null ? `${rating} rating` : ' '}</div>
      </div>
      <span className={isOnline ? 'dot-online' : 'dot-offline'} title={isOnline ? 'online' : 'offline'} />
    </div>
  )
}

export default function Game() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { match, players, online, loading, error, connState, myId, applyRow, refetch, matchRef } = useMatch(matchId)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ratings, setRatings] = useState({})
  const [copied, setCopied] = useState(false)
  // 1s heartbeat so the timeout countdown ticks down live.
  const [nowTs, setNowTs] = useState(() => Date.now())
  // Remember the previous status so we can announce a waiting -> active flip.
  const prevStatusRef = useRef(null)

  useEffect(() => {
    const t = setInterval(() => setNowTs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Toast when an opponent joins your waiting room (status flips to active).
  useEffect(() => {
    const status = match?.status
    if (prevStatusRef.current === 'waiting' && status === 'active') {
      toast('Opponent joined — game on!', 'success')
    }
    if (status) prevStatusRef.current = status
  }, [match?.status, toast])

  // fetch both players' ratings for this game type (display only)
  useEffect(() => {
    if (!match?.game_type) return
    const ids = [match.player1, match.player2].filter(Boolean)
    if (!ids.length) return
    supabase
      .from('game_stats')
      .select('profile_id,rating')
      .eq('game_type', match.game_type)
      .in('profile_id', ids)
      .then(({ data }) => {
        if (data) setRatings(Object.fromEntries(data.map((r) => [r.profile_id, r.rating])))
      })
  }, [match?.game_type, match?.player1, match?.player2, match?.status])

  const rpc = useCallback(
    async (name, params) => {
      setActionError('')
      const { data, error } = await supabase.rpc(name, params)
      if (error) {
        setActionError(error.message)
        return null
      }
      applyRow(data)
      return data
    },
    [applyRow],
  )

  const makeMove = useCallback((move) => rpc('make_move', { p_match_id: matchId, p_move: move }), [rpc, matchId])
  const answerTrivia = useCallback((choice) => rpc('trivia_answer', { p_match_id: matchId, p_choice: choice }), [rpc, matchId])

  // Chess goes through the server-authoritative Edge Function, which re-derives
  // the move with a real engine. We send only the move coordinates — never a
  // board the client made up — but we commit the result locally first so the
  // board never snaps back during the round-trip. The server reconciles on
  // success and we roll back to the pre-move row on rejection.
  const makeChessMove = useCallback(
    async (move) => {
      setActionError('')
      const prev = matchRef.current
      if (prev && move.optimisticFen) {
        const oppId = prev.player1 === myId ? prev.player2 : prev.player1
        applyRow({
          board_state: { ...(prev.board_state || {}), fen: move.optimisticFen },
          current_turn: oppId, // flips the turn so the board disables immediately
          last_move_at: new Date().toISOString(),
        })
      }

      const { data, error } = await supabase.functions.invoke('chess-move', {
        body: { match_id: matchId, from: move.from, to: move.to, promotion: move.promotion },
      })
      if (!error) {
        applyRow(data) // reconcile to authoritative state (visually a no-op)
        return data
      }
      // FunctionsHttpError → the function ran and rejected the move (illegal /
      // not your turn). Roll back the optimistic move and surface why.
      if (error.context && typeof error.context.json === 'function') {
        let msg = 'Move rejected.'
        try {
          msg = (await error.context.json())?.error || msg
        } catch {
          /* non-JSON body */
        }
        if (prev) applyRow(prev)
        else refetch?.()
        setActionError(msg)
        toast(msg, 'error')
        return null
      }
      // Couldn't reach the function (not deployed yet) — fall back to the legacy
      // RPC so honest play keeps working during rollout. Once chess-move is
      // deployed and migration 0004 is applied, this branch is never taken.
      const fallback = await rpc('make_move', { p_match_id: matchId, p_move: move })
      if (!fallback && prev) applyRow(prev) // RPC also failed → undo optimistic move
      return fallback
    },
    [matchId, applyRow, refetch, matchRef, myId, rpc, toast],
  )

  // Checkers is server-authoritative via the checkers-move Edge Function. Unlike
  // chess we don't apply optimistically — captures remove pieces, so a hand-rolled
  // local mutation is error-prone and the round-trip is sub-second. We just send
  // {from, to}, then reconcile to the authoritative row (or roll back on reject).
  // There is no make_move fallback: that RPC rejects checkers by design.
  const makeCheckersMove = useCallback(
    async (move) => {
      setActionError('')
      const prev = matchRef.current
      const { data, error } = await supabase.functions.invoke('checkers-move', {
        body: { match_id: matchId, from: move.from, to: move.to },
      })
      if (!error) {
        applyRow(data)
        return data
      }
      // FunctionsHttpError → the function ran and rejected the move (illegal /
      // not your turn). Surface why; the board is unchanged so nothing to undo.
      if (error.context && typeof error.context.json === 'function') {
        let msg = 'Move rejected.'
        try {
          msg = (await error.context.json())?.error || msg
        } catch {
          /* non-JSON body */
        }
        if (prev) applyRow(prev)
        else refetch?.()
        setActionError(msg)
        toast(msg, 'error')
        return null
      }
      // Couldn't reach the function at all.
      const msg = 'Could not reach the game server. Please try again.'
      setActionError(msg)
      toast(msg, 'error')
      refetch?.()
      return null
    },
    [matchId, applyRow, refetch, matchRef, toast],
  )

  const resign = async () => {
    if (!confirm('Resign this game?')) return
    setBusy(true)
    const data = await rpc('resign', { p_match_id: matchId })
    setBusy(false)
    if (data?.status === 'abandoned') navigate('/play')
  }

  const claimTimeout = async () => {
    setBusy(true)
    const data = await rpc('claim_timeout', { p_match_id: matchId })
    setBusy(false)
    if (data?.winner === myId) toast('Win claimed — your opponent timed out.', 'success')
  }

  const copyInvite = useCallback(() => {
    const url = `${window.location.origin}/play/${matchId}`
    navigator.clipboard?.writeText(url)
    setCopied(true)
    toast('Invite link copied', 'success')
    setTimeout(() => setCopied(false), 1500)
  }, [matchId, toast])

  // One-click rematch: spin up a fresh open room of the same game and jump to it.
  const newGame = async () => {
    if (!match?.game_type) return
    setBusy(true)
    const { data, error } = await supabase.rpc('create_room', {
      p_game_type: match.game_type,
      p_is_private: false,
    })
    setBusy(false)
    if (error) {
      toast(error.message || 'Could not start a new game.', 'error')
      return
    }
    if (data?.id) navigate(`/play/${data.id}`)
  }

  if (loading) {
    return (
      <>
        <AppNav />
        <div className="page-loader"><div className="spinner" /></div>
      </>
    )
  }

  if (error || !match) {
    return (
      <>
        <AppNav />
        <main className="app-main">
          <div className="app-wrap center">
            <div className="empty-state">
              {error || 'Match not found.'}
              <div style={{ marginTop: 18 }}>
                <Link className="btn btn-green btn-sm" to="/play">Back to game hub</Link>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  const isP1 = myId === match.player1
  const p1 = players[match.player1]
  const p2 = players[match.player2]
  const oppId = isP1 ? match.player2 : match.player1
  const finished = match.status === 'finished' || match.status === 'abandoned'
  const isMyTurn = match.status === 'active' && match.current_turn === myId
  const isTurnGame = match.game_type !== 'trivia'

  // ---------- waiting room ----------
  if (match.status === 'waiting') {
    const inviteUrl = `${window.location.origin}/play/${match.id}`
    return (
      <>
        <AppNav />
        <main className="app-main">
          <div className="app-wrap">
            <div className="board-panel waiting-room">
              <div className="spinner" style={{ margin: '0 auto 20px' }} />
              <h2 style={{ fontSize: 24, marginBottom: 8 }}>Waiting for an opponent…</h2>
              <p className="muted">{gameLabel(match.game_type)} · share this link to invite someone:</p>
              <div className="code">{inviteUrl}</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
                <button className="btn btn-line btn-sm" onClick={copyInvite}>
                  {copied ? 'Copied ✓' : 'Copy link'}
                </button>
                <button className="btn btn-line btn-sm" onClick={resign} disabled={busy}>
                  Cancel room
                </button>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  // ---------- result banner ----------
  let banner = null
  if (finished) {
    if (match.status === 'abandoned') {
      banner = <div className="status-banner draw">This game was cancelled.</div>
    } else if (match.result === 'draw') {
      banner = <div className="status-banner draw">It's a draw! 🤝</div>
    } else if (match.winner === myId) {
      banner = <div className="status-banner win">🎉 You won! Rating updated.</div>
    } else {
      banner = <div className="status-banner lose">You lost this one. Rematch?</div>
    }
  } else if (isTurnGame) {
    banner = isMyTurn ? (
      <div className="status-banner your-turn">Your move</div>
    ) : (
      <div className="status-banner wait">Waiting for opponent's move…</div>
    )
  }

  const boardDisabled = finished || (isTurnGame && !isMyTurn)

  // Live timeout eligibility. You can't claim on your own move; otherwise the
  // opponent must be idle past the server threshold (chess 180s / else 60s).
  const lastMoveMs = match.last_move_at ? new Date(match.last_move_at).getTime() : nowTs
  const claimRemainMs = Math.max(0, lastMoveMs + TIMEOUT_MS(match.game_type) - nowTs)
  const claimEligible = !(isTurnGame && isMyTurn)
  const canClaim = claimEligible && claimRemainMs <= 0
  const claimLabel =
    claimEligible && claimRemainMs > 0
      ? `Claim win in ${fmtClock(claimRemainMs)}`
      : 'Claim win (opponent away)'

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ fontSize: 24 }}>{gameLabel(match.game_type)}</h1>
            <Link className="btn btn-line btn-sm" to="/play">← Game hub</Link>
          </div>

          <div className="game-layout">
            <div className="board-panel">
              {finished && match.status === 'finished' && match.winner === myId && <Confetti />}
              <div className="banner-region" aria-live="polite">
                {connState === 'reconnecting' && !finished && (
                  <div className="status-banner wait reconnecting">
                    <span className="spinner sm" /> Reconnecting… your moves are safe.
                  </div>
                )}
                {banner}
              </div>
              <Suspense fallback={<div className="spinner" style={{ margin: '40px auto' }} />}>
                {match.game_type === 'tictactoe' && (
                  <TicTacToe match={match} makeMove={makeMove} disabled={boardDisabled} />
                )}
                {match.game_type === 'connect_four' && (
                  <ConnectFour match={match} makeMove={makeMove} disabled={boardDisabled} />
                )}
                {match.game_type === 'chess' && (
                  <ChessGame
                    fen={match.board_state?.fen}
                    orientation={isP1 ? 'white' : 'black'}
                    myColor={isP1 ? 'w' : 'b'}
                    makeMove={makeChessMove}
                    disabled={boardDisabled}
                  />
                )}
                {match.game_type === 'trivia' && (
                  <Trivia match={match} myId={myId} answerTrivia={answerTrivia} />
                )}
                {match.game_type === 'checkers' && (
                  <Checkers
                    match={match}
                    makeMove={makeCheckersMove}
                    myColor={isP1 ? 1 : 2}
                    disabled={boardDisabled}
                  />
                )}
              </Suspense>

              {finished && (
                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <button className="btn btn-green" onClick={newGame} disabled={busy}>New game</button>
                  <Link className="btn btn-line" to="/play">Back to hub</Link>
                </div>
              )}
            </div>

            <div className="side-panel">
              <div className="panel">
                <h4>Players</h4>
                <Seat
                  profile={p1}
                  label="Player 1"
                  isTurn={match.current_turn === match.player1 && !finished}
                  isOnline={online.includes(match.player1)}
                  isYou={isP1}
                  rating={ratings[match.player1]}
                />
                <Seat
                  profile={p2}
                  label="Player 2"
                  isTurn={match.current_turn === match.player2 && !finished}
                  isOnline={online.includes(match.player2)}
                  isYou={!isP1}
                  rating={ratings[match.player2]}
                />
              </div>

              {!finished && (
                <div className="panel">
                  <h4>Actions</h4>
                  {oppId && !online.includes(oppId) && (
                    <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                      Your opponent looks offline. If they don't move, you can claim the win after
                      a short wait.
                    </p>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <button
                      className="btn btn-line btn-sm"
                      onClick={claimTimeout}
                      disabled={busy || !canClaim}
                    >
                      {claimLabel}
                    </button>
                    <button className="btn btn-line btn-sm" onClick={resign} disabled={busy}>
                      Resign
                    </button>
                  </div>
                </div>
              )}

              {actionError && (
                <div className="panel">
                  <p className="err-text">{actionError}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
