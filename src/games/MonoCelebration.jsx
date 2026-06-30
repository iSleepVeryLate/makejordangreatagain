import { useEffect, useRef, useState, memo, useSyncExternalStore } from 'react'
import Confetti from '../components/Confetti.jsx'

// ============================================================================
// ITEM 3 — big-moment celebration overlay (Monopoly-GO-style payoff).
//
// Subscribes to the animator's `celebrate` edge slice ({ kind, nonce }). On each
// nonce bump it shows, for a fixed TTL, a finite DOM celebration over the board:
//   • the existing <Confetti> burst (itself reduced-motion-aware → renders nothing
//     under reduce), and
//   • a gold light/glow FLASH (a CSS-animated radial wash that fades out).
// Both are finite DOM with a TTL timer that clears them → no perpetual animation.
// The `stinger` SFX is fired from useBoardAnimator's celebrate-trigger path? No —
// it's fired HERE so it's co-located with the visual + still plays under reduced
// motion (sound is motion-independent in this codebase).
//
// PARK/leak-safety: pure DOM, no rAF, no 3D. A single TTL timeout per fire, cleared
// on the next fire and on unmount. Reduced motion → no confetti, no flash (calm),
// but the stinger still plays. The overlay is pointer-events:none so it never
// blocks the board / decision moments underneath.
// ============================================================================

const TTL_MS = 2200 // confetti + flash lifetime; the flash CSS animation is shorter

// Per-kind accent for the gold flash + the small badge label. All warm/gold to stay
// in the dark-premium key (never cartoony-bright).
const KINDS = {
  buy: { label: 'PROPERTY!', glow: 'rgba(255,206,84,0.9)' },
  set: { label: 'MONOPOLY!', glow: 'rgba(255,225,150,1)' },
  go: { label: '+200 · GO', glow: 'rgba(110,231,168,0.9)' },
  win: { label: 'WINNER!', glow: 'rgba(255,225,150,1)' },
}

const EMPTY = Object.freeze({ kind: null, nonce: 0 })

function MonoCelebration({ store, reducedMotion = false, play }) {
  const sub = store?.celebrate?.subscribe || ((cb) => { cb(); return () => {} })
  const get = store?.celebrate?.get || (() => EMPTY)
  const sig = useSyncExternalStore(sub, get)
  const [active, setActive] = useState(null) // { kind, key } while celebrating, else null
  const timerRef = useRef(0)
  const lastNonceRef = useRef(0)
  const reducedRef = useRef(reducedMotion); reducedRef.current = reducedMotion
  const playRef = useRef(play); playRef.current = play

  useEffect(() => {
    if (!sig || !sig.kind || sig.nonce === lastNonceRef.current) return undefined
    lastNonceRef.current = sig.nonce
    // Stinger fires on every milestone regardless of reduced motion (sound is
    // motion-independent here). play may be undefined (no sound) — guarded.
    playRef.current?.('stinger')
    // Visuals only when motion is allowed. Under reduced motion we still flashed the
    // stinger above; skip the confetti + glow flash entirely (calm path).
    if (reducedRef.current) return undefined
    setActive({ kind: sig.kind, key: sig.nonce })
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setActive(null), TTL_MS)
    return undefined
  }, [sig])

  // Clear the TTL timer on unmount so a late fire can't setState after teardown.
  useEffect(() => () => clearTimeout(timerRef.current), [])

  if (!active) return null
  const meta = KINDS[active.kind] || KINDS.buy
  return (
    <div className="mono-celebrate" aria-hidden style={{ '--cel-glow': meta.glow }}>
      <div className="mono-celebrate-flash" />
      <div className="mono-celebrate-badge">{meta.label}</div>
      {/* Confetti is itself reduced-motion-aware (returns null under reduce); we already
          gate above, but keying it remounts a fresh burst per celebration. */}
      <Confetti key={active.key} count={54} />
    </div>
  )
}

export default memo(MonoCelebration)
