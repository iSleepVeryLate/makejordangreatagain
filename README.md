# Jordan Stand Tall 🇯🇴

The online home of the **Jordan Stand Tall** Discord community — a warm cultural
gathering place where Jordanians sign in with Discord, create a profile, and play
games together in real time: **Tic-Tac-Toe, Connect Four, Chess, and Jordan Trivia**,
with ratings and a leaderboard.

> Not a political party. An independent, non-political community space.

Built with **Vite + React**, **Supabase** (auth + Postgres + realtime), and deployed
free on **Vercel**.

---

## What you get

- A polished landing page (the original design, preserved).
- **Discord login** — one click, auto-pulls username + avatar.
- A **game hub / lobby** with quick-match and create-room (open or private invite link).
- Four real-time multiplayer games, server-refereed so games can't desync or be cheated by disconnecting.
- **Elo ratings**, a per-game **leaderboard**, and **player profiles**.

---

## 1. Prerequisites

- [Node.js](https://nodejs.org) 18+ and npm
- A free [Supabase](https://supabase.com) account
- A free [Discord](https://discord.com/developers/applications) developer account
- A free [Vercel](https://vercel.com) account (for deploying)

---

## 2. Set up Supabase (database + auth)

1. Go to <https://supabase.com> → **New project**. Pick a name and a database password
   (save it), choose a region near Jordan (e.g. Frankfurt), and create it.
2. When it's ready, open **Project Settings → API** and copy:
   - **Project URL** → this is your `VITE_SUPABASE_URL`
   - **anon public** key → this is your `VITE_SUPABASE_ANON_KEY`
3. Open the **SQL Editor** → **New query**, paste the entire contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), and click **Run**.
4. New query again, paste [`supabase/seed_trivia.sql`](supabase/seed_trivia.sql), and **Run**
   (this loads the Jordan trivia questions).

> Realtime is enabled automatically by the migration (it adds the `matches` table to
> the `supabase_realtime` publication). No extra clicks needed.

---

## 3. Set up Discord login

1. Go to <https://discord.com/developers/applications> → **New Application**, name it
   "Jordan Stand Tall".
2. In the left sidebar open **OAuth2**. Copy the **Client ID** and **Client Secret**
   (click *Reset Secret* if needed).
3. Still in **OAuth2 → Redirects**, add this exact URL (replace `<project-ref>` with your
   Supabase project ref, the part before `.supabase.co`):
   ```
   https://<project-ref>.supabase.co/auth/v1/callback
   ```
4. Back in **Supabase → Authentication → Providers → Discord**: toggle it **on**, paste the
   Discord **Client ID** and **Client Secret**, and save.
5. In **Supabase → Authentication → URL Configuration**:
   - Set **Site URL** to `http://localhost:5173` for now (change to your Vercel URL after deploy).
   - Under **Redirect URLs**, add both:
     ```
     http://localhost:5173/auth/callback
     https://YOUR-VERCEL-DOMAIN.vercel.app/auth/callback
     ```

---

## 4. Run it locally

```bash
npm install
cp .env.example .env.local      # then edit .env.local with your two Supabase values
npm run dev
```

Open <http://localhost:5173>. Click **Sign in**, log in with Discord, and you'll land in
the game hub. A profile row is created automatically on first login.

To test multiplayer, open the site in **two different browsers** (or one normal + one
incognito) and sign in with **two different Discord accounts**. In one, hit *Quick match*;
in the other, *Quick match* the same game (or *Join* the open room). Play away — moves sync
live, and only the player whose turn it is can move.

---

## 5. Deploy to Vercel (free)

1. Push this repo to GitHub.
2. Go to <https://vercel.com> → **Add New → Project** → import the repo.
3. Framework preset: **Vite** (auto-detected). Build command `npm run build`, output `dist`.
4. Add the two **Environment Variables** (same values as `.env.local`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Deploy. Then go back to **Supabase → Authentication → URL Configuration** and:
   - update **Site URL** to your `https://...vercel.app` domain,
   - make sure `https://YOUR-DOMAIN/auth/callback` is in the **Redirect URLs** list.

`vercel.json` already handles SPA routing so deep links like `/auth/callback` work on reload.

---

## How it works (for the curious)

- **One source of truth.** Every game lives as a row in the `matches` table with a
  `board_state` JSON. All moves go through `SECURITY DEFINER` Postgres functions
  (`make_move`, `trivia_answer`, `join_open_room`, …) — the database is the referee:
  it validates the move, flips the turn, detects wins, and records Elo + W/L/D atomically.
- **Real-time.** Clients subscribe to their match row via Supabase Realtime
  (`postgres_changes`). When the row changes, both players re-render from the authoritative
  state. The `useMatch` hook also reconciles on reconnect and tracks presence (online dots).
- **Security.** Row Level Security makes tables read-mostly; clients can never write game
  state directly. Trivia answers are never sent to the browser (served via the answer-free
  `trivia_public` view).

## Project structure

```
index.html                     Vite entry
src/
  main.jsx, App.jsx            app + router
  lib/supabaseClient.js        Supabase client (PKCE, realtime)
  context/AuthContext.jsx      session + Discord sign-in + route guard
  hooks/useMatch.js            realtime match sync (the core)
  pages/                       Landing, Login, AuthCallback, Lobby, Game, Leaderboard, Profile
  games/                       TicTacToe, ConnectFour, ChessGame, Trivia + config
  components/                  AppNav, Avatar, BrandMark
  styles/                      landing.css (original design), app.css
supabase/
  migrations/0001_init.sql     schema, RLS, triggers, all game RPCs
  seed_trivia.sql              Jordan trivia questions
```

## Troubleshooting

- **"Supabase isn't configured"** on the login page → your `.env.local` is missing or the
  dev server wasn't restarted after editing it.
- **Login redirects then bounces back to /login** → the redirect URL isn't in Supabase's
  allow-list (step 3.5), or the Discord callback URL is wrong (step 3.3).
- **Moves don't appear for the other player** → make sure you ran the full migration
  (it enables Realtime on `matches`).
- **Free Supabase projects pause after ~1 week idle** → the first load after a quiet
  spell may be slow while it wakes up. Normal on the free tier.
