-- =====================================================================
-- Jordan Stand Tall — Challenges + Notifications (social layer)
-- Paste into the Supabase SQL editor and run once (after 0010).
-- =====================================================================
--
-- Two features, one migration:
--   1) CHALLENGES — duel a *specific* person to any of the 5 matches-based
--      games (tictactoe, connect_four, chess, trivia, checkers). On accept we
--      spin up a real `matches` row, reusing initial_board() + the existing Elo
--      pipeline, so a challenge match is identical to a quick-match in every way.
--   2) NOTIFICATIONS — a per-user inbox that powers the navbar bell. Driven by
--      SECURITY DEFINER functions/triggers only; clients can read their own rows
--      but never write them. "Your turn" pings fire for the slow strategy games
--      (chess, checkers) where a player commonly walks away mid-match — the
--      exact place async games silently die today.

-- ---------- challenges ----------
create table if not exists public.challenges (
  id           uuid primary key default gen_random_uuid(),
  from_id      uuid not null references public.profiles(id) on delete cascade,
  to_id        uuid not null references public.profiles(id) on delete cascade,
  game_type    public.game_type not null,
  status       text not null default 'pending',      -- pending|accepted|declined|cancelled|expired
  match_id     uuid references public.matches(id) on delete set null,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  expires_at   timestamptz not null default now() + interval '24 hours',
  constraint challenge_distinct check (from_id <> to_id)
);

-- At most one *pending* challenge per (challenger, target, game) — no spamming
-- the same person with five chess invites. Resolved ones don't block a rematch.
create unique index if not exists one_pending_challenge
  on public.challenges (from_id, to_id, game_type)
  where status = 'pending';
create index if not exists challenges_to_idx   on public.challenges(to_id, status);
create index if not exists challenges_from_idx on public.challenges(from_id, status);

-- ---------- notifications ----------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  type         text not null,                          -- challenge|challenge_accepted|challenge_declined|your_turn
  actor_id     uuid references public.profiles(id) on delete set null,
  match_id     uuid references public.matches(id) on delete cascade,
  challenge_id uuid references public.challenges(id) on delete cascade,
  game_type    public.game_type,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications (user_id) where read_at is null;

-- =====================================================================
-- RPCs — the only way challenges/notifications ever get written
-- =====================================================================

-- Send a directed challenge + drop a notification in the target's inbox.
create or replace function public.create_challenge(p_to uuid, p_game_type public.game_type)
returns public.challenges
language plpgsql security definer set search_path = public as $$
declare c public.challenges; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if p_to is null or p_to = uid then raise exception 'invalid_target'; end if;
  if not exists (select 1 from public.profiles where id = p_to) then
    raise exception 'invalid_target';
  end if;

  insert into public.challenges (from_id, to_id, game_type, status)
  values (uid, p_to, p_game_type, 'pending')
  returning * into c;

  insert into public.notifications (user_id, type, actor_id, challenge_id, game_type)
  values (p_to, 'challenge', uid, c.id, p_game_type);

  return c;
exception when unique_violation then
  raise exception 'challenge_exists';
end $$;

-- Accept (creates the match) or decline a challenge. Only the target may call.
create or replace function public.respond_challenge(p_challenge_id uuid, p_accept boolean)
returns public.challenges
language plpgsql security definer set search_path = public as $$
declare c public.challenges; uid uuid := auth.uid(); m public.matches; ct uuid;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if c.to_id <> uid then raise exception 'Not your challenge'; end if;
  if c.status <> 'pending' then raise exception 'challenge_closed'; end if;
  if now() > c.expires_at then
    update public.challenges set status='expired', responded_at=now()
     where id=c.id returning * into c;
    raise exception 'challenge_expired';
  end if;

  if p_accept then
    -- Trivia answers simultaneously (current_turn null); everything else has the
    -- challenger move first, mirroring join_open_room/join_by_id.
    ct := case when c.game_type = 'trivia' then null else c.from_id end;
    insert into public.matches
      (game_type, status, is_private, player1, player2, current_turn, board_state, last_move_at)
    values
      (c.game_type, 'active', true, c.from_id, c.to_id, ct,
       public.initial_board(c.game_type), now())
    returning * into m;

    update public.challenges
       set status='accepted', responded_at=now(), match_id=m.id
     where id=c.id returning * into c;

    insert into public.notifications (user_id, type, actor_id, challenge_id, match_id, game_type)
    values (c.from_id, 'challenge_accepted', uid, c.id, m.id, c.game_type);
  else
    update public.challenges set status='declined', responded_at=now()
     where id=c.id returning * into c;

    insert into public.notifications (user_id, type, actor_id, challenge_id, game_type)
    values (c.from_id, 'challenge_declined', uid, c.id, c.game_type);
  end if;

  return c;
end $$;

-- Challenger rescinds a still-pending challenge.
create or replace function public.cancel_challenge(p_challenge_id uuid)
returns public.challenges
language plpgsql security definer set search_path = public as $$
declare c public.challenges; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select * into c from public.challenges where id = p_challenge_id for update;
  if not found then raise exception 'Challenge not found'; end if;
  if c.from_id <> uid then raise exception 'Not your challenge'; end if;
  if c.status <> 'pending' then return c; end if;

  update public.challenges set status='cancelled', responded_at=now()
   where id=c.id returning * into c;
  return c;
end $$;

-- Mark some (or all, when p_ids is null) of the caller's unread notifications read.
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n int; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  update public.notifications set read_at = now()
   where user_id = uid and read_at is null
     and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- =====================================================================
-- "YOUR TURN" TRIGGER — nudge the player a long async game is waiting on
-- =====================================================================
-- Only chess + checkers (the slow strategy games people step away from). Skips
-- the opening move (move_count > 0 → challenge_accepted already covered it) and
-- de-dupes: at most one *unread* "your turn" ping per match, so a back-and-forth
-- never floods the bell. Fires no matter who wrote the row (RPC or Edge Function).
create or replace function public.notify_turn()
returns trigger language plpgsql security definer set search_path = public as $$
declare opponent uuid;
begin
  if new.status = 'active'
     and new.game_type in ('chess','checkers')
     and new.move_count > 0
     and new.current_turn is not null
     and new.current_turn is distinct from old.current_turn then

    opponent := case when new.current_turn = new.player1 then new.player2 else new.player1 end;

    if not exists (
      select 1 from public.notifications
       where user_id = new.current_turn and match_id = new.id
         and type = 'your_turn' and read_at is null
    ) then
      insert into public.notifications (user_id, type, actor_id, match_id, game_type)
      values (new.current_turn, 'your_turn', opponent, new.id, new.game_type);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_turn on public.matches;
create trigger trg_notify_turn
  after update on public.matches
  for each row execute function public.notify_turn();

-- =====================================================================
-- ROW LEVEL SECURITY — read your own; never client-writable
-- =====================================================================
alter table public.challenges    enable row level security;
alter table public.notifications enable row level security;

drop policy if exists challenges_read on public.challenges;
create policy challenges_read on public.challenges for select to authenticated
  using (from_id = auth.uid() or to_id = auth.uid());

drop policy if exists notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated
  using (user_id = auth.uid());

-- =====================================================================
-- GRANTS
-- =====================================================================
grant select on public.challenges    to authenticated;
grant select on public.notifications to authenticated;

grant execute on function public.create_challenge(uuid, public.game_type) to authenticated;
grant execute on function public.respond_challenge(uuid, boolean)         to authenticated;
grant execute on function public.cancel_challenge(uuid)                   to authenticated;
grant execute on function public.mark_notifications_read(uuid[])          to authenticated;

-- =====================================================================
-- REALTIME — the navbar bell subscribes to its own inbox
-- =====================================================================
alter table public.notifications replica identity full;
alter table public.challenges    replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.challenges;
exception when duplicate_object then null; end $$;
