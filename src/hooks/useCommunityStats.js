import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

// Pulls the live Discord community numbers (member count + online now) from the
// discord-stats Edge Function, which caches Discord's invite-with-counts result
// server-side. Defaults to null so the landing page shows a neutral placeholder
// until the first response arrives — and so a failed fetch never blanks the page
// or shows an invented number.
export function useCommunityStats() {
  const [stats, setStats] = useState({ memberCount: null, onlineCount: null })

  useEffect(() => {
    let active = true
    supabase.functions
      .invoke('discord-stats')
      .then(({ data, error }) => {
        if (!active || error || !data) return
        setStats({
          memberCount: typeof data.member_count === 'number' ? data.member_count : null,
          onlineCount: typeof data.online_count === 'number' ? data.online_count : null,
        })
      })
      .catch(() => {
        /* keep defaults — the page still renders with its placeholder */
      })
    return () => {
      active = false
    }
  }, [])

  return stats
}
