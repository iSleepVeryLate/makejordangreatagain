// المندس engine tests. Run: deno test supabase/functions/_shared/
import {
  assert,
  assertEquals,
  assertFalse,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  applyAction,
  DEFAULT_SETTINGS,
  mundassCount,
  startGame,
  TASK_IDS,
  type Action,
  type Ctx,
  type PublicState,
  type Role,
  type Secret,
  type Settings,
} from './mundassEngine.ts'

// Deterministic RNG (mulberry32) so role assignment is reproducible per seed.
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Test harness: a running game with a controllable clock. */
class G {
  state: PublicState
  secrets: Record<string, Secret>
  settings: Settings
  now: number
  rand: () => number
  ids: string[]

  constructor(n: number, opts: Partial<Settings> = {}, seed = 42) {
    this.settings = { ...DEFAULT_SETTINGS, ...opts }
    this.rand = rng(seed)
    this.now = 1_000_000
    this.ids = Array.from({ length: n }, (_, i) => `p${i + 1}`)
    const s = startGame(this.ids, this.settings, this.now, this.rand)
    this.state = s.state
    this.secrets = s.secrets
  }

  ctx(): Ctx {
    return { state: this.state, secrets: this.secrets, settings: this.settings, now: this.now, rand: this.rand }
  }
  act(caller: string, action: Action) {
    return applyAction(this.ctx(), caller, action)
  }
  advance(ms: number) {
    this.now += ms
  }
  byRole(role: Role): string[] {
    return this.ids.filter((id) => this.secrets[id].role === role)
  }
  mundass(): string {
    return this.byRole('mundass')[0]
  }
  crew(): string[] {
    return this.byRole('crew')
  }
  /** Past the kill cooldown. */
  ready() {
    this.advance(this.settings.killCooldownSecs * 1000 + 1)
  }
  kill(victim: string) {
    return this.act(this.mundass(), { type: 'kill', victim, x: 100, y: 100 })
  }
}

// ---------- role assignment ----------

Deno.test('mundass count: 1 for 4-7 players, 2 for 8-10', () => {
  assertEquals(mundassCount(4), 1)
  assertEquals(mundassCount(7), 1)
  assertEquals(mundassCount(8), 2)
  assertEquals(mundassCount(10), 2)
})

Deno.test('start deals exactly one mundass at 5 players, everyone alive, tasks counted', () => {
  const g = new G(5)
  assertEquals(g.byRole('mundass').length, 1)
  assertEquals(g.byRole('crew').length, 4)
  assertEquals(Object.values(g.state.alive).filter(Boolean).length, 5)
  assertEquals(g.state.phase, 'playing')
  // 4 crew × 4 tasks each
  assertEquals(g.state.tasksTotal, 16)
  assertEquals(g.state.tasksDone, 0)
  // roles are NOT in public state
  assertEquals(g.state.reveal, null)
})

Deno.test('start at 8 players deals 2 mundasseen who know each other', () => {
  const g = new G(8)
  const m = g.byRole('mundass')
  assertEquals(m.length, 2)
  assertEquals(g.secrets[m[0]].mates, [m[1]])
  assertEquals(g.secrets[m[1]].mates, [m[0]])
  for (const c of g.crew()) assertEquals(g.secrets[c].mates, [])
})

Deno.test('mundass gets fake tasks that never count', () => {
  const g = new G(4)
  assert(g.secrets[g.mundass()].fake)
  assertEquals(g.secrets[g.mundass()].tasks.length, g.settings.tasksPerPlayer)
  // fake tasks are excluded from the denominator (3 crew × 4)
  assertEquals(g.state.tasksTotal, 12)
})

Deno.test('different seeds shuffle the mundass around', () => {
  const picks = new Set<string>()
  for (let seed = 1; seed <= 12; seed++) picks.add(new G(4, {}, seed).mundass())
  assert(picks.size > 1)
})

// ---------- kills ----------

Deno.test('kill is blocked until the initial cooldown elapses', () => {
  const g = new G(4)
  const r = g.kill(g.crew()[0])
  assertFalse(r.ok)
  assertEquals(r.error, 'kill_cooldown')
})

Deno.test('kill after cooldown drops a body and resets the cooldown', () => {
  const g = new G(5)
  g.ready()
  const victim = g.crew()[0]
  const r = g.kill(victim)
  assert(r.ok)
  assertEquals(g.state.alive[victim], false)
  assertEquals(g.state.bodies.length, 1)
  assertEquals(g.state.bodies[0].victim, victim)
  // cooldown restarted → immediate second kill blocked
  const r2 = g.kill(g.crew()[1])
  assertFalse(r2.ok)
  assertEquals(r2.error, 'kill_cooldown')
})

Deno.test('crew cannot kill; mundass cannot kill a mate or the dead', () => {
  const g = new G(8)
  g.ready()
  const [m1, m2] = g.byRole('mundass')
  assertEquals(g.act(g.crew()[0], { type: 'kill', victim: g.crew()[1], x: 0, y: 0 }).error, 'not_mundass')
  assertEquals(g.act(m1, { type: 'kill', victim: m2, x: 0, y: 0 }).error, 'cannot_kill_mate')
  const victim = g.crew()[0]
  g.act(m1, { type: 'kill', victim, x: 0, y: 0 })
  g.ready()
  assertEquals(g.act(m1, { type: 'kill', victim, x: 0, y: 0 }).error, 'victim_not_alive')
})

Deno.test('mundass wins when numbers reach parity', () => {
  const g = new G(4) // 1 mundass vs 3 crew
  g.ready()
  g.kill(g.crew()[0])
  assertEquals(g.state.phase, 'playing')
  g.ready()
  g.kill(g.crew()[1]) // 1 v 1 → parity
  assertEquals(g.state.phase, 'ended')
  assertEquals(g.state.winner, 'mundass')
  // full-cast reveal is published at game end
  assertEquals(g.state.reveal![g.mundass()], 'mundass')
})

// ---------- meetings: report / emergency ----------

Deno.test('reporting a body opens a discussion meeting and clears bodies', () => {
  const g = new G(5)
  g.ready()
  const victim = g.crew()[0]
  g.kill(victim)
  const reporter = g.crew()[1]
  const r = g.act(reporter, { type: 'report', victim })
  assert(r.ok)
  assertEquals(g.state.phase, 'meeting')
  assertEquals(g.state.meeting!.stage, 'discussion')
  assertEquals(g.state.meeting!.kind, 'body')
  assertEquals(g.state.meeting!.victim, victim)
  assertEquals(g.state.bodies.length, 0)
})

Deno.test('cannot report a body that does not exist', () => {
  const g = new G(4)
  assertEquals(g.act(g.crew()[0], { type: 'report', victim: g.crew()[1] }).error, 'no_such_body')
})

Deno.test('emergency meeting works once per player', () => {
  const g = new G(4)
  const caller = g.crew()[0]
  assert(g.act(caller, { type: 'emergency' }).ok)
  assertEquals(g.state.meeting!.kind, 'emergency')
  // finish the meeting, then try again
  g.advance(g.settings.discussionSecs * 1000 + 1)
  g.act(caller, { type: 'tick' })
  g.advance(g.settings.votingSecs * 1000 + 1)
  g.act(caller, { type: 'tick' })
  g.advance(7000)
  g.act(caller, { type: 'tick' })
  assertEquals(g.state.phase, 'playing')
  assertEquals(g.act(caller, { type: 'emergency' }).error, 'emergency_used')
  // another player still has theirs
  assert(g.act(g.crew()[1], { type: 'emergency' }).ok)
})

Deno.test('the dead cannot report, call meetings, or vote', () => {
  const g = new G(5)
  g.ready()
  const dead = g.crew()[0]
  g.kill(dead)
  assertEquals(g.act(dead, { type: 'emergency' }).error, 'you_are_dead')
  g.act(g.crew()[1], { type: 'report', victim: dead })
  g.advance(g.settings.discussionSecs * 1000 + 1)
  g.act(dead, { type: 'tick' })
  assertEquals(g.act(dead, { type: 'vote', target: 'skip' }).error, 'ghosts_cannot_vote')
})

// ---------- voting ----------

function toVoting(g: G, kind: 'emergency' | 'body' = 'emergency') {
  if (kind === 'emergency') g.act(g.crew()[0], { type: 'emergency' })
  g.advance(g.settings.discussionSecs * 1000 + 1)
  g.act(g.crew()[0], { type: 'tick' })
  assertEquals(g.state.meeting!.stage, 'voting')
}

Deno.test('votes are secret during voting; only WHO voted is public', () => {
  const g = new G(5)
  toVoting(g)
  const voter = g.crew()[1]
  g.act(voter, { type: 'vote', target: g.mundass() })
  assert(g.state.meeting!.voted.includes(voter))
  assertEquals(g.state.meeting!.result, null) // no tally leak mid-vote
  assertEquals(g.secrets[voter].vote, g.mundass()) // stored in the voter's own secret
})

Deno.test('double voting and voting for the dead are rejected', () => {
  const g = new G(5)
  g.ready()
  const dead = g.crew()[0]
  g.kill(dead)
  g.act(g.crew()[1], { type: 'report', victim: dead })
  g.advance(g.settings.discussionSecs * 1000 + 1)
  g.act(g.crew()[1], { type: 'tick' })
  const voter = g.crew()[1]
  assertEquals(g.act(voter, { type: 'vote', target: dead }).error, 'bad_target')
  assert(g.act(voter, { type: 'vote', target: 'skip' }).ok)
  assertEquals(g.act(voter, { type: 'vote', target: 'skip' }).error, 'already_voted')
})

Deno.test('when everyone alive has voted the meeting closes immediately', () => {
  const g = new G(4)
  toVoting(g)
  const target = g.mundass()
  for (const id of g.ids) {
    if (g.state.meeting?.stage !== 'voting') break
    g.act(id, { type: 'vote', target })
  }
  assertEquals(g.state.meeting!.stage, 'reveal')
  assertEquals(g.state.meeting!.result!.ejected, target)
  assertEquals(g.state.meeting!.result!.wasMundass, true)
})

Deno.test('ejecting the mundass wins the game for the crew', () => {
  const g = new G(4)
  toVoting(g)
  for (const id of g.ids) {
    if (g.state.meeting?.stage !== 'voting') break
    g.act(id, { type: 'vote', target: g.mundass() })
  }
  g.advance(7000)
  g.act(g.crew()[0], { type: 'tick' })
  assertEquals(g.state.phase, 'ended')
  assertEquals(g.state.winner, 'crew')
})

Deno.test('a tie ejects no one', () => {
  const g = new G(4)
  toVoting(g)
  const [a, b] = [g.crew()[0], g.crew()[1]]
  g.act(a, { type: 'vote', target: b })
  g.act(b, { type: 'vote', target: a })
  g.act(g.crew()[2], { type: 'vote', target: b })
  g.act(g.mundass(), { type: 'vote', target: a }) // 2-2 tie
  assertEquals(g.state.meeting!.stage, 'reveal')
  assertEquals(g.state.meeting!.result!.ejected, null)
})

Deno.test('skip outvoting the top candidate ejects no one', () => {
  const g = new G(5)
  toVoting(g)
  const target = g.crew()[1]
  g.act(g.crew()[0], { type: 'vote', target })
  for (const id of g.ids) {
    if (id === g.crew()[0]) continue
    if (g.state.meeting?.stage !== 'voting') break
    g.act(id, { type: 'vote', target: 'skip' })
  }
  assertEquals(g.state.meeting!.result!.ejected, null)
  assertEquals(g.state.meeting!.result!.tally['skip'], 4)
})

Deno.test('voting deadline closes the vote with abstentions counted', () => {
  const g = new G(5)
  toVoting(g)
  g.act(g.crew()[0], { type: 'vote', target: 'skip' })
  g.advance(g.settings.votingSecs * 1000 + 1)
  g.act(g.crew()[0], { type: 'tick' })
  assertEquals(g.state.meeting!.stage, 'reveal')
  assertEquals(g.state.meeting!.result!.abstained, 4)
})

Deno.test('after the reveal the hara returns to playing with votes cleared', () => {
  const g = new G(5)
  toVoting(g)
  for (const id of g.ids) {
    if (g.state.meeting?.stage !== 'voting') break
    g.act(id, { type: 'vote', target: 'skip' })
  }
  g.advance(7000)
  g.act(g.crew()[0], { type: 'tick' })
  assertEquals(g.state.phase, 'playing')
  assertEquals(g.state.meeting, null)
})

// ---------- tasks ----------

Deno.test('real tasks fill the bar; fake mundass tasks never do', () => {
  const g = new G(4)
  const c = g.crew()[0]
  const t = g.secrets[c].tasks[0]
  assert(g.act(c, { type: 'task_done', taskId: t.id }).ok)
  assertEquals(g.state.tasksDone, 1)
  const m = g.mundass()
  g.act(m, { type: 'task_done', taskId: g.secrets[m].tasks[0].id })
  assertEquals(g.state.tasksDone, 1)
})

Deno.test('finishing a task twice is idempotent; not-your-task is rejected', () => {
  const g = new G(4)
  const c = g.crew()[0]
  const mine = g.secrets[c].tasks.map((t) => t.id)
  const notMine = TASK_IDS.find((id) => !mine.includes(id))!
  assertEquals(g.act(c, { type: 'task_done', taskId: notMine }).error, 'not_your_task')
  g.act(c, { type: 'task_done', taskId: mine[0] })
  const again = g.act(c, { type: 'task_done', taskId: mine[0] })
  assert(again.ok)
  assertFalse(again.changed)
  assertEquals(g.state.tasksDone, 1)
})

Deno.test('ghosts finishing their tasks still count — and can win the game', () => {
  const g = new G(4)
  g.ready()
  const dead = g.crew()[0]
  g.kill(dead)
  for (const c of g.crew()) {
    for (const t of g.secrets[c].tasks) g.act(c, { type: 'task_done', taskId: t.id })
  }
  assertEquals(g.state.phase, 'ended')
  assertEquals(g.state.winner, 'crew')
})

// ---------- sabotage ----------

Deno.test('only the mundass can cut the power; anyone can fix it', () => {
  const g = new G(4)
  assertEquals(g.act(g.crew()[0], { type: 'sabotage' }).error, 'not_mundass')
  assert(g.act(g.mundass(), { type: 'sabotage' }).ok)
  assertEquals(g.state.sabotage, 'power')
  assertEquals(g.act(g.mundass(), { type: 'sabotage' }).error, 'already_sabotaged')
  // the mihbash is blocked until the breaker is fixed
  assertEquals(g.act(g.crew()[0], { type: 'emergency' }).error, 'fix_sabotage_first')
  assert(g.act(g.crew()[1], { type: 'fix_sabotage' }).ok)
  assertEquals(g.state.sabotage, null)
})

// ---------- leave ----------

Deno.test('a leaving crew member shrinks the task denominator', () => {
  const g = new G(5)
  const before = g.state.tasksTotal
  const leaver = g.crew()[0]
  g.act(leaver, { type: 'leave' })
  assertEquals(g.state.alive[leaver], false)
  assertEquals(g.state.tasksTotal, before - g.settings.tasksPerPlayer)
})

Deno.test('the mundass rage-quitting hands the crew the win', () => {
  const g = new G(5)
  g.act(g.mundass(), { type: 'leave' })
  assertEquals(g.state.phase, 'ended')
  assertEquals(g.state.winner, 'crew')
})

// ---------- clock ----------

Deno.test('tick before any deadline is a no-op', () => {
  const g = new G(4)
  const r = g.act(g.crew()[0], { type: 'tick' })
  assert(r.ok)
  assertFalse(r.changed)
})

Deno.test('actions self-heal an expired stage even without a tick', () => {
  const g = new G(5)
  g.act(g.crew()[0], { type: 'emergency' })
  g.advance(g.settings.discussionSecs * 1000 + 1)
  // a vote arriving after the discussion deadline finds the voting stage open
  const r = g.act(g.crew()[1], { type: 'vote', target: 'skip' })
  assert(r.ok)
  assertEquals(g.state.meeting!.stage, 'voting')
})

Deno.test('actions are rejected once the game has ended', () => {
  const g = new G(4)
  g.act(g.mundass(), { type: 'leave' })
  assertEquals(g.state.phase, 'ended')
  assertEquals(g.act(g.crew()[0], { type: 'emergency' }).error, 'game_over')
})
