-- =====================================================================
-- Jordan Stand Tall — add the Checkers (Dama) game type
-- Paste into the Supabase SQL editor and run once (after 0006).
-- =====================================================================
--
-- This is intentionally its OWN migration. Postgres forbids using a freshly
-- added enum value in the same transaction that adds it, so all logic that
-- references 'checkers' (initial_board, make_move, the stats backfill) lives in
-- 0008 — which must be run AFTER this one has committed.

alter type public.game_type add value if not exists 'checkers';
