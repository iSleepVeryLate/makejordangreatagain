-- =====================================================================
-- Jordan Stand Tall — fair trivia timeouts
-- Paste into the Supabase SQL editor and run once (after 0002).
-- =====================================================================
--
-- Bug this fixes:
--   claim_timeout() guards turn-based games with "you cannot claim while it
--   is your move", but trivia has no current_turn, so that guard was skipped
--   entirely. That let the *stalling* player claim the win after 60s — the
--   exact opposite of fair. A trivia timeout should only be claimable by a
--   player who has answered the current round when their opponent has not.

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

  allowed := case when m.game_type = 'chess' then interval '180 seconds' else interval '60 seconds' end;
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

grant execute on function public.claim_timeout(uuid) to authenticated;
