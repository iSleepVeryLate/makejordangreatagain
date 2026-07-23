// المندس (Al-Mundass) — pure game engine.
// No I/O here: index.ts loads room + secrets, calls these, commits atomically.
// Everything role-shaped lives in `secrets` (per-player rows, own-row RLS);
// `state` is the public room snapshot every player can read.

export type Role = 'crew' | 'mundass'

export interface Settings {
  discussionSecs: number
  votingSecs: number
  killCooldownSecs: number
  tasksPerPlayer: number
}

export const DEFAULT_SETTINGS: Settings = {
  discussionSecs: 45,
  votingSecs: 30,
  killCooldownSecs: 25,
  tasksPerPlayer: 4,
}

export const MIN_PLAYERS = 4
export const MAX_PLAYERS = 16

// Task catalog — ids are shared with the client, which maps them to minigames
// and world coordinates. The engine only cares about ids and counts.
export const TASK_IDS = [
  'wires', // وصّل الأسلاك — electrical room
  'tea', // اعمل شاي — kitchen
  'satellite', // ظبّط الستلايت — rooftop
  'laundry', // انشر الغسيل — rooftop
  'coffee', // اطحن القهوة — diwan
  'plants', // اسقِ الزرع — garden
  'olives', // اقطف الزيتون — garden
  'shelf', // رتّب الدكانة — shop
  'gas', // بدّل جرة الغاز — garage
  'water', // عبّي المي — water tap
] as const

export interface TaskItem {
  id: string
  done: boolean
}

export interface Secret {
  role: Role
  tasks: TaskItem[]
  fake: boolean // mundass tasks are decoys — never counted
  mates: string[] // fellow mundasseen (empty for crew)
  killCooldownUntil: number // epoch ms
  emergencyUsed: boolean
  vote: string | null // uid | 'skip' | null (cleared each meeting)
}

export interface Body {
  victim: string
  x: number
  y: number
}

export interface MeetingResult {
  ejected: string | null
  wasMundass: boolean | null // null when nobody ejected
  tally: Record<string, number> // uid|'skip' -> votes (anonymous counts)
  abstained: number
}

export interface Meeting {
  kind: 'body' | 'emergency'
  caller: string
  victim: string | null
  stage: 'discussion' | 'voting' | 'reveal'
  endsAt: number // epoch ms deadline for the current stage
  voted: string[] // uids that have cast a vote (not who they voted for)
  result: MeetingResult | null
}

export interface PublicState {
  phase: 'lobby' | 'playing' | 'meeting' | 'ended'
  alive: Record<string, boolean> // physical truth — bodies render in-world anyway
  bodies: Body[]
  tasksDone: number
  tasksTotal: number
  sabotage: 'power' | null
  // Team sabotage cooldown (epoch ms): armed at start, after a fix, and after
  // every meeting, so the power can't be strobed. Public — reveals nothing
  // about WHO the mundass is, only when the next cut could come.
  sabotageCdUntil: number
  meeting: Meeting | null
  winner: 'crew' | 'mundass' | null
  // Filled only when phase === 'ended': the classic full-cast reveal.
  reveal: Record<string, Role> | null
  startedAt: number | null
}

export const SABOTAGE_COOLDOWN_MS = 45_000
export const SABOTAGE_START_GRACE_MS = 20_000

export interface Ctx {
  state: PublicState
  secrets: Record<string, Secret>
  settings: Settings
  now: number // epoch ms
  rand: () => number // injectable for tests
}

export type Action =
  | { type: 'start'; players: string[] }
  | { type: 'kill'; victim: string; x: number; y: number }
  | { type: 'report'; victim: string }
  | { type: 'emergency' }
  | { type: 'vote'; target: string } // uid or 'skip'
  | { type: 'task_done'; taskId: string }
  | { type: 'sabotage' }
  | { type: 'fix_sabotage' }
  | { type: 'leave' }
  | { type: 'tick' } // advances deadline-based stages; idempotent

export interface EngineResult {
  ok: boolean
  error?: string
  state: PublicState
  secrets: Record<string, Secret>
  changed: boolean
}

export function initialState(): PublicState {
  return {
    phase: 'lobby',
    alive: {},
    bodies: [],
    tasksDone: 0,
    tasksTotal: 0,
    sabotage: null,
    sabotageCdUntil: 0,
    meeting: null,
    winner: null,
    reveal: null,
    startedAt: null,
  }
}

export function mundassCount(playerCount: number): number {
  if (playerCount >= 13) return 3
  if (playerCount >= 8) return 2
  return 1
}

function shuffled<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pickTasks(settings: Settings, rand: () => number): TaskItem[] {
  const pool = shuffled(TASK_IDS.slice(), rand)
  return pool.slice(0, Math.min(settings.tasksPerPlayer, pool.length)).map((id) => ({ id, done: false }))
}

/** Deal roles + tasks at game start. Returns fresh state + secrets. */
export function startGame(
  players: string[],
  settings: Settings,
  now: number,
  rand: () => number,
): { state: PublicState; secrets: Record<string, Secret> } {
  const order = shuffled(players, rand)
  const nMundass = mundassCount(players.length)
  const mundasseen = order.slice(0, nMundass)
  const secrets: Record<string, Secret> = {}
  for (const uid of players) {
    const isMundass = mundasseen.includes(uid)
    secrets[uid] = {
      role: isMundass ? 'mundass' : 'crew',
      tasks: pickTasks(settings, rand),
      fake: isMundass,
      mates: isMundass ? mundasseen.filter((m) => m !== uid) : [],
      // First kill unlocks after one cooldown — classic pacing guard.
      killCooldownUntil: now + settings.killCooldownSecs * 1000,
      emergencyUsed: false,
      vote: null,
    }
  }
  const crewCount = players.length - nMundass
  const state: PublicState = {
    ...initialState(),
    phase: 'playing',
    alive: Object.fromEntries(players.map((p) => [p, true])),
    tasksTotal: crewCount * Math.min(settings.tasksPerPlayer, TASK_IDS.length),
    sabotageCdUntil: now + SABOTAGE_START_GRACE_MS,
    startedAt: now,
  }
  return { state, secrets }
}

function aliveOf(ctx: Ctx, role?: Role): string[] {
  return Object.keys(ctx.state.alive).filter(
    (uid) => ctx.state.alive[uid] && (!role || ctx.secrets[uid]?.role === role),
  )
}

/** Crew/mundass win check. Mutates state if the game ends. */
function checkWin(ctx: Ctx): void {
  const { state, secrets } = ctx
  if (state.phase === 'ended') return
  const aliveMundass = aliveOf(ctx, 'mundass').length
  const aliveCrew = aliveOf(ctx, 'crew').length
  let winner: 'crew' | 'mundass' | null = null
  if (aliveMundass === 0) winner = 'crew'
  else if (state.tasksTotal > 0 && state.tasksDone >= state.tasksTotal) winner = 'crew'
  else if (aliveMundass >= aliveCrew) winner = 'mundass'
  if (winner) {
    state.phase = 'ended'
    state.winner = winner
    state.meeting = null
    state.sabotage = null
    state.reveal = Object.fromEntries(Object.keys(secrets).map((uid) => [uid, secrets[uid].role]))
  }
}

function openMeeting(ctx: Ctx, kind: 'body' | 'emergency', caller: string, victim: string | null): void {
  const { state, settings, now } = ctx
  state.phase = 'meeting'
  state.bodies = [] // bodies are cleared the moment the hara gathers
  state.sabotage = null
  state.meeting = {
    kind,
    caller,
    victim,
    stage: 'discussion',
    endsAt: now + settings.discussionSecs * 1000,
    voted: [],
    result: null,
  }
  for (const uid of Object.keys(ctx.secrets)) ctx.secrets[uid].vote = null
}

function tallyVotes(ctx: Ctx): MeetingResult {
  const { secrets } = ctx
  const livingVoters = aliveOf(ctx)
  const tally: Record<string, number> = {}
  let cast = 0
  for (const uid of livingVoters) {
    const v = secrets[uid]?.vote
    if (!v) continue
    cast++
    tally[v] = (tally[v] || 0) + 1
  }
  const abstained = livingVoters.length - cast
  // Plurality among non-skip candidates; ties (including with skip) eject no one.
  let best: string | null = null
  let bestN = 0
  let tie = false
  for (const [target, n] of Object.entries(tally)) {
    if (target === 'skip') continue
    if (n > bestN) {
      best = target
      bestN = n
      tie = false
    } else if (n === bestN && n > 0) tie = true
  }
  const skipN = tally['skip'] || 0
  const ejected = !tie && best && bestN > skipN ? best : null
  return {
    ejected,
    wasMundass: ejected ? secrets[ejected]?.role === 'mundass' : null,
    tally,
    abstained,
  }
}

function closeVoting(ctx: Ctx): void {
  const { state, now } = ctx
  const m = state.meeting
  if (!m) return
  const result = tallyVotes(ctx)
  m.result = result
  m.stage = 'reveal'
  m.endsAt = now + 6000 // reveal card duration
  if (result.ejected) state.alive[result.ejected] = false
}

function endMeeting(ctx: Ctx): void {
  const { state, secrets, settings, now } = ctx
  state.meeting = null
  state.phase = 'playing'
  // Everyone respawns clustered at the mihbash — without a fresh cooldown the
  // mundass could knife someone the instant the meeting closed. Same for an
  // immediate blackout. Classic Among Us pacing: reset both at meeting end.
  for (const uid of Object.keys(secrets)) {
    if (secrets[uid].role === 'mundass') {
      secrets[uid].killCooldownUntil = now + settings.killCooldownSecs * 1000
    }
  }
  state.sabotageCdUntil = now + SABOTAGE_COOLDOWN_MS
  checkWin(ctx)
}

/** Deadline-driven stage advancement — safe to call any time (idempotent). */
function advanceClock(ctx: Ctx): boolean {
  const { state, settings, now } = ctx
  const m = state.meeting
  if (state.phase !== 'meeting' || !m) return false
  let changed = false
  // Loop: a long-stale room may need to cross several stages in one tick.
  for (let guard = 0; guard < 4; guard++) {
    const cur = state.meeting
    if (state.phase !== 'meeting' || !cur) break
    if (cur.stage === 'discussion' && now >= cur.endsAt) {
      cur.stage = 'voting'
      cur.endsAt = now + settings.votingSecs * 1000
      changed = true
      continue
    }
    const everyoneVoted = cur.stage === 'voting' && aliveOf(ctx).every((uid) => cur.voted.includes(uid))
    if (cur.stage === 'voting' && (now >= cur.endsAt || everyoneVoted)) {
      closeVoting(ctx)
      changed = true
      continue
    }
    if (cur.stage === 'reveal' && now >= cur.endsAt) {
      endMeeting(ctx)
      changed = true
      continue
    }
    break
  }
  // (cast: TS narrowed phase to 'meeting' above and can't see endMeeting's mutation)
  if ((state.phase as PublicState['phase']) === 'ended') changed = true
  return changed
}

export function applyAction(ctx: Ctx, caller: string, action: Action): EngineResult {
  const { state, secrets, settings, now } = ctx
  const fail = (error: string): EngineResult => ({ ok: false, error, state, secrets, changed: false })
  const okr = (changed = true): EngineResult => ({ ok: true, state, secrets, changed })

  // Every action first advances any expired meeting stage — keeps rooms
  // moving even if the dedicated tick was missed.
  const clockMoved = advanceClock(ctx)

  if (action.type === 'tick') {
    return okr(clockMoved)
  }

  if (state.phase === 'ended') return fail('game_over')

  const me = secrets[caller]

  switch (action.type) {
    case 'start':
      return fail('start_is_handled_by_index') // start uses startGame(), not applyAction

    case 'kill': {
      if (state.phase !== 'playing') return fail('not_playing')
      if (!me || me.role !== 'mundass') return fail('not_mundass')
      if (!state.alive[caller]) return fail('you_are_dead')
      if (!state.alive[action.victim]) return fail('victim_not_alive')
      if (secrets[action.victim]?.role === 'mundass') return fail('cannot_kill_mate')
      if (now < me.killCooldownUntil) return fail('kill_cooldown')
      state.alive[action.victim] = false
      state.bodies.push({ victim: action.victim, x: action.x, y: action.y })
      me.killCooldownUntil = now + settings.killCooldownSecs * 1000
      checkWin(ctx)
      return okr()
    }

    case 'report': {
      if (state.phase !== 'playing') return fail('not_playing')
      if (!me || !state.alive[caller]) return fail('you_are_dead')
      if (!state.bodies.some((b) => b.victim === action.victim)) return fail('no_such_body')
      openMeeting(ctx, 'body', caller, action.victim)
      return okr()
    }

    case 'emergency': {
      if (state.phase !== 'playing') return fail('not_playing')
      if (!me || !state.alive[caller]) return fail('you_are_dead')
      if (me.emergencyUsed) return fail('emergency_used')
      if (state.sabotage) return fail('fix_sabotage_first')
      me.emergencyUsed = true
      openMeeting(ctx, 'emergency', caller, null)
      return okr()
    }

    case 'vote': {
      const m = state.meeting
      if (state.phase !== 'meeting' || !m) return fail('no_meeting')
      if (m.stage !== 'voting') return fail('not_voting_stage')
      if (!me || !state.alive[caller]) return fail('ghosts_cannot_vote')
      if (m.voted.includes(caller)) return fail('already_voted')
      if (action.target !== 'skip' && !state.alive[action.target]) return fail('bad_target')
      me.vote = action.target
      m.voted.push(caller)
      // Everyone voted? Close immediately — no dead air.
      advanceClock(ctx)
      return okr()
    }

    case 'task_done': {
      if (state.phase !== 'playing' && state.phase !== 'meeting') return fail('not_playing')
      if (!me) return fail('not_in_game')
      const t = me.tasks.find((x) => x.id === action.taskId)
      if (!t) return fail('not_your_task')
      if (t.done) return okr(false) // idempotent
      t.done = true
      if (!me.fake) {
        state.tasksDone++
        checkWin(ctx)
      }
      return okr()
    }

    case 'sabotage': {
      if (state.phase !== 'playing') return fail('not_playing')
      if (!me || me.role !== 'mundass') return fail('not_mundass')
      if (!state.alive[caller]) return fail('you_are_dead')
      if (state.sabotage) return fail('already_sabotaged')
      if (now < (state.sabotageCdUntil || 0)) return fail('sabotage_cooldown')
      state.sabotage = 'power'
      return okr()
    }

    case 'fix_sabotage': {
      if (state.phase !== 'playing') return fail('not_playing')
      if (!me || !state.alive[caller]) return fail('you_are_dead')
      if (!state.sabotage) return okr(false)
      state.sabotage = null
      state.sabotageCdUntil = now + SABOTAGE_COOLDOWN_MS
      return okr()
    }

    case 'leave': {
      if (!me) return fail('not_in_game')
      if (!state.alive[caller]) return okr(false)
      // Leaving mid-game = quiet death, no body; their unfinished real tasks
      // leave the denominator so the bar stays honest.
      state.alive[caller] = false
      if (!me.fake) {
        const remaining = me.tasks.filter((t) => !t.done).length
        state.tasksTotal = Math.max(state.tasksDone, state.tasksTotal - remaining)
      }
      if (state.meeting && state.meeting.stage === 'voting') advanceClock(ctx)
      checkWin(ctx)
      return okr()
    }

    default:
      return fail('unknown_action')
  }
}
