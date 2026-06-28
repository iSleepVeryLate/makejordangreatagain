// =====================================================================
// Jordan Stand Tall — send a Web Push for a freshly-created notification
// =====================================================================
//
// Invoked by the public.notifications INSERT trigger (via pg_net), NOT by the
// browser. It looks up every device the recipient has registered and sends each
// one an encrypted Web Push signed with our VAPID key. Dead subscriptions
// (the browser unsubscribed / the push service 404s or 410s) are pruned so we
// don't keep hammering them.
//
//   Deploy: supabase functions deploy send-push --no-verify-jwt
//   Secrets (see migration 0012 for the full setup):
//     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_HOOK_SECRET
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:hello@makejordangreatagain.com'
const HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET') ?? ''

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Display names for each game, in both languages the site speaks.
const GAME_LABELS: Record<string, { en: string; ar: string }> = {
  tictactoe: { en: 'Tic-Tac-Toe', ar: 'إكس-أو' },
  connect_four: { en: 'Connect Four', ar: 'أربعة على التوالي' },
  chess: { en: 'Chess', ar: 'الشطرنج' },
  trivia: { en: 'Jordan Trivia', ar: 'معلومات الأردن' },
  checkers: { en: 'Checkers', ar: 'الدامة' },
}

function gameLabel(key: string | null, lang: string): string {
  if (!key) return ''
  const l = GAME_LABELS[key]
  return l ? (lang === 'ar' ? l.ar : l.en) : key
}

// Build the push title/body for a notification type, in the device's language.
// Returns null for types we deliberately don't push (e.g. a decline).
function content(
  type: string,
  actor: string,
  game: string,
  lang: string,
): { title: string; body: string } | null {
  const ar = lang === 'ar'
  switch (type) {
    case 'your_turn':
      return ar
        ? { title: 'دورك', body: `دورك في ${game} ضد ${actor}` }
        : { title: 'Your move', body: `It's your move vs ${actor} in ${game}` }
    case 'challenge':
      return ar
        ? { title: 'تحدٍّ جديد', body: `${actor} تحدّاك في ${game}` }
        : { title: 'New challenge', body: `${actor} challenged you to ${game}` }
    case 'challenge_accepted':
      return ar
        ? { title: 'تم قبول التحدي', body: `${actor} قبِل تحديك في ${game} — العب الآن` }
        : { title: 'Challenge accepted', body: `${actor} accepted your ${game} challenge — play now` }
    default:
      return null // challenge_declined and anything unknown: no push
  }
}

// Where tapping the notification should land the user.
function urlFor(type: string, matchId: string | null): string {
  if ((type === 'your_turn' || type === 'challenge_accepted') && matchId) return `/play/${matchId}`
  return '/play'
}

Deno.serve(async (req) => {
  // Only our own DB trigger may call this.
  if (HOOK_SECRET && req.headers.get('x-hook-secret') !== HOOK_SECRET) {
    return new Response('forbidden', { status: 401 })
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return new Response('VAPID keys not configured', { status: 500 })
  }

  let payload: {
    user_id?: string
    type?: string
    actor_id?: string | null
    match_id?: string | null
    game_type?: string | null
  }
  try {
    payload = await req.json()
  } catch {
    return new Response('bad request', { status: 400 })
  }

  const { user_id, type, actor_id, match_id, game_type } = payload
  if (!user_id || !type) return new Response('missing fields', { status: 400 })

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE)

  // Who triggered it (for the "vs X" / "X challenged you" copy).
  let actorName = 'Someone'
  let actorNameAr = 'أحدهم'
  if (actor_id) {
    const { data: actor } = await admin
      .from('profiles')
      .select('username, global_name')
      .eq('id', actor_id)
      .maybeSingle()
    if (actor) {
      actorName = actor.global_name || actor.username || actorName
      actorNameAr = actor.global_name || actor.username || actorNameAr
    }
  }

  // Every device this user has registered.
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, lang')
    .eq('user_id', user_id)

  if (!subs || subs.length === 0) return new Response(JSON.stringify({ sent: 0 }), { status: 200 })

  const url = urlFor(type, match_id ?? null)
  const dead: string[] = []
  let sent = 0

  await Promise.all(
    subs.map(async (s) => {
      const lang = s.lang === 'ar' ? 'ar' : 'en'
      const actor = lang === 'ar' ? actorNameAr : actorName
      const c = content(type, actor, gameLabel(game_type ?? null, lang), lang)
      if (!c) return // a type we don't push

      const body = JSON.stringify({
        title: c.title,
        body: c.body,
        url,
        // Collapse repeated pings for the same match into one bubble.
        tag: `mjg-${type}-${match_id ?? actor_id ?? user_id}`,
      })

      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        )
        sent++
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode
        if (code === 404 || code === 410) dead.push(s.endpoint) // gone for good
      }
    }),
  )

  // Garbage-collect subscriptions the push service says no longer exist.
  if (dead.length) await admin.from('push_subscriptions').delete().in('endpoint', dead)

  return new Response(JSON.stringify({ sent, pruned: dead.length }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
