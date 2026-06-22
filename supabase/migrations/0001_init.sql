-- =====================================================================
-- Jordan Stand Tall — database schema, security, and game logic
-- Paste this whole file into the Supabase SQL editor and run it once.
-- =====================================================================

-- ---------- enums ----------
do $$ begin
  create type public.game_type as enum ('tictactoe','connect_four','chess','trivia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.match_status as enum ('waiting','active','finished','abandoned');
exception when duplicate_object then null; end $$;

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  discord_id  text unique,
  username    text not null,
  global_name text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- per-game stats / rating ----------
create table if not exists public.game_stats (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  game_type    public.game_type not null,
  rating       integer not null default 1000,
  wins         integer not null default 0,
  losses       integer not null default 0,
  draws        integer not null default 0,
  games_played integer generated always as (wins + losses + draws) stored,
  updated_at   timestamptz not null default now(),
  primary key (profile_id, game_type)
);

-- ---------- matches / rooms (one table for every game) ----------
create table if not exists public.matches (
  id           uuid primary key default gen_random_uuid(),
  game_type    public.game_type not null,
  status       public.match_status not null default 'waiting',
  is_private   boolean not null default false,
  player1      uuid not null references public.profiles(id),
  player2      uuid references public.profiles(id),
  current_turn uuid references public.profiles(id),
  board_state  jsonb not null,
  move_count   integer not null default 0,
  winner       uuid references public.profiles(id),
  result       text,                         -- 'p1' | 'p2' | 'draw' | 'abandoned'
  last_move_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  finished_at  timestamptz,
  constraint players_distinct check (player2 is null or player1 <> player2)
);

-- one open *public* room per creator per game (prevents lobby spam + race target)
create unique index if not exists one_open_room_per_creator
  on public.matches (player1, game_type)
  where status = 'waiting' and is_private = false;

create index if not exists matches_open_lobby_idx
  on public.matches (game_type, created_at)
  where status = 'waiting' and is_private = false;
create index if not exists matches_player1_idx on public.matches(player1);
create index if not exists matches_player2_idx on public.matches(player2);

-- ---------- trivia ----------
create table if not exists public.trivia_questions (
  id         uuid primary key default gen_random_uuid(),
  category   text default 'jordan',
  question   text not null,
  choices    jsonb not null,        -- ["Amman","Irbid","Zarqa","Aqaba"]
  answer_idx smallint not null,     -- never exposed to clients
  difficulty smallint default 1,
  active     boolean not null default true
);

-- =====================================================================
-- VIEWS
-- =====================================================================

-- Trivia without the answer (clients read this, never the base table).
create or replace view public.trivia_public as
  select id, category, question, choices, difficulty
  from public.trivia_questions
  where active;

-- Leaderboard derived from game_stats (never goes stale).
create or replace view public.leaderboard as
  select
    gs.game_type,
    p.id as profile_id,
    p.username,
    p.global_name,
    p.avatar_url,
    gs.rating, gs.wins, gs.losses, gs.draws, gs.games_played,
    rank() over (partition by gs.game_type order by gs.rating desc, gs.wins desc) as rank
  from public.game_stats gs
  join public.profiles p on p.id = gs.profile_id
  where gs.games_played > 0;

-- =====================================================================
-- SIGNUP TRIGGER — auto-create a profile + seed stats from Discord meta
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare meta jsonb := new.raw_user_meta_data;
begin
  insert into public.profiles (id, discord_id, username, global_name, avatar_url)
  values (
    new.id,
    coalesce(meta->>'provider_id', meta->>'sub'),
    coalesce(meta->>'user_name', meta->>'name', meta->>'full_name', 'jordanian'),
    coalesce(meta->>'global_name', meta->>'full_name', meta->>'name'),
    coalesce(meta->>'avatar_url', meta->>'picture')
  )
  on conflict (id) do nothing;

  insert into public.game_stats (profile_id, game_type)
  select new.id, gt from unnest(enum_range(null::public.game_type)) gt
  on conflict do nothing;

  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- RESULT TRIGGER — Elo + W/L/D recorded atomically when a match finishes
-- =====================================================================
create or replace function public.record_result()
returns trigger language plpgsql security definer set search_path = public as $$
declare k int := 24; ra int; rb int; ea float; eb float; sa float; sb float;
begin
  if new.status = 'finished'
     and old.status is distinct from 'finished'
     and new.player2 is not null
     and new.result in ('p1','p2','draw') then

    ra := coalesce((select rating from game_stats where profile_id=new.player1 and game_type=new.game_type), 1000);
    rb := coalesce((select rating from game_stats where profile_id=new.player2 and game_type=new.game_type), 1000);
    ea := 1.0 / (1 + power(10, (rb - ra) / 400.0));
    eb := 1.0 / (1 + power(10, (ra - rb) / 400.0));
    sa := case new.result when 'p1' then 1 when 'p2' then 0 else 0.5 end;
    sb := 1 - sa;

    insert into game_stats(profile_id, game_type, rating, wins, losses, draws)
    values (new.player1, new.game_type, 1000 + round(k*(sa-ea)),
            (new.result='p1')::int, (new.result='p2')::int, (new.result='draw')::int)
    on conflict (profile_id, game_type) do update set
      rating = game_stats.rating + round(k*(sa-ea)),
      wins   = game_stats.wins   + (new.result='p1')::int,
      losses = game_stats.losses + (new.result='p2')::int,
      draws  = game_stats.draws  + (new.result='draw')::int,
      updated_at = now();

    insert into game_stats(profile_id, game_type, rating, wins, losses, draws)
    values (new.player2, new.game_type, 1000 + round(k*(sb-eb)),
            (new.result='p2')::int, (new.result='p1')::int, (new.result='draw')::int)
    on conflict (profile_id, game_type) do update set
      rating = game_stats.rating + round(k*(sb-eb)),
      wins   = game_stats.wins   + (new.result='p2')::int,
      losses = game_stats.losses + (new.result='p1')::int,
      draws  = game_stats.draws  + (new.result='draw')::int,
      updated_at = now();
  end if;
  return new;
end $$;

drop trigger if exists trg_record_result on public.matches;
create trigger trg_record_result
  after update on public.matches
  for each row execute function public.record_result();

-- =====================================================================
-- GAME HELPERS
-- =====================================================================

-- Tic-Tac-Toe winner ('X' | 'O' | null). cells is 1-indexed length 9.
create or replace function public.ttt_winner(c text[]) returns text
language sql immutable as $$
  select case
    when c[1]<>'' and c[1]=c[2] and c[2]=c[3] then c[1]
    when c[4]<>'' and c[4]=c[5] and c[5]=c[6] then c[4]
    when c[7]<>'' and c[7]=c[8] and c[8]=c[9] then c[7]
    when c[1]<>'' and c[1]=c[4] and c[4]=c[7] then c[1]
    when c[2]<>'' and c[2]=c[5] and c[5]=c[8] then c[2]
    when c[3]<>'' and c[3]=c[6] and c[6]=c[9] then c[3]
    when c[1]<>'' and c[1]=c[5] and c[5]=c[9] then c[1]
    when c[3]<>'' and c[3]=c[5] and c[5]=c[7] then c[3]
    else null end;
$$;

-- Connect Four winner (1 | 2 | 0). b is a flat 6x7 = 42 int[] (row 0 = top).
create or replace function public.c4_winner(b int[]) returns int
language plpgsql immutable as $$
declare r int; c int; v int; idx int;
begin
  for r in 0..5 loop          -- horizontal
    for c in 0..3 loop
      idx := r*7 + c + 1; v := b[idx];
      if v<>0 and v=b[idx+1] and v=b[idx+2] and v=b[idx+3] then return v; end if;
    end loop;
  end loop;
  for r in 0..2 loop          -- vertical
    for c in 0..6 loop
      idx := r*7 + c + 1; v := b[idx];
      if v<>0 and v=b[idx+7] and v=b[idx+14] and v=b[idx+21] then return v; end if;
    end loop;
  end loop;
  for r in 0..2 loop          -- diagonal down-right
    for c in 0..3 loop
      idx := r*7 + c + 1; v := b[idx];
      if v<>0 and v=b[idx+8] and v=b[idx+16] and v=b[idx+24] then return v; end if;
    end loop;
  end loop;
  for r in 0..2 loop          -- diagonal down-left
    for c in 3..6 loop
      idx := r*7 + c + 1; v := b[idx];
      if v<>0 and v=b[idx+6] and v=b[idx+12] and v=b[idx+18] then return v; end if;
    end loop;
  end loop;
  return 0;
end $$;

-- Starting board for each game type.
create or replace function public.initial_board(p_game_type public.game_type)
returns jsonb language plpgsql volatile as $$
declare qids jsonb; n int := 8;
begin
  if p_game_type = 'tictactoe' then
    return jsonb_build_object('cells', jsonb_build_array('','','','','','','','',''));
  elsif p_game_type = 'connect_four' then
    return jsonb_build_object('grid', (select jsonb_agg(0) from generate_series(1,42)));
  elsif p_game_type = 'chess' then
    return jsonb_build_object(
      'fen','rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1','pgn','');
  elsif p_game_type = 'trivia' then
    select jsonb_agg(id) into qids from (
      select id from public.trivia_questions where active order by random() limit n
    ) q;
    return jsonb_build_object(
      'round', 0,
      'total', coalesce(jsonb_array_length(qids), 0),
      'question_ids', coalesce(qids, '[]'::jsonb),
      'scores', '{}'::jsonb,
      'answered', '{}'::jsonb);
  end if;
  return '{}'::jsonb;
end $$;

-- =====================================================================
-- MATCHMAKING RPCs
-- =====================================================================

create or replace function public.create_room(p_game_type public.game_type, p_is_private boolean default false)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  begin
    insert into public.matches (game_type, status, is_private, player1, board_state)
    values (p_game_type, 'waiting', p_is_private, uid, public.initial_board(p_game_type))
    returning * into m;
  exception when unique_violation then
    select * into m from public.matches
     where player1=uid and game_type=p_game_type and status='waiting' and is_private=false
     limit 1;
  end;
  return m;
end $$;

create or replace function public.join_open_room(p_game_type public.game_type)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare v_match public.matches; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  with candidate as (
    select id from public.matches
    where game_type = p_game_type and status='waiting'
      and is_private = false and player1 <> v_uid
    order by created_at asc
    limit 1
    for update skip locked
  )
  update public.matches m
     set player2 = v_uid,
         status  = 'active',
         current_turn = case when m.game_type='trivia' then null else m.player1 end,
         last_move_at = now()
    from candidate c
   where m.id = c.id
   returning m.* into v_match;

  if v_match.id is null then
    begin
      insert into public.matches (game_type, player1, board_state)
      values (p_game_type, v_uid, public.initial_board(p_game_type))
      returning * into v_match;
    exception when unique_violation then
      select * into v_match from public.matches
       where player1=v_uid and game_type=p_game_type and status='waiting' and is_private=false
       limit 1;
    end;
  end if;
  return v_match;
end $$;

create or replace function public.join_by_id(p_match_id uuid)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  update public.matches mm
     set player2 = uid,
         status  = 'active',
         current_turn = case when mm.game_type='trivia' then null else mm.player1 end,
         last_move_at = now()
   where mm.id = p_match_id and mm.status='waiting' and mm.player2 is null and mm.player1 <> uid
   returning mm.* into m;

  if m.id is null then
    select * into m from public.matches
     where id = p_match_id and (player1 = uid or player2 = uid);
    if m.id is null then raise exception 'Room not available'; end if;
  end if;
  return m;
end $$;

-- =====================================================================
-- MOVE RPCs (server is the referee for all turn-based games)
-- =====================================================================

create or replace function public.make_move(p_match_id uuid, p_move jsonb)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  uid uuid := auth.uid();
  is_p1 boolean;
  cells text[]; mark text; cell_idx int; w text;
  grid int[]; disc int; col int; rr int; placed int; cw int; board_full boolean;
  new_fen text; new_pgn text; outcome text; stm text; expect text;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.status <> 'active' then raise exception 'Match is not active'; end if;
  if uid <> m.player1 and uid <> m.player2 then raise exception 'You are not in this match'; end if;
  is_p1 := (uid = m.player1);

  if m.game_type = 'tictactoe' then
    if m.current_turn <> uid then raise exception 'Not your turn'; end if;
    cell_idx := (p_move->>'cell')::int;
    if cell_idx < 0 or cell_idx > 8 then raise exception 'Invalid cell'; end if;
    cells := array(select jsonb_array_elements_text(m.board_state->'cells'));
    if cells[cell_idx+1] <> '' then raise exception 'Cell already taken'; end if;
    mark := case when is_p1 then 'X' else 'O' end;
    cells[cell_idx+1] := mark;
    m.board_state := jsonb_build_object('cells', to_jsonb(cells));
    w := public.ttt_winner(cells);
    if w is not null then
      m.status := 'finished'; m.winner := uid; m.result := case when is_p1 then 'p1' else 'p2' end;
    elsif not ('' = any(cells)) then
      m.status := 'finished'; m.result := 'draw'; m.winner := null;
    else
      m.current_turn := case when is_p1 then m.player2 else m.player1 end;
    end if;

  elsif m.game_type = 'connect_four' then
    if m.current_turn <> uid then raise exception 'Not your turn'; end if;
    col := (p_move->>'col')::int;
    if col < 0 or col > 6 then raise exception 'Invalid column'; end if;
    grid := array(select (jsonb_array_elements_text(m.board_state->'grid'))::int);
    disc := case when is_p1 then 1 else 2 end;
    placed := null;
    for rr in reverse 5..0 loop
      if grid[rr*7 + col + 1] = 0 then
        grid[rr*7 + col + 1] := disc; placed := rr; exit;
      end if;
    end loop;
    if placed is null then raise exception 'Column is full'; end if;
    m.board_state := jsonb_build_object('grid', to_jsonb(grid));
    cw := public.c4_winner(grid);
    board_full := not (0 = any(grid));
    if cw <> 0 then
      m.status := 'finished'; m.winner := uid; m.result := case when is_p1 then 'p1' else 'p2' end;
    elsif board_full then
      m.status := 'finished'; m.result := 'draw'; m.winner := null;
    else
      m.current_turn := case when is_p1 then m.player2 else m.player1 end;
    end if;

  elsif m.game_type = 'chess' then
    if m.current_turn <> uid then raise exception 'Not your turn'; end if;
    new_fen := p_move->>'fen';
    if new_fen is null then raise exception 'Missing fen'; end if;
    new_pgn := coalesce(p_move->>'pgn', m.board_state->>'pgn');
    outcome := p_move->>'outcome';
    -- after p1 (white) moves it is black to move, and vice versa
    stm := split_part(new_fen, ' ', 2);
    expect := case when is_p1 then 'b' else 'w' end;
    if stm <> expect then raise exception 'Illegal move (turn mismatch)'; end if;
    m.board_state := jsonb_build_object('fen', new_fen, 'pgn', new_pgn);
    if outcome = 'checkmate' then
      m.status := 'finished'; m.winner := uid; m.result := case when is_p1 then 'p1' else 'p2' end;
    elsif outcome = 'draw' then
      m.status := 'finished'; m.result := 'draw'; m.winner := null;
    else
      m.current_turn := case when is_p1 then m.player2 else m.player1 end;
    end if;

  else
    raise exception 'Use trivia_answer for trivia matches';
  end if;

  m.move_count := m.move_count + 1;
  m.last_move_at := now();
  if m.status = 'finished' then m.finished_at := now(); end if;

  update public.matches set
    board_state=m.board_state, status=m.status, current_turn=m.current_turn,
    move_count=m.move_count, winner=m.winner, result=m.result,
    last_move_at=m.last_move_at, finished_at=m.finished_at
  where id=m.id;

  return m;
end $$;

create or replace function public.trivia_answer(p_match_id uuid, p_choice int)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches; uid uuid := auth.uid();
  bs jsonb; round int; total int; qids jsonb; qid uuid; correct_idx int; is_correct boolean;
  answered jsonb; round_key text; round_ans jsonb; scores jsonb; uid_key text := auth.uid()::text;
  s1 int; s2 int; both_done boolean;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if m.game_type <> 'trivia' then raise exception 'Not a trivia match'; end if;
  if m.status <> 'active' then raise exception 'Match is not active'; end if;
  if uid <> m.player1 and uid <> m.player2 then raise exception 'You are not in this match'; end if;

  bs := m.board_state;
  round := (bs->>'round')::int;
  total := (bs->>'total')::int;
  qids := bs->'question_ids';
  scores := coalesce(bs->'scores', '{}'::jsonb);
  answered := coalesce(bs->'answered', '{}'::jsonb);
  round_key := round::text;
  round_ans := coalesce(answered->round_key, '{}'::jsonb);

  if round >= total then raise exception 'Quiz already finished'; end if;
  if round_ans ? uid_key then raise exception 'You already answered this question'; end if;

  qid := (qids->>round)::uuid;
  select answer_idx into correct_idx from public.trivia_questions where id = qid;
  is_correct := (p_choice = correct_idx);

  round_ans := round_ans || jsonb_build_object(uid_key, jsonb_build_object('choice', p_choice, 'correct', is_correct));
  answered := answered || jsonb_build_object(round_key, round_ans);
  if is_correct then
    scores := scores || jsonb_build_object(uid_key, coalesce((scores->>uid_key)::int, 0) + 1);
  end if;

  both_done := (round_ans ? m.player1::text) and (m.player2 is not null and round_ans ? m.player2::text);
  bs := bs || jsonb_build_object('scores', scores, 'answered', answered);

  if both_done then
    if round + 1 >= total then
      s1 := coalesce((scores->>m.player1::text)::int, 0);
      s2 := coalesce((scores->>m.player2::text)::int, 0);
      m.status := 'finished'; m.finished_at := now();
      if s1 > s2 then m.winner := m.player1; m.result := 'p1';
      elsif s2 > s1 then m.winner := m.player2; m.result := 'p2';
      else m.winner := null; m.result := 'draw'; end if;
    else
      bs := bs || jsonb_build_object('round', round + 1);
    end if;
  end if;

  m.board_state := bs;
  m.move_count := m.move_count + 1;
  m.last_move_at := now();

  update public.matches set
    board_state=m.board_state, status=m.status, winner=m.winner, result=m.result,
    move_count=m.move_count, last_move_at=m.last_move_at, finished_at=m.finished_at
  where id=m.id;

  return m;
end $$;

-- =====================================================================
-- RESIGN + TIMEOUT
-- =====================================================================

create or replace function public.resign(p_match_id uuid)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if uid <> m.player1 and uid <> m.player2 then raise exception 'Not your match'; end if;

  if m.status = 'waiting' then
    update public.matches set status='abandoned', result='abandoned', finished_at=now()
     where id=m.id returning * into m;
    return m;
  end if;
  if m.status <> 'active' then return m; end if;

  if uid = m.player1 then m.winner := m.player2; m.result := 'p2';
  else m.winner := m.player1; m.result := 'p1'; end if;
  update public.matches set status='finished', winner=m.winner, result=m.result, finished_at=now()
   where id=m.id returning * into m;
  return m;
end $$;

create or replace function public.claim_timeout(p_match_id uuid)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare m public.matches; uid uuid := auth.uid(); allowed interval;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if uid <> m.player1 and uid <> m.player2 then raise exception 'Not your match'; end if;
  if m.status <> 'active' then return m; end if;

  allowed := case when m.game_type = 'chess' then interval '180 seconds' else interval '60 seconds' end;
  if now() - m.last_move_at < allowed then raise exception 'Too soon to claim a timeout'; end if;
  if m.game_type <> 'trivia' and m.current_turn = uid then
    raise exception 'It is your move — you cannot claim a timeout';
  end if;

  if uid = m.player1 then m.winner := m.player1; m.result := 'p1';
  else m.winner := m.player2; m.result := 'p2'; end if;
  update public.matches set status='finished', winner=m.winner, result=m.result, finished_at=now()
   where id=m.id returning * into m;
  return m;
end $$;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles        enable row level security;
alter table public.game_stats      enable row level security;
alter table public.matches         enable row level security;
alter table public.trivia_questions enable row level security;

-- profiles: any signed-in user can read; you may only edit your own row.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- game_stats / leaderboard: world-readable to signed-in users, never client-writable.
drop policy if exists stats_read on public.game_stats;
create policy stats_read on public.game_stats for select to authenticated using (true);

-- matches: readable by participants or if it's an open public room. No client writes.
drop policy if exists matches_read on public.matches;
create policy matches_read on public.matches for select to authenticated using (
  player1 = auth.uid()
  or player2 = auth.uid()
  or (status = 'waiting' and is_private = false)
);

-- trivia_questions: RLS on with no policy => base table unreadable by clients.
-- Clients read the answer-free public view instead.

-- =====================================================================
-- GRANTS
-- =====================================================================
grant select on public.leaderboard to authenticated;
grant select on public.trivia_public to authenticated, anon;

grant execute on function public.create_room(public.game_type, boolean)  to authenticated;
grant execute on function public.join_open_room(public.game_type)        to authenticated;
grant execute on function public.join_by_id(uuid)                        to authenticated;
grant execute on function public.make_move(uuid, jsonb)                  to authenticated;
grant execute on function public.trivia_answer(uuid, int)                to authenticated;
grant execute on function public.resign(uuid)                            to authenticated;
grant execute on function public.claim_timeout(uuid)                     to authenticated;

-- =====================================================================
-- REALTIME — clients subscribe to match row changes
-- =====================================================================
alter table public.matches replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.matches;
exception when duplicate_object then null; end $$;

-- =====================================================================
-- OPTIONAL: sweep stale active games into 'abandoned' (needs pg_cron).
-- Enable the pg_cron extension first (Dashboard -> Database -> Extensions),
-- then uncomment:
--
-- select cron.schedule('sweep-abandoned', '*/15 * * * *', $sweep$
--   update public.matches set status='abandoned', result='abandoned', finished_at=now()
--   where status='active' and now() - last_move_at > interval '30 minutes';
-- $sweep$);
-- =====================================================================
