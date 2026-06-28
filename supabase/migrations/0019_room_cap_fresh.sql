-- =====================================================================
-- Jordan Stand Tall — Cap counts only FRESH rooms (lifecycle fix)
-- Paste into the Supabase SQL editor and run once (after 0014-0017).
-- =====================================================================
--
-- WHY: the concurrent-room cap in 0014 counted EVERY non-terminal room a user
-- holds. But the stale-room sweep (0017) is only a backstop and may be dormant
-- (unscheduled). With the sweep off, abandoned rooms accumulate and ratchet a user
-- straight into the cap — they get "cap:<n>" and can't create anything, even though
-- all those rooms are dead. (Observed: a user with 11 rooms, all idle 41 min.)
--
-- FIX: count only rooms that are still FRESH (activity within the sweep's idle
-- window, 30 min). A backlog of stale/abandoned rooms no longer blocks creation —
-- exactly the rooms the sweep WOULD close don't count — while genuine spam (many
-- fresh rooms in quick succession) is still capped. This makes the cap correct
-- whether or not the sweep is scheduled. The cooldown rule is unchanged.

create or replace function public.assert_can_create_room(p_uid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare open_count int; recent_count int; retry_secs int;
begin
  if p_uid is null then raise exception 'Not authenticated'; end if;

  -- (a) concurrent cap — only rooms still FRESH (idle < 30 min) count, so a stale
  -- backlog can't block creation while the sweep is dormant.
  select
      (select count(*) from public.matches
         where player1 = p_uid and status in ('waiting','active')
           and now() - last_activity_at < interval '30 minutes')
    + (select count(*) from public.draw_rooms
         where host = p_uid and status <> 'finished'
           and now() - last_activity_at < interval '30 minutes')
    + (select count(*) from public.monopoly_rooms
         where host = p_uid and status <> 'finished'
           and now() - last_activity_at < interval '30 minutes')
  into open_count;
  if open_count >= 5 then
    raise exception 'cap:%', open_count;
  end if;

  -- (b) creation cooldown: at most 5 new rooms per rolling minute.
  select count(*) into recent_count
    from public.room_events
   where actor = p_uid and event_type = 'create' and created_at > now() - interval '1 minute';
  if recent_count >= 5 then
    select greatest(1, ceil(60 - extract(epoch from (now() - min(created_at)))))::int
      into retry_secs
      from public.room_events
     where actor = p_uid and event_type = 'create' and created_at > now() - interval '1 minute';
    raise exception 'cooldown:%', retry_secs;
  end if;
end $$;
