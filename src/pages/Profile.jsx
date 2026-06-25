import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useLang } from '../context/LanguageContext.jsx'
import { MOCK_AUTH_ENABLED } from '../lib/devAuth.js'
import { GAMES } from '../games/config.js'
import AppNav from '../components/AppNav.jsx'
import Avatar from '../components/Avatar.jsx'

export default function Profile() {
  const { id } = useParams()
  const { profile: me } = useAuth()
  const { t, lang } = useLang()
  const gl = (key) => t(`game.${key}.label`)
  const [profile, setProfile] = useState(null)
  const [statsByGame, setStatsByGame] = useState({})
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setNotFound(false)
    // DEV mock auth: the synthetic user has no DB row, so render the in-context
    // mock profile for its own page instead of a dead-end "not found".
    if (MOCK_AUTH_ENABLED && me && id === me.id) {
      setProfile(me)
      setStatsByGame({})
      setLoading(false)
      return () => {
        active = false
      }
    }
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
        <main className="app-main">
          <div className="app-wrap">
            <div className="profile-head">
              <div className="skeleton" style={{ width: 76, height: 76, borderRadius: '50%' }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton skel-line" style={{ width: 220, height: 24, marginBottom: 12 }} />
                <div className="skeleton skel-line" style={{ width: 150 }} />
              </div>
            </div>
            <div className="stat-grid">
              {GAMES.map((g) => (
                <div key={g.key} className="skeleton skel-card" />
              ))}
            </div>
          </div>
        </main>
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
              {t('app.profile.notExist')}
              <div style={{ marginTop: 18 }}>
                <Link className="btn btn-green btn-sm" to="/leaderboard">{t('app.profile.viewLeaderboard')}</Link>
              </div>
            </div>
          </div>
        </main>
      </>
    )
  }

  const isMe = me?.id === profile.id
  const joined = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(lang === 'ar' ? 'ar-JO' : undefined, { year: 'numeric', month: 'long' })
    : null

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
                {isMe && <span className="you-badge" style={{ marginInlineStart: 10, verticalAlign: 'middle' }}>{t('app.profile.you')}</span>}
              </div>
              <div className="pmeta">
                @{profile.username}
                {joined ? ` · ${t('app.profile.memberSince', { date: joined })}` : ''}
              </div>
            </div>
          </div>

          <div className="stat-grid">
            {GAMES.map((g) => {
              const s = statsByGame[g.key] || { rating: 1000, wins: 0, losses: 0, draws: 0, games_played: 0 }
              return (
                <div className="stat-card" key={g.key}>
                  <div className="gt">{g.emoji} {gl(g.key)}</div>
                  <div className="rating">{s.rating}</div>
                  <div className="rating-lbl">{t('app.profile.ratingPlayed', { n: s.games_played ?? (s.wins + s.losses + s.draws) })}</div>
                  <div className="wld">
                    <span><b>{s.wins}</b> {t('app.profile.win')}</span>
                    <span><b>{s.losses}</b> {t('app.profile.loss')}</span>
                    <span><b>{s.draws}</b> {t('app.profile.draw')}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {isMe && (
            <div style={{ marginTop: 30 }}>
              <Link className="btn btn-green" to="/play">{t('app.profile.playGame')}</Link>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
