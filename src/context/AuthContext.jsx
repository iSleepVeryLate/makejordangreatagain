import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js'

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
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

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
    let active = true

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setLoading(false)
      // defer the DB call so it runs outside the auth lock
      setTimeout(() => {
        if (active) loadProfile(data.session?.user)
      }, 0)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!active) return
      setSession(newSession)
      setLoading(false)
      // IMPORTANT: never await Supabase calls directly inside this callback —
      // it runs while the auth client holds a lock, and awaiting another
      // Supabase call here deadlocks (the sign-in hangs forever). Defer it.
      setTimeout(() => {
        if (active) loadProfile(newSession?.user)
      }, 0)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signInWithDiscord = useCallback(async () => {
    if (!isSupabaseConfigured) {
      alert('Supabase is not configured yet. See README.md to finish setup.')
      return
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) alert('Could not start Discord sign-in: ' + error.message)
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user)
  }, [session, loadProfile])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signInWithDiscord,
    signOut,
    refreshProfile,
  }

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
