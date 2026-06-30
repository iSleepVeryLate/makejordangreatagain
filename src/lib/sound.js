// Net-new audio for Jordan Monopoly. The repo ships ZERO sound today; rather than
// commit a pile of binary clips, every SFX here is SYNTHESISED with WebAudio at
// play time. That keeps the feature weightless, offline-safe (no /sounds fetch),
// and avoids licensing — while never "shipping silence pretending to be sound".
// (A future pass could swap in real CC0 mp3s behind the same `play(name)` API;
// nothing else would change.)
//
// Contract used by the animator / UI:
//   sound.play(name)        — fire a one-shot SFX (no-op until unlocked or if muted)
//   sound.installUnlock()   — arm a one-time pointer/key listener to unlock audio
//   sound.toggleMute()      — flip + persist mute (localStorage 'jst_mono_muted')
//   sound.subscribe(fn)     — notified on mute changes (for useSyncExternalStore)
//   sound.getMuted()        — current mute bool

const STORAGE_KEY = 'jst_mono_muted'

let ctx = null
let master = null
let unlocked = false
let armed = false
const listeners = new Set()

function readMuted() {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}
let muted = readMuted()

function ensureCtx() {
  if (ctx) return ctx
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!AC) return null
  try {
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = 0.85
    master.connect(ctx.destination)
  } catch { ctx = null }
  return ctx
}

const tnow = () => ctx.currentTime

// An enveloped oscillator tone with optional pitch glide.
function tone({ freq, type = 'sine', t0 = 0, dur = 0.15, gain = 0.3, glideTo = null, attack = 0.005 }) {
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  const start = tnow() + t0
  o.type = type
  o.frequency.setValueAtTime(freq, start)
  if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), start + dur)
  g.gain.setValueAtTime(0.0001, start)
  g.gain.exponentialRampToValueAtTime(gain, start + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  o.connect(g); g.connect(master)
  o.start(start); o.stop(start + dur + 0.03)
}

// A short filtered-noise burst (clacks, coins, hammer, paper, clang).
function noise({ t0 = 0, dur = 0.12, gain = 0.3, type = 'highpass', freq = 1000, q = 0.7 }) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource(); src.buffer = buf
  const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q
  const g = ctx.createGain()
  const start = tnow() + t0
  g.gain.setValueAtTime(gain, start)
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur)
  src.connect(filter); filter.connect(g); g.connect(master)
  src.start(start); src.stop(start + dur + 0.03)
}

// name → synth recipe. Kept short and punchy (<~0.6s each).
const SFX = {
  hop: () => tone({ freq: 300, glideTo: 470, type: 'sine', dur: 0.07, gain: 0.1 }),
  go: () => { tone({ freq: 660, type: 'triangle', dur: 0.16, gain: 0.16 }); tone({ freq: 990, t0: 0.08, type: 'triangle', dur: 0.22, gain: 0.16 }) },
  diceRoll: () => { for (let i = 0; i < 5; i++) noise({ t0: i * 0.06, dur: 0.05, gain: 0.07, type: 'bandpass', freq: 1600 + Math.random() * 1400, q: 1.3 }) },
  diceLand: () => { noise({ dur: 0.06, gain: 0.24, type: 'highpass', freq: 2600 }); noise({ t0: 0.09, dur: 0.07, gain: 0.22, type: 'highpass', freq: 2100 }) },
  buy: () => { tone({ freq: 880, type: 'square', dur: 0.08, gain: 0.09 }); tone({ freq: 1320, t0: 0.07, type: 'square', dur: 0.13, gain: 0.11 }); noise({ dur: 0.04, gain: 0.08, type: 'highpass', freq: 3200 }) },
  rent: () => { for (let i = 0; i < 4; i++) tone({ freq: 1180 + i * 130, t0: i * 0.05, type: 'triangle', dur: 0.1, gain: 0.08 }) },
  build: () => { noise({ dur: 0.05, gain: 0.28, type: 'lowpass', freq: 420 }); tone({ freq: 150, type: 'square', dur: 0.08, gain: 0.12 }) },
  card: () => noise({ dur: 0.2, gain: 0.1, type: 'highpass', freq: 3800 }),
  jail: () => { tone({ freq: 220, type: 'sawtooth', dur: 0.32, gain: 0.16, glideTo: 90 }); noise({ dur: 0.14, gain: 0.18, type: 'bandpass', freq: 1100, q: 2 }) },
  jailOut: () => { tone({ freq: 620, type: 'sine', dur: 0.1, gain: 0.12 }); tone({ freq: 880, t0: 0.08, type: 'sine', dur: 0.15, gain: 0.12 }) },
  bankrupt: () => { tone({ freq: 440, type: 'sawtooth', dur: 0.55, gain: 0.2, glideTo: 90 }) },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, t0: i * 0.13, type: 'triangle', dur: 0.32, gain: 0.17 })) },
  turn: () => { tone({ freq: 784, type: 'sine', dur: 0.12, gain: 0.14 }); tone({ freq: 1047, t0: 0.1, type: 'sine', dur: 0.18, gain: 0.14 }) },
  ui: () => tone({ freq: 560, type: 'sine', dur: 0.05, gain: 0.07 }),
  // tile select — a soft, crisp two-note pip when a deed/tile is opened (distinct from `ui`)
  select: () => { tone({ freq: 720, type: 'sine', dur: 0.05, gain: 0.08 }); tone({ freq: 1080, t0: 0.04, type: 'sine', dur: 0.07, gain: 0.06 }) },

  // ---- chess: dry, wooden, chess.com-flavoured. Own + opponent moves play these. ----
  // soft wood "tock" — a quiet thud under a short low click
  chessMove: () => { noise({ dur: 0.045, gain: 0.16, type: 'lowpass', freq: 520 }); tone({ freq: 180, type: 'sine', dur: 0.05, gain: 0.06 }) },
  // harder/lower than a move: a punchier knock with a downward body
  chessCapture: () => { noise({ dur: 0.06, gain: 0.26, type: 'bandpass', freq: 380, q: 1.2 }); tone({ freq: 150, glideTo: 90, type: 'triangle', dur: 0.09, gain: 0.12 }) },
  // two quick tocks ~80ms apart (rook + king settling)
  chessCastle: () => { noise({ dur: 0.045, gain: 0.16, type: 'lowpass', freq: 520 }); noise({ t0: 0.085, dur: 0.045, gain: 0.16, type: 'lowpass', freq: 520 }); tone({ freq: 180, type: 'sine', dur: 0.05, gain: 0.05 }) },
  // alerting two-note rise
  chessCheck: () => { tone({ freq: 660, type: 'triangle', dur: 0.1, gain: 0.12 }); tone({ freq: 990, t0: 0.09, type: 'triangle', dur: 0.13, gain: 0.12 }) },
  // bright ascending sparkle
  chessPromote: () => { [784, 1047, 1319].forEach((f, i) => tone({ freq: f, t0: i * 0.07, type: 'triangle', dur: 0.12, gain: 0.1 })) },
  // short resolved cadence (neutral — the result banner says who won)
  chessGameOver: () => { [523, 659, 784].forEach((f, i) => tone({ freq: f, t0: i * 0.12, type: 'triangle', dur: 0.26, gain: 0.15 })) },
}

function play(name) {
  if (muted || !unlocked) return
  const c = ensureCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume()
  const fn = SFX[name]
  if (!fn) return
  try { fn() } catch { /* never let a synth glitch bubble into gameplay */ }
}

// Browsers block audio until a user gesture. Resume the context inside one.
function unlock() {
  if (unlocked) return
  const c = ensureCtx()
  if (!c) return
  if (c.state === 'suspended') c.resume()
  unlocked = true
}

function installUnlock() {
  if (armed || unlocked || typeof window === 'undefined') return
  armed = true
  const h = () => { unlock() }
  window.addEventListener('pointerdown', h, { once: true, passive: true })
  window.addEventListener('keydown', h, { once: true })
}

function setMuted(v) {
  muted = !!v
  try { localStorage.setItem(STORAGE_KEY, muted ? '1' : '0') } catch { /* ignore */ }
  listeners.forEach((l) => l(muted))
}

export const sound = {
  play,
  installUnlock,
  unlock,
  toggleMute: () => setMuted(!muted),
  setMuted,
  getMuted: () => muted,
  subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
}
