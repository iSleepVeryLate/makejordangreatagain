-- =====================================================================
-- Jordan Stand Tall — Room audit + admin observability (hardening, 3/5)
-- Paste into the Supabase SQL editor and run once (after 0015).
-- =====================================================================
--
-- WHAT THIS ADDS:
--   * profiles.is_admin — the minimal admin flag (AuthContext reads it for free via
--     its existing select('*'); the /admin/rooms page is hidden unless it's true,
--     and EVERY admin RPC re-checks it server-side, so the flag is UI-only).
--   * room_metrics — a derived view (duration / players / outcome) per room, admin-
--     only. Never stale (it reads live), never granted to normal clients.
--   * room_admin_stats() — aggregate live/stale counts + recent events for the ops
--     page (mirrors live_game_counts() in 0002: aggregate-only, no row leakage).
--   * admin_force_close() — soft-close any room from the ops page.
--   * room_events is made append-only (no in-place edits); retention pruning of old
--     rows is allowed (done by the sweep in 0017) so the log stays bounded.

-- =====================================================================
-- 1) ADMIN FLAG
-- =====================================================================
alter table public.profiles add column if not exists is_admin boolean not null default false;

-- =====================================================================
-- 2) ROOM METRICS VIEW (admin / service only)
-- =====================================================================
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
    from public.monopoly_rooms r;

revoke all on public.room_metrics from anon, authenticated;
grant select on public.room_metrics to service_role;

-- =====================================================================
-- 3) ADMIN STATS RPC (ops dashboard)
-- =====================================================================
create or replace function public.room_admin_stats()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare uid uuid := auth.uid();
begin
  -- service role (uid null) is allowed; an authenticated caller must be an admin.
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
    'events', coalesce((select jsonb_agg(e) from (
        select id, system, room_ref, event_type, actor, payload, created_at
        from public.room_events order by created_at desc limit 50
      ) e), '[]'::jsonb),
    'server_now', now()
  );
end $$;
revoke all on function public.room_admin_stats() from public;
grant execute on function public.room_admin_stats() to authenticated, service_role;

-- =====================================================================
-- 4) ADMIN FORCE-CLOSE (soft-close, audited)
-- =====================================================================
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
  else
    raise exception 'unknown system';
  end if;

  perform public.log_room_event(p_system, p_room, 'force_close', uid, '{}'::jsonb);
end $$;
revoke all on function public.admin_force_close(text, uuid) from public;
grant execute on function public.admin_force_close(text, uuid) to authenticated, service_role;

-- =====================================================================
-- 5) APPEND-ONLY GUARD ON room_events
-- =====================================================================
-- Block in-place edits of audit rows. DELETE is intentionally allowed so the sweep
-- can prune rows older than its retention window (keeps the log bounded).
create or replace function public.room_events_no_update()
returns trigger language plpgsql as $$
begin
  raise exception 'room_events is append-only';
end $$;

drop trigger if exists trg_room_events_no_update on public.room_events;
create trigger trg_room_events_no_update
  before update on public.room_events
  for each row execute function public.room_events_no_update();
