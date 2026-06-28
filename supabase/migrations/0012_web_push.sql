-- =====================================================================
-- Jordan Stand Tall — Web Push notifications
-- Paste into the Supabase SQL editor and run once (after 0011).
-- =====================================================================
--
-- WHAT THIS DOES
--   Every ping that already lands in the navbar bell (a row in
--   public.notifications) now ALSO gets delivered as a real OS/browser push
--   notification — so an async chess or checkers game no longer dies just
--   because the player closed the tab. "Your turn", "you were challenged", and
--   "your challenge was accepted" all flow through here for free, because they
--   are all just INSERTs into public.notifications.
--
-- THE PIPELINE (fully server-side, fires even when nobody is looking):
--   notifications INSERT
--     -> trigger on_notification_push()            (this file)
--     -> net.http_post() via pg_net                (async, non-blocking)
--     -> Edge Function `send-push`                 (signs + sends Web Push)
--     -> the browser's push service
--     -> service worker `push` handler             (public/sw.js)
--
-- ONE-TIME SETUP (after running this migration):
--   1) Generate a VAPID key pair:
--        npx web-push generate-vapid-keys
--   2) Put the PUBLIC key in the site env (.env.local / host dashboard):
--        VITE_VAPID_PUBLIC_KEY=<public key>
--   3) Give the Edge Function its secrets:
--        supabase secrets set \
--          VAPID_PUBLIC_KEY=<public key> \
--          VAPID_PRIVATE_KEY=<private key> \
--          VAPID_SUBJECT=mailto:hello@makejordangreatagain.com \
--          PUSH_HOOK_SECRET=<any long random string>
--   4) Deploy the function (it is called by pg_net with no JWT):
--        supabase functions deploy send-push --no-verify-jwt
--   5) Point the trigger at the function. Run this ONCE, with YOUR project ref
--      and the SAME hook secret as step 3 (kept out of git — secrets table):
--        insert into private.push_config (id, function_url, hook_secret)
--        values (1,
--          'https://<your-ref>.supabase.co/functions/v1/send-push',
--          '<the PUSH_HOOK_SECRET from step 3>')
--        on conflict (id) do update
--          set function_url = excluded.function_url,
--              hook_secret  = excluded.hook_secret;
--
--   Until step 5 is done the trigger is a safe no-op — notifications keep
--   working exactly as before, just without the extra push.

-- pg_net lets a trigger fire an outbound HTTP request without blocking the
-- transaction (it queues the request for a background worker).
create extension if not exists pg_net;

-- ---------- private config (NOT client-readable, secrets stay out of git) ----------
create schema if not exists private;

create table if not exists private.push_config (
  id           int  primary key default 1,
  function_url text,
  hook_secret  text,
  constraint push_config_singleton check (id = 1)
);
-- Only the table owner / service role may ever read this.
revoke all on private.push_config from anon, authenticated;

-- ---------- one row per (user, device/browser) ----------
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  endpoint     text not null unique,           -- the push service URL (the device's address)
  p256dh       text not null,                  -- subscription public key (base64url)
  auth         text not null,                  -- subscription auth secret (base64url)
  lang         text not null default 'en',     -- so the push copy matches the user's UI language
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists push_subs_user_idx on public.push_subscriptions (user_id);

-- =====================================================================
-- RPCs — the only way a client touches its own subscriptions
-- =====================================================================

-- Upsert keyed on endpoint: re-running on the same device just refreshes it.
-- user_id is always the caller, never client-supplied, so nobody can register
-- a device against someone else's account.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_lang     text default 'en',
  p_ua       text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_endpoint is null or p_p256dh is null or p_auth is null then
    raise exception 'invalid_subscription';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, lang, user_agent, last_seen_at)
  values (uid, p_endpoint, p_p256dh, p_auth, coalesce(p_lang, 'en'), p_ua, now())
  on conflict (endpoint) do update
    set user_id      = excluded.user_id,
        p256dh       = excluded.p256dh,
        auth         = excluded.auth,
        lang         = excluded.lang,
        user_agent   = excluded.user_agent,
        last_seen_at = now();
end $$;

-- Turn a device off again (the caller can only drop their own rows).
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = uid;
end $$;

-- =====================================================================
-- PUSH TRIGGER — fan a new notification out to the user's devices
-- =====================================================================
create or replace function public.on_notification_push()
returns trigger
language plpgsql security definer set search_path = public as $$
declare cfg private.push_config;
begin
  select * into cfg from private.push_config where id = 1;

  -- Not provisioned yet (see step 5) → behave exactly like before.
  if cfg.function_url is null then
    return new;
  end if;

  perform net.http_post(
    url     := cfg.function_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-hook-secret', coalesce(cfg.hook_secret, '')
    ),
    body    := jsonb_build_object(
      'notification_id', new.id,
      'user_id',         new.user_id,
      'type',            new.type,
      'actor_id',        new.actor_id,
      'match_id',        new.match_id,
      'game_type',       new.game_type
    )
  );

  return new;
exception when others then
  -- A push hiccup must NEVER roll back the notification write.
  return new;
end $$;

drop trigger if exists trg_notification_push on public.notifications;
create trigger trg_notification_push
  after insert on public.notifications
  for each row execute function public.on_notification_push();

-- =====================================================================
-- ROW LEVEL SECURITY — subscriptions are never directly client-accessible
-- (all reads/writes go through the SECURITY DEFINER RPCs above; the
--  Edge Function uses the service role, which bypasses RLS).
-- =====================================================================
alter table public.push_subscriptions enable row level security;

-- =====================================================================
-- GRANTS
-- =====================================================================
grant execute on function public.save_push_subscription(text, text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text)                        to authenticated;
