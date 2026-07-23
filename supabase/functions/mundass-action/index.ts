// المندس (Al-Mundass) — server-authoritative action handler.
// Deploy: supabase functions deploy mundass-action   (JWT verification stays ON)
//
// Same shape as monopoly-action: verify the caller's JWT, load the full room
// (including per-player secrets) via the service-role-only mundass_load RPC, run
// the pure engine, and commit through the seq-gated mundass_commit. Rule
// rejections and seq conflicts return 200 with a client-safe snapshot so
// browsers never log red 4xx during normal play.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import {
  applyAction,
  startGame,
  MIN_PLAYERS,
  type Action,
  type Ctx,
  type PublicState,
  type Secret,
  type Settings,
} from '../_shared/mundassEngine.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

// deno-lint-ignore no-explicit-any
function settingsOf(room: any): Settings {
  return {
    discussionSecs: room.discussion_seconds ?? 45,
    votingSecs: room.voting_seconds ?? 30,
    killCooldownSecs: room.kill_cooldown_seconds ?? 25,
    tasksPerPlayer: room.tasks_per_player ?? 4,
  }
}

// deno-lint-ignore no-explicit-any
function buildPatch(state: PublicState, secrets: Record<string, Secret>): any {
  return {
    state,
    status: state.phase === 'ended' ? 'finished' : state.phase === 'lobby' ? 'lobby' : 'playing',
    winner: state.winner,
    phase_ends_at: state.meeting ? new Date(state.meeting.endsAt).toISOString() : null,
    secrets,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const t0 = Date.now()
  let outcome = 'error'
  let action = ''
  let roomId = ''
  let uid = ''
  try {
    const body = await req.json().catch(() => ({}))
    roomId = body?.room_id || ''
    action = body?.action || ''
    if (!roomId || !action) return json({ error: 'room_id and action are required' }, 400)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '').trim()
    if (!jwt) return json({ error: 'Not authenticated' }, 401)
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt)
    if (userErr || !user) return json({ error: 'Not authenticated' }, 401)
    uid = user.id

    const admin = createClient(url, service)
    const { data: snap, error: loadErr } = await admin.rpc('mundass_load', { p_room: roomId })
    if (loadErr) return json({ error: loadErr.message }, 500)
    if (!snap?.room) return json({ error: 'Game not found' }, 404)

    if (action === 'ping') {
      outcome = 'ok'
      return json({ ok: true })
    }

    const room = snap.room
    // deno-lint-ignore no-explicit-any
    const players: any[] = snap.players || []
    if (!players.some((p) => p.profile_id === uid)) {
      outcome = 'rejected'
      return json({ rejected: true, error: 'not_in_room', room, players })
    }

    const expectedSeq = room.seq
    const settings = settingsOf(room)
    const now = Date.now()

    // ---- start: assigns secret roles + tasks (host-only, lobby-only) ----
    if (action === 'start') {
      if (room.host !== uid) {
        outcome = 'rejected'
        return json({ rejected: true, error: 'not_host', room, players })
      }
      if (room.status !== 'lobby') {
        outcome = 'rejected'
        return json({ rejected: true, error: 'already_started', room, players })
      }
      const ids = players.filter((p) => p.is_present).map((p) => p.profile_id)
      if (ids.length < MIN_PLAYERS) {
        outcome = 'rejected'
        return json({ rejected: true, error: 'not_enough_players', room, players })
      }
      const started = startGame(ids, settings, now, Math.random)
      const { data: committed, error: commitErr } = await admin.rpc('mundass_commit', {
        p_room: roomId,
        p_expected_seq: expectedSeq,
        p_patch: buildPatch(started.state, started.secrets),
      })
      if (commitErr) return json({ error: commitErr.message }, 500)
      outcome = committed?.conflict ? 'conflict' : 'ok'
      return json(committed)
    }

    // ---- everything else runs through the pure engine ----
    const ctx: Ctx = {
      state: room.state as PublicState,
      secrets: (snap.secrets || {}) as Record<string, Secret>,
      settings,
      now,
      rand: Math.random,
    }
    const result = applyAction(ctx, uid, { type: action, ...body } as Action)

    if (!result.ok) {
      outcome = 'rejected'
      return json({ rejected: true, error: result.error, room, players })
    }
    if (!result.changed) {
      outcome = 'noop'
      return json({ room, players })
    }

    const { data: committed, error: commitErr } = await admin.rpc('mundass_commit', {
      p_room: roomId,
      p_expected_seq: expectedSeq,
      p_patch: buildPatch(result.state, result.secrets),
    })
    if (commitErr) return json({ error: commitErr.message }, 500)
    outcome = committed?.conflict ? 'conflict' : 'ok'
    return json(committed)
  } catch (e) {
    return json({ error: (e as Error)?.message || 'Unexpected error' }, 500)
  } finally {
    console.log(JSON.stringify({
      fn: 'mundass-action', action, room: roomId, uid, outcome, ms: Date.now() - t0,
    }))
  }
})
