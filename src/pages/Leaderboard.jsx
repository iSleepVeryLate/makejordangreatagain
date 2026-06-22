import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { GAMES, gameLabel } from '../games/config.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'

export default function Leaderboard() {
  const { profile } = useAuth()
  const [game, setGame] = useState('tictactoe')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    supabase
      .from('leaderboard')
      .select('*')
      .eq('game_type', game)
      .order('rank', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        setRows(data || [])
        setLoading(false)
      })
  }, [game])

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="section-head">
            <h1>Leaderboard</h1>
            <p>Top players across the community. Win games to climb the ranks.</p>
          </div>

          <div className="lb-tabs">
            {GAMES.map((g) => (
              <button
                key={g.key}
                className={`lb-tab${game === g.key ? ' active' : ''}`}
                onClick={() => setGame(g.key)}
              >
                {g.emoji} {g.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="lb-skeleton">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="skeleton skel-lb-row" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="empty-state">
              No ranked games of {gameLabel(game)} yet. Be the first — head to the{' '}
              <Link to="/play" style={{ color: 'var(--green-bright)' }}>game hub</Link>!
            </div>
          ) : (
            <table className="lb-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Player</th>
                  <th className="num-cell">Rating</th>
                  <th className="num-cell">W</th>
                  <th className="num-cell">L</th>
                  <th className="num-cell">D</th>
                  <th className="num-cell">Played</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.profile_id} className={r.profile_id === profile?.id ? 'me' : ''}>
                    <td className={`lb-rank${r.rank <= 3 ? ' top' : ''}`}>
                      {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : r.rank}
                    </td>
                    <td>
                      <div className="lb-player">
                        <Avatar profile={r} />
                        <Link to={`/profile/${r.profile_id}`}>
                          {r.global_name || r.username}
                        </Link>
                      </div>
                    </td>
                    <td className="num-cell" style={{ fontWeight: 700, color: 'var(--green-bright)' }}>{r.rating}</td>
                    <td className="num-cell">{r.wins}</td>
                    <td className="num-cell">{r.losses}</td>
                    <td className="num-cell">{r.draws}</td>
                    <td className="num-cell">{r.games_played}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </>
  )
}
