-- =====================================================================
-- Jordan Stand Tall — Room sweep scheduler (enterprise hardening, 5/5)
-- Paste into the Supabase SQL editor and run once (after 0017).
-- =====================================================================
--
-- WHAT THIS DOES:
--   Schedules public.sweep_all_rooms() to run every minute. The sweep closes idle
--   rooms, reaps ghost players, and pumps stalled turn deadlines (Draw in SQL,
--   Monopoly via an async pg_net tick to the monopoly-action Edge Function).
--
-- PRIMARY: pg_cron (runs in-database; no auth hops, no cold starts).
--   The DO block below tries to enable + schedule it. If pg_cron is gated on your
--   plan, the block degrades to a NOTICE and you wire an EXTERNAL scheduler instead
--   (see the fallback note). Until either is wired, the per-client pumps in the
--   React hooks keep all gameplay working exactly as before — the sweep is purely
--   additive resilience, never a hard dependency.
--
-- ONE-TIME SETUP for the Monopoly server-tick (the only piece that needs config):
--   1) Add the tick secret to the Edge Function:
--        supabase secrets set TICK_SECRET=<any long random string>
--   2) (Re)deploy the function with the new server-tick branch:
--        supabase functions deploy monopoly-action
--   3) Point the pump at it. Run ONCE with YOUR project ref + the SAME secret:
--        insert into private.scheduler_config (id, monopoly_action_url, tick_secret, enabled)
--        values (1,
--          'https://<your-ref>.supabase.co/functions/v1/monopoly-action',
--          '<the TICK_SECRET from step 1>',
--          true)
--        on conflict (id) do update
--          set monopoly_action_url = excluded.monopoly_action_url,
--              tick_secret         = excluded.tick_secret,
--              enabled             = excluded.enabled;
--   Until step 3, pump_monopoly_deadlines() is a safe no-op (Draw still pumps in
--   SQL, and Monopoly's own client pump still drives live tables).

-- =====================================================================
-- Schedule the sweep (pg_cron primary; NOTICE fallback if unavailable)
-- =====================================================================
do $$
begin
  create extension if not exists pg_cron;

  if exists (select 1 from cron.job where jobname = 'sweep-all-rooms') then
    perform cron.unschedule('sweep-all-rooms');
  end if;
  perform cron.schedule('sweep-all-rooms', '* * * * *', $sweep$ select public.sweep_all_rooms(); $sweep$);

  raise notice 'pg_cron: scheduled sweep-all-rooms every minute.';
exception when others then
  raise notice 'pg_cron unavailable (%). FALLBACK: call public.sweep_all_rooms() every minute from an external scheduler (Supabase Scheduled Functions / GitHub Action / cron-job.org) using the service role, or a thin Edge Function that invokes it.', sqlerrm;
end $$;

-- =====================================================================
-- FALLBACK external scheduler, if pg_cron is not available
-- =====================================================================
-- Create a tiny Edge Function `sweep` that calls sweep_all_rooms() with the service
-- role, then have any external cron POST to it once a minute. Sketch:
--
--   // supabase/functions/sweep/index.ts
--   import { createClient } from 'npm:@supabase/supabase-js@2'
--   Deno.serve(async (req) => {
--     if (req.headers.get('x-tick-secret') !== Deno.env.get('TICK_SECRET'))
--       return new Response('forbidden', { status: 403 })
--     const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
--     const { data, error } = await admin.rpc('sweep_all_rooms')
--     return new Response(JSON.stringify(error ?? data), { status: error ? 500 : 200 })
--   })
--
--   supabase functions deploy sweep
--   # then point cron-job.org / a GitHub Action at .../functions/v1/sweep with the
--   # x-tick-secret header, every minute.
