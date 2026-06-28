-- =====================================================================
-- Jordan Monopoly — shrink realtime payloads (drop REPLICA IDENTITY FULL)
-- =====================================================================
--
-- Migration 0013 cut the COUNT of realtime events per action (~31 -> ~2) by only
-- writing changed rows. This cuts the SIZE of each event: REPLICA IDENTITY FULL
-- (set in 0010) appends the entire OLD row image to every change event, and
-- monopoly_rooms carries fat jsonb (turn_order, log, pending_*), so FULL roughly
-- doubles those payloads — felt most on mobile / weak links and in the worst-case
-- bankruptcy burst (one event per transferred property).
--
-- SAFE: the client reads only payload.new (applyRoom merges new over prev) or
-- refetches / applies the broadcast snapshot (players/properties) — it never reads
-- payload.old. Under DEFAULT replica identity an UPDATE still streams the full NEW
-- row plus the primary key, so the realtime filters (id=eq / room_id=eq) keep
-- matching. All three tables have primary keys, so DEFAULT is valid.

alter table public.monopoly_rooms      replica identity default;
alter table public.monopoly_players    replica identity default;
alter table public.monopoly_properties replica identity default;
