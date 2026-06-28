-- =====================================================================
-- Jordan Stand Tall — Monopoly server-tick auth (no JWT disabling)
-- Paste into the Supabase SQL editor and run once (after 0017/0018).
-- =====================================================================
--
-- WHY: the Monopoly deadline pump (0017) POSTs to the monopoly-action Edge
-- Function from cron (pg_net). With the function's gateway JWT verification left
-- ON, a request with no Authorization header is rejected at the gateway before it
-- can reach the secret-gated 'tick' branch. Rather than deploy the function with
-- --no-verify-jwt (which would move ALL auth into the function), we send the PUBLIC
-- anon key as the bearer: it satisfies the gateway's verify_jwt exactly like a
-- browser request, and the function still authorizes the tick via x-tick-secret +
-- server_tick (it skips getUser on that path). Gateway JWT verification stays ON.
--
-- The anon key is the same public key shipped to every browser — storing it in the
-- (client-unreadable) private.scheduler_config is not a secret exposure.

alter table private.scheduler_config add column if not exists auth_bearer text;

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
      headers := jsonb_build_object(
        'Content-Type',   'application/json',
        'x-tick-secret',  coalesce(cfg.tick_secret, ''),
        'Authorization',  'Bearer ' || coalesce(cfg.auth_bearer, ''),
        'apikey',         coalesce(cfg.auth_bearer, '')
      ),
      body    := jsonb_build_object('room_id', rec.id, 'action', 'tick', 'server_tick', true)
    );
    n := n + 1;
  end loop;
  return n;
exception when others then
  return n;  -- a pg_net hiccup must never abort the sweep
end $$;
revoke all on function public.pump_monopoly_deadlines() from public;
grant execute on function public.pump_monopoly_deadlines() to service_role;
