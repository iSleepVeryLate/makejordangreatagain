-- =====================================================================
-- Jordan Stand Tall — Quiet the sweep audit log (only log real work)
-- Paste into the Supabase SQL editor and run once (after 0020).
-- =====================================================================
--
-- WHY: sweep_all_rooms() runs every minute and logged a 'sweep' room_event on
-- EVERY run, even when it closed nothing — flooding room_events (and the
-- /admin/rooms feed) with empty heartbeats. Now it only logs when the run actually
-- closed/reaped/pumped something, and the payload includes the pump count too.
-- Also deletes the existing no-op sweep rows so the feed reads clean immediately.

create or replace function public.sweep_all_rooms()
returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; pumped int; total int;
begin
  -- advance rooms whose deadline passed with nobody left to pump them
  pumped := coalesce(public.pump_draw_deadlines(), 0) + coalesce(public.pump_monopoly_deadlines(), 0);

  result := jsonb_build_object(
    'matches',  public.sweep_matches(),
    'draw',     public.sweep_draw_rooms(),
    'monopoly', public.sweep_monopoly_rooms(),
    'ghosts',   public.reap_ghost_presence(),
    'pumped',   pumped
  );

  -- retention: keep the audit log bounded
  delete from public.room_events where created_at < now() - interval '30 days';

  -- Only record an audit event when the sweep DID something — no per-minute no-ops.
  total := (result->>'matches')::int + (result->>'draw')::int + (result->>'monopoly')::int
         + (result->>'ghosts')::int + (result->>'pumped')::int;
  if total > 0 then
    perform public.log_room_event('all', null, 'sweep', null, result);
  end if;

  return result;
end $$;

-- One-time (and re-run-safe) cleanup of the empty heartbeat rows already logged.
delete from public.room_events
 where event_type = 'sweep'
   and coalesce((payload->>'matches')::int, 0)  + coalesce((payload->>'draw')::int, 0)
     + coalesce((payload->>'monopoly')::int, 0) + coalesce((payload->>'ghosts')::int, 0)
     + coalesce((payload->>'pumped')::int, 0) = 0;
