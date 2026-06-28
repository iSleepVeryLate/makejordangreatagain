-- =====================================================================
-- Jordan Stand Tall — Unified sweep + server deadline pumps (hardening, 4/5)
-- Paste into the Supabase SQL editor and run once (after 0016).
-- =====================================================================
--
-- WHAT THIS ADDS:
--   * sweep_matches / sweep_draw_rooms / sweep_monopoly_rooms — set-based closers
--     over the partial indexes from 0014. Idle/abandoned rooms get a terminal
--     status + closed_reason='inactive'. Matches use result='abandoned' so
--     record_result (0001) never mints phantom Elo, and the server never invents a
--     winner — one-sided timeout WINS stay on the player-driven claim_timeout path.
--   * pump_draw_deadlines / pump_monopoly_deadlines — advance a room's turn timer
--     when EVERY client has left (today the pumps are client-only, so an empty
--     table freezes mid-phase). Draw advances purely in SQL; Monopoly's engine is
--     in the Edge Function, so the pump fires an async pg_net tick at it.
--   * sweep_all_rooms() — the single entrypoint the scheduler (0018) calls.
--
-- All of this is the BACKSTOP. While a client is watching, its own fast pump still
-- drives play sub-second; this only matters when nobody is home.

-- =====================================================================
-- 0) SCHEDULER CONFIG (table only; 0018 populates the row + wires cron/Edge)
-- =====================================================================
-- private schema is created by 0012 (web_push); create it defensively in case
-- 0012 hasn't been applied (the monopoly tick + pg_net live behind it).
create schema if not exists private;

create table if not exists private.scheduler_config (
  id                  int  primary key default 1,
  monopoly_action_url text,
  tick_secret         text,
  enabled             boolean not null default true,
  constraint scheduler_config_singleton check (id = 1)
);
revoke all on private.scheduler_config from anon, authenticated;

-- =====================================================================
-- 1) SWEEPERS
-- =====================================================================
create or replace function public.sweep_matches()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  -- waiting rooms that never found an opponent
  update public.matches
     set status = 'abandoned', result = coalesce(result, 'abandoned'),
         finished_at = now(), closed_reason = 'inactive'
   where status = 'waiting'
     and (now() - last_activity_at > interval '10 minutes' or now() > coalesce(expires_at, 'infinity'));
  get diagnostics n = row_count;

  -- active games both players walked away from (idle past 30 min)
  update public.matches
     set status = 'abandoned', result = coalesce(result, 'abandoned'),
         finished_at = now(), closed_reason = 'inactive'
   where status = 'active'
     and (now() - last_activity_at > interval '30 minutes' or now() > coalesce(expires_at, 'infinity'));
  get diagnostics k = row_count;

  return n + k;
end $$;

create or replace function public.sweep_draw_rooms()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  update public.draw_rooms
     set status = 'finished', phase = 'ended', drawer = null, reveal_word = null,
         phase_ends_at = null, closed_reason = 'inactive', updated_at = now()
   where status <> 'finished'
     and ( (status = 'lobby'   and now() - last_activity_at > interval '15 minutes')
        or (status = 'playing' and now() - last_activity_at > interval '30 minutes')
        or now() > coalesce(expires_at, 'infinity') );
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.sweep_monopoly_rooms()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  -- bump seq so any straggler Edge commit loses the optimistic check and reconciles
  update public.monopoly_rooms
     set status = 'finished', phase = 'ended', phase_ends_at = null,
         seq = seq + 1, closed_reason = 'inactive', updated_at = now()
   where status <> 'finished'
     and ( (status = 'lobby'   and now() - last_activity_at > interval '15 minutes')
        or (status = 'playing' and now() - last_activity_at > interval '30 minutes')
        or now() > coalesce(expires_at, 'infinity') );
  get diagnostics n = row_count;
  return n;
end $$;

-- =====================================================================
-- 2) DRAW DEADLINE PUMP (pure SQL — reuses the existing state machine)
-- =====================================================================
-- Verbatim copy of draw_advance (0009) MINUS the auth.uid()/draw_is_member gate,
-- so cron (no JWT) can drive it. service_role only. The public draw_advance keeps
-- its membership gate for client calls. Row lock + phase guards make a cron pump
-- and a client pump for the same deadline safely idempotent (one wins, one no-ops).
create or replace function public.draw_advance_internal(p_room uuid)
returns public.draw_rooms
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; w text; n int; next_drawer uuid;
begin
  select * into r from public.draw_rooms where id = p_room for update;
  if not found then return null; end if;
  if r.status = 'finished' then return r; end if;

  if r.phase = 'choosing' then
    if now() < r.phase_ends_at then return r; end if;
    select word_choices->>0 into w from public.draw_secrets where room_id = p_room;
    update public.draw_secrets set word = w where room_id = p_room;
    update public.draw_rooms
       set phase = 'reveal', reveal_word = w,
           phase_ends_at = now() + interval '6 seconds', updated_at = now()
     where id = p_room and phase = 'choosing' returning * into r;

  elsif r.phase = 'drawing' then
    if now() < r.phase_ends_at then return r; end if;
    select word into w from public.draw_secrets where room_id = p_room;
    update public.draw_rooms
       set phase = 'reveal', reveal_word = w,
           phase_ends_at = now() + interval '6 seconds', updated_at = now()
     where id = p_room and phase = 'drawing' returning * into r;

  elsif r.phase = 'reveal' then
    if now() < r.phase_ends_at then return r; end if;
    update public.draw_secrets set word = null, word_choices = null where room_id = p_room;
    n := jsonb_array_length(r.turn_order);

    if r.turn_index + 1 < n then
      next_drawer := (r.turn_order->>(r.turn_index + 1))::uuid;
      update public.draw_secrets set word_choices = public.draw_pick_words(r.lang, 3) where room_id = p_room;
      update public.draw_players set guessed_at = null, round_score = 0 where room_id = p_room;
      update public.draw_rooms
         set phase = 'choosing', drawer = next_drawer, turn_index = r.turn_index + 1,
             reveal_word = null, phase_ends_at = now() + interval '20 seconds', updated_at = now()
       where id = p_room returning * into r;

    elsif r.round < r.total_rounds then
      next_drawer := (r.turn_order->>0)::uuid;
      update public.draw_secrets set word_choices = public.draw_pick_words(r.lang, 3) where room_id = p_room;
      update public.draw_players set guessed_at = null, round_score = 0 where room_id = p_room;
      update public.draw_rooms
         set phase = 'choosing', drawer = next_drawer, round = r.round + 1, turn_index = 0,
             reveal_word = null, phase_ends_at = now() + interval '20 seconds', updated_at = now()
       where id = p_room returning * into r;

    else
      update public.draw_rooms
         set status = 'finished', phase = 'ended', drawer = null, reveal_word = null,
             phase_ends_at = null, updated_at = now()
       where id = p_room returning * into r;
    end if;
  end if;

  return r;
end $$;

create or replace function public.pump_draw_deadlines()
returns int language plpgsql security definer set search_path = public as $$
declare rec record; n int := 0;
begin
  for rec in
    select id from public.draw_rooms
     where status = 'playing' and phase in ('choosing','drawing','reveal')
       and phase_ends_at is not null and now() >= phase_ends_at
     order by phase_ends_at
     limit 200
  loop
    perform public.draw_advance_internal(rec.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- 3) MONOPOLY DEADLINE PUMP (async pg_net tick → monopoly-action Edge Fn)
-- =====================================================================
create or replace function public.pump_monopoly_deadlines()
returns int language plpgsql security definer set search_path = public as $$
declare rec record; cfg private.scheduler_config; n int := 0;
begin
  select * into cfg from private.scheduler_config where id = 1;
  if cfg.monopoly_action_url is null or coalesce(cfg.enabled, true) = false then
    return 0;  -- not provisioned / disabled → no-op; client pumps still drive play
  end if;

  for rec in
    select id from public.monopoly_rooms
     where status = 'playing' and phase_ends_at is not null and now() >= phase_ends_at
     order by phase_ends_at
     limit 200
  loop
    perform net.http_post(
      url     := cfg.monopoly_action_url,
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-tick-secret', coalesce(cfg.tick_secret, '')),
      body    := jsonb_build_object('room_id', rec.id, 'action', 'tick', 'server_tick', true)
    );
    n := n + 1;
  end loop;
  return n;
exception when others then
  return n;  -- a pg_net hiccup must never abort the sweep
end $$;

-- =====================================================================
-- 4) ORCHESTRATOR (the scheduler's single entrypoint)
-- =====================================================================
create or replace function public.sweep_all_rooms()
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  -- 1) advance rooms whose deadline passed with nobody left to pump them
  perform public.pump_draw_deadlines();
  perform public.pump_monopoly_deadlines();

  -- 2) close idle/expired rooms + reap ghost players
  result := jsonb_build_object(
    'matches',  public.sweep_matches(),
    'draw',     public.sweep_draw_rooms(),
    'monopoly', public.sweep_monopoly_rooms(),
    'ghosts',   public.reap_ghost_presence()
  );

  -- 3) retention: keep the audit log bounded (DELETE is allowed; UPDATE is not)
  delete from public.room_events where created_at < now() - interval '30 days';

  perform public.log_room_event('all', null, 'sweep', null, result);
  return result;
end $$;

-- =====================================================================
-- GRANTS — sweep/pump internals are service_role only (never client-callable)
-- =====================================================================
revoke all on function public.sweep_matches()            from public;
revoke all on function public.sweep_draw_rooms()         from public;
revoke all on function public.sweep_monopoly_rooms()     from public;
revoke all on function public.draw_advance_internal(uuid) from public;
revoke all on function public.pump_draw_deadlines()      from public;
revoke all on function public.pump_monopoly_deadlines()  from public;
revoke all on function public.sweep_all_rooms()          from public;

grant execute on function public.sweep_matches()            to service_role;
grant execute on function public.sweep_draw_rooms()         to service_role;
grant execute on function public.sweep_monopoly_rooms()     to service_role;
grant execute on function public.draw_advance_internal(uuid) to service_role;
grant execute on function public.pump_draw_deadlines()      to service_role;
grant execute on function public.pump_monopoly_deadlines()  to service_role;
grant execute on function public.sweep_all_rooms()          to service_role;
