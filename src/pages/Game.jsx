import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useMatch } from '../hooks/useMatch.js'
import { gameLabel } from '../games/config.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'

// Lazy-loaded so each board (and chess's heavy engine + board deps) only ships
// to players who actually open that game.
const TicTacToe = lazy(() => import('../games/TicTacToe.jsx'))
const ConnectFour = lazy(() => import('../games/ConnectFour.jsx'))
const ChessGame = lazy(() => import('../games/ChessGame.jsx'))
const Trivia = lazy(() => import('../games/Trivia.jsx'))

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
  const { match, players, online, loading, error, connState, myId, applyRow } = useMatch(matchId)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ratings, setRatings] = useState({})

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
  // board the client made up.
  const makeChessMove = useCallback(
    async (move) => {
      setActionError('')
      const { data, error } = await supabase.functions.invoke('chess-move', {
        body: { match_id: matchId, from: move.from, to: move.to, promotion: move.promotion },
      })
      if (!error) {
        applyRow(data)
        return data
      }
      // FunctionsHttpError → the function ran and rejected the move (illegal /
      // not your turn). Surface it; never fall back to the open RPC path.
      if (error.context && typeof error.context.json === 'function') {
        let msg = 'Move rejected.'
        try {
          msg = (await error.context.json())?.error || msg
        } catch {
          /* non-JSON body */
        }
        setActionError(msg)
        return null
      }
      // Couldn't reach the function (not deployed yet) — fall back to the legacy
      // RPC so honest play keeps working during rollout. Once chess-move is
      // deployed and migration 0004 is applied, this branch is never taken.
      return rpc('make_move', { p_match_id: matchId, p_move: move })
    },
    [matchId, applyRow, rpc],
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
    await rpc('claim_timeout', { p_match_id: matchId })
    setBusy(false)
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
                <button
                  className="btn btn-line btn-sm"
                  onClick={() => navigator.clipboard?.writeText(inviteUrl)}
                >
                  Copy link
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
              {connState === 'reconnecting' && !finished && (
                <div className="status-banner wait reconnecting">
                  <span className="spinner sm" /> Reconnecting… your moves are safe.
                </div>
              )}
              {banner}
              <Suspense fallback={<div className="spinner" style={{ margin: '40px auto' }} />}>
                {match.game_type === 'tictactoe' && (
                  <TicTacToe match={match} makeMove={makeMove} disabled={boardDisabled} />
                )}
                {match.game_type === 'connect_four' && (
                  <ConnectFour match={match} makeMove={makeMove} disabled={boardDisabled} />
                )}
                {match.game_type === 'chess' && (
                  <ChessGame match={match} myId={myId} makeMove={makeChessMove} disabled={boardDisabled} />
                )}
                {match.game_type === 'trivia' && (
                  <Trivia match={match} myId={myId} answerTrivia={answerTrivia} />
                )}
              </Suspense>

              {finished && (
                <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
                  <Link className="btn btn-green" to="/play">Play again</Link>
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
                    <button className="btn btn-line btn-sm" onClick={claimTimeout} disabled={busy}>
                      Claim win (opponent away)
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
