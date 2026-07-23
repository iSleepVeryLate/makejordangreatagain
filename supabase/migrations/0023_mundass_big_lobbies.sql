-- =====================================================================
-- Jordan Stand Tall — المندس: big Discord-night lobbies (up to 16 players)
-- Paste into the Supabase SQL editor and run once (after 0022).
-- =====================================================================
--
-- The community plays 15 at a time. Raises the room cap from 10 → 16 and
-- widens the color pool to 16 distinct palette indexes (0..15, matching the
-- client's COLORS array). The engine (mundass-action) scales with it:
-- 1 mundass at 4-7 players, 2 at 8-12, 3 at 13-16.

create or replace function public.mundass_join(p_code text)
returns public.mundass_rooms
language plpgsql security definer set search_path = public as $$
declare
  r public.mundass_rooms; uid uuid := auth.uid();
  n int; v_color int; already boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.mundass_rooms
   where code = upper(trim(p_code)) order by created_at desc limit 1 for update;
  if not found then raise exception 'Room not found'; end if;
  if r.status = 'finished' then raise exception 'Room is closed'; end if;

  already := exists (select 1 from public.mundass_players
                      where room_id = r.id and profile_id = uid);
  if already then
    update public.mundass_players set is_present = true
     where room_id = r.id and profile_id = uid;
    return r;
  end if;

  if r.status <> 'lobby' then raise exception 'Game already started'; end if;
  select count(*) into n from public.mundass_players where room_id = r.id;
  if n >= 16 then raise exception 'Room is full'; end if;

  -- Smallest unused palette color 0..15.
  select min(c) into v_color from generate_series(0, 15) c
   where c not in (select color from public.mundass_players where room_id = r.id);

  insert into public.mundass_players (room_id, profile_id, color, is_present)
  values (r.id, uid, coalesce(v_color, 0), true);
  perform public.log_room_event('mundass', r.id, 'join', uid, '{}'::jsonb);
  return r;
end $$;
