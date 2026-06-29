import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useMatch } from '../hooks/useMatch.js'
import { friendlyRpcError } from '../lib/rpcErrors.js'
import { useToast } from '../context/ToastContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
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
  const { t } = useLang()
  return (
    <div className={`seat${isTurn ? ' turn' : ''}`}>
      <Avatar profile={profile} size="md" />
      <div className="info">
        <div className="nm">
          {profile?.global_name || profile?.username || label}{' '}
          {isYou && <span className="you-badge">{t('app.game.you')}</span>}
        </div>
        <div className="rt">{rating != null ? t('app.game.rating', { n: rating }) : ' '}</div>
      </div>
      <span
        className={isOnline ? 'dot-online' : 'dot-offline'}
        title={isOnline ? t('app.game.online') : t('app.game.offline')}
      />
    </div>
  )
}

export default function Game() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { t } = useLang()
  const gl = (key) => t(`game.${key}.label`)
  const { match, players, online, loading, error, connState, myId, applyRow, refetch, matchRef, nudge, serverNow } = useMatch(matchId)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ratings, setRatings] = useState({})
  const [copied, setCopied] = useState(false)
  // Server-derived reconnect-grace window for the claim-timeout button.
  const [grace, setGrace] = useState(null)
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
      toast(t('app.game.opponentJoined'), 'success')
    }
    if (status) prevStatusRef.current = status
  }, [match?.status, toast, t])

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

  // Server-authoritative reconnect-grace for the claim-timeout button. Polled so
  // the countdown is anchored to SERVER time (never the local clock) and is honest
  // about whether the opponent is actually disconnected vs just slow. Degrades to
  // the local last_move_at estimate if match_grace_status isn't deployed yet.
  useEffect(() => {
    if (!matchId || match?.status !== 'active') {
      setGrace(null)
      return undefined
    }
    let active = true
    const fetchGrace = () => {
      supabase.rpc('match_grace_status', { p_match: matchId }).then(
        ({ data, error }) => {
          if (!active || error || !data) return
          const serverNow = data.server_now ? new Date(data.server_now).getTime() : Date.now()
          setGrace({
            claimAt: data.claim_at ? new Date(data.claim_at).getTime() : null,
            offset: serverNow - Date.now(),
            oppPresent: !!data.opp_present,
          })
        },
        () => {},
      )
    }
    fetchGrace()
    const iv = setInterval(fetchGrace, 8000)
    return () => {
      active = false
      clearInterval(iv)
    }
  }, [matchId, match?.status, match?.last_move_at, match?.current_turn])

  const rpc = useCallback(
    async (name, params) => {
      setActionError('')
      const { data, error } = await supabase.rpc(name, params)
      if (error) {
        setActionError(error.message)
        return null
      }
      applyRow(data)
      nudge() // P1: ping the opponent to pull this update now, not on the next poll
      return data
    },
    [applyRow, nudge],
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
          board_state: {
            ...(prev.board_state || {}),
            fen: move.optimisticFen,
            // P2: carry the optimistic PGN too so the move list + last-move
            // highlight update instantly, not a beat later on reconcile. Keep the
            // prior PGN if the board couldn't build one (it always can).
            ...(move.optimisticPgn ? { pgn: move.optimisticPgn } : {}),
          },
          current_turn: oppId, // flips the turn so the board disables immediately
          last_move_at: new Date().toISOString(),
          // Bump the monotonic counter so a poll/realtime read still in flight
          // from BEFORE this move can't land afterward and snap the board back.
          // The server's reconcile carries the same count, so it still applies.
          move_count: (prev.move_count || 0) + 1,
        })
      }

      const { data, error } = await supabase.functions.invoke('chess-move', {
        body: { match_id: matchId, from: move.from, to: move.to, promotion: move.promotion },
      })
      if (!error) {
        applyRow(data) // reconcile to authoritative state (visually a no-op)
        nudge() // P1: push this move to the opponent immediately
        return data
      }
      // FunctionsHttpError → the function ran and rejected the move (illegal /
      // not your turn). Roll back the optimistic move and surface why.
      if (error.context && typeof error.context.json === 'function') {
        let msg = t('app.game.moveRejected')
        try {
          msg = (await error.context.json())?.error || msg
        } catch {
          /* non-JSON body */
        }
        if (prev) applyRow(prev, { force: true }) // undo the optimistic move (restores older count)
        else refetch?.()
        setActionError(msg)
        toast(msg, 'error')
        return null
      }
      // Couldn't reach the function (not deployed yet) — fall back to the legacy
      // RPC so honest play keeps working during rollout. Once chess-move is
      // deployed and migration 0004 is applied, this branch is never taken.
      const fallback = await rpc('make_move', { p_match_id: matchId, p_move: move })
      if (!fallback && prev) applyRow(prev, { force: true }) // RPC also failed → undo optimistic move
      return fallback
    },
    [matchId, applyRow, refetch, matchRef, myId, rpc, toast, t, nudge],
  )

  // Checkers is server-authoritative via the checkers-move Edge Function. The
  // board plays optimistically and submits a whole turn as a `path` (one request
  // even for a multi-jump); here we just relay it and reconcile to the
  // authoritative row, or roll back to `prev` and surface why on rejection.
  // There is no make_move fallback: that RPC rejects checkers by design.
  const makeCheckersMove = useCallback(
    async (move) => {
      setActionError('')
      const prev = matchRef.current
      const { data, error } = await supabase.functions.invoke('checkers-move', {
        body: { match_id: matchId, path: move.path },
      })
      if (!error) {
        applyRow(data)
        nudge() // P1: push this move to the opponent immediately
        return data
      }
      // FunctionsHttpError → the function ran and rejected the move (illegal /
      // not your turn). Surface why; the board is unchanged so nothing to undo.
      if (error.context && typeof error.context.json === 'function') {
        let msg = t('app.game.moveRejected')
        try {
          msg = (await error.context.json())?.error || msg
        } catch {
          /* non-JSON body */
        }
        if (prev) applyRow(prev, { force: true })
        else refetch?.()
        setActionError(msg)
        toast(msg, 'error')
        return null
      }
      // Couldn't reach the function at all.
      const msg = t('app.game.serverUnreachable')
      setActionError(msg)
      toast(msg, 'error')
      refetch?.()
      return null
    },
    [matchId, applyRow, refetch, matchRef, toast, t, nudge],
  )

  const resign = async () => {
    if (!confirm(t('app.game.resignConfirm'))) return
    setBusy(true)
    const data = await rpc('resign', { p_match_id: matchId })
    setBusy(false)
    if (data?.status === 'abandoned') navigate('/play')
  }

  const claimTimeout = async () => {
    setBusy(true)
    const data = await rpc('claim_timeout', { p_match_id: matchId })
    setBusy(false)
    if (data?.winner === myId) toast(t('app.game.winClaimed'), 'success')
  }

  const copyInvite = useCallback(() => {
    const url = `${window.location.origin}/play/${matchId}`
    navigator.clipboard?.writeText(url)
    setCopied(true)
    toast(t('app.game.inviteCopied'), 'success')
    setTimeout(() => setCopied(false), 1500)
  }, [matchId, toast, t])

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
      toast(friendlyRpcError(error, t), 'error')
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
              {!error || error === 'not_found' ? t('app.game.matchNotFound') : error}
              <div style={{ marginTop: 18 }}>
                <Link className="btn btn-green btn-sm" to="/play">{t('app.game.backToHub')}</Link>
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
              <h2 style={{ fontSize: 24, marginBottom: 8 }}>{t('app.hub.waitingOpponent')}</h2>
              <p className="muted">{gl(match.game_type)} · {t('app.game.shareInvite')}</p>
              <div className="code">{inviteUrl}</div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginTop: 8 }}>
                <button className="btn btn-line btn-sm" onClick={copyInvite}>
                  {copied ? t('app.game.copied') : t('app.game.copyLink')}
                </button>
                <button className="btn btn-line btn-sm" onClick={resign} disabled={busy}>
                  {t('app.game.cancelRoom')}
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
      const closedMsg =
        match.closed_reason === 'inactive'
          ? t('app.game.closedInactive')
          : match.closed_reason === 'admin'
            ? t('app.game.closedAdmin')
            : t('app.game.cancelled')
      banner = <div className="status-banner draw">{closedMsg}</div>
    } else if (match.result === 'draw') {
      banner = <div className="status-banner draw">{t('app.game.draw')}</div>
    } else if (match.winner === myId) {
      banner = <div className="status-banner win">{t('app.game.youWon')}</div>
    } else {
      banner = <div className="status-banner lose">{t('app.game.youLost')}</div>
    }
  } else if (isTurnGame) {
    banner = isMyTurn ? (
      <div className="status-banner your-turn">{t('app.hub.yourMove')}</div>
    ) : (
      <div className="status-banner wait">{t('app.game.waitingMove')}</div>
    )
  }

  const boardDisabled = finished || (isTurnGame && !isMyTurn)

  // Live timeout eligibility. You can't claim on your own move; otherwise the
  // opponent must be idle past the window. Prefer the SERVER-derived grace window
  // (honest about whether the opponent actually disconnected — a disconnected
  // opponent shortens the wait); fall back to the local last_move_at clock (chess
  // 180s / checkers 120s / else 60s) when match_grace_status isn't available.
  const lastMoveMs = match.last_move_at ? new Date(match.last_move_at).getTime() : nowTs
  // Anchor "now" to SERVER time: the grace RPC's offset when we have it, else
  // useMatch's last_move_at-derived estimate (P3) — so the fallback countdown
  // stays honest on a skewed device clock. nowTs ticks 1/s to keep it live.
  const serverNowTs = grace ? nowTs + grace.offset : (serverNow ? serverNow() : nowTs)
  const claimAtMs = grace?.claimAt ?? lastMoveMs + TIMEOUT_MS(match.game_type)
  const claimRemainMs = Math.max(0, claimAtMs - serverNowTs)
  const claimEligible = !(isTurnGame && isMyTurn)
  const canClaim = claimEligible && claimRemainMs <= 0
  // Server presence wins when we have it; else fall back to the realtime channel.
  const oppDisconnected = grace ? !grace.oppPresent : !!(oppId && !online.includes(oppId))
  const claimLabel =
    claimEligible && claimRemainMs > 0
      ? oppDisconnected
        ? t('app.game.oppDisconnectedClaim', { clock: fmtClock(claimRemainMs) })
        : t('app.game.claimIn', { clock: fmtClock(claimRemainMs) })
      : t('app.game.claimNow')

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="section-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ fontSize: 24 }}>{gl(match.game_type)}</h1>
            <Link className="btn btn-line btn-sm back-hub" to="/play">{t('app.game.backHub')}</Link>
          </div>

          <div className="game-layout">
            <div className="board-panel">
              {finished && match.status === 'finished' && match.winner === myId && <Confetti />}
              <div className="banner-region" aria-live="polite">
                {connState === 'reconnecting' && !finished && (
                  <div className="status-banner wait reconnecting">
                    <span className="spinner sm" /> {t('app.game.reconnecting')}
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
                    pgn={match.board_state?.pgn}
                    orientation={isP1 ? 'white' : 'black'}
                    myColor={isP1 ? 'w' : 'b'}
                    makeMove={makeChessMove}
                    disabled={boardDisabled}
                    finished={finished}
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
                  <button className="btn btn-green" onClick={newGame} disabled={busy}>{t('app.game.newGame')}</button>
                  <Link className="btn btn-line" to="/play">{t('app.game.backToHubShort')}</Link>
                </div>
              )}
            </div>

            <div className="side-panel">
              <div className="panel">
                <h4>{t('app.game.players')}</h4>
                <Seat
                  profile={p1}
                  label={t('app.game.player1')}
                  isTurn={match.current_turn === match.player1 && !finished}
                  isOnline={online.includes(match.player1)}
                  isYou={isP1}
                  rating={ratings[match.player1]}
                />
                <Seat
                  profile={p2}
                  label={t('app.game.player2')}
                  isTurn={match.current_turn === match.player2 && !finished}
                  isOnline={online.includes(match.player2)}
                  isYou={!isP1}
                  rating={ratings[match.player2]}
                />
              </div>

              {!finished && (
                <div className="panel">
                  <h4>{t('app.game.actions')}</h4>
                  {oppDisconnected && (
                    <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                      {t('app.game.oppOffline')}
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
                      {t('app.game.resign')}
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
