import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient.js'

// Fetch all active rows from a public resource table, ordered by `orderBy`
// (default `sort`). Mirrors the fetch-then-render pattern in Leaderboard.jsx
// but is reusable across the tourism / services / emergency pages. Works for
// anonymous visitors because those tables grant public (anon) SELECT and the
// RLS policy already limits results to active rows.
export function useResource(table, { orderBy = 'sort' } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(false)
    supabase
      .from(table)
      .select('*')
      .order(orderBy, { ascending: true })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setError(true)
        setRows(data || [])
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [table, orderBy])

  return { rows, loading, error }
}
