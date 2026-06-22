import { Navigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { isSupabaseConfigured } from '../lib/supabaseClient.js'
import { Mark } from '../components/BrandMark.jsx'

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" style={{ width: 20, height: 20 }}>
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.5a18.3 18.3 0 0 1 4.3 1.4 13.6 13.6 0 0 0-15 0A18.3 18.3 0 0 1 8.8 3.5L8.6 3a19.8 19.8 0 0 0-4.9 1.4C.6 9 0 13.5.3 17.9A19.9 19.9 0 0 0 6.4 21l.4-.6a11.9 11.9 0 0 1-1.9-.9l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.2.7-1.9.9l.4.6a19.9 19.9 0 0 0 6.1-3.1c.4-5.1-.6-9.6-2.9-13.5ZM8.3 15.4c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7.4 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  )
}

export default function Login() {
  const { session, loading, signInWithDiscord } = useAuth()

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    )
  }
  if (session) return <Navigate to="/play" replace />

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <Mark />
        <h1>Welcome home</h1>
        <p>Sign in with Discord to join the game hub, challenge fellow Jordanians, and climb the leaderboard.</p>

        <button className="btn btn-discord" onClick={signInWithDiscord} disabled={!isSupabaseConfigured}>
          <DiscordIcon />
          Continue with Discord
        </button>

        {!isSupabaseConfigured && (
          <div className="config-warn">
            ⚠️ Supabase isn't configured yet. Add your <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env.local</code> and restart the dev server.
            See <strong>README.md</strong> for the full setup.
          </div>
        )}

        <div className="auth-foot">
          <Link to="/">← Back to the community home</Link>
        </div>
      </div>
    </div>
  )
}
