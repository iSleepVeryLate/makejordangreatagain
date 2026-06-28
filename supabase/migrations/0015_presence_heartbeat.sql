-- =====================================================================
-- Jordan Stand Tall — Server presence + heartbeat (enterprise hardening, 2/5)
-- Paste into the Supabase SQL editor and run once (after 0014).
-- =====================================================================
--
-- WHAT THIS ADDS:
--   * room_presence: a server-authoritative "who checked in, and when" table for
--     ALL three systems. It is deliberately NOT in the realtime publication, so a
--     20s heartbeat never re-floods the carefully-quieted game-state stream (0013).
--   * room_heartbeat(): the one RPC every client calls on an interval.
--   * reap_ghost_presence(): flips *_players.is_present=false for players whose
--     heartbeat went stale (browser crash / closed tab without leaving). Called by
--     the sweep (0017). This is what finally makes host-migration and Draw's
--     "everyone present has guessed" check trust real presence.
--   * claim_timeout() rewrite + match_grace_status(): a 1v1 reconnect grace window.
--     A connected-but-slow opponent still gets the full move clock; a genuinely
--     DISCONNECTED opponent can be claimed against after a shorter grace measured
--     from their last sign of life — never an instant win, always server-decided.
--
-- BACKWARD COMPATIBLE: a client that never calls room_heartbeat has no presence
-- row, so it is never reaped and claim_timeout falls back to the exact pre-0015
-- move-clock behaviour. The grace only ever SHORTENS the wait on real evidence of
-- a disconnect; it can never lengthen it.

-- =====================================================================
-- 1) ROOM PRESENCE — unpublished, server-only
-- =====================================================================
create table if not exists public.room_presence (
  system     text not null,                                   -- 'match' | 'draw' | 'monopoly'
  room_id    uuid not null,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  last_seen  timestamptz not null default now(),
  primary key (system, room_id, profile_id)
);
create index if not exists room_presence_lookup_idx on public.room_presence (system, room_id);
create index if not exists room_presence_stale_idx  on public.room_presence (last_seen);

-- RLS on with NO select policy + explicit revoke → clients never read/write it
-- directly. The heartbeat RPC (definer) is the only writer; the sweep + the grace
-- RPCs (definer/service) are the only readers. (Never added to supabase_realtime.)
alter table public.room_presence enable row level security;
revoke all on public.room_presence from anon, authenticated;

-- =====================================================================
-- 2) HEARTBEAT RPC
-- =====================================================================
create or replace function public.room_heartbeat(p_system text, p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ok boolean := false;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_system not in ('match','draw','monopoly') then return; end if;

  -- Membership check so a user can't seed presence into rooms they aren't in.
  if p_system = 'draw' then
    ok := public.draw_is_member(p_room);
  elsif p_system = 'monopoly' then
    ok := public.monopoly_is_member(p_room);
  else
    ok := exists (select 1 from public.matches m
                   where m.id = p_room and (m.player1 = uid or m.player2 = uid));
  end if;
  if not ok then return; end if;

  insert into public.room_presence (system, room_id, profile_id, last_seen)
  values (p_system, p_room, uid, now())
  on conflict (system, room_id, profile_id) do update set last_seen = now();
end $$;
grant execute on function public.room_heartbeat(text, uuid) to authenticated;

-- =====================================================================
-- 3) GHOST REAPER (called by the sweep in 0017)
-- =====================================================================
create or replace function public.reap_ghost_presence()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int;
begin
  -- Only players who HAVE a presence row that has gone stale (>45s ≈ 3 missed
  -- beats) are reaped; a player whose client never heartbeats has no row and is
  -- left alone (today's behaviour). The `and is_present` guard keeps the write set
  -- to genuinely-changing rows, so realtime events fire only on a real transition.
  update public.draw_players dp set is_present = false
    from public.room_presence rp
   where rp.system = 'draw' and rp.room_id = dp.room_id and rp.profile_id = dp.profile_id
     and dp.is_present and now() - rp.last_seen > interval '45 seconds';
  get diagnostics n = row_count;

  update public.monopoly_players mp set is_present = false
    from public.room_presence rp
   where rp.system = 'monopoly' and rp.room_id = mp.room_id and rp.profile_id = mp.profile_id
     and mp.is_present and now() - rp.last_seen > interval '45 seconds';
  get diagnostics m = row_count;

  -- Keep the presence table from growing forever.
  delete from public.room_presence where last_seen < now() - interval '6 hours';

  return n + m;
end $$;
revoke all on function public.reap_ghost_presence() from public;
grant execute on function public.reap_ghost_presence() to service_role;

-- =====================================================================
-- 4) 1v1 RECONNECT GRACE — claim_timeout rewrite + read-only status RPC
-- =====================================================================
create or replace function public.claim_timeout(p_match_id uuid)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches; uid uuid := auth.uid(); allowed interval;
  opp uuid; opp_seen timestamptz; disconnect_grace interval := interval '30 seconds';
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if uid <> m.player1 and uid <> m.player2 then raise exception 'Not your match'; end if;
  if m.status <> 'active' then return m; end if;
  if m.game_type <> 'trivia' and m.current_turn = uid then
    raise exception 'It is your move — you cannot claim a timeout';
  end if;

  allowed := case when m.game_type = 'chess' then interval '180 seconds' else interval '60 seconds' end;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;
  select rp.last_seen into opp_seen
    from public.room_presence rp
   where rp.system = 'match' and rp.room_id = m.id and rp.profile_id = opp;

  if opp_seen is not null and now() - opp_seen < interval '20 seconds' then
    -- present but slow → full move clock
    if now() - m.last_move_at < allowed then
      raise exception 'Too soon to claim a timeout';
    end if;
  else
    -- disconnected (or no signal) → win allowed once the move clock OR the
    -- disconnect grace (from last_seen) has elapsed; falls back to the move clock
    -- when there is no presence signal at all.
    if now() - m.last_move_at < allowed
       and (opp_seen is null or now() - opp_seen < disconnect_grace) then
      raise exception 'Too soon to claim a timeout';
    end if;
  end if;

  if uid = m.player1 then m.winner := m.player1; m.result := 'p1';
  else m.winner := m.player2; m.result := 'p2'; end if;
  update public.matches set status='finished', winner=m.winner, result=m.result, finished_at=now()
   where id=m.id returning * into m;
  return m;
end $$;

-- Read-only mirror so the client can render an honest, server-anchored countdown
-- ("claim the win in m:ss") without trusting the local clock or duplicating the
-- grace rules. Returns server_now + claim_at; the client ticks claim_at-server_now.
create or replace function public.match_grace_status(p_match uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.matches; uid uuid := auth.uid(); opp uuid; opp_seen timestamptz;
  allowed interval; disconnect_grace interval := interval '30 seconds';
  claim_at timestamptz; present boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into m from public.matches where id = p_match;
  if not found then raise exception 'Match not found'; end if;
  if uid <> m.player1 and uid <> m.player2 then raise exception 'Not your match'; end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;
  select rp.last_seen into opp_seen
    from public.room_presence rp
   where rp.system = 'match' and rp.room_id = m.id and rp.profile_id = opp;

  allowed := case when m.game_type = 'chess' then interval '180 seconds' else interval '60 seconds' end;
  present := (opp_seen is not null and now() - opp_seen < interval '20 seconds');

  if present then
    claim_at := m.last_move_at + allowed;
  elsif opp_seen is not null then
    claim_at := least(m.last_move_at + allowed, opp_seen + disconnect_grace);
  else
    claim_at := m.last_move_at + allowed;
  end if;

  return jsonb_build_object(
    'status',        m.status,
    'opp_present',   present,
    'opp_last_seen', opp_seen,
    'claim_at',      claim_at,
    'ready', (m.status = 'active')
             and (m.game_type = 'trivia' or m.current_turn is distinct from uid)
             and now() >= claim_at,
    'server_now',    now()
  );
end $$;
grant execute on function public.match_grace_status(uuid) to authenticated;
