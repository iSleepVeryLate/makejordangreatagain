-- =====================================================================
-- Jordan Stand Tall — close the client-trusted chess path
-- =====================================================================
--
-- The chess branch of make_move() trusted the client's fen/pgn/outcome, which
-- let a modified client fabricate positions or claim a win. Chess is now
-- refereed by the `chess-move` Edge Function (Deno + chess.js, service role).
-- This migration makes make_move() REJECT chess so the Edge Function is the
-- only path that can write a chess move.
--
-- ORDER OF OPERATIONS — apply this AFTER `supabase functions deploy chess-move`
-- and after the new frontend (which calls the function) is live. Until then the
-- client falls back to make_move for chess, so honest play keeps working.
--
-- This re-creates make_move() identically to 0001 except the chess branch.

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

grant execute on function public.make_move(uuid, jsonb) to authenticated;
