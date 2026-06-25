-- =====================================================================
-- Jordan Stand Tall — Checkers (Dama) game logic
-- Paste into the Supabase SQL editor and run once (AFTER 0007 has committed).
-- =====================================================================
--
-- Checkers is refereed by the `checkers-move` Edge Function (Deno, service role),
-- exactly like chess. Postgres' job here is only to (1) seed the starting board,
-- (2) REJECT any attempt to push a checkers move through make_move (so the Edge
-- Function is the only writer), (3) give checkers a fair idle-timeout window, and
-- (4) backfill a stats row for existing players.
--
-- Board state shape: { board: int[64], mustJumpFrom: int|null, noProgress: int }
--   index = row*8 + col (row 0 = top). 0 empty, 1 p1 man, 2 p2 man, 3 p1 king,
--   4 p2 king. p1 on rows 5-7 (promotes row 0), p2 on rows 0-2 (promotes row 7),
--   on the dark squares where (row + col) is odd.

-- ---------- initial_board(): add the checkers starting position ----------
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
  elsif p_game_type = 'checkers' then
    return jsonb_build_object(
      'board', (
        select jsonb_agg(
          case
            when ((g.i / 8) + (g.i % 8)) % 2 = 1 and (g.i / 8) <= 2 then 2
            when ((g.i / 8) + (g.i % 8)) % 2 = 1 and (g.i / 8) >= 5 then 1
            else 0
          end order by g.i)
        from generate_series(0, 63) as g(i)
      ),
      'mustJumpFrom', null,
      'noProgress', 0);
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

-- ---------- make_move(): reject checkers (Edge Function is the only writer) ----------
-- Re-created identically to 0004 except for the added checkers branch.
create or replace function public.make_move(p_match_id uuid, p_move jsonb)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches;
  uid uuid := auth.uid();
  is_p1 boolean;
  cells text[]; mark text; cell_idx int; w text;
  grid int[]; disc int; col int; rr int; placed int; cw int; board_full boolean;
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
    -- Chess is refereed by the chess-move Edge Function, never here.
    raise exception 'Chess moves must go through the chess-move endpoint';

  elsif m.game_type = 'checkers' then
    -- Checkers is refereed by the checkers-move Edge Function, never here.
    raise exception 'Checkers moves must go through the checkers-move endpoint';

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

-- ---------- claim_timeout(): give checkers a 120s idle window ----------
-- Re-created identically to 0003 (incl. the trivia-fairness fix) except checkers
-- joins chess in the longer idle tier (strategy games deserve more think time).
create or replace function public.claim_timeout(p_match_id uuid)
returns public.matches
language plpgsql security definer set search_path = public as $$
declare
  m public.matches; uid uuid := auth.uid(); allowed interval;
  opp uuid; round int; answered jsonb; round_ans jsonb;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into m from public.matches where id = p_match_id for update;
  if not found then raise exception 'Match not found'; end if;
  if uid <> m.player1 and uid <> m.player2 then raise exception 'Not your match'; end if;
  if m.status <> 'active' then return m; end if;
  if m.player2 is null then raise exception 'No opponent to time out'; end if;

  opp := case when uid = m.player1 then m.player2 else m.player1 end;

  allowed := case
    when m.game_type = 'chess' then interval '180 seconds'
    when m.game_type = 'checkers' then interval '120 seconds'
    else interval '60 seconds' end;
  if now() - m.last_move_at < allowed then raise exception 'Too soon to claim a timeout'; end if;

  if m.game_type = 'trivia' then
    -- You may only claim if you answered the current round and they did not.
    round := (m.board_state->>'round')::int;
    answered := coalesce(m.board_state->'answered', '{}'::jsonb);
    round_ans := coalesce(answered->round::text, '{}'::jsonb);
    if not (round_ans ? uid::text) then
      raise exception 'Answer the current question before claiming a timeout';
    end if;
    if round_ans ? opp::text then
      raise exception 'Your opponent has answered — no timeout to claim';
    end if;
  elsif m.current_turn = uid then
    raise exception 'It is your move — you cannot claim a timeout';
  end if;

  if uid = m.player1 then m.winner := m.player1; m.result := 'p1';
  else m.winner := m.player2; m.result := 'p2'; end if;
  update public.matches set status='finished', winner=m.winner, result=m.result, finished_at=now()
   where id=m.id returning * into m;
  return m;
end $$;

-- ---------- backfill a checkers stats row for existing players ----------
-- New users already get one via handle_new_user()'s enum_range seed; this covers
-- everyone who signed up before checkers existed. (record_result also self-heals
-- via upsert, so this is for cleanliness / pre-game leaderboard presence.)
insert into public.game_stats (profile_id, game_type)
select id, 'checkers'::public.game_type from public.profiles
on conflict do nothing;

-- ---------- grants (re-grant; no-op if unchanged) ----------
grant execute on function public.make_move(uuid, jsonb)     to authenticated;
grant execute on function public.claim_timeout(uuid)        to authenticated;
