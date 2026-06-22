-- =====================================================================
-- Jordan Stand Tall — live lobby counts
-- Paste into the Supabase SQL editor and run once (after 0001_init.sql).
-- =====================================================================
--
-- Why this exists:
--   The matches_read RLS policy only lets a client read rows where it is a
--   participant, or rooms that are 'waiting' and public. That means a plain
--   `select ... from matches where status = 'active'` returns ONLY the
--   caller's own active games — never a community-wide count. The lobby's
--   "N live now" badges need the aggregate across everyone, so we expose it
--   through a SECURITY DEFINER function that returns counts only (no rows,
--   no player ids, no board state — nothing sensitive leaks).

create or replace function public.live_game_counts()
returns table (game_type public.game_type, active bigint)
language sql
security definer
set search_path = public
stable
as $$
  select m.game_type, count(*)::bigint as active
  from public.matches m
  where m.status = 'active'
  group by m.game_type;
$$;

grant execute on function public.live_game_counts() to authenticated;
