# Jordan Monopoly — "Enterprise / Official-Site" Interactivity Upgrade

> **Hand-off brief for a fresh agent.** Read this top to bottom before touching code.
> Goal: make the existing Monopoly module feel like it's played on the official
> Monopoly site — **everyone sees the dice roll in real time, dice are animated
> 3D and make sound, pieces physically walk tile-by-tile around the board, money
> moves, cards flip, jail clangs.** This is a **client-side presentation upgrade**.
> The rules engine, database, and Edge Function are FROZEN (see "Do not touch").

---

## 0. TL;DR — what you are building

Five hero features, layered on top of a game that already works end-to-end:

1. **3D animated dice, synchronized for every player.** Real CSS-3D cubes that
   tumble and land on the rolled face. All clients show the *same* result at the
   *same* time, driven by the server's committed snapshot.
2. **Live "is rolling…" presence.** The instant a player clicks Roll, every other
   player sees their dice start tumbling and a "Layla is rolling…" indicator —
   before the result is even computed — via an ephemeral realtime broadcast.
3. **Step-by-step token walk.** Tokens hop one tile at a time around the
   perimeter (not a diagonal teleport), bounce on landing, with a per-step tick
   and a GO chime when they pass GO.
4. **Sound design (net-new — the app has zero audio today).** Dice, hops, cash
   register, rent coins, card flip, jail clang, build thock, bankruptcy stinger,
   win fanfare, "your turn" chime. Global mute toggle, persisted, autoplay-safe.
5. **Premium board polish.** Classic-feeling tiles (color bands, owner stripes,
   houses/hotels, mortgage hatch), real corner tiles, tap-a-tile **deed cards**,
   floating +/− money numbers, a spotlight on the active tile.

**No server, DB, or rules changes are required for any of this.** If you think you
need one, STOP and flag it — you almost certainly don't.

---

## 1. The mockup (what it should look like)

A high-fidelity HTML mockup is saved as
**[`monopoly-pro-mockup.html`](monopoly-pro-mockup.html)** — open it in any browser
(no build needed) to see the exact target, including the pieces moving around the
board. **This is the bar.** It must NOT read like a small "flash game": it is a
large, premium, gallery-quality board. Rough textual layout (the saved HTML is
authoritative):

```
┌─ Jordan Monopoly · ABCDE ─────────────────────── ● live  🔊 ─┐
│                                                               │
│  [🏎 Layla ●rolling…] [🐕 Sami 1,240] [🚢 Noor 980] [🎩 Omar 1,510]   ← player rail
│                                                               │
│  ┌───────────── B O A R D (11×11) ───────────┐  ┌─ Game log ─┐│
│  │ GO  Salt  ▢  Irbid Tax  ✈  Zarqa ?  ...   │  │ 🎲 Layla   ││
│  │ ┌───────────────────────────────────────┐ │  │   4 + 3    ││
│  │ │   Layla's turn                         │ │  │ 🏠 Mafraq  ││
│  │ │        ⚄  ⚂   ← 3D dice (synced)       │ │  │ 💸 Sami→.. ││
│  │ │   [Roll dice] [Trade] [Manage]         │ │  │ 🏗 Omar    ││
│  │ └───────────────────────────────────────┘ │  └────────────┘│
│  │  ...tokens hop tile-to-tile, trail dots... │                │
│  └────────────────────────────────────────────┘                │
│   (tap any tile → deed card popover: rent table, owner, houses) │
│                                                               │
│  🎲 3D dice synced · 🔊 Sound · 🚶 Step walk · 📡 Live rolling · 🪪 Deed cards │
└───────────────────────────────────────────────────────────────┘
```

Key visual deltas from today's UI:
- **Big, board-fills-the-screen.** The board is `width:100%; aspect-ratio:1` with
  `fr` grid tracks, so it scales fluidly — large on desktop, fits a phone. Tile
  text scales with it and **fits inside the card** (no clipped 6px labels). See
  §7.1 for the sizing rule.
- **Premium dark-felt + gold trim** (see §7.0): radial green-charcoal felt,
  hairline gold border, gilded crest + wordmark, gold `ROLL DICE`, subtle depth
  (soft shadows / inner glow). Refined — not garish, not bright-Hasbro.
- Dice today are emoji `⚀⚁`. Target: two **large 3D cubes** that tumble while
  rolling and settle onto the result.
- Tokens today **slide diagonally**. Target: chunky chip pieces that **walk the
  perimeter** tile-by-tile with a hop; the active piece carries a gold glow.
- Player **cards** (not cramped chips): avatar, cash in gold, a **rolling…** pulse,
  and **+/− money floats**.
- Tiles get **owner outline + houses/hotels** and are **clickable** for a deed card
  (today `onTile={null}`).
- Title bar gets a **sound toggle** + a **fullscreen** affordance.

Elevate the app's dark family to this **premium felt-and-gold** treatment. Do
**not** ship a bright Hasbro-cream board, and do **not** ship the flat, tiny first
draft — match `monopoly-pro-mockup.html`.

---

## 2. Source-of-truth facts (the architecture you must not break)

### 2.1 Server-authoritative, deterministic engine
- All gameplay (dice, rent, cards, trades, auctions, jail, bankruptcy) runs in
  the **`monopoly-action` Edge Function** → pure engine `reduce(state, action, ctx)`
  in `supabase/functions/_shared/monopolyEngine.ts`.
- **Dice RNG (`Math.random`) happens ONLY on the server.** The client must never
  generate a dice value. You animate the result the server returns. This is
  load-bearing for fairness — do not "predict" or roll locally.
- Each committed action bumps `monopoly_rooms.seq` (optimistic lock). The commit
  (`monopoly_commit`) applies the whole next state atomically under a row lock +
  seq check. A racing/stale submit returns `{conflict:true}` and the client
  silently refetches.

### 2.2 Realtime sync (client) — `src/hooks/useMonopolyRoom.js`
- One channel `monopoly-room:${roomId}` with **presence** + three
  `postgres_changes` subscriptions: `monopoly_rooms` (the state machine),
  `monopoly_players`, `monopoly_properties`. Player/property bursts are debounced
  250ms.
- **Monotonic seq reconcile**: `applyRoom` drops any incoming room row whose
  `seq` is *older* than current — never roll back. **Your animation layer must
  respect this**: animate only when `seq` *increases*, and treat the committed
  snapshot as the single source of truth.
- A 4s **safety-net poll** + a **single-pumper 1s timer** that fires the deadline
  `tick` action from exactly one client. Don't add competing timers.
- `sendAction(action, args)` invokes the Edge Function and applies the returned
  snapshot instantly (optimistic). `{conflict}` and `{rejected}` are handled and
  must remain non-fatal.

### 2.3 State shapes (what you read to drive animation)
`room` (subset): `{ id, status, phase, current_seat, turn_order[], dice:[d1,d2]|null,
doubles_count, last_card:{deck,id,text,by}|null, phase_ends_at, turn_seconds,
bank_houses, bank_hotels, seq, pending_purchase, pending_auction, pending_trade,
pending_debt, winner, log:[] }`

`players[]`: `{ profile_id, seat, token, position(0..39), cash, in_jail, jail_turns,
goojf_cards, bankrupt, is_present, profile:{...} }`

`properties[]`: `{ tile_index, owner|null, houses(0..4=houses,5=hotel), mortgaged }`

**`room.log`** is a capped (40) ring buffer and is your **event stream**. Diff its
tail on each seq bump to know what just happened. Entry kinds (from the engine /
`formatLog`):
```
start · roll{d:[d1,d2]} · buy{tile,price} · rent{to,amount,tile} · tax{amount}
pass_go · card{deck,text} · jail · jail_out{how} · build{tile,houses}
sell{tile,houses} · mortgage{tile} · unmortgage{tile} · trade{from,to}
auction_win{tile,price} · auction_none{tile} · bankrupt{by,to} · win{by}
```
Every entry carries `by` (actor id) where relevant and a `ts` (server ms).

### 2.4 Board data — DUAL MIRROR, keep byte-identical
- `src/games/monopolyBoard.js` (client) and
  `supabase/functions/_shared/monopolyBoard.ts` (server) are byte-identical and
  guarded by a Deno parity test (`monopolyBoard.test.ts`). **Do not add
  display-only fields to these.** Client-only visuals (emoji, color) live in
  `src/games/monopolyTokens.js`. Add new display metadata there.
- 40 tiles, 28 ownable. Token keys: `car ship thimble dog hat boot iron
  wheelbarrow`. `COLOR_GROUPS` has the hex per color set. `JAIL_FINE=50`,
  `GO_SALARY=200`, `START_CASH=1500`.

### 2.5 Tile → grid geometry (already established, reuse exactly)
11×11 CSS grid, tracks `1.5fr repeat(9,1fr) 1.5fr`. Perimeter mapping (duplicated
in `MonopolyBoard.jsx` and `TokenLayer.jsx`):
```js
function gridPos(i){
  if (i <= 10) return { row: 11, col: 11 - i }   // bottom, right→left
  if (i <= 20) return { row: 21 - i, col: 1 }    // left,  bottom→top
  if (i <= 30) return { row: 1,  col: i - 19 }   // top,   left→right
  return            { row: i-29, col: 11 }        // right, top→bottom
}
```
`TokenLayer.jsx` already converts this to **percentage centers** accounting for
the 1.5fr corner tracks (`EDGES`/`centerPct`/`CENTERS`). Reuse `CENTERS[i]` for
token positions — do not recompute naïvely or tokens will drift on corners.

### 2.6 No audio exists yet
Grep confirms **zero** `Audio`/`AudioContext`/`.mp3` usage in the repo. Sound is
entirely net-new. There is no asset/sound directory; `public/` holds only icons +
`sw.js`.

### 2.7 Service worker — `public/sw.js`
Runtime caching, **cache-first for same-origin static assets**. Any file you drop
in `public/sounds/` is served same-origin and will be cached automatically after
first play. Optionally add a couple of the most-used clips to the `PRECACHE` array
so they're ready offline; not required.

### 2.8 i18n + RTL — bilingual EN/AR
- The whole signed-in app is bilingual via `useLang()` → `{ t, dir }`, strings in
  `src/i18n/strings.js` (`mono.*` keys, EN+AR). **Every new user-facing string
  must be added in both languages.**
- `MonopolyGame` root is `<div className="mono-game" dir={dir}>`. **GOTCHA:** the
  board uses explicit `gridColumn` numbers; under `dir="rtl"` CSS grid counts
  columns from the right, which **mirrors the board**. Monopoly geometry must NOT
  mirror (GO stays bottom-right). **Fix: force `dir="ltr"` on the `.mono-board`
  container** (and the token layer) while the surrounding chrome (rail, log,
  banner, dock) stays RTL/translated. Verify in Arabic.

### 2.9 Repo / branch / run facts
- Monopoly is already merged on `main` (commits `efd7c0d`, `e5245b3`, `f4d6cae`).
- The working tree has **unrelated** uncommitted changes (challenges/notifications:
  `AppNav.jsx`, `NotificationBell.jsx`, `0011_*.sql`, etc.). **Do not commit those.**
  Branch off `main` as `feat/monopoly-pro` and keep your diff scoped to Monopoly.
- Build/dev: `npm run dev`, `npm run build` (Vite). No test runner is wired into
  npm scripts; the Deno parity test is for the board mirror only.
- **Playtesting multiplayer needs two REAL logged-in users** (two browsers /
  accounts). Per project memory, `VITE_MOCK_AUTH=1` only reaches authed pages for
  UI/anon-read — it does **not** drive real gameplay actions.

---

## 3. The core idea: a delta-driven animation orchestrator

Everything hinges on one new client module. Build it first; the rest hangs off it.

**Principle:** the committed snapshot is truth. Animations are a *cosmetic replay*
of the transition between the last snapshot you displayed and the new one. They
must always converge to the snapshot, and they must never block, gate, or alter
gameplay.

### 3.1 `useBoardAnimator(room, players, properties)` (new hook)
Tracks, in refs (not state, to avoid re-renders):
- `lastSeq` — the seq we've fully animated.
- `displayPos: Map<profileId, tileIndex>` — where each token is *rendered* right
  now (may lag behind authoritative `position` mid-walk).
- `lastLogLen` — to diff `room.log`.

On every `room` change:
```
if (room.seq === lastSeq) return            // nothing new
if (lastSeq === null || room.seq - lastSeq is "large"/unknown
    || we have no prior displayPos for movers) {
    snapAll(); lastSeq = room.seq; return    // first paint / refetch / gap → SNAP, no replay, no sound
}
const newEvents = room.log.slice(lastLogLen) // what happened since
enqueue(buildTimeline(prevSnapshot, room, players, newEvents))
lastSeq = room.seq; lastLogLen = room.log.length
```

`snapAll()` sets every `displayPos` to the authoritative `position` instantly and
plays **no** sound. Used on mount, reconnect, `{conflict}`, tab-revisit, and any
time you can't trust the delta. This is what makes refresh/late-join correct.

### 3.2 Building the timeline for one seq step
Inputs you have: each player's `from = displayPos`, `to = authoritative position`,
the roll `room.dice = [d1,d2]`, and `newEvents` (the log tail).

**The mover** is the current-turn player whose `position` changed. Animate only
them; `snap` everyone else (other players don't move on a normal turn).

Two-leg walk, derived purely from `(from, dice, to)`:
```
total   = d1 + d2
viaDice = (from + total) % 40
LEG 1 (dice walk): step from → from+1 → … → viaDice, one tile per ~160ms,
        hop each step, tick sound; if a step index wraps past 0 → GO chime + +200 float.
LEG 2 (only if to !== viaDice): a card/jail relocation happened. Glide viaDice → to
        in one smooth move (~450ms) with a "whoosh"/card sound. (Going back 3,
        go-to-jail, advance-to-Petra all read fine as a single glide.)
```
Jail-fail rolls (`roll_for_jail` that don't escape): `position` is unchanged →
no walk, just settle the dice + a small "still stuck" shake + jail tone.

After the walk, fire the **landing event sounds/visuals** from `newEvents`
(buy/rent/tax/build/card/jail/bankrupt/win — see the sound map in §5.3) and the
**money floats** (diff each player's `cash` vs the prior snapshot; float the delta
up from their chip).

### 3.3 Don't fall behind
If new seqs arrive while a timeline is still playing (e.g. an away player is being
auto-played fast by the timer pump), **do not queue indefinitely**. Cap the queue
at ~1 in-flight timeline; if you're behind, **snap to the latest** and only animate
the most recent transition. Gameplay correctness > animation completeness.

### 3.4 Wiring
- `MonopolyGame.jsx` calls the animator and passes `displayPos` to `TokenLayer`
  and the current dice-anim state to the dice component.
- Keep the existing memoization: the animator updates token positions via its own
  lightweight state/subscription so the 40 `Tile`s and the log **do not** re-render
  on each hop. `TokenLayer` already re-renders independently — keep it that way.

---

## 4. Live "is rolling…" presence (ephemeral broadcast)

The committed snapshot already reaches all clients — but only *after* the Edge
round-trip (~200–600ms). To make remote players see the roll *start* immediately:

1. Extend `useMonopolyRoom.js` to expose a `broadcast(event, payload)` helper and
   subscribe to `broadcast` events on the **same** `monopoly-room:${roomId}`
   channel (add `ch.on('broadcast', { event: 'roll' }, …)`). Surface incoming
   roll-start events to the UI (e.g. a `rollingBy` state or a callback).
2. In `MonopolyGame.rollDice`, the instant the user clicks Roll, call
   `broadcast('roll', { by: myId })` **in parallel** with `sendAction('roll')`.
3. On any client receiving a roll-start: show that player's dice **tumbling** and a
   "`{name}` is rolling…" tag on their chip + the turn banner. Start the dice-roll
   sound loop.
4. When the next snapshot with a **new `dice`** (higher seq) arrives, the dice
   **settle** to the real faces simultaneously on every client, the loop stops, a
   "dice land" clack plays, and the token walk begins.

This is **purely cosmetic and best-effort**. If the broadcast is missed, the
snapshot still drives the full animation — graceful degradation. Never let the
broadcast mutate game state.

Add a ~2.5s safety timeout so a "rolling…" indicator can't get stuck if a snapshot
never arrives.

---

## 5. Sound system (net-new)

### 5.1 `src/lib/sound.js` (singleton) + `src/hooks/useSound.js`
Requirements:
- Preload a manifest of short clips into `HTMLAudioElement`s (or a tiny WebAudio
  buffer pool for low latency on rapid hops). Provide `play(name, {volume})`.
- **Mute toggle** persisted to `localStorage` key `jst_mono_muted` (default
  unmuted). Expose `muted` + `toggleMute()`.
- **Autoplay unlock**: browsers block audio until a user gesture. On the first
  `pointerdown`/`keydown` anywhere in the room, resume/unlock the audio context
  (play a 0-volume blip). Until then, queue nothing — just no-op.
- **Never play on the initial snapshot or a silent reconcile** — only on live
  deltas routed through the animator. (Otherwise a refresh blasts a backlog.)
- Respect rapid repeats: clone/reset the node so overlapping hops don't cut each
  other off; throttle the hop tick if steps are very fast.

### 5.2 Assets — `public/sounds/` (you must source/produce these)
Use short, royalty-free / CC0 SFX (e.g. a CC0 game-SFX pack). Keep each clip small
(mono MP3, ~64–96 kbps, < ~30 KB; most are < 1s). Suggested manifest:
```
dice-roll.mp3    (shake/tumble, ~0.8s, can loop while "rolling")
dice-land.mp3    (two clacks)
hop.mp3          (soft tick — per tile step)
go.mp3           (bright chime — passing GO)
buy.mp3          (cash register / ka-ching)
rent.mp3         (coins drop)
build.mp3        (hammer thock)
card.mp3         (paper flip)
jail.mp3         (cell-door clang)
bankrupt.mp3     (descending stinger)
win.mp3          (short fanfare)
turn.mp3         (gentle chime — it just became YOUR turn)
ui.mp3           (subtle click — optional, for buttons)
```
If you cannot source audio, synthesize simple tones with WebAudio as a fallback so
the feature ships, and leave a TODO to replace with real SFX. Do not ship silence
pretending to be sound.

### 5.3 Event → sound/visual map (driven by the log delta)
| log kind | sound | extra visual |
|---|---|---|
| `roll` | dice-roll → dice-land | 3D dice settle |
| (step during walk) | hop | token bounce |
| `pass_go` | go | +200 float on chip |
| `buy` / `auction_win` | buy | deed flips onto owner; owner stripe appears |
| `rent` | rent | −amount float (payer), +amount float (owner) |
| `tax` | rent | −amount float |
| `card` | card | the existing `last_card` pop, enlarged/animated |
| `jail` | jail | token slides to jail, bars flash |
| `jail_out` | (light chime) | — |
| `build` | build | house pip pops in |
| `sell` | build (softer) | house pip removed |
| `mortgage`/`unmortgage` | ui | mortgage hatch toggles |
| `bankrupt` | bankrupt | chip greys out (already styled) |
| `win` | win | existing `<Confetti/>` |
| becomes your turn | turn | turn banner pulse |

### 5.4 Toggle UI
Add a speaker icon button in the room title bar / players strip (lucide
`Volume2`/`VolumeX`). Add `mono.soundOn` / `mono.soundOff` strings (EN+AR).

---

## 6. 3D dice component — `src/games/Dice3D.jsx`

- A CSS-3D cube: a `.cube` with 6 `.face` children (pip layouts for 1–6),
  `transform-style: preserve-3d`, parent has `perspective`.
- Props: `value (1..6|null)`, `rolling (bool)`.
- **Rolling**: spin continuously (`@keyframes` rotateX/rotateY) while `rolling`.
- **Settle**: when `value` arrives, transition to the fixed rotation that brings
  that face forward. Provide a `FACE_ROTATION = {1:'rotateX(0) rotateY(0)', 2:…, …}`
  map. Add a small overshoot/bounce on settle (cubic-bezier).
- Render **two** of them in the center slot, fed by the animator's dice state
  (which reflects broadcast "rolling" then snapshot "settled").
- Honor `prefers-reduced-motion`: skip the tumble, just show the final face.
- Keep the existing emoji-die path as a graceful fallback if you must, but the
  target is the 3D cube.

Replace the current `.mono-dice` emoji block in `MonopolyGame.renderCenter()`.

---

## 7. Premium board polish — `MonopolyBoard.jsx` / `TokenLayer.jsx` / CSS

> **Reference:** `monopoly-pro-mockup.html`. The goal is "official-app gorgeous,"
> not "functional dark grid." Match its aesthetic and scale.

### 7.0 Visual design language (the look) — APPROVED & LOCKED
> **Decision (locked by the product owner):** the **dark green-charcoal felt + gold
> trim** treatment in `monopoly-pro-mockup.html` is final. Do not propose a
> bright-Hasbro or glass/neon alternative — build this.

- **Felt:** deep green-charcoal radial — center `~#14201a` → edges `~#080b09`. The
  board sits on it with a **hairline gold border** (`rgba(212,175,55,.2)`) and an
  inner shadow so it reads as a real table.
- **Gold as the premium accent** (`#d4af37` / `#c9a24b` / `#e8c45a`): the crest, the
  `JORDAN` overline + `MONOPOLY` wordmark, cash figures, the `ROLL DICE` button,
  the active-player ring, and tile prices. Use it sparingly and richly.
- **Tiles:** subtle vertical sheen (`#1d231f`→`#161b18`), 1px `#2b322c` border, 6px
  radius, a **saturated color band on the inward edge** (~21% of the tile). Name in
  near-white `#dfe4df` (≈11px desktop), price in gold below. Corners are larger,
  with an icon + label + sublabel ("GO / collect 200", "Jail / just visiting").
- **Depth is allowed here** (unlike the chat-widget rules): tasteful shadows, an
  inner felt glow, a faint rotated "JO" watermark behind the center. Keep it
  classy — no neon, no rainbow, no clutter.
- **Pieces:** chunky 26–30px circular chips, token emoji on a dark fill ringed in
  the player color, drop shadow; the active piece adds a **gold glow + hop**.
- **Player cards** (top rail): avatar in the token color, name, **cash in gold**,
  gold left-edge + ring on the active player, a green `rolling…` pulse.
- Reuse the app's existing tokens/colors where possible, but this screen earns a
  richer treatment than the rest of the site — it's the showpiece.

### 7.1 Responsive sizing (must fix the "small / clipped text" problem)
- The board container is **`width:100%; max-width:~720px; aspect-ratio:1`** and uses
  **fractional grid tracks** (`grid-template-columns:1.42fr repeat(9,1fr) 1.42fr`,
  same rows). It therefore **scales to its column** — big on desktop, shrinks intact
  on mobile. Never hard-code the board to 760px again.
- **Tile text scales with the board** so it always fits the card. Use `clamp()` or
  container-query units, e.g. tile name `font-size: clamp(7px, 1.35vw, 12px)` (or
  `cqw` units with `container-type: inline-size` on the board). Cap lines to 2 with
  `-webkit-line-clamp`. Verify nothing clips at 320px, 768px, and ≥1100px.
- **Layout reflow:** desktop = board centered, player cards on top, log/side panel
  to the side or below; **mobile (≤640px)** = single column — rail wraps to 2×N,
  board full-width, the action dock + log stack beneath (the existing `mono` media
  query already starts this; extend it). The center action panel stays inside the
  board's middle slot at all sizes.
- Touch targets ≥40px on mobile; the `ROLL DICE` button is the primary, full-width
  on mobile.

- **Tiles**: keep the dark theme; add inward-facing color bands, an **owner
  stripe** in the owner's token color, **house pips** (1–4) / **hotel bar** (5) on
  the band, a **mortgage hatch** overlay + `⌧`. Most of this data is already on
  `properties[]`; today only a corner dot + tiny houses render — make it crisp.
- **Corner tiles**: give GO an arrow + "Collect 200", Jail a "Just visiting" lane +
  bars, Free Parking a car, Go-To-Jail cuffs. (Names already in board data.)
- **Active-tile spotlight**: the `active` ring exists; add a soft spotlight that
  follows the active token.
- **Deed cards (tap a tile)**: today `MonopolyBoard` is passed `onTile={null}`.
  Wire it: clicking a tile opens a read-only **deed popover** (reuse/extend the
  inline `Deed` component already in `MonopolyGame.jsx`) showing the rent table,
  price, owner, houses, mortgage status. Position it without `position:fixed`
  issues; close on outside-click/Esc. Add to both languages.
- **Tokens** (`TokenLayer.jsx`): render as a circular chip (token emoji + colored
  ring + shadow). Add a **hop** animation per step, an active-token pulse, and read
  position from the animator's `displayPos` (not raw `position`). Keep using
  `CENTERS[i]`. Keep the component independently memoized.
- **Money floats** (`src/games/MoneyFloat.jsx` or inline): a `+N`/`−N` that floats
  up and fades from a player chip when their cash changes. Optionally tween the
  cash number.

---

## 8. Files

**New**
- `src/games/useBoardAnimator.js` — the delta→timeline orchestrator (§3).
- `src/games/Dice3D.jsx` — 3D dice (§6).
- `src/lib/sound.js` + `src/hooks/useSound.js` — audio (§5).
- `src/games/MoneyFloat.jsx` — floating cash deltas (optional but recommended).
- `public/sounds/*.mp3` — SFX assets (§5.2).

**Modified**
- `src/hooks/useMonopolyRoom.js` — expose `broadcast()` + roll-start subscription
  on the existing channel (§4). Keep seq reconcile / poll / pumper intact.
- `src/games/MonopolyGame.jsx` — wire animator + dice + sounds + deed popover +
  money floats + sound toggle; replace emoji dice; route `rollDice` through the
  broadcast.
- `src/games/MonopolyBoard.jsx` — premium tiles, enable `onTile` deed cards,
  force `dir="ltr"` on the board, corner tiles (§2.8, §7).
- `src/games/TokenLayer.jsx` — consume `displayPos`, hop animation, active pulse.
- `src/games/TurnTimer.jsx` — optional: numeric seconds + low-time pulse.
- `src/styles/app.css` — all new CSS (3D dice, tokens/hops, money floats, deed
  card, board polish, sound button, responsive, `prefers-reduced-motion`).
- `src/i18n/strings.js` — new EN+AR strings (rolling…, sound on/off, deed labels,
  GO, Just visiting, etc.).
- `public/sw.js` — optional: add a few clips to `PRECACHE`.

---

## 9. Do NOT touch (frozen — rules are tested & deployed)

- `supabase/functions/_shared/monopolyEngine.ts` (and its test)
- `supabase/functions/_shared/monopolyBoard.ts` (+ parity test) and
  `src/games/monopolyBoard.js` — **must stay byte-identical**; no display fields.
- `supabase/functions/monopoly-action/index.ts`
- `supabase/migrations/0010_monopoly.sql` and the `monopoly_*` RPCs.
- The unrelated working-tree changes (challenges/notifications). Don't stage them.

If a genuinely-needed server change appears (it shouldn't), stop and flag it with
the reason before writing any SQL or Edge code.

---

## 10. Hard constraints / gotchas (read twice)

1. **Never roll dice on the client.** Animate the server's committed result only.
2. **Snapshot is truth; animations converge to it.** On mount, refetch, reconnect,
   `{conflict}`, tab-revisit, or any seq gap → **snap, no replay, no sound**.
3. **Animate only on increasing `seq`.** Respect the monotonic reconcile in
   `useMonopolyRoom` — don't reintroduce rollback/flicker.
4. **Never fall behind.** Cap the in-flight timeline; if behind, snap to latest.
5. **Sounds only on live deltas.** Never on initial load / silent resync. Unlock
   audio on first gesture. Mute persists in `localStorage`.
6. **Performance.** Hops and the per-second timer must not re-render the 40 tiles
   or the log. Keep `TokenLayer`/`TurnTimer` isolated; drive token motion through
   refs/local state. No new global re-render per frame.
7. **RTL.** Force the board geometry `dir="ltr"`; keep chrome RTL. Translate every
   new string. Verify in Arabic that the board is not mirrored.
8. **`prefers-reduced-motion`.** Skip hops/3D tumble; move instantly; everything
   still functions. Sound is independent of motion (its own mute).
9. **Mobile.** Board must stay legible and playable down to ~320px (the existing
   responsive breakpoint stacks the side panel — keep it working).
10. **Broadcast is best-effort cosmetic.** It must never affect state or block.

---

## 11. Acceptance criteria (QA — two real accounts, two browsers)

- [ ] Player A clicks Roll → within ~300ms Player B sees A's dice tumbling and an
      "A is rolling…" indicator; both clients settle to **identical** faces.
- [ ] A's token **walks tile-by-tile** around the perimeter to its destination and
      bounces on landing (both clients see it).
- [ ] Passing GO: GO chime + `+200` float; cash updates on both clients.
- [ ] Buy plays cash-register, deed flips to owner, owner stripe appears; decline →
      auction still works.
- [ ] Landing on owned property: rent coin sound, `−amount` (payer) / `+amount`
      (owner) floats, both balances tween.
- [ ] Chance/Chest: card flips with sound; any card-driven relocation glides with a
      whoosh and resolves (rent/buy/jail) correctly.
- [ ] Go-to-jail: token slides to Jail with a clang; "in jail" UI as today.
- [ ] Build: house pip pops with a thock; hotel at 5 houses.
- [ ] Bankruptcy: stinger + chip greys; Win: fanfare + existing confetti.
- [ ] Mute toggle silences everything and **persists across reload**.
- [ ] `prefers-reduced-motion`: no hops/tumble, instant moves, fully functional.
- [ ] **Refresh mid-game / late join**: board snaps to the exact current state with
      **no** spurious animation or sound; play continues normally.
- [ ] Arabic/RTL: chrome reads RTL, board is **not** mirrored, all new strings
      translated.
- [ ] No console errors; seq reconcile, poll, and timer pump still behave; no
      desync between the two clients after a full game.

---

## 12. Suggested build order

1. **Animator core** (§3) with snap-only behaviour + step-by-step walk wired to
   `TokenLayer` via `displayPos`. (Biggest win, unblocks everything.)
2. **Sound system** (§5) + the event→sound map, gated to live deltas.
3. **3D dice** (§6) fed by the animator.
4. **Live roll broadcast** (§4).
5. **Board polish + deed cards + money floats** (§7).
6. **RTL/reduced-motion/mobile passes + QA** (§10–11).

Ship behind the existing `/monopoly` route; no flag needed. Verify with
`npm run dev` and two logged-in accounts. No migration or Edge deploy required.

---

## Appendix A — mockup (standalone, browser-openable)

The mockup is saved next to this plan as **[`monopoly-pro-mockup.html`](monopoly-pro-mockup.html)**.
Open it directly in any browser (no build/server needed) to see the target.

It is a **static visual spec**, not shippable code. It builds the full-width
**dark-felt + gold** board (`aspect-ratio:1`, fractional grid tracks) via a JS loop
over the 40 Jordan tiles, then overlays:
- the **gilded header** (crest + `JORDAN MONOPOLY` wordmark, live pill, sound +
  fullscreen icons) and the **player cards** (active "rolling…" pulse + gold cash),
- **3 pieces actually moving** around the perimeter (the lead car glows + hops),
  animated via a JS-generated `@keyframes` walk over the real `CENTERS` geometry
  from §2.5,
- a **large 3D dice pair** + gold `ROLL DICE` / Trade / Manage dock in the center
  slot, with a faint "JO" watermark and gold radial glow,
- **owner outlines + houses/hotel** on owned tiles, a **+200 money float**,
- a **phone preview** (notch, stacked mini-rail, fit-to-width board with its own
  moving pieces, bottom action bar) proving the **responsive** layout, and the
  **feature chips** row.

Use it as the visual reference for §1 and §7. Reproduce the *feel* (dark, premium,
classic-Monopoly legibility) — the real implementation is React + the existing
`MonopolyBoard`/`TokenLayer`, not this static HTML.
</content>
</invoke>
