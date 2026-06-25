-- =====================================================================
-- Jordan Stand Tall — Draw & Guess (skribbl-style) multiplayer party game
-- Paste into the Supabase SQL editor and run once (after 0001-0008).
-- =====================================================================
--
-- WHY THIS IS SEPARATE FROM `matches`:
--   Every other game is strictly 1v1 (matches.player1/player2). Draw & Guess is
--   N-player, so it gets its own tables, its own RPCs, and its own page/route.
--
-- THE LOAD-BEARING SECURITY IDEA:
--   The word a player is drawing must NEVER reach a guesser's browser, or they
--   would just read it out of devtools. Supabase realtime (`postgres_changes`)
--   broadcasts the ENTIRE row to every subscriber, so a secret column on a
--   published table leaks to everyone. Therefore the answer lives in its own
--   table, `draw_secrets`, which is deliberately kept OUT of the realtime
--   publication and has RLS on with NO select policy (same trick as
--   trivia_questions.answer_idx). Only the SECURITY DEFINER RPCs read it; the
--   current drawer receives their word/choices via an RPC return value, never
--   through the row stream. The word becomes public only when the server copies
--   it into draw_rooms.reveal_word at the reveal phase.
--
-- TWO TRANSPORTS:
--   * Authoritative game state (phase, drawer, timer, scores) syncs over
--     postgres_changes on draw_rooms + draw_players, exactly like useMatch.js.
--   * Drawing strokes + chat ride an EPHEMERAL realtime broadcast channel
--     (draw:<roomId>) handled entirely client-side — never written to Postgres.
--
-- All mutations go through SECURITY DEFINER RPCs (the only writers). There are
-- no INSERT/UPDATE/DELETE policies, so clients can never write these tables.

-- ---------- tables ----------

-- The synced, broadcast-safe room row. Carries everything every player may see.
-- reveal_word is null except during the reveal/ended phases.
create table if not exists public.draw_rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                 -- short shareable join code
  host          uuid not null references public.profiles(id) on delete cascade,
  lang          text not null default 'en' check (lang in ('en','ar')),
  status        text not null default 'lobby' check (status in ('lobby','playing','finished')),
  phase         text not null default 'waiting'
                check (phase in ('waiting','choosing','drawing','reveal','ended')),
  round         int  not null default 0,
  total_rounds  int  not null default 3 check (total_rounds between 1 and 10),
  turn_index    int  not null default 0,
  drawer        uuid references public.profiles(id),
  reveal_word   text,                                 -- null except reveal/ended
  word_hint     text,                                 -- masked length, e.g. "___ ___" (safe: no letters)
  round_seconds int  not null default 75 check (round_seconds between 30 and 180),
  phase_ends_at timestamptz,
  turn_order    jsonb not null default '[]'::jsonb,   -- shuffled array of profile ids
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The answer. NOT in the realtime publication. RLS on, no select policy.
create table if not exists public.draw_secrets (
  room_id      uuid primary key references public.draw_rooms(id) on delete cascade,
  word         text,                                  -- current answer (hidden)
  word_choices jsonb                                  -- the 3 options offered (hidden)
);

-- Per-player room membership + score. Synced (broadcast-safe).
create table if not exists public.draw_players (
  room_id     uuid not null references public.draw_rooms(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  score       int  not null default 0,
  round_score int  not null default 0,
  guessed_at  timestamptz,                            -- when they got it THIS round
  is_present  boolean not null default true,
  joined_at   timestamptz not null default now(),
  primary key (room_id, profile_id)
);
create index if not exists draw_players_room_idx on public.draw_players(room_id);
create index if not exists draw_rooms_code_idx on public.draw_rooms(code);

-- The word bank. RLS on, no select policy (RPC-only). Seeded by seed_draw_words.sql.
create table if not exists public.draw_words (
  id         uuid primary key default gen_random_uuid(),
  lang       text not null check (lang in ('en','ar')),
  word       text not null,
  category   text,
  difficulty smallint default 1,
  active     boolean not null default true
);
create index if not exists draw_words_lang_idx on public.draw_words(lang) where active;

-- =====================================================================
-- HELPERS
-- =====================================================================

-- Arabic-aware normaliser for guess matching: lowercases (latin), strips tatweel
-- + tashkeel/diacritics, folds alef variants (أإآٱ→ا), alef-maqsura ى→ي,
-- ta-marbuta ة→ه, waw/ya-hamza (ؤئ→وي), and collapses whitespace. Built from
-- chr() code points so the .sql file stays ASCII-clean and editor-safe.
-- (Diacritics: U+0640 tatweel, U+064B-U+0652 tashkeel, U+0670 superscript alef.)
create or replace function public.draw_normalize(p text, p_lang text default 'en')
returns text language sql immutable as $$
  select btrim(regexp_replace(
    translate(
      regexp_replace(
        lower(coalesce(p, '')),
        '[' || chr(1600) || chr(1611) || '-' || chr(1618) || chr(1648) || ']', '', 'g'
      ),
      chr(1571)||chr(1573)||chr(1570)||chr(1649)||chr(1609)||chr(1577)||chr(1572)||chr(1574),
      chr(1575)||chr(1575)||chr(1575)||chr(1575)||chr(1610)||chr(1607)||chr(1608)||chr(1610)
    ),
    '\s+', ' ', 'g'
  ));
$$;

-- Random unambiguous join code (no I/L/O/0/1).
create or replace function public.draw_gen_code()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random()*31)+1)::int, 1), ''
  ) from generate_series(1,4);
$$;

-- Pick N random active words for a language, as a jsonb array of strings.
-- SECURITY DEFINER so it can read draw_words (which clients can't).
create or replace function public.draw_pick_words(p_lang text, p_n int)
returns jsonb language sql volatile security definer set search_path = public as $$
  select coalesce(jsonb_agg(word), '[]'::jsonb)
  from (
    select word from public.draw_words
    where active and lang = p_lang
    order by random() limit p_n
  ) q;
$$;

-- Membership test used by RLS. SECURITY DEFINER so the policy on draw_players
-- doesn't recurse into its own RLS (which would error).
create or replace function public.draw_is_member(p_room uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.draw_players
    where room_id = p_room and profile_id = auth.uid()
  );
$$;

-- =====================================================================
-- LOBBY / MATCHMAKING RPCs
-- =====================================================================

create or replace function public.draw_create_room(
  p_lang text default 'en', p_total_rounds int default 3, p_round_seconds int default 75)
returns public.draw_rooms
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid(); v_code text; tries int := 0;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_lang not in ('en','ar') then p_lang := 'en'; end if;
  p_total_rounds  := least(greatest(coalesce(p_total_rounds, 3), 1), 10);
  p_round_seconds := least(greatest(coalesce(p_round_seconds, 75), 30), 180);

  loop
    v_code := public.draw_gen_code();
    begin
      insert into public.draw_rooms (code, host, lang, total_rounds, round_seconds)
      values (v_code, uid, p_lang, p_total_rounds, p_round_seconds)
      returning * into r;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 8 then raise exception 'Could not allocate a room code, try again'; end if;
    end;
  end loop;

  insert into public.draw_secrets (room_id) values (r.id);
  insert into public.draw_players (room_id, profile_id, is_present)
  values (r.id, uid, true)
  on conflict (room_id, profile_id) do update set is_present = true;
  return r;
end $$;

create or replace function public.draw_join(p_code text)
returns public.draw_rooms
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.draw_rooms where code = upper(btrim(p_code));
  if not found then raise exception 'Room not found'; end if;
  if r.status = 'finished' then raise exception 'That game has already ended'; end if;
  -- Late joiners (status='playing') come in score 0; they guess this game but are
  -- not in turn_order, so they won't draw until the host hits "play again".
  insert into public.draw_players (room_id, profile_id, is_present, score)
  values (r.id, uid, true, 0)
  on conflict (room_id, profile_id) do update set is_present = true;
  return r;
end $$;

create or replace function public.draw_leave(p_room uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid(); new_host uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update public.draw_players set is_present = false
   where room_id = p_room and profile_id = uid;

  select * into r from public.draw_rooms where id = p_room for update;
  if not found then return; end if;
  -- Host migration: if the host leaves while still in the lobby, hand off to the
  -- earliest-joined remaining present player.
  if r.host = uid and r.status = 'lobby' then
    select profile_id into new_host from public.draw_players
     where room_id = p_room and profile_id <> uid and is_present
     order by joined_at asc limit 1;
    if new_host is not null then
      update public.draw_rooms set host = new_host, updated_at = now() where id = p_room;
    end if;
  end if;
end $$;

-- =====================================================================
-- ROUND LIFECYCLE RPCs
-- =====================================================================

-- Host starts the game: shuffle the drawing order, pick the first drawer (random,
-- NOT necessarily the host), generate the first 3 hidden word choices, enter
-- 'choosing'. The drawer fetches their choices via draw_drawer_view().
create or replace function public.draw_start(p_room uuid)
returns public.draw_rooms
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid(); v_order jsonb; n int; first_drawer uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.draw_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.host <> uid then raise exception 'Only the host can start the game'; end if;
  if r.status <> 'lobby' then raise exception 'The game has already started'; end if;

  select jsonb_agg(profile_id order by random()), count(*)
    into v_order, n
    from public.draw_players where room_id = p_room and is_present;
  if n < 2 then raise exception 'Need at least 2 players to start'; end if;

  first_drawer := (v_order->>0)::uuid;
  update public.draw_secrets
     set word = null, word_choices = public.draw_pick_words(r.lang, 3)
   where room_id = p_room;
  update public.draw_players set guessed_at = null, round_score = 0, score = 0
   where room_id = p_room;
  update public.draw_rooms
     set status = 'playing', phase = 'choosing', round = 1, turn_index = 0,
         drawer = first_drawer, turn_order = v_order, reveal_word = null,
         phase_ends_at = now() + interval '20 seconds', updated_at = now()
   where id = p_room returning * into r;
  return r;
end $$;

-- The current drawer pulls their private state (word choices while 'choosing',
-- the chosen word while 'drawing'/'reveal'). Survives a page reload. Nobody else
-- can call this — it is the only path to the secret and it is drawer-gated.
create or replace function public.draw_drawer_view(p_room uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid(); s public.draw_secrets;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.draw_rooms where id = p_room;
  if not found then raise exception 'Room not found'; end if;
  if r.drawer is null or r.drawer <> uid then raise exception 'You are not the drawer'; end if;
  select * into s from public.draw_secrets where room_id = p_room;
  return jsonb_build_object(
    'phase',   r.phase,
    'choices', case when r.phase = 'choosing' then s.word_choices else null end,
    'word',    case when r.phase in ('drawing','reveal') then s.word else null end
  );
end $$;

-- Drawer commits one of the 3 choices and the drawing phase begins.
create or replace function public.draw_choose_word(p_room uuid, p_choice_idx int)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid(); ch jsonb; chosen text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.draw_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.drawer is null or r.drawer <> uid then raise exception 'It is not your turn to draw'; end if;
  if r.phase <> 'choosing' then raise exception 'Not choosing a word right now'; end if;

  select word_choices into ch from public.draw_secrets where room_id = p_room;
  if ch is null or p_choice_idx < 0 or p_choice_idx >= jsonb_array_length(ch) then
    raise exception 'Invalid word choice';
  end if;
  chosen := ch->>p_choice_idx;

  update public.draw_secrets set word = chosen where room_id = p_room;
  update public.draw_players set guessed_at = null, round_score = 0 where room_id = p_room;
  update public.draw_rooms
     set phase = 'drawing',
         word_hint = regexp_replace(chosen, '\S', '_', 'g'),  -- length/spacing only
         phase_ends_at = now() + (r.round_seconds || ' seconds')::interval,
         updated_at = now()
   where id = p_room returning * into r;
  return jsonb_build_object('room', to_jsonb(r), 'word', chosen);
end $$;

-- A non-drawer submits a guess. Server-side EXACT normalized equality only (no
-- substring). Returns { correct } and NEVER the word. The client decides what to
-- broadcast: a system "X guessed it!" on true, or the raw text as chat on false.
create or replace function public.draw_guess(p_room uuid, p_text text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r public.draw_rooms; uid uuid := auth.uid(); me public.draw_players;
  w text; remaining numeric; frac numeric; pts int;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_text is null or length(p_text) > 80 then return jsonb_build_object('correct', false); end if;

  select * into r from public.draw_rooms where id = p_room for update;  -- lock serialises guesses
  if not found then raise exception 'Room not found'; end if;
  if r.phase <> 'drawing' then return jsonb_build_object('correct', false); end if;
  if now() >= r.phase_ends_at then return jsonb_build_object('correct', false); end if;  -- past buzzer
  if r.drawer = uid then raise exception 'The drawer cannot guess'; end if;

  select * into me from public.draw_players where room_id = p_room and profile_id = uid;
  if not found then raise exception 'You are not in this room'; end if;
  if me.guessed_at is not null then return jsonb_build_object('correct', false); end if;  -- no double credit

  select word into w from public.draw_secrets where room_id = p_room;
  if w is null then return jsonb_build_object('correct', false); end if;
  if public.draw_normalize(p_text, r.lang) <> public.draw_normalize(w, r.lang) then
    return jsonb_build_object('correct', false);
  end if;

  -- speed-based: 100 (slow) .. 250 (instant)
  remaining := greatest(0, extract(epoch from (r.phase_ends_at - now())));
  frac := case when r.round_seconds > 0 then remaining / r.round_seconds else 0 end;
  pts  := 100 + round(150 * frac);

  update public.draw_players
     set guessed_at = now(), round_score = round_score + pts, score = score + pts
   where room_id = p_room and profile_id = uid;
  -- drawer earns a slice for each correct guess (rewards a clear drawing)
  update public.draw_players
     set round_score = round_score + 30, score = score + 30
   where room_id = p_room and profile_id = r.drawer;

  -- everyone present (besides the drawer) has guessed -> end the round now by
  -- collapsing the deadline; draw_advance becomes eligible immediately.
  if not exists (
    select 1 from public.draw_players
     where room_id = p_room and profile_id <> r.drawer and is_present and guessed_at is null
  ) then
    update public.draw_rooms set phase_ends_at = now() where id = p_room;
  end if;

  return jsonb_build_object('correct', true);
end $$;

-- Idempotent state pump, safe to call from any client. Advances the room when the
-- deadline passes (or the round ended early). The row lock + phase guards make
-- concurrent calls a no-op for everyone but the first.
create or replace function public.draw_advance(p_room uuid)
returns public.draw_rooms
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid(); w text; n int; next_drawer uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.draw_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.status = 'finished' then return r; end if;
  if not public.draw_is_member(p_room) then raise exception 'You are not in this room'; end if;

  if r.phase = 'choosing' then
    if now() < r.phase_ends_at then return r; end if;       -- drawer still has time
    -- drawer never chose: auto-pick the first option, skip straight to reveal
    select word_choices->>0 into w from public.draw_secrets where room_id = p_room;
    update public.draw_secrets set word = w where room_id = p_room;
    update public.draw_rooms
       set phase = 'reveal', reveal_word = w,
           phase_ends_at = now() + interval '6 seconds', updated_at = now()
     where id = p_room and phase = 'choosing' returning * into r;

  elsif r.phase = 'drawing' then
    if now() < r.phase_ends_at then return r; end if;
    select word into w from public.draw_secrets where room_id = p_room;
    update public.draw_rooms
       set phase = 'reveal', reveal_word = w,
           phase_ends_at = now() + interval '6 seconds', updated_at = now()
     where id = p_room and phase = 'drawing' returning * into r;

  elsif r.phase = 'reveal' then
    if now() < r.phase_ends_at then return r; end if;
    update public.draw_secrets set word = null, word_choices = null where room_id = p_room;
    n := jsonb_array_length(r.turn_order);

    if r.turn_index + 1 < n then
      next_drawer := (r.turn_order->>(r.turn_index + 1))::uuid;
      update public.draw_secrets set word_choices = public.draw_pick_words(r.lang, 3) where room_id = p_room;
      update public.draw_players set guessed_at = null, round_score = 0 where room_id = p_room;
      update public.draw_rooms
         set phase = 'choosing', drawer = next_drawer, turn_index = r.turn_index + 1,
             reveal_word = null, phase_ends_at = now() + interval '20 seconds', updated_at = now()
       where id = p_room returning * into r;

    elsif r.round < r.total_rounds then
      next_drawer := (r.turn_order->>0)::uuid;
      update public.draw_secrets set word_choices = public.draw_pick_words(r.lang, 3) where room_id = p_room;
      update public.draw_players set guessed_at = null, round_score = 0 where room_id = p_room;
      update public.draw_rooms
         set phase = 'choosing', drawer = next_drawer, round = r.round + 1, turn_index = 0,
             reveal_word = null, phase_ends_at = now() + interval '20 seconds', updated_at = now()
       where id = p_room returning * into r;

    else
      update public.draw_rooms
         set status = 'finished', phase = 'ended', drawer = null, reveal_word = null,
             phase_ends_at = null, updated_at = now()
       where id = p_room returning * into r;
    end if;
  end if;

  return r;
end $$;

-- Host "play again": wipe scores and drop back to the lobby.
create or replace function public.draw_reset(p_room uuid)
returns public.draw_rooms
language plpgsql security definer set search_path = public as $$
declare r public.draw_rooms; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into r from public.draw_rooms where id = p_room for update;
  if not found then raise exception 'Room not found'; end if;
  if r.host <> uid then raise exception 'Only the host can restart'; end if;

  update public.draw_secrets set word = null, word_choices = null where room_id = p_room;
  update public.draw_players set score = 0, round_score = 0, guessed_at = null where room_id = p_room;
  update public.draw_rooms
     set status = 'lobby', phase = 'waiting', round = 0, turn_index = 0, drawer = null,
         reveal_word = null, word_hint = null, turn_order = '[]'::jsonb,
         phase_ends_at = null, updated_at = now()
   where id = p_room returning * into r;
  return r;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.draw_rooms   enable row level security;
alter table public.draw_players enable row level security;
alter table public.draw_secrets enable row level security;  -- no select policy => unreadable
alter table public.draw_words   enable row level security;  -- no select policy => unreadable

-- A joinable lobby is discoverable; otherwise only members can read the room.
drop policy if exists draw_rooms_read on public.draw_rooms;
create policy draw_rooms_read on public.draw_rooms for select to authenticated
  using (status = 'lobby' or public.draw_is_member(id));

-- Players (the scoreboard) are readable by anyone in the same room.
drop policy if exists draw_players_read on public.draw_players;
create policy draw_players_read on public.draw_players for select to authenticated
  using (public.draw_is_member(room_id));

-- No write policies anywhere: all mutations go through the SECURITY DEFINER RPCs.

-- =====================================================================
-- GRANTS
-- =====================================================================
grant select on public.draw_rooms   to authenticated;
grant select on public.draw_players to authenticated;
-- draw_secrets / draw_words intentionally NOT granted to clients.

grant execute on function public.draw_normalize(text, text)               to authenticated;
grant execute on function public.draw_is_member(uuid)                     to authenticated;
grant execute on function public.draw_create_room(text, int, int)         to authenticated;
grant execute on function public.draw_join(text)                          to authenticated;
grant execute on function public.draw_leave(uuid)                         to authenticated;
grant execute on function public.draw_start(uuid)                         to authenticated;
grant execute on function public.draw_drawer_view(uuid)                   to authenticated;
grant execute on function public.draw_choose_word(uuid, int)              to authenticated;
grant execute on function public.draw_guess(uuid, text)                   to authenticated;
grant execute on function public.draw_advance(uuid)                       to authenticated;
grant execute on function public.draw_reset(uuid)                         to authenticated;

-- =====================================================================
-- REALTIME — clients subscribe to room + player changes (NOT secrets/words)
-- =====================================================================
alter table public.draw_rooms   replica identity full;
alter table public.draw_players replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.draw_rooms;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.draw_players;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- OPTIONAL: sweep stale Draw & Guess rooms (needs pg_cron; mirrors 0001).
-- select cron.schedule('sweep-draw-rooms', '*/15 * * * *', $sweep$
--   update public.draw_rooms set status='finished', phase='ended'
--   where status <> 'finished' and now() - updated_at > interval '30 minutes';
-- $sweep$);
-- =====================================================================
