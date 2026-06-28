-- =====================================================================
-- Jordan Monopoly — quiet commit: stop re-broadcasting the whole board
-- =====================================================================
--
-- WHY: the engine returns the FULL state on every action (all players + all 28
-- properties), and monopoly_commit upserted every one of those rows uncondition-
-- ally. Postgres emits a logical-replication (realtime) event for EVERY row a
-- statement touches — even an UPDATE that sets identical values — so each single
-- action fanned out ~31 realtime events per client (1 room + 2 players + 28
-- properties). With REPLICA IDENTITY FULL each event also carries the full row.
-- Measured live: 61 actions -> 1891 events/client (~31x), ~740ms peer latency.
-- That flood is what makes live play feel laggy / jumpy / "glitchy", and it scales
-- with player count and bites hardest on mobile / weak connections.
--
-- FIX: guard each ON CONFLICT DO UPDATE with `WHERE (existing) IS DISTINCT FROM
-- (excluded)`, so a row is only actually written (and only then emits a realtime
-- event) when something about it truly changed. The room row still updates every
-- action (seq always advances) and remains the single authoritative sync signal.
-- After this, a plain roll emits ~2 events (room + the one moving player) instead
-- of 31. Pure perf/transport change — identical game state, identical return shape.

create or replace function public.monopoly_commit(p_room uuid, p_expected_seq int, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.monopoly_rooms;
begin
  select * into r from public.monopoly_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.seq <> p_expected_seq then
    return public.monopoly_snapshot(p_room, false) || jsonb_build_object('conflict', true);
  end if;

  -- ---- room: only the dynamic game-state columns are writable here ----
  if p_patch ? 'room' then
    update public.monopoly_rooms m set
      status           = x.status,
      phase            = x.phase,
      current_seat     = x.current_seat,
      turn_order       = x.turn_order,
      dice             = x.dice,
      doubles_count    = x.doubles_count,
      last_card        = x.last_card,
      phase_ends_at    = x.phase_ends_at,
      bank_houses      = x.bank_houses,
      bank_hotels      = x.bank_hotels,
      pending_purchase = x.pending_purchase,
      pending_auction  = x.pending_auction,
      pending_trade    = x.pending_trade,
      pending_debt     = x.pending_debt,
      winner           = x.winner,
      log              = x.log,
      seq              = p_expected_seq + 1,
      updated_at       = now()
    from jsonb_populate_record(null::public.monopoly_rooms, p_patch->'room') x
    where m.id = p_room;
  else
    update public.monopoly_rooms set seq = p_expected_seq + 1, updated_at = now() where id = p_room;
  end if;

  -- ---- players (upsert only the rows that actually CHANGED) ----
  insert into public.monopoly_players
    (room_id, profile_id, seat, token, position, cash, in_jail, jail_turns, goojf_cards, bankrupt, is_present)
  select p_room, x.profile_id, x.seat, x.token, x.position, x.cash, x.in_jail,
         x.jail_turns, x.goojf_cards, x.bankrupt, x.is_present
  from jsonb_to_recordset(coalesce(p_patch->'players', '[]'::jsonb)) as x(
    profile_id uuid, seat int, token text, position int, cash int,
    in_jail boolean, jail_turns int, goojf_cards int, bankrupt boolean, is_present boolean)
  on conflict (room_id, profile_id) do update set
    seat = excluded.seat, token = excluded.token, position = excluded.position,
    cash = excluded.cash, in_jail = excluded.in_jail, jail_turns = excluded.jail_turns,
    goojf_cards = excluded.goojf_cards, bankrupt = excluded.bankrupt, is_present = excluded.is_present
  where (monopoly_players.seat, monopoly_players.token, monopoly_players.position,
         monopoly_players.cash, monopoly_players.in_jail, monopoly_players.jail_turns,
         monopoly_players.goojf_cards, monopoly_players.bankrupt, monopoly_players.is_present)
        is distinct from
        (excluded.seat, excluded.token, excluded.position, excluded.cash, excluded.in_jail,
         excluded.jail_turns, excluded.goojf_cards, excluded.bankrupt, excluded.is_present);

  -- ---- properties (upsert only the rows that actually CHANGED) ----
  insert into public.monopoly_properties (room_id, tile_index, owner, houses, mortgaged)
  select p_room, x.tile_index, x.owner, x.houses, x.mortgaged
  from jsonb_to_recordset(coalesce(p_patch->'properties', '[]'::jsonb)) as x(
    tile_index int, owner uuid, houses int, mortgaged boolean)
  on conflict (room_id, tile_index) do update set
    owner = excluded.owner, houses = excluded.houses, mortgaged = excluded.mortgaged
  where (monopoly_properties.owner, monopoly_properties.houses, monopoly_properties.mortgaged)
        is distinct from
        (excluded.owner, excluded.houses, excluded.mortgaged);

  -- ---- secrets (deck order; never leaves the server) ----
  if p_patch ? 'secrets' then
    update public.monopoly_secrets set
      chance     = coalesce(p_patch->'secrets'->'chance', chance),
      chest      = coalesce(p_patch->'secrets'->'chest', chest),
      chance_pos = coalesce((p_patch->'secrets'->>'chance_pos')::int, chance_pos),
      chest_pos  = coalesce((p_patch->'secrets'->>'chest_pos')::int, chest_pos)
    where room_id = p_room;
  end if;

  return public.monopoly_snapshot(p_room, false);
end $$;
