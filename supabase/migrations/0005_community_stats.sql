-- =====================================================================
-- Jordan Stand Tall — community stats cache
-- Paste into the Supabase SQL editor and run once (after 0004).
-- =====================================================================
--
-- Why this exists:
--   The landing page hero shows live Discord numbers (member count + online
--   now). We don't want every visitor's page load to hit Discord's API — that
--   would be slow and rate-limited — so the discord-stats Edge Function fetches
--   Discord at most once per TTL and caches the result here. This table is also
--   the graceful fallback: if Discord is unreachable, the function returns the
--   last known good row instead of failing. Only the service role writes to it
--   (it bypasses RLS); everyone may read it, since it's public marketing data.

create table if not exists public.community_stats (
  id           boolean primary key default true,
  member_count integer,
  online_count integer,
  updated_at   timestamptz not null default now(),
  constraint community_stats_singleton check (id)
);

-- Seed the single row so there is always a value to fall back to before the
-- first live refresh. These are overwritten on the first successful fetch.
insert into public.community_stats (id, member_count, online_count)
values (true, 181, 21)
on conflict (id) do nothing;

alter table public.community_stats enable row level security;

-- Public marketing data: anyone (logged in or not) may read it.
drop policy if exists community_stats_read on public.community_stats;
create policy community_stats_read
  on public.community_stats
  for select
  to anon, authenticated
  using (true);

grant select on public.community_stats to anon, authenticated;
