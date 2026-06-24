// =====================================================================
// Jordan Stand Tall — live Discord community stats (members + online)
// =====================================================================
//
// Why this exists:
//   The landing page shows the real Discord member count and online count.
//   Discord exposes both through the public invite-with-counts endpoint — no
//   bot and no token required:
//
//     GET https://discord.com/api/v10/invites/<code>?with_counts=true
//       -> { approximate_member_count, approximate_presence_count, ... }
//
//   We never call that from the browser (CORS, rate limits, and one exposed
//   request per visitor). Instead this Edge Function fetches it at most once
//   per TTL, caches the result in public.community_stats with the service role,
//   and serves the cached row the rest of the time. If Discord is unreachable
//   we return the last known good row rather than erroring.
//
// Public endpoint (the landing page is shown to logged-out visitors):
//   Deploy:       supabase functions deploy discord-stats --no-verify-jwt
//   Optional env: DISCORD_INVITE_CODE (default 'makejordangreatagain'),
//                 STATS_TTL_SECONDS   (default 600)

import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const INVITE = Deno.env.get('DISCORD_INVITE_CODE') || 'makejordangreatagain'
const TTL_MS = Number(Deno.env.get('STATS_TTL_SECONDS') || '600') * 1000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const url = Deno.env.get('SUPABASE_URL')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(url, service)

  // The cached row is both our cache and our fallback.
  const { data: cached } = await admin
    .from('community_stats')
    .select('member_count, online_count, updated_at')
    .eq('id', true)
    .maybeSingle()

  // Fresh enough? Serve the cache and skip Discord entirely.
  const ageMs = cached?.updated_at
    ? Date.now() - new Date(cached.updated_at).getTime()
    : Infinity
  if (cached && ageMs < TTL_MS) return json({ ...cached, cached: true })

  // Stale (or empty) — refresh from Discord. A User-Agent is required or
  // Discord may answer 403.
  try {
    const res = await fetch(
      `https://discord.com/api/v10/invites/${INVITE}?with_counts=true`,
      { headers: { 'User-Agent': 'JordanStandTall (https://makejordangreatagain.com, 1.0)' } },
    )
    if (!res.ok) throw new Error(`Discord responded ${res.status}`)
    const d = await res.json()

    const member_count = d.approximate_member_count ?? d.profile?.member_count ?? null
    const online_count = d.approximate_presence_count ?? d.profile?.online_count ?? null
    if (member_count == null) throw new Error('No member count in Discord response')

    const updated_at = new Date().toISOString()
    await admin.from('community_stats').upsert({ id: true, member_count, online_count, updated_at })

    return json({ member_count, online_count, updated_at, cached: false })
  } catch (e) {
    // Discord failed — serve the last known good row if we have one.
    if (cached) return json({ ...cached, cached: true, stale: true })
    return json({ error: String((e as Error)?.message || e) }, 502)
  }
})
