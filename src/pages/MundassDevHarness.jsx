import { useCallback, useMemo, useRef, useState } from 'react'
import { useLang } from '../context/LanguageContext.jsx'
import MundassCanvas from '../games/mundass/MundassCanvas.jsx'
import MeetingOverlay from '../games/mundass/MeetingOverlay.jsx'
import TaskModal from '../games/mundass/minigames.jsx'
import { TASK_IDS_CLIENT } from '../games/mundass/devData.js'
import { MANHOLES } from '../games/mundass/map.js'

// DEV-ONLY (/__dev/mundass, tree-shaken out of prod): drives every المندس
// surface with mock data — walk the hara with WASD, spawn bots/bodies, flip
// roles, cut the power, open any minigame, and step through a full meeting.
// No login, no Supabase, no 2nd player needed.

// A full 15-player Discord-night crowd — exercises the 16-color palette, the
// dense meeting grid, and the many-peers render path.
const BOT_NAMES = [
  'أبو خليل', 'أم رامي', 'مهند', 'شهد', 'ليث', 'أبو عودة', 'رغد',
  'قصي', 'تالا', 'أبو فارس', 'جود', 'عمار', 'لين', 'حمزة',
]
const MOCK_PLAYERS = [
  { profile_id: 'me', color: 0, is_present: true, profile: { global_name: 'أنا (Me)' } },
  ...BOT_NAMES.map((name, i) => ({
    profile_id: `b${i + 1}`, color: i + 1, is_present: true, profile: { global_name: name },
  })),
]

export default function MundassDevHarness() {
  const { t, lang, dir } = useLang()
  const [role, setRole] = useState('crew')
  const [sabotage, setSabotage] = useState(null)
  const [bodies, setBodies] = useState([])
  const [meeting, setMeeting] = useState(null)
  const [openTask, setOpenTask] = useState(null)
  const [chat, setChat] = useState([])
  const [botsOn, setBotsOn] = useState(true)
  const canvasRef = useRef(null)
  const listenersRef = useRef(new Set())
  const botAngleRef = useRef(0)

  const state = useMemo(() => ({
    phase: meeting ? 'meeting' : 'playing',
    alive: Object.fromEntries(MOCK_PLAYERS.map((p) => [
      p.profile_id, !(p.profile_id === 'b2' && bodies.length > 0),
    ])),
    bodies,
    tasksDone: 11,
    tasksTotal: 48,
    sabotage,
    sabotageCdUntil: 0,
    meeting,
    winner: null,
    reveal: null,
    startedAt: 1,
  }), [meeting, bodies, sabotage])

  const meSecret = useMemo(() => ({
    role,
    tasks: TASK_IDS_CLIENT.slice(0, 4).map((id, i) => ({ id, done: i === 0 })),
    mates: [],
    killCooldownUntil: 0,
    emergencyUsed: false,
    vote: null,
  }), [role])

  const stateRef = useRef(state)
  const meRef = useRef(meSecret)
  stateRef.current = state
  meRef.current = meSecret

  // Tiny fake broadcast bus + a bot circling the courtyard.
  const onMessage = useCallback((fn) => {
    listenersRef.current.add(fn)
    return () => listenersRef.current.delete(fn)
  }, [])
  const sendBroadcast = useCallback(() => {}, [])
  useMemo(() => {
    const iv = setInterval(() => {
      if (!botsOn) return
      botAngleRef.current += 0.05
      const a = botAngleRef.current
      // the whole crowd wanders: two courtyard rings + a few room-dwellers
      const msgs = BOT_NAMES.map((_, i) => {
        const id = `b${i + 1}`
        if (i % 3 === 0) {
          const ph = a + i
          return { t: 'pos', id, x: 1600 + Math.cos(ph) * 230, y: 980 + Math.sin(ph) * 120, fx: Math.cos(ph) > 0 ? 1 : -1, m: 1 }
        }
        if (i % 3 === 1) {
          const ph = -a * 0.7 + i
          return { t: 'pos', id, x: 1600 + Math.cos(ph) * 120, y: 1020 + Math.sin(ph) * 70, fx: 1, m: 1 }
        }
        const spots = [[1330, 620], [780, 660], [2400, 170], [740, 1280], [3030, 1560], [1950, 1380]]
        const [sx, sy] = spots[i % spots.length]
        return { t: 'pos', id, x: sx + Math.cos(a + i) * 40, y: sy + Math.sin(a + i) * 26, fx: 1, m: 1 }
      })
      msgs.forEach((m) => listenersRef.current.forEach((fn) => fn(m)))
    }, 100)
    return iv
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [botsOn])

  const [nearest, setNearest] = useState(null)
  const [killTarget, setKillTarget] = useState(null)

  const startMeeting = (stage) => {
    const base = {
      kind: 'emergency', caller: 'b1', victim: null,
      stage, endsAt: Date.now() + 45000, voted: stage === 'voting' ? ['b1', 'b4', 'b7'] : [],
      result: stage === 'reveal'
        ? { ejected: 'b3', wasMundass: true, tally: { b3: 8, b6: 3, skip: 2 }, abstained: 2 }
        : null,
    }
    setMeeting(base)
  }

  return (
    <div className="mun-game" dir={dir}>
      <MundassCanvas
        ref={canvasRef}
        myId="me"
        players={MOCK_PLAYERS}
        stateRef={stateRef}
        meRef={meRef}
        frozen={!!meeting || !!openTask}
        sendBroadcast={sendBroadcast}
        onMessage={onMessage}
        onNearest={setNearest}
        onKillTarget={setKillTarget}
        lang={lang}
      />

      <div className="mun-hud-top">
        <div className="mun-taskbar">
          <div className="mun-taskbar-label">{t('mundass.taskBar')}</div>
          <div className="mun-taskbar-track"><div className="mun-taskbar-fill" style={{ width: '25%' }} /></div>
        </div>
      </div>

      {state.sabotage === 'power' && <div className="mun-sabotage-banner">⚡ {t('mundass.powerCut')}</div>}

      <div className="mun-hud-actions">
        {nearest && (
          <button
            className="mun-act mun-act-use"
            onClick={() => {
              if (nearest.kind === 'task') setOpenTask(nearest.taskId)
              else if (nearest.kind === 'breaker') setOpenTask('fix')
              else if (nearest.kind === 'manhole') {
                const next = MANHOLES[(nearest.index + 1) % MANHOLES.length]
                canvasRef.current?.teleport(next.x, next.y + 60)
              }
            }}
          >
            {nearest.kind}
          </button>
        )}
        {killTarget && <button className="mun-act mun-act-kill ready">💀</button>}
      </div>

      {/* harness controls */}
      <div style={{
        position: 'absolute', bottom: 12, insetInlineStart: 12, zIndex: 20, display: 'flex',
        flexWrap: 'wrap', gap: 6, maxWidth: 420,
      }}>
        {[
          ['role: ' + role, () => setRole(role === 'crew' ? 'mundass' : 'crew')],
          ['power cut', () => setSabotage(sabotage ? null : 'power')],
          ['body', () => setBodies(bodies.length ? [] : [{ victim: 'b2', x: 1680, y: 1050 }])],
          ['meet: discuss', () => startMeeting('discussion')],
          ['meet: vote', () => startMeeting('voting')],
          ['meet: reveal', () => startMeeting('reveal')],
          ['meet: off', () => setMeeting(null)],
          ['bots: ' + (botsOn ? 'on' : 'off'), () => setBotsOn(!botsOn)],
          ...[...TASK_IDS_CLIENT, 'fix'].map((id) => [id, () => setOpenTask(id)]),
        ].map(([label, fn]) => (
          <button key={label} className="btn btn-line btn-sm" onClick={fn}>{label}</button>
        ))}
      </div>

      {openTask && (
        <TaskModal
          taskId={openTask}
          lang={lang}
          t={t}
          onDone={() => setOpenTask(null)}
          onClose={() => setOpenTask(null)}
        />
      )}

      {meeting && (
        <MeetingOverlay
          state={state}
          players={MOCK_PLAYERS}
          myId="me"
          iAmGhost={false}
          serverNow={() => Date.now()}
          onVote={() => setMeeting({ ...meeting, voted: [...meeting.voted, 'me'] })}
          chat={chat}
          onSendChat={(text) => setChat((c) => [...c, { t: 'chat', name: 'أنا', text }])}
          t={t}
          lang={lang}
          dir={dir}
        />
      )}
    </div>
  )
}
