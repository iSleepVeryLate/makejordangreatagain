// =====================================================================
// Jordan Stand Tall — server-authoritative Jordan Monopoly action handler
// =====================================================================
//
// One Edge Function, dispatched on `action`. Every gameplay mutation flows here:
//   1. authenticate the JWT  → uid
//   2. monopoly_load(room)   → full state INCLUDING the secret deck order
//   3. pure JS engine        → compute the entire next state (server dice RNG)
//   4. monopoly_commit(...)   → apply atomically under a row lock + seq check
//   5. return the client-safe snapshot (no secrets)
//
// Dice (Math.random) and the secret deck never leave this function. A stale /
// duplicate / racing submit fails the seq check inside monopoly_commit and comes
// back tagged {conflict:true} → 409, and the client refetches.
//
// Deploy:  supabase functions deploy monopoly-action
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are injected.)

import { createClient } from 'npm:@supabase/supabase-js@2'
import { reduce } from '../_shared/monopolyEngine.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const d6 = () => 1 + Math.floor(Math.random() * 6)
const rollDice = (): [number, number] => [d6(), d6()]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const t0 = Date.now()
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '').trim()
    if (!jwt) return json({ error: 'Not authenticated' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } })
    const { data: { user }, error: userErr } = await userClient.auth.getUser(jwt)
    if (userErr || !user) return json({ error: 'Not authenticated' }, 401)
    const uid = user.id

    const body = await req.json().catch(() => null)
    const roomId = body?.room_id
    const action = body?.action
    if (!roomId || !action) return json({ error: 'Missing room_id or action' }, 400)

    const admin = createClient(url, service)

    // 1) load full state (incl. secret deck order)
    const { data: state, error: loadErr } = await admin.rpc('monopoly_load', { p_room: roomId })
    if (loadErr) return json({ error: loadErr.message }, 500)
    if (!state?.room) return json({ error: 'Game not found' }, 404)

    // warm-up ping: lets the client wake the function on room entry with no effect
    if (action === 'ping') return json({ ok: true })

    const expectedSeq = state.room.seq

    // 2) run the pure engine
    const result = reduce(state, body, { uid, now: Date.now(), roll: rollDice })

    if ('error' in result) {
      console.log(JSON.stringify({ fn: 'monopoly-action', action, room: roomId, uid, outcome: 'error', error: result.error, ms: Date.now() - t0 }))
      // Expected, user-correctable rule rejection (e.g. "Not your turn", "Not enough
      // cash") — NOT an HTTP error. A 4xx here makes the browser print a red console
      // line in every player's tab during normal play. Return 200 with a `rejected`
      // flag plus the current snapshot so the client can show the reason AND resync
      // any state that had drifted (the action losing tells us the client was stale).
      return json({ rejected: true, error: result.error, room: state.room, players: state.players, properties: state.properties })
    }
    if ('noop' in result) {
      // nothing to do (e.g. a tick before the deadline) — return current state, no write
      return json({ room: state.room, players: state.players, properties: state.properties })
    }

    // 3) commit atomically with the optimistic seq lock
    const { data: snap, error: commitErr } = await admin.rpc('monopoly_commit', {
      p_room: roomId, p_expected_seq: expectedSeq, p_patch: result.patch,
    })
    if (commitErr) return json({ error: commitErr.message }, 500)
    if (snap?.conflict) {
      console.log(JSON.stringify({ fn: 'monopoly-action', action, room: roomId, uid, outcome: 'conflict', ms: Date.now() - t0 }))
      // A racing / duplicate submit lost the optimistic seq check — entirely normal
      // in multiplayer (the 1s timer pump + several clients). Return 200 with the
      // snapshot (it carries conflict:true); the client reconciles silently rather
      // than showing a spurious error toast and logging a red 409.
      return json(snap)
    }
    console.log(JSON.stringify({ fn: 'monopoly-action', action, room: roomId, uid, outcome: 'ok', ms: Date.now() - t0 }))
    return json(snap)
  } catch (e) {
    console.log(JSON.stringify({ fn: 'monopoly-action', outcome: 'throw', error: String((e as Error)?.message || e) }))
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
