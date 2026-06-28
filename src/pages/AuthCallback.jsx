import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// supabase-js (detectSessionInUrl) exchanges the ?code in the URL automatically.
// We just wait for the auth state to settle, then route the user onward and
// drop the code param from history.
export default function AuthCallback() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (!session) { navigate('/login', { replace: true }); return }
    // Restore the page the user was headed to before sign-in (stashed by
    // signInWithDiscord), falling back to the games hub.
    let to = '/play'
    try {
      const stored = sessionStorage.getItem('mjg:returnTo')
      if (stored) { to = stored; sessionStorage.removeItem('mjg:returnTo') }
    } catch { /* ignore */ }
    navigate(to, { replace: true })
  }, [loading, session, navigate])

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="spinner" style={{ margin: '0 auto 16px' }} />
        <p style={{ margin: 0 }}>Signing you in…</p>
      </div>
    </div>
  )
}
