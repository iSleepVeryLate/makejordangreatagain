import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

if (!isSupabaseConfigured) {
  // Helpful message during local setup — the app still mounts so you can see the UI.
  console.warn(
    '[Jordan Stand Tall] Supabase is not configured. ' +
      'Copy .env.example to .env.local and add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
  )
}

// Even when unconfigured we create a client with placeholders so imports never crash.
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  {
    auth: {
      flowType: 'pkce',
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
    },
  },
)
