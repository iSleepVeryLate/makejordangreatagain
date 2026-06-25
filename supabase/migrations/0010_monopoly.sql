-- =====================================================================
-- Jordan Stand Tall — Jordan Monopoly (N-player, server-authoritative)
-- Paste into the Supabase SQL editor and run once (after 0001-0009).
-- =====================================================================
--
-- WHY THIS IS SEPARATE FROM `matches` (same rationale as Draw & Guess 0009):
--   Monopoly is N-player (2-8) with rich per-player + per-property state, so it
--   gets its own tables, its own RPCs, and its own /monopoly route. It never
--   touches `matches` or the game_type enum.
--
-- THE LOAD-BEARING ARCHITECTURE (hybrid — lobby RPCs + Edge Function + atomic commit):
--   * Lobby/membership (create/join/leave/set_token/reset) are SECURITY DEFINER
--     RPCs callable by the authenticated client — plain row writes, board-agnostic.
--   * ALL gameplay (dice, rent, cards, trades, auctions, bankruptcy) runs in the
--     `monopoly-action` Edge Function's pure JS engine, because dice RNG must be
--     unforgeable and the rules are far too branchy for SQL (same reason chess /
--     checkers use Edge Functions). The engine computes the ENTIRE next state,
--     then commits it atomically.
--   * monopoly_commit() applies the whole computed state in ONE transaction under
--     a `select ... for update` row lock with an optimistic `seq` check, so a
--     duplicate / racing / stale submit can never half-apply or double-apply.
--   * monopoly_load() / monopoly_commit() are restricted to the service_role and
--     are the ONLY way the deck order (monopoly_secrets) is read — a malicious
--     client cannot call them to forge money or peek at the shuffled cards.
--
-- SECRET STATE:
--   The only secret is the shuffled Chance/Chest deck ORDER in monopoly_secrets,
--   kept out of the realtime publication and unreadable by clients (RLS on, no
--   select policy — same trick as draw_secrets). Card RESULTS become public the
--   instant they resolve (written to monopoly_rooms.last_card + log).

-- =====================================================================
-- TABLES
-- =====================================================================

-- The synced room row: the turn/phase state machine + transient turn state.
create table if not exists public.monopoly_rooms (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  host             uuid not null references public.profiles(id) on delete cascade,
  status           text not null default 'lobby' check (status in ('lobby','playing','finished')),
  phase            text not null default 'waiting'
                   check (phase in ('waiting','roll','resolve','buy_decision','auction',
                                    'trade_review','jail','awaiting_debt','ended')),
  current_seat     int  not null default 0,            -- index into turn_order
  turn_order       jsonb not null default '[]'::jsonb, -- ordered array of player ids
  dice             jsonb,                              -- [d1,d2] of the last roll, or null
  doubles_count    int  not null default 0,            -- consecutive doubles this turn (3 -> jail)
  last_card        jsonb,                              -- {deck,id,text,by} for log/animation
  phase_ends_at    timestamptz,                        -- deadline for the timer pump
  turn_seconds     int  not null default 45 check (turn_seconds between 20 and 180),
  start_cash       int  not null default 1500 check (start_cash between 500 and 5000),
  max_players      int  not null default 8 check (max_players between 2 and 8),
  bank_houses      int  not null default 32,
  bank_hotels      int  not null default 12,
  seq              int  not null default 0,            -- optimistic-lock action counter
  pending_purchase jsonb,                              -- {tile, price} during buy_decision
  pending_auction  jsonb,                              -- auction state during 'auction'
  pending_trade    jsonb,                              -- proposal during 'trade_review'
  pending_debt     jsonb,                              -- {debtor, creditor|null, amount, reason}
  winner           uuid references public.profiles(id),
  log              jsonb not null default '[]'::jsonb, -- capped ring buffer of recent events
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Per-player seat. Synced (broadcast-safe — no secrets here).
create table if not exists public.monopoly_players (
  room_id      uuid not null references public.monopoly_rooms(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  seat         int  not null default 0,                -- assigned at start; stable
  token        text not null default 'car',
  position     int  not null default 0,                -- tile index 0..39
  cash         int  not null default 1500,
  in_jail      boolean not null default false,
  jail_turns   int  not null default 0,                -- failed roll-outs so far (0..3)
  goojf_cards  int  not null default 0,                -- get-out-of-jail-free cards held
  bankrupt     boolean not null default false,
  is_present   boolean not null default true,
  joined_at    timestamptz not null default now(),
  primary key (room_id, profile_id)
);
create index if not exists monopoly_players_room_idx on public.monopoly_players(room_id);

-- The 28 ownable tiles. Seeded by the engine at game start. Synced.
create table if not exists public.monopoly_properties (
  room_id     uuid not null references public.monopoly_rooms(id) on delete cascade,
  tile_index  int  not null,                           -- 0..39 (only ownable indices exist)
  owner       uuid references public.profiles(id),     -- null = bank-owned
  houses      int  not null default 0,                 -- 0..4 = houses, 5 = hotel
  mortgaged   boolean not null default false,
  primary key (room_id, tile_index)
);
create index if not exists monopoly_properties_room_idx on public.monopoly_properties(room_id);
create index if not exists monopoly_rooms_code_idx on public.monopoly_rooms(code);

-- The shuffled deck order. NOT in the realtime publication. RLS on, no select policy.
create table if not exists public.monopoly_secrets (
  room_id     uuid primary key references public.monopoly_rooms(id) on delete cascade,
  chance      jsonb not null default '[]'::jsonb,      -- shuffled array of chance card ids
  chest       jsonb not null default '[]'::jsonb,      -- shuffled array of chest card ids
  chance_pos  int  not null default 0,                 -- draw pointer (wraps)
  chest_pos   int  not null default 0
);

-- =====================================================================
-- HELPERS
-- =====================================================================

-- Random unambiguous 5-char join code (no I/L/O/0/1).
create or replace function public.monopoly_gen_code()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random()*31)+1)::int, 1), ''
  ) from generate_series(1,5);
$$;

-- Membership test for RLS. SECURITY DEFINER so the policy doesn't recurse.
create or replace function public.monopoly_is_member(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.monopoly_players
    where room_id = p_room and profile_id = auth.uid()
  );
$$;

-- Composite snapshot used as the canonical return shape. Secrets are included
-- only for the engine (service-role); never returned to a browser.
create or replace function public.monopoly_snapshot(p_room uuid, p_include_secrets boolean default false)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'room', (select to_jsonb(r) from public.monopoly_rooms r where r.id = p_room),
    'players', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.seat) from public.monopoly_players p where p.room_id = p_room
    ), '[]'::jsonb),
    'properties', coalesce((
      select jsonb_agg(to_jsonb(pr) order by pr.tile_index) from public.monopoly_properties pr where pr.room_id = p_room
    ), '[]'::jsonb)
  ) || case when p_include_secrets then jsonb_build_object(
    'secrets', (select to_jsonb(s) from public.monopoly_secrets s where s.room_id = p_room)
  ) else '{}'::jsonb end;
$$;

-- Engine read: full state INCLUDING the secret deck order. service_role only.
create or replace function public.monopoly_load(p_room uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.monopoly_snapshot(p_room, true);
$$;

-- Engine write: apply the entire computed next state in one transaction, under a
-- row lock + optimistic seq check. p_patch = { room:{...}, players:[...],
-- properties:[...], secrets:{...} } in DB (snake_case) column shape. Returns the
-- new client-safe snapshot, or that snapshot tagged {conflict:true} if the seq
-- no longer matches (a human/tick already acted). service_role only.
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

  -- ---- players (upsert the rows the engine touched) ----
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
    goojf_cards = excluded.goojf_cards, bankrupt = excluded.bankrupt, is_present = excluded.is_present;

  -- ---- properties (upsert; seeds all 28 at game start) ----
  insert into public.monopoly_properties (room_id, tile_index, owner, houses, mortgaged)
  select p_room, x.tile_index, x.owner, x.houses, x.mortgaged
  from jsonb_to_recordset(coalesce(p_patch->'properties', '[]'::jsonb)) as x(
    tile_index int, owner uuid, houses int, mortgaged boolean)
  on conflict (room_id, tile_index) do update set
    owner = excluded.owner, houses = excluded.houses, mortgaged = excluded.mortgaged;

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

-- =====================================================================
-- LOBBY / MATCHMAKING RPCs (authenticated client)
-- =====================================================================

create or replace function public.monopoly_create_room(
  p_turn_seconds int default 45, p_start_cash int default 1500, p_max_players int default 8)
returns public.monopoly_rooms
language plpgsql security definer set search_path = public as $$
declare r public.monopoly_rooms; uid uuid := auth.uid(); v_code text; tries int := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  p_turn_seconds := least(greatest(coalesce(p_turn_seconds, 45), 20), 180);
  p_start_cash   := least(greatest(coalesce(p_start_cash, 1500), 500), 5000);
  p_max_players  := least(greatest(coalesce(p_max_players, 8), 2), 8);

  loop
    v_code := public.monopoly_gen_code();
    begin
      insert into public.monopoly_rooms (code, host, turn_seconds, start_cash, max_players)
      values (v_code, uid, p_turn_seconds, p_start_cash, p_max_players)
      returning * into r;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 8 then raise exception 'Could not allocate a room code, try again'; end if;
    end;
  end loop;

  insert into public.monopoly_secrets (room_id) values (r.id);
  insert into public.monopoly_players (room_id, profile_id, seat, token, cash, is_present)
  values (r.id, uid, 0, 'car', p_start_cash, true)
  on conflict (room_id, profile_id) do update set is_present = true;
  return r;
end $$;

create or replace function public.monopoly_join(p_code text)
returns public.monopoly_rooms
language plpgsql security definer set search_path = public as $$
declare r public.monopoly_rooms; uid uuid := auth.uid(); n int; v_token text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.monopoly_rooms where code = upper(btrim(p_code)) for update;
  if not found then raise exception 'Room not found'; end if;
  if r.status <> 'lobby' then raise exception 'That game has already started'; end if;

  if exists (select 1 from public.monopoly_players where room_id = r.id and profile_id = uid) then
    update public.monopoly_players set is_present = true where room_id = r.id and profile_id = uid;
    return r;
  end if;

  select count(*) into n from public.monopoly_players where room_id = r.id and is_present;
  if n >= r.max_players then raise exception 'Room is full'; end if;

  -- assign the first free token
  select tk into v_token
  from unnest(array['car','ship','thimble','dog','hat','boot','iron','wheelbarrow']) tk
  where tk not in (select token from public.monopoly_players where room_id = r.id)
  limit 1;

  insert into public.monopoly_players (room_id, profile_id, seat, token, cash, is_present)
  values (r.id, uid, n, coalesce(v_token, 'car'), r.start_cash, true);
  return r;
end $$;

create or replace function public.monopoly_leave(p_room uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.monopoly_rooms; uid uuid := auth.uid(); new_host uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update public.monopoly_players set is_present = false
   where room_id = p_room and profile_id = uid;

  select * into r from public.monopoly_rooms where id = p_room for update;
  if not found then return; end if;
  -- Host migration: if the host leaves while still in the lobby, hand off to the
  -- earliest-joined remaining present player.
  if r.host = uid and r.status = 'lobby' then
    select profile_id into new_host from public.monopoly_players
     where room_id = p_room and profile_id <> uid and is_present
     order by joined_at asc limit 1;
    if new_host is not null then
      update public.monopoly_rooms set host = new_host, updated_at = now() where id = p_room;
    end if;
  end if;
end $$;

create or replace function public.monopoly_set_token(p_room uuid, p_token text)
returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_token not in ('car','ship','thimble','dog','hat','boot','iron','wheelbarrow') then
    raise exception 'Invalid token';
  end if;
  if exists (
    select 1 from public.monopoly_players
    where room_id = p_room and token = p_token and profile_id <> uid
  ) then raise exception 'That token is taken'; end if;
  update public.monopoly_players set token = p_token
   where room_id = p_room and profile_id = uid;
end $$;

-- Host "play again": wipe the board and drop back to the lobby.
create or replace function public.monopoly_reset(p_room uuid)
returns public.monopoly_rooms
language plpgsql security definer set search_path = public as $$
declare r public.monopoly_rooms; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.monopoly_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.host <> uid then raise exception 'Only the host can restart'; end if;

  delete from public.monopoly_properties where room_id = p_room;
  update public.monopoly_secrets
     set chance = '[]'::jsonb, chest = '[]'::jsonb, chance_pos = 0, chest_pos = 0
   where room_id = p_room;
  update public.monopoly_players
     set position = 0, cash = r.start_cash, in_jail = false, jail_turns = 0,
         goojf_cards = 0, bankrupt = false
   where room_id = p_room;
  update public.monopoly_rooms
     set status = 'lobby', phase = 'waiting', current_seat = 0, turn_order = '[]'::jsonb,
         dice = null, doubles_count = 0, last_card = null, phase_ends_at = null, seq = 0,
         pending_purchase = null, pending_auction = null, pending_trade = null,
         pending_debt = null, winner = null, log = '[]'::jsonb, updated_at = now()
   where id = p_room returning * into r;
  return r;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.monopoly_rooms      enable row level security;
alter table public.monopoly_players    enable row level security;
alter table public.monopoly_properties enable row level security;
alter table public.monopoly_secrets    enable row level security;  -- no select policy => unreadable

drop policy if exists monopoly_rooms_read on public.monopoly_rooms;
create policy monopoly_rooms_read on public.monopoly_rooms for select to authenticated
  using (status = 'lobby' or public.monopoly_is_member(id));

drop policy if exists monopoly_players_read on public.monopoly_players;
create policy monopoly_players_read on public.monopoly_players for select to authenticated
  using (public.monopoly_is_member(room_id));

drop policy if exists monopoly_properties_read on public.monopoly_properties;
create policy monopoly_properties_read on public.monopoly_properties for select to authenticated
  using (public.monopoly_is_member(room_id));

-- No write policies anywhere: lobby RPCs (SECURITY DEFINER) and the Edge Function
-- service-role client are the only writers.

-- =====================================================================
-- GRANTS
-- =====================================================================
grant select on public.monopoly_rooms      to authenticated;
grant select on public.monopoly_players    to authenticated;
grant select on public.monopoly_properties to authenticated;
-- monopoly_secrets: protected by RLS (no select policy), AND explicitly revoked so
-- the shuffled deck order can never leak even if RLS were ever disabled. Supabase's
-- default privileges auto-grant SELECT to anon/authenticated on new public tables,
-- so the revoke is load-bearing, not redundant.
revoke all on public.monopoly_secrets from anon, authenticated;

grant execute on function public.monopoly_is_member(uuid)                         to authenticated;
grant execute on function public.monopoly_create_room(int, int, int)              to authenticated;
grant execute on function public.monopoly_join(text)                              to authenticated;
grant execute on function public.monopoly_leave(uuid)                             to authenticated;
grant execute on function public.monopoly_set_token(uuid, text)                   to authenticated;
grant execute on function public.monopoly_reset(uuid)                             to authenticated;

-- Engine RPCs: service_role ONLY (a client must never call commit/load directly,
-- or it could forge money or read the shuffled deck).
revoke all on function public.monopoly_load(uuid)                       from public;
revoke all on function public.monopoly_commit(uuid, int, jsonb)         from public;
revoke all on function public.monopoly_snapshot(uuid, boolean)          from public;
grant execute on function public.monopoly_load(uuid)                    to service_role;
grant execute on function public.monopoly_commit(uuid, int, jsonb)      to service_role;
grant execute on function public.monopoly_snapshot(uuid, boolean)       to service_role;

-- =====================================================================
-- REALTIME — clients subscribe to room + player + property changes (NOT secrets)
-- =====================================================================
alter table public.monopoly_rooms      replica identity full;
alter table public.monopoly_players    replica identity full;
alter table public.monopoly_properties replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.monopoly_rooms;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.monopoly_players;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.monopoly_properties;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- OPTIONAL: sweep stale Monopoly rooms (needs pg_cron; mirrors 0009).
-- select cron.schedule('sweep-monopoly-rooms', '*/15 * * * *', $sweep$
--   update public.monopoly_rooms set status='finished', phase='ended'
--   where status <> 'finished' and now() - updated_at > interval '45 minutes';
-- $sweep$);
-- =====================================================================
