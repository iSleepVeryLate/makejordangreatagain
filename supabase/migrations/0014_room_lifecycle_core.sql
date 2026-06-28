-- =====================================================================
-- Jordan Stand Tall — Room lifecycle core (enterprise hardening, part 1/5)
-- Paste into the Supabase SQL editor and run once (after 0001-0013).
-- =====================================================================
--
-- WHAT THIS ADDS (the foundation the other lifecycle migrations build on):
--   * A unified activity/TTL convention across all THREE room systems
--     (matches / draw_rooms / monopoly_rooms): last_activity_at, expires_at,
--     closed_reason — plus partial indexes the sweep (0017) scans.
--   * room_events: one append-only audit log for create/join/leave/finish/sweep
--     across every system, and the rate-limit ledger for creation abuse.
--   * assert_can_create_room(): per-user concurrent-room cap + creation cooldown,
--     wired into all three create RPCs (which now also emit a 'create' event and
--     stamp expires_at).
--
-- DESIGN NOTES / WHY:
--   * last_activity_at is touched by a BEFORE UPDATE trigger on matches and
--     draw_rooms. It is ALSO put on monopoly_rooms via the same trigger — which is
--     realtime-safe: monopoly_rooms is already updated AND broadcast on EVERY
--     monopoly_commit (seq always advances, see 0013), so piggybacking
--     last_activity_at onto that existing row-write adds ZERO new realtime events.
--     (The 0013 quieting concern is about the per-row monopoly_players /
--     monopoly_properties no-op upserts — NOT the room row, which always changes.)
--   * expires_at is a sliding idle TTL capped by an absolute max lifetime, so a
--     script that touches a room forever still can't keep it alive past created_at
--     + 12h. The sweep (0017) is the primary cleaner; expires_at is the backstop.
--   * Create RPCs raise machine-parseable errors: 'cap:<n>' and 'cooldown:<n>'.
--     The client (src/lib/rpcErrors.js) turns these into friendly, localized text.

-- =====================================================================
-- 1) UNIFIED LIFECYCLE COLUMNS
-- =====================================================================
alter table public.matches        add column if not exists last_activity_at timestamptz not null default now();
alter table public.matches        add column if not exists expires_at       timestamptz;
alter table public.matches        add column if not exists closed_reason    text;

alter table public.draw_rooms      add column if not exists last_activity_at timestamptz not null default now();
alter table public.draw_rooms      add column if not exists expires_at       timestamptz;
alter table public.draw_rooms      add column if not exists closed_reason    text;

alter table public.monopoly_rooms  add column if not exists last_activity_at timestamptz not null default now();
alter table public.monopoly_rooms  add column if not exists expires_at       timestamptz;
alter table public.monopoly_rooms  add column if not exists closed_reason    text;

-- Backfill from the best existing signal so pre-existing rooms aren't instantly
-- "stale" the moment the sweep turns on.
update public.matches       set last_activity_at = greatest(last_move_at, created_at) where last_activity_at < greatest(last_move_at, created_at);
update public.draw_rooms    set last_activity_at = greatest(updated_at, created_at)  where last_activity_at < greatest(updated_at, created_at);
update public.monopoly_rooms set last_activity_at = greatest(updated_at, created_at) where last_activity_at < greatest(updated_at, created_at);

-- Partial indexes covering only sweepable (non-terminal) rooms — keeps the sweep
-- scan cheap and its locks narrow.
create index if not exists matches_sweep_idx
  on public.matches (status, last_activity_at) where status in ('waiting','active');
create index if not exists draw_rooms_sweep_idx
  on public.draw_rooms (status, last_activity_at) where status <> 'finished';
create index if not exists monopoly_rooms_sweep_idx
  on public.monopoly_rooms (status, last_activity_at) where status <> 'finished';

-- =====================================================================
-- 2) ACTIVITY TOUCH TRIGGER (matches + draw_rooms + monopoly_rooms)
-- =====================================================================
-- Bumps last_activity_at and slides expires_at on every real row write. Each of
-- these tables only UPDATEs on genuine state changes (a move, a phase advance, a
-- commit), so this never introduces no-op writes / extra realtime events.
create or replace function public.touch_last_activity()
returns trigger language plpgsql set search_path = public as $$
begin
  new.last_activity_at := now();
  new.expires_at := least(now() + interval '2 hours', new.created_at + interval '12 hours');
  return new;
end $$;

drop trigger if exists trg_touch_matches on public.matches;
create trigger trg_touch_matches before update on public.matches
  for each row execute function public.touch_last_activity();

drop trigger if exists trg_touch_draw on public.draw_rooms;
create trigger trg_touch_draw before update on public.draw_rooms
  for each row execute function public.touch_last_activity();

drop trigger if exists trg_touch_monopoly on public.monopoly_rooms;
create trigger trg_touch_monopoly before update on public.monopoly_rooms
  for each row execute function public.touch_last_activity();

-- =====================================================================
-- 3) ROOM EVENTS — append-only audit log (+ creation rate-limit ledger)
-- =====================================================================
create table if not exists public.room_events (
  id          bigint generated always as identity primary key,
  system      text not null,          -- 'match' | 'draw' | 'monopoly' | 'all'
  room_ref    uuid,                   -- room/match id (null for system-wide e.g. sweep)
  event_type  text not null,          -- create|join|leave|resign|start|finish|sweep|ghost_reap|tick|force_close
  actor       uuid references public.profiles(id) on delete set null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists room_events_room_idx on public.room_events (system, room_ref, created_at desc);
create index if not exists room_events_recent_idx on public.room_events (created_at desc);
create index if not exists room_events_actor_create_idx
  on public.room_events (actor, created_at) where event_type = 'create';

-- RLS on, NO policies and explicit revoke → clients can never read or write it.
-- Only SECURITY DEFINER functions (running as owner) and the service role touch it.
alter table public.room_events enable row level security;
revoke all on public.room_events from anon, authenticated;

-- Tiny logger reused by every RPC / sweep. SECURITY DEFINER so a definer caller
-- (create_room etc.) can always insert regardless of the caller's own grants.
create or replace function public.log_room_event(
  p_system text, p_room uuid, p_event text,
  p_actor uuid default null, p_payload jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.room_events (system, room_ref, event_type, actor, payload)
  values (p_system, p_room, p_event, p_actor, coalesce(p_payload, '{}'::jsonb));
$$;
revoke all on function public.log_room_event(text, uuid, text, uuid, jsonb) from public;
grant execute on function public.log_room_event(text, uuid, text, uuid, jsonb) to service_role;

-- =====================================================================
-- 4) ABUSE PREVENTION — concurrent-room cap + creation cooldown
-- =====================================================================
-- Called as the first statement of every create RPC. The existing
-- one_open_room_per_creator index (0001) only covers PUBLIC 1v1 waiting rooms;
-- this caps everything (private 1v1, draw, monopoly, and active games) per user.
create or replace function public.assert_can_create_room(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare open_count int; recent_count int; retry_secs int;
begin
  if p_uid is null then raise exception 'Not authenticated'; end if;

  -- (a) concurrent open/active room cap across ALL systems (max 5 at once)
  select
      (select count(*) from public.matches        where player1 = p_uid and status in ('waiting','active'))
    + (select count(*) from public.draw_rooms      where host    = p_uid and status <> 'finished')
    + (select count(*) from public.monopoly_rooms  where host    = p_uid and status <> 'finished')
  into open_count;
  if open_count >= 5 then
    raise exception 'cap:%', open_count;
  end if;

  -- (b) creation cooldown: at most 5 new rooms per rolling minute (reads the audit
  -- log, which the create RPCs also write — so it doubles as the rate ledger).
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
revoke all on function public.assert_can_create_room(uuid) from public;
grant execute on function public.assert_can_create_room(uuid) to authenticated, service_role;

-- =====================================================================
-- 5) WIRE THE GUARDS + TTL + AUDIT INTO THE THREE CREATE RPCs
-- =====================================================================

-- ---- 1v1 matches ----
create or replace function public.create_room(p_game_type public.game_type, p_is_private boolean default false)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches; uid uuid := auth.uid(); priv boolean := coalesce(p_is_private, false);
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.assert_can_create_room(uid);
  begin
    insert into public.matches (game_type, status, is_private, player1, board_state, expires_at)
    values (p_game_type, 'waiting', priv, uid, public.initial_board(p_game_type), now() + interval '2 hours')
    returning * into m;
    perform public.log_room_event('match', m.id, 'create', uid,
      jsonb_build_object('game_type', p_game_type, 'is_private', priv));
  exception when unique_violation then
    -- already holds an open public room for this game → hand it back, no new room,
    -- no audit/cooldown entry (re-entry, not a create).
    select * into m from public.matches
     where player1 = uid and game_type = p_game_type and status = 'waiting' and is_private = false
     limit 1;
  end;
  return m;
end $$;

-- ---- Draw & Guess ----
create or replace function public.draw_create_room(
  p_lang text default 'en', p_total_rounds int default 3, p_round_seconds int default 75)
returns public.draw_rooms
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid(); v_code text; tries int := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.assert_can_create_room(uid);
  if p_lang not in ('en','ar') then p_lang := 'en'; end if;
  p_total_rounds  := least(greatest(coalesce(p_total_rounds, 3), 1), 10);
  p_round_seconds := least(greatest(coalesce(p_round_seconds, 75), 30), 180);

  loop
    v_code := public.draw_gen_code();
    begin
      insert into public.draw_rooms (code, host, lang, total_rounds, round_seconds, expires_at)
      values (v_code, uid, p_lang, p_total_rounds, p_round_seconds, now() + interval '2 hours')
      returning * into r;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 8 then raise exception 'Could not allocate a room code, try again'; end if;
    end;
  end loop;

  insert into public.draw_secrets (room_id) values (r.id);
  insert into public.draw_players (room_id, profile_id, is_present)
  values (r.id, uid, true)
  on conflict (room_id, profile_id) do update set is_present = true;
  perform public.log_room_event('draw', r.id, 'create', uid,
    jsonb_build_object('lang', p_lang, 'rounds', p_total_rounds));
  return r;
end $$;

-- ---- Monopoly ----
create or replace function public.monopoly_create_room(
  p_turn_seconds int default 45, p_start_cash int default 1500, p_max_players int default 8)
returns public.monopoly_rooms
language plpgsql security definer set search_path = public as $$
declare r public.monopoly_rooms; uid uuid := auth.uid(); v_code text; tries int := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform public.assert_can_create_room(uid);
  p_turn_seconds := least(greatest(coalesce(p_turn_seconds, 45), 20), 180);
  p_start_cash   := least(greatest(coalesce(p_start_cash, 1500), 500), 5000);
  p_max_players  := least(greatest(coalesce(p_max_players, 8), 2), 8);

  loop
    v_code := public.monopoly_gen_code();
    begin
      insert into public.monopoly_rooms (code, host, turn_seconds, start_cash, max_players, expires_at)
      values (v_code, uid, p_turn_seconds, p_start_cash, p_max_players, now() + interval '2 hours')
      returning * into r;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 8 then raise exception 'Could not allocate a room code, try again'; end if;
    end;
  end loop;

  insert into public.monopoly_secrets (room_id) values (r.id);
  insert into public.monopoly_players (room_id, profile_id, seat, token, cash, is_present)
  values (r.id, uid, 0, 'car', p_start_cash, true)
  on conflict (room_id, profile_id) do update set is_present = true;
  perform public.log_room_event('monopoly', r.id, 'create', uid,
    jsonb_build_object('max_players', p_max_players, 'start_cash', p_start_cash));
  return r;
end $$;

-- Grants are unchanged (these CREATE OR REPLACE keep the 0001/0009/0010 grants).
