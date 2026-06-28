import { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'
import { MOCK_AUTH_ENABLED, mockSession, mockProfile } from '../lib/devAuth.js'

const AuthContext = createContext(null)

// Pull the best-available Discord fields out of the auth user metadata.
// Discord's keys vary, so we coalesce across the common ones.
function discordFields(user) {
  const m = user?.user_metadata || {}
  return {
    discord_id: m.provider_id || m.sub || null,
    username: m.user_name || m.name || m.full_name || m.preferred_username || 'jordanian',
    global_name: m.global_name || m.custom_claims?.global_name || m.full_name || m.name || null,
    avatar_url: m.avatar_url || m.picture || null,
  }
}

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    console.error('[auth] failed to load profile:', error.message)
    return null
  }
  return data
}

export function AuthProvider({ children }) {
  // DEV-ONLY: when mock auth is enabled, boot straight into a fake signed-in
  // state and skip every real Supabase auth call. See src/lib/devAuth.js.
  const [session, setSession] = useState(MOCK_AUTH_ENABLED ? mockSession : null)
  const [profile, setProfile] = useState(MOCK_AUTH_ENABLED ? mockProfile : null)
  const [loading, setLoading] = useState(!MOCK_AUTH_ENABLED)

  const loadProfile = useCallback(async (user) => {
    if (!user) {
      setProfile(null)
      return
    }
    // The signup trigger creates the row; retry briefly in case we beat it.
    let p = await fetchProfile(user.id)
    if (!p) {
      await new Promise((r) => setTimeout(r, 600))
      p = await fetchProfile(user.id)
    }
    if (p) {
      // Best-effort: keep username/avatar fresh from Discord on each login.
      const fresh = discordFields(user)
      const needsUpdate =
        p.username !== fresh.username ||
        p.avatar_url !== fresh.avatar_url ||
        p.global_name !== fresh.global_name
      if (needsUpdate) {
        const { data: updated } = await supabase
          .from('profiles')
          .update({
            username: fresh.username,
            global_name: fresh.global_name,
            avatar_url: fresh.avatar_url,
          })
          .eq('id', user.id)
          .select()
          .maybeSingle()
        if (updated) p = updated
      }
      setProfile(p)
    } else {
      // Fallback so the UI still works even if the row is missing.
      setProfile({ id: user.id, ...discordFields(user) })
    }
  }, [])

  useEffect(() => {
    // DEV-ONLY: mock auth already seeded session + profile; don't touch Supabase.
    if (MOCK_AUTH_ENABLED) {
      console.warn(
        '[auth] DEV mock auth is ACTIVE — signed in as a fake user. ' +
          'This is gated to dev builds and must never be enabled in production.',
      )
      return
    }

    let active = true
    // A transient null session (a failed token refresh that supabase-js will
    // auto-retry, or an initial-event race) must NOT eject a player mid-game.
    // We debounce committing a null and cancel it the instant a real session
    // arrives; only an explicit SIGNED_OUT drops the session immediately.
    let nullCommitTimer = null
    const clearNullCommit = () => {
      if (nullCommitTimer) { clearTimeout(nullCommitTimer); nullCommitTimer = null }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
      // defer the DB call so it runs outside the auth lock
      setTimeout(() => {
        if (active) loadProfile(data.session?.user)
      }, 0)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!active) return
      setLoading(false)

      if (newSession) {
        // A real session — cancel any pending null-commit and apply it.
        clearNullCommit()
        setSession(newSession)
        // IMPORTANT: never await Supabase calls directly inside this callback —
        // it runs while the auth client holds a lock, and awaiting another
        // Supabase call here deadlocks (the sign-in hangs forever). Defer it.
        setTimeout(() => {
          if (active) loadProfile(newSession.user)
        }, 0)
        return
      }

      if (event === 'SIGNED_OUT') {
        // Explicit sign-out — drop the session now.
        clearNullCommit()
        setSession(null)
        setTimeout(() => { if (active) loadProfile(null) }, 0)
        return
      }

      // Transient null on any other event: hold for a beat. If a real session
      // comes back (the refresh succeeds), the commit above cancels this.
      clearNullCommit()
      nullCommitTimer = setTimeout(() => {
        if (!active) return
        nullCommitTimer = null
        setSession(null)
        loadProfile(null)
      }, 1500)
    })

    return () => {
      active = false
      clearNullCommit()
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signInWithDiscord = useCallback(async (returnTo) => {
    // DEV-ONLY: re-seed the fake session (e.g. after a mock sign-out).
    if (MOCK_AUTH_ENABLED) {
      setSession(mockSession)
      setProfile(mockProfile)
      return
    }
    if (!isSupabaseConfigured) {
      alert('Supabase is not configured yet. See README.md to finish setup.')
      return
    }
    // The OAuth round-trip drops React Router state, so remember where the user
    // was headed (e.g. a Monopoly room they got redirected away from) and let
    // AuthCallback restore it after sign-in.
    try {
      if (returnTo && typeof returnTo === 'string' && returnTo !== '/login') {
        sessionStorage.setItem('mjg:returnTo', returnTo)
      }
    } catch { /* ignore */ }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) alert('Could not start Discord sign-in: ' + error.message)
  }, [])

  const signOut = useCallback(async () => {
    // DEV-ONLY: no real session to revoke; just drop the fake one.
    if (!MOCK_AUTH_ENABLED) await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (MOCK_AUTH_ENABLED) return
    if (session?.user) await loadProfile(session.user)
  }, [session, loadProfile])

  // Memoized so a re-render of the provider (e.g. a token refresh firing
  // setSession with an identical user) doesn't churn every useAuth() consumer —
  // which would needlessly re-run effects like the Monopoly realtime hook.
  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      // UI-only flag (the /admin route + nav link). Every admin RPC re-checks
      // is_admin server-side, so this never grants real privilege on its own.
      isAdmin: !!profile?.is_admin,
      loading,
      signInWithDiscord,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, signInWithDiscord, signOut, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function RequireAuth({ children }) {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}

// Gate for the ops/admin surface. Requires a session AND profile.is_admin; a
// non-admin is bounced to the game hub. (Server-side RPCs enforce admin too.)
export function RequireAdmin({ children }) {
  const { session, profile, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="page-loader">
        <div className="spinner" />
      </div>
    )
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (!profile?.is_admin) {
    return <Navigate to="/play" replace />
  }
  return children
}
