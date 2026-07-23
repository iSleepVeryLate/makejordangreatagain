-- =====================================================================
-- Jordan Stand Tall — المندس (Al-Mundass), the Jordanian social-deduction game
-- Paste into the Supabase SQL editor and run once (after 0001-0021).
-- =====================================================================
--
-- Among Us reimagined in an old Amman neighborhood. 4-10 players roam the حارة
-- doing chores; 1-2 of them are secretly المندس, killing neighbors and calling
-- no attention to themselves. Meetings (دقّ المهباش) vote suspects out.
--
-- ARCHITECTURE (blend of the two existing N-player games):
--   * Lobby/membership = SECURITY DEFINER RPCs (like draw_* / monopoly_*).
--   * ALL gameplay = the `mundass-action` Edge Function running a pure engine,
--     committing atomically via the seq-gated mundass_commit (monopoly pattern).
--   * SECRET ROLES: mundass_secrets holds one row per player (role + task list +
--     kill cooldown + vote). RLS on, NO select policy, revoked — the only reads
--     are the service-role Edge Function (mundass_load) and the owner via the
--     mundass_me() RPC. Roles never travel through the realtime row stream, so
--     a devtools-savvy player still cannot learn who the mundass is.
--   * Movement/chat are EPHEMERAL realtime broadcast (never touch Postgres) —
--     same as Draw & Guess strokes. The DB only holds authoritative state:
--     alive-map, bodies, task bar, meeting phase, votes.
--
-- Registers as the 4th room system ('mundass') in the unified lifecycle
-- framework (0014-0021): sweep, TTL, heartbeat, creation caps, audit, admin.

-- =====================================================================
-- 1) TABLES
-- =====================================================================
create table if not exists public.mundass_rooms (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  host                  uuid not null references public.profiles(id) on delete cascade,
  status                text not null default 'lobby' check (status in ('lobby','playing','finished')),
  seq                   int  not null default 0,          -- optimistic-lock action counter
  discussion_seconds    int  not null default 45,
  voting_seconds        int  not null default 30,
  kill_cooldown_seconds int  not null default 25,
  tasks_per_player      int  not null default 4,
  -- The engine's public snapshot: phase, alive-map, bodies, task bar, meeting,
  -- winner, end-of-game role reveal. NEVER contains roles before game end.
  state                 jsonb not null default '{"phase":"lobby"}'::jsonb,
  winner                text check (winner in ('crew','mundass')),
  phase_ends_at         timestamptz,                       -- meeting-stage deadline mirror (observability/pump)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  last_activity_at      timestamptz not null default now(),
  expires_at            timestamptz,
  closed_reason         text
);

create table if not exists public.mundass_players (
  room_id    uuid not null references public.mundass_rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  color      int  not null default 0,                      -- palette index 0..9
  is_present boolean not null default true,
  joined_at  timestamptz not null default now(),
  primary key (room_id, profile_id)
);

-- One row PER PLAYER (unlike draw/monopoly secrets, which are per-room): each
-- player's role, task list, kill cooldown, emergency-button use, and current
-- meeting vote. Own row is served by mundass_me(); the full set only by
-- mundass_load() (service role).
create table if not exists public.mundass_secrets (
  room_id    uuid not null references public.mundass_rooms(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  primary key (room_id, profile_id)
);

-- Lifecycle sweep index (0014 convention)
create index if not exists mundass_rooms_sweep_idx
  on public.mundass_rooms (status, last_activity_at) where status <> 'finished';

-- Activity touch trigger (0014's shared function)
drop trigger if exists trg_touch_mundass on public.mundass_rooms;
create trigger trg_touch_mundass before update on public.mundass_rooms
  for each row execute function public.touch_last_activity();

-- =====================================================================
-- 2) RLS
-- =====================================================================
alter table public.mundass_rooms   enable row level security;
alter table public.mundass_players enable row level security;
alter table public.mundass_secrets enable row level security;

create or replace function public.mundass_is_member(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mundass_players
     where room_id = p_room and profile_id = auth.uid()
  );
$$;
grant execute on function public.mundass_is_member(uuid) to authenticated;

-- Lobby rooms are world-readable (join-by-code preview); playing rooms members-only.
drop policy if exists mundass_rooms_read on public.mundass_rooms;
create policy mundass_rooms_read on public.mundass_rooms
  for select to authenticated
  using (status = 'lobby' or public.mundass_is_member(id));

drop policy if exists mundass_players_read on public.mundass_players;
create policy mundass_players_read on public.mundass_players
  for select to authenticated
  using (public.mundass_is_member(room_id));

-- mundass_secrets: NO select policy + revoke => unreadable by any client.
revoke all on public.mundass_secrets from anon, authenticated;

grant select on public.mundass_rooms   to authenticated;
grant select on public.mundass_players to authenticated;

-- No INSERT/UPDATE/DELETE policies anywhere — the SECURITY DEFINER RPCs below and
-- the service-role Edge Function are the only writers.

-- =====================================================================
-- 3) REALTIME PUBLICATION (secrets stay OUT; replica identity default — the
--    client only ever reads payload.new, per the 0019 lesson)
-- =====================================================================
do $$ begin
  alter publication supabase_realtime add table public.mundass_rooms;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.mundass_players;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- 4) LOBBY RPCs (client-callable)
-- =====================================================================
create or replace function public.mundass_gen_code()
returns text language plpgsql volatile as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no ambiguous I/L/O/0/1
  c text := '';
begin
  for i in 1..5 loop
    c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return c;
end $$;

create or replace function public.mundass_create_room(
  p_discussion_seconds int default 45,
  p_voting_seconds int default 30,
  p_kill_cooldown_seconds int default 25,
  p_tasks_per_player int default 4)
returns public.mundass_rooms
language plpgsql security definer set search_path = public as $$
declare r public.mundass_rooms; uid uuid := auth.uid(); v_code text; tries int := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.assert_can_create_room(uid);
  p_discussion_seconds    := least(greatest(coalesce(p_discussion_seconds, 45), 15), 120);
  p_voting_seconds        := least(greatest(coalesce(p_voting_seconds, 30), 15), 90);
  p_kill_cooldown_seconds := least(greatest(coalesce(p_kill_cooldown_seconds, 25), 10), 60);
  p_tasks_per_player      := least(greatest(coalesce(p_tasks_per_player, 4), 2), 6);

  loop
    v_code := public.mundass_gen_code();
    begin
      insert into public.mundass_rooms
        (code, host, discussion_seconds, voting_seconds, kill_cooldown_seconds,
         tasks_per_player, expires_at)
      values
        (v_code, uid, p_discussion_seconds, p_voting_seconds, p_kill_cooldown_seconds,
         p_tasks_per_player, now() + interval '2 hours')
      returning * into r;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 8 then raise exception 'Could not allocate a room code, try again'; end if;
    end;
  end loop;

  insert into public.mundass_players (room_id, profile_id, color, is_present)
  values (r.id, uid, 0, true)
  on conflict (room_id, profile_id) do update set is_present = true;
  perform public.log_room_event('mundass', r.id, 'create', uid,
    jsonb_build_object('discussion', p_discussion_seconds, 'tasks', p_tasks_per_player));
  return r;
end $$;
grant execute on function public.mundass_create_room(int, int, int, int) to authenticated;

create or replace function public.mundass_join(p_code text)
returns public.mundass_rooms
language plpgsql security definer set search_path = public as $$
declare
  r public.mundass_rooms; uid uuid := auth.uid();
  n int; v_color int; already boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.mundass_rooms
   where code = upper(trim(p_code)) order by created_at desc limit 1 for update;
  if not found then raise exception 'Room not found'; end if;
  if r.status = 'finished' then raise exception 'Room is closed'; end if;

  already := exists (select 1 from public.mundass_players
                      where room_id = r.id and profile_id = uid);
  if already then
    update public.mundass_players set is_present = true
     where room_id = r.id and profile_id = uid;
    return r;
  end if;

  if r.status <> 'lobby' then raise exception 'Game already started'; end if;
  select count(*) into n from public.mundass_players where room_id = r.id;
  if n >= 10 then raise exception 'Room is full'; end if;

  -- Smallest unused palette color 0..9.
  select min(c) into v_color from generate_series(0, 9) c
   where c not in (select color from public.mundass_players where room_id = r.id);

  insert into public.mundass_players (room_id, profile_id, color, is_present)
  values (r.id, uid, coalesce(v_color, 0), true);
  perform public.log_room_event('mundass', r.id, 'join', uid, '{}'::jsonb);
  return r;
end $$;
grant execute on function public.mundass_join(text) to authenticated;

create or replace function public.mundass_leave(p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.mundass_rooms; uid uuid := auth.uid(); new_host uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update public.mundass_players set is_present = false
   where room_id = p_room and profile_id = uid;

  select * into r from public.mundass_rooms where id = p_room for update;
  if not found then return; end if;

  -- Host migration while still in the lobby (same as draw_leave).
  if r.status = 'lobby' and r.host = uid then
    select profile_id into new_host from public.mundass_players
     where room_id = p_room and profile_id <> uid and is_present
     order by joined_at asc limit 1;
    if new_host is not null then
      update public.mundass_rooms set host = new_host, updated_at = now() where id = p_room;
    end if;
  end if;
  perform public.log_room_event('mundass', p_room, 'leave', uid, '{}'::jsonb);
end $$;
grant execute on function public.mundass_leave(uuid) to authenticated;

-- Your own secret view (role, tasks, mates, cooldown, emergency, vote) — the ONLY
-- client path to anything role-shaped. Member-gated; returns '{}' before start.
create or replace function public.mundass_me(p_room uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); d jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if not public.mundass_is_member(p_room) then raise exception 'Not your room'; end if;
  select data into d from public.mundass_secrets
   where room_id = p_room and profile_id = uid;
  return coalesce(d, '{}'::jsonb);
end $$;
grant execute on function public.mundass_me(uuid) to authenticated;

-- Host "play again": back to lobby, secrets wiped, seq bumped so any straggler
-- Edge commit loses its optimistic check.
create or replace function public.mundass_reset(p_room uuid)
returns public.mundass_rooms
language plpgsql security definer set search_path = public as $$
declare r public.mundass_rooms; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.mundass_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.host <> uid then raise exception 'Only the host can restart'; end if;

  delete from public.mundass_secrets where room_id = p_room;
  update public.mundass_rooms
     set status = 'lobby', state = '{"phase":"lobby"}'::jsonb, winner = null,
         phase_ends_at = null, seq = seq + 1, closed_reason = null, updated_at = now()
   where id = p_room returning * into r;
  perform public.log_room_event('mundass', p_room, 'reset', uid, '{}'::jsonb);
  return r;
end $$;
grant execute on function public.mundass_reset(uuid) to authenticated;

-- =====================================================================
-- 5) ENGINE RPCs (service_role ONLY — the Edge Function's read/write path)
-- =====================================================================
create or replace function public.mundass_snapshot(p_room uuid, p_include_secrets boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.mundass_rooms; res jsonb;
begin
  select * into r from public.mundass_rooms where id = p_room;
  if not found then return null; end if;
  res := jsonb_build_object(
    'room', to_jsonb(r),
    'players', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.joined_at)
        from public.mundass_players p where p.room_id = p_room), '[]'::jsonb)
  );
  if p_include_secrets then
    res := res || jsonb_build_object('secrets', coalesce((
      select jsonb_object_agg(s.profile_id, s.data)
        from public.mundass_secrets s where s.room_id = p_room), '{}'::jsonb));
  end if;
  return res;
end $$;

create or replace function public.mundass_load(p_room uuid)
returns jsonb language sql security definer set search_path = public as $$
  select public.mundass_snapshot(p_room, true);
$$;

-- Atomic seq-gated commit (monopoly_commit pattern): row lock serialises,
-- the seq equality check rejects stale/racing submits with a client-safe
-- snapshot tagged conflict:true, and seq always advances by exactly 1.
create or replace function public.mundass_commit(p_room uuid, p_expected_seq int, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.mundass_rooms; k text; v jsonb;
begin
  select * into r from public.mundass_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.seq <> p_expected_seq then
    return public.mundass_snapshot(p_room, false) || jsonb_build_object('conflict', true);
  end if;

  update public.mundass_rooms
     set state         = coalesce(p_patch->'state', state),
         status        = coalesce(p_patch->>'status', status),
         winner        = case when p_patch ? 'winner' then nullif(p_patch->>'winner', '') else winner end,
         phase_ends_at = case when p_patch ? 'phase_ends_at'
                              then nullif(p_patch->>'phase_ends_at', '')::timestamptz
                              else phase_ends_at end,
         seq           = p_expected_seq + 1,
         updated_at    = now()
   where id = p_room;

  if p_patch ? 'secrets' then
    for k, v in select * from jsonb_each(p_patch->'secrets') loop
      insert into public.mundass_secrets (room_id, profile_id, data)
      values (p_room, k::uuid, v)
      on conflict (room_id, profile_id) do update set data = excluded.data;
    end loop;
  end if;

  return public.mundass_snapshot(p_room, false);
end $$;

revoke all on function public.mundass_snapshot(uuid, boolean) from public;
revoke all on function public.mundass_load(uuid)              from public;
revoke all on function public.mundass_commit(uuid, int, jsonb) from public;
grant execute on function public.mundass_snapshot(uuid, boolean) to service_role;
grant execute on function public.mundass_load(uuid)              to service_role;
grant execute on function public.mundass_commit(uuid, int, jsonb) to service_role;

-- =====================================================================
-- 6) LIFECYCLE FRAMEWORK — register 'mundass' as the 4th room system
-- =====================================================================

-- 6a) Heartbeat (0015): extend the allow-list + membership branch.
create or replace function public.room_heartbeat(p_system text, p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); ok boolean := false;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_system not in ('match','draw','monopoly','mundass') then return; end if;

  if p_system = 'draw' then
    ok := public.draw_is_member(p_room);
  elsif p_system = 'monopoly' then
    ok := public.monopoly_is_member(p_room);
  elsif p_system = 'mundass' then
    ok := public.mundass_is_member(p_room);
  else
    ok := exists (select 1 from public.matches m
                   where m.id = p_room and (m.player1 = uid or m.player2 = uid));
  end if;
  if not ok then return; end if;

  insert into public.room_presence (system, room_id, profile_id, last_seen)
  values (p_system, p_room, uid, now())
  on conflict (system, room_id, profile_id) do update set last_seen = now();
end $$;

-- 6b) Ghost reaper (0015): also flip stale mundass players.
create or replace function public.reap_ghost_presence()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; m int; o int;
begin
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

  update public.mundass_players up set is_present = false
    from public.room_presence rp
   where rp.system = 'mundass' and rp.room_id = up.room_id and rp.profile_id = up.profile_id
     and up.is_present and now() - rp.last_seen > interval '45 seconds';
  get diagnostics o = row_count;

  delete from public.room_presence where last_seen < now() - interval '6 hours';

  return n + m + o;
end $$;

-- 6c) Creation cap (0019 fresh-count version) + mundass rooms.
create or replace function public.assert_can_create_room(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare open_count int; recent_count int; retry_secs int;
begin
  if p_uid is null then raise exception 'Not authenticated'; end if;

  select
      (select count(*) from public.matches
         where player1 = p_uid and status in ('waiting','active')
           and now() - last_activity_at < interval '30 minutes')
    + (select count(*) from public.draw_rooms
         where host = p_uid and status <> 'finished'
           and now() - last_activity_at < interval '30 minutes')
    + (select count(*) from public.monopoly_rooms
         where host = p_uid and status <> 'finished'
           and now() - last_activity_at < interval '30 minutes')
    + (select count(*) from public.mundass_rooms
         where host = p_uid and status <> 'finished'
           and now() - last_activity_at < interval '30 minutes')
  into open_count;
  if open_count >= 5 then
    raise exception 'cap:%', open_count;
  end if;

  select count(*) into recent_count
    from public.room_events
   where actor = p_uid and event_type = 'create' and created_at > now() - interval '1 minute';
  if recent_count >= 5 then
    select greatest(1, ceil(60 - extract(epoch from (now() - min(created_at)))))::int
      into retry_secs
      from public.room_events
     where actor = p_uid and event_type = 'create' and created_at > now() - interval '1 minute';
    raise exception 'cooldown:%', retry_secs;
  end if;
end $$;

-- 6d) Sweeper (0017 pattern; seq bump so straggler Edge commits reconcile).
create or replace function public.sweep_mundass_rooms()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  update public.mundass_rooms
     set status = 'finished', phase_ends_at = null,
         seq = seq + 1, closed_reason = 'inactive', updated_at = now()
   where status <> 'finished'
     and ( (status = 'lobby'   and now() - last_activity_at > interval '15 minutes')
        or (status = 'playing' and now() - last_activity_at > interval '30 minutes')
        or now() > coalesce(expires_at, 'infinity') );
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sweep_mundass_rooms() from public;
grant execute on function public.sweep_mundass_rooms() to service_role;

-- 6e) Orchestrator (0021 quiet version) + mundass.
-- (No mundass deadline pump: meeting stages are pumped by the clients' 1s driver
-- through the Edge Function, and an all-clients-gone room is simply swept.)
create or replace function public.sweep_all_rooms()
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; pumped int; total int;
begin
  pumped := coalesce(public.pump_draw_deadlines(), 0) + coalesce(public.pump_monopoly_deadlines(), 0);

  result := jsonb_build_object(
    'matches',  public.sweep_matches(),
    'draw',     public.sweep_draw_rooms(),
    'monopoly', public.sweep_monopoly_rooms(),
    'mundass',  public.sweep_mundass_rooms(),
    'ghosts',   public.reap_ghost_presence(),
    'pumped',   pumped
  );

  delete from public.room_events where created_at < now() - interval '30 days';

  total := (result->>'matches')::int + (result->>'draw')::int + (result->>'monopoly')::int
         + (result->>'mundass')::int + (result->>'ghosts')::int + (result->>'pumped')::int;
  if total > 0 then
    perform public.log_room_event('all', null, 'sweep', null, result);
  end if;

  return result;
end $$;

-- 6f) Metrics view (0016) + mundass branch.
create or replace view public.room_metrics as
  select 'match'::text as system, m.id as room_ref, m.game_type::text as kind,
         m.created_at, m.finished_at, m.status::text as status, m.closed_reason,
         extract(epoch from (coalesce(m.finished_at, now()) - m.created_at))::int as duration_s,
         (case when m.player2 is null then 1 else 2 end) as player_count,
         m.result as outcome
    from public.matches m
  union all
  select 'draw', r.id, 'draw_and_guess', r.created_at,
         case when r.status = 'finished' then r.updated_at end, r.status, r.closed_reason,
         extract(epoch from (coalesce(case when r.status='finished' then r.updated_at end, now()) - r.created_at))::int,
         (select count(*)::int from public.draw_players dp where dp.room_id = r.id),
         r.status
    from public.draw_rooms r
  union all
  select 'monopoly', r.id, 'monopoly', r.created_at,
         case when r.status = 'finished' then r.updated_at end, r.status, r.closed_reason,
         extract(epoch from (coalesce(case when r.status='finished' then r.updated_at end, now()) - r.created_at))::int,
         (select count(*)::int from public.monopoly_players mp where mp.room_id = r.id),
         coalesce(r.winner::text, r.status)
    from public.monopoly_rooms r
  union all
  select 'mundass', r.id, 'mundass', r.created_at,
         case when r.status = 'finished' then r.updated_at end, r.status, r.closed_reason,
         extract(epoch from (coalesce(case when r.status='finished' then r.updated_at end, now()) - r.created_at))::int,
         (select count(*)::int from public.mundass_players up where up.room_id = r.id),
         coalesce(r.winner, r.status)
    from public.mundass_rooms r;

revoke all on public.room_metrics from anon, authenticated;
grant select on public.room_metrics to service_role;

-- 6g) Admin stats (0016) + mundass block.
create or replace function public.room_admin_stats()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare uid uuid := auth.uid();
begin
  if uid is not null and not exists (select 1 from public.profiles where id = uid and is_admin) then
    raise exception 'forbidden';
  end if;

  return jsonb_build_object(
    'matches', jsonb_build_object(
      'waiting', (select count(*) from public.matches where status = 'waiting'),
      'active',  (select count(*) from public.matches where status = 'active'),
      'stale',   (select count(*) from public.matches
                   where status in ('waiting','active') and now() - last_activity_at > interval '30 minutes')),
    'draw', jsonb_build_object(
      'lobby',   (select count(*) from public.draw_rooms where status = 'lobby'),
      'playing', (select count(*) from public.draw_rooms where status = 'playing'),
      'stale',   (select count(*) from public.draw_rooms
                   where status <> 'finished' and now() - last_activity_at > interval '30 minutes')),
    'monopoly', jsonb_build_object(
      'lobby',   (select count(*) from public.monopoly_rooms where status = 'lobby'),
      'playing', (select count(*) from public.monopoly_rooms where status = 'playing'),
      'stale',   (select count(*) from public.monopoly_rooms
                   where status <> 'finished' and now() - last_activity_at > interval '30 minutes')),
    'mundass', jsonb_build_object(
      'lobby',   (select count(*) from public.mundass_rooms where status = 'lobby'),
      'playing', (select count(*) from public.mundass_rooms where status = 'playing'),
      'stale',   (select count(*) from public.mundass_rooms
                   where status <> 'finished' and now() - last_activity_at > interval '30 minutes')),
    'events', coalesce((select jsonb_agg(e) from (
        select id, system, room_ref, event_type, actor, payload, created_at
        from public.room_events order by created_at desc limit 50
      ) e), '[]'::jsonb),
    'server_now', now()
  );
end $$;

-- 6h) Admin force-close (0016) + mundass branch.
create or replace function public.admin_force_close(p_system text, p_room uuid)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (select 1 from public.profiles where id = uid and is_admin) then
    raise exception 'forbidden';
  end if;

  if p_system = 'match' then
    update public.matches
       set status = 'abandoned', result = coalesce(result, 'abandoned'),
           finished_at = coalesce(finished_at, now()), closed_reason = 'admin'
     where id = p_room and status in ('waiting','active');
  elsif p_system = 'draw' then
    update public.draw_rooms
       set status = 'finished', phase = 'ended', drawer = null, reveal_word = null,
           phase_ends_at = null, closed_reason = 'admin', updated_at = now()
     where id = p_room and status <> 'finished';
  elsif p_system = 'monopoly' then
    update public.monopoly_rooms
       set status = 'finished', phase = 'ended', phase_ends_at = null,
           seq = seq + 1, closed_reason = 'admin', updated_at = now()
     where id = p_room and status <> 'finished';
  elsif p_system = 'mundass' then
    update public.mundass_rooms
       set status = 'finished', phase_ends_at = null,
           seq = seq + 1, closed_reason = 'admin', updated_at = now()
     where id = p_room and status <> 'finished';
  else
    raise exception 'unknown system';
  end if;

  perform public.log_room_event(p_system, p_room, 'force_close', uid, '{}'::jsonb);
end $$;
