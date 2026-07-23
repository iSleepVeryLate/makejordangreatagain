# المندس — Al-Mundass ("The Infiltrator")

Jordanian social deduction — Among Us reimagined in an old Amman neighborhood (الحارة).
8th game on the site; 2nd realtime N-player game (after Draw & Guess); 3rd server-authoritative
game (after Chess/Checkers/Monopoly).

## Fantasy

Night in the حارة. أهل الحارة (the neighbors) are doing their chores — making tea, hanging
laundry, fixing the satellite dish. But someone in the alley is not who they say they are:
**المندس**. The crew wins by finishing the chores or voting the mundass out of the
neighborhood; the mundass wins by picking the neighbors off one by one.

The emergency meeting is called the Jordanian way: **دقّ المهباش** — banging the brass coffee
grinder in the courtyard, the traditional call that gathers the whole neighborhood.

## Vocabulary (EN / AR)

| Concept        | English            | Arabic          |
|----------------|--------------------|-----------------|
| Game           | Al-Mundass         | المندس          |
| Crew           | The Neighbors      | أهل الحارة      |
| Impostor       | The Mundass        | المندس          |
| Emergency call | Bang the mihbash   | دقّ المهباش     |
| Report body    | Report!            | بلّغ!           |
| Meeting        | Neighborhood meeting | اجتماع الحارة |
| Eject          | Kicked out of the hara | انطرد من الحارة |
| Ghost          | Spirit             | روح             |
| Sabotage       | Cut the power      | قطع الكهرباء    |

## Players & roles

- 4–16 players (community nights run ~15). 1 mundass at 4–7 players, 2 at 8–12, 3 at 13–16.
- Roles are **server-secret**: assigned by the Edge Function into a table only the owner can
  read (RLS `user_id = auth.uid()`). Nothing role-shaped ever appears in public room state.
- Host settings: discussion 45s, voting 30s, kill cooldown 25s, tasks per player 4.

## Map — الحارة (single-screen world ~ 2000×1300)

Rooms connected by alleys; simple rect-wall collision. Camera follows the player;
soft vision radius (radial light mask) — shrinks hard during a power cut.

1. **ساحة الحارة** (Courtyard) — center, spawn point, the **مهباش** (emergency button)
2. **الديوان** (Guest hall) — coffee grinding task
3. **المطبخ** (Kitchen) — tea task
4. **السطح** (Rooftop) — satellite + laundry tasks
5. **الحاكورة** (Garden) — watering + olive-picking tasks
6. **الدكانة** (Corner shop) — shelf-stocking task
7. **الكراج** (Garage) — gas-cylinder task
8. **غرفة الكهرباء** (Electrical room) — wires task + power-cut fix point
9. **حنفية الحارة** (Water tap) — jerrycan task

**Manholes (بالوعات)**: 3 covers (courtyard / garage / garden) — mundass-only fast travel,
the vent equivalent.

## Tasks (pointer minigames, 5–15s each)

1. وصّل الأسلاك — drag 4 colored wires to matching terminals (electrical room)
2. اعمل شاي — tap the steps in order: بابور → براد → شاي → نعنع → سكر (kitchen)
3. ظبّط الستلايت — rotate the dish until the signal meter locks (rooftop)
4. انشر الغسيل — drag 4 clothes onto the line (rooftop)
5. اطحن القهوة — mash the مهباش to fill the meter (diwan)
6. اسقِ الزرع — tap the 5 dry pots, they bloom (garden)
7. اقطف الزيتون — tap 8 olives off the tree (garden)
8. رتّب الدكانة — drag goods into silhouette slots (shop)
9. بدّل جرة الغاز — hold to unscrew, drag the new jarrah in (garage)
10. عبّي المي — hold the tap, release inside the fill band (water tap)

Each player gets N tasks server-assigned across rooms. Task bar = global completion across
all crew (ghosts keep doing tasks). The mundass sees a fake task list (can pretend).

## Loop & phases

`lobby → playing ⇄ meeting → ended`

- **Kill**: mundass near a living neighbor → kill (cooldown). Body drops at the spot.
- **Report / مهباش**: living player near a body → report; or bang the mihbash in the
  courtyard (1 emergency per player per game) → meeting.
- **Meeting**: discussion (chat, living players talk; ghosts watch) → voting (vote or skip;
  plurality ejected, tie = no one) → reveal ("كان المندس!" / "ما كان المندس…") → bodies
  cleared, everyone respawns at the courtyard.
- **Sabotage**: قطع الكهرباء — crew vision shrinks until anyone holds the breaker 3s.
- **Ghosts**: pass through walls, invisible to the living, still do tasks, see all chat.

**Win conditions** (checked server-side after every action):
- Crew: all mundasseen ejected, or tasks 100%.
- Mundass: living mundasseen ≥ living crew.

## Architecture (house patterns)

- **Migration `0022_mundass.sql`** — `mundass_rooms` (code, host, status, seq, settings,
  public `state` jsonb, lifecycle columns), `mundass_players` (public: name/color/alive),
  `mundass_secrets` (role + task list; RLS = own row only; written by service role only).
  Lobby RPCs (`mundass_create_room`, `mundass_join_room`, `mundass_leave_room`) with the
  unified room-lifecycle registration (sweep/TTL/heartbeat/creation caps).
- **Edge Function `mundass-action`** — server-authoritative engine, seq-gated atomic
  commits (Monopoly pattern): `start, kill, report, emergency, vote, task_done, sabotage,
  fix_sabotage`. Deno tests for role assignment, vote tally, win checks.
- **Realtime**: `postgres_changes` on room row (seq-gated, poll fallback) + a broadcast
  channel for 10 Hz positions and meeting chat. Positions are client-authoritative
  (casual integrity: server validates roles, cooldowns, aliveness — not pixel positions).
- **Client**: `/mundass` home + `/mundass/:roomId` room. Canvas 2D renderer outside React
  (refs + rAF; React only for HUD/overlays — the Monopoly perf lesson). WASD/arrows +
  touch joystick. Players drawn as beans wearing the **شماغ** (red-checked hatta + black
  عقال) — procedural canvas, no image assets. Full EN/AR + RTL.
