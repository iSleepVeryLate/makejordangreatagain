import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { GAMES } from '../games/config.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'

export default function Profile() {
  const { id } = useParams()
  const { profile: me } = useAuth()
  const [profile, setProfile] = useState(null)
  const [statsByGame, setStatsByGame] = useState({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setNotFound(false)
    Promise.all([
      supabase.from('profiles').select('*').eq('id', id).maybeSingle(),
      supabase.from('game_stats').select('*').eq('profile_id', id),
    ]).then(([prof, stats]) => {
      if (!active) return
      if (!prof.data) {
        setNotFound(true)
      } else {
        setProfile(prof.data)
        setStatsByGame(Object.fromEntries((stats.data || []).map((s) => [s.game_type, s])))
      }
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [id])

  if (loading) {
    return (
      <>
        <AppNav />
        <div className="page-loader"><div className="spinner" /></div>
      </>
    )
  }

  if (notFound) {
    return (
      <>
        <AppNav />
        <main className="app-main">
          <div className="app-wrap center">
            <div className="empty-state">
              That player doesn't exist.
              <div style={{ marginTop: 18 }}>
                <Link className="btn btn-green btn-sm" to="/leaderboard">View leaderboard</Link>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  const isMe = me?.id === profile.id
  const joined = profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' }) : null

  return (
    <>
      <AppNav />
      <main className="app-main">
        <div className="app-wrap">
          <div className="profile-head">
            <Avatar profile={profile} size="lg" />
            <div>
              <div className="pname">
                {profile.global_name || profile.username}
                {isMe && <span className="you-badge" style={{ marginLeft: 10, verticalAlign: 'middle' }}>you</span>}
              </div>
              <div className="pmeta">
                @{profile.username}
                {joined ? ` · member since ${joined}` : ''}
              </div>
            </div>
          </div>

          <div className="stat-grid">
            {GAMES.map((g) => {
              const s = statsByGame[g.key] || { rating: 1000, wins: 0, losses: 0, draws: 0, games_played: 0 }
              return (
                <div className="stat-card" key={g.key}>
                  <div className="gt">{g.emoji} {g.label}</div>
                  <div className="rating">{s.rating}</div>
                  <div className="rating-lbl">rating · {s.games_played ?? (s.wins + s.losses + s.draws)} played</div>
                  <div className="wld">
                    <span><b>{s.wins}</b> W</span>
                    <span><b>{s.losses}</b> L</span>
                    <span><b>{s.draws}</b> D</span>
                  </div>
                </div>
              )
            })}
          </div>

          {isMe && (
            <div style={{ marginTop: 30 }}>
              <Link className="btn btn-green" to="/play">Play a game</Link>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
