import { useEffect, useRef, useSyncExternalStore } from 'react'

// ============================================================================
// ITEM 4 — coins fly from a gaining player's TOKEN into their HUD balance card.
//
// Subscribes to the animator's `coin` edge slice ({ id, amount, nonce }) — the SAME
// signal that drives the 3D coin burst — and, on a positive gain, spawns a finite set
// of gold coin elements at the token's projected screen position and animates them into
// that player's balance-card element. The card's CountUp (already driven by the cash
// snapshot) ticks up as the coins land, so the two read as one "you got paid" moment.
//
// Coordinate space: VIEWPORT px. The source comes from getTokenPos(id) (the 3D scene's
// project() + canvas rect → viewport px); the destination is the card's
// getBoundingClientRect centre. The layer itself is position:fixed inset:0 so both map
// cleanly to the viewport. The DOM nodes are appended to a fixed container we own.
//
// GRACEFUL DEGRADE: if there's no scene projection (2D-Lite, or the token is off-screen)
// OR no card ref, we do NOTHING here — the existing token-side burst + the +$N MoneyFloat
// already carry the gain. Never throws.
//
// PARK / leak-safety: pure DOM, NO rAF, NO setInterval. Each coin is one element with a
// Web Animations Animation; a single TTL timeout per flight removes the nodes. All live
// timeouts + animations are tracked and cancelled on unmount. Reduced motion → no fly at
// all (the CountUp snaps instantly via its own reduced path).
// ============================================================================

const EMPTY = Object.freeze({ id: null, amount: 0, nonce: 0 })
const COINS_MIN = 5
const COINS_MAX = 12
const FLIGHT_MS = 620 // landing window ~ the gain CountUp (460ms) + a little, so they settle together
const STAGGER_MS = 40 // per-coin launch stagger → a stream, not a clump
const COIN_PX = 16

// How many coins for a gain — more for a bigger payoff, capped so it never clutters.
function coinCount(amount) {
  const n = Math.round(COINS_MIN + Math.log10(Math.max(1, amount)) * 2.4)
  return Math.max(COINS_MIN, Math.min(COINS_MAX, n))
}

export default function CoinFlyLayer({ store, getTokenPos, getCardEl, reducedMotion = false }) {
  const sub = store?.coin?.subscribe || ((cb) => { cb(); return () => {} })
  const get = store?.coin?.get || (() => EMPTY)
  const sig = useSyncExternalStore(sub, get)

  const layerRef = useRef(null)
  const lastNonceRef = useRef(0)
  const timersRef = useRef(new Set())
  const animsRef = useRef(new Set())
  // Keep callbacks/flags current without re-subscribing the effect to them.
  const getTokenPosRef = useRef(getTokenPos); getTokenPosRef.current = getTokenPos
  const getCardElRef = useRef(getCardEl); getCardElRef.current = getCardEl
  const reducedRef = useRef(reducedMotion); reducedRef.current = reducedMotion

  useEffect(() => {
    if (!sig || !sig.id || sig.nonce === lastNonceRef.current) return
    lastNonceRef.current = sig.nonce
    if (reducedRef.current) return // calm path: the card CountUp snaps; no fly
    const layer = layerRef.current
    if (!layer) return

    // Source = token's viewport pos; destination = the player's card centre. Either
    // missing (2D-Lite / off-screen / no card) → bail; the token-side burst carries it.
    const from = getTokenPosRef.current?.(sig.id)
    const cardEl = getCardElRef.current?.(sig.id)
    if (!from || !cardEl) return
    const cr = cardEl.getBoundingClientRect()
    if (!cr.width || !cr.height) return
    const to = { x: cr.left + cr.width / 2, y: cr.top + cr.height / 2 }

    const n = coinCount(sig.amount)
    for (let i = 0; i < n; i++) {
      const coin = document.createElement('span')
      coin.className = 'mono-coinfly'
      // small launch jitter so coins don't perfectly overlap at the source
      const jx = (Math.random() - 0.5) * 26
      const jy = (Math.random() - 0.5) * 26
      coin.style.left = `${from.x + jx - COIN_PX / 2}px`
      coin.style.top = `${from.y + jy - COIN_PX / 2}px`
      layer.appendChild(coin)

      const dx = to.x - (from.x + jx)
      const dy = to.y - (from.y + jy)
      // a gentle arc: rise a touch at mid-flight before homing into the card
      const arcY = -40 - Math.random() * 30
      const delay = i * STAGGER_MS
      let anim
      try {
        anim = coin.animate(
          [
            { transform: 'translate(0,0) scale(1)', opacity: 1, offset: 0 },
            { transform: `translate(${dx * 0.5}px, ${dy * 0.5 + arcY}px) scale(1.05)`, opacity: 1, offset: 0.55 },
            { transform: `translate(${dx}px, ${dy}px) scale(.55)`, opacity: 0.2, offset: 1 },
          ],
          { duration: FLIGHT_MS, delay, easing: 'cubic-bezier(.4,.05,.5,1)', fill: 'forwards' },
        )
      } catch {
        // Web Animations unavailable → just drop the node (no fly; gain still shown via floats).
        coin.remove(); continue
      }
      animsRef.current.add(anim)
      const cleanup = () => {
        animsRef.current.delete(anim)
        try { coin.remove() } catch { /* already gone */ }
      }
      anim.onfinish = cleanup
      anim.oncancel = cleanup
    }

    // Belt-and-braces TTL: if an Animation's finish never fires (tab throttling),
    // sweep the layer clean after the longest flight + stagger.
    const ttl = FLIGHT_MS + STAGGER_MS * n + 120
    const sweep = setTimeout(() => {
      timersRef.current.delete(sweep)
      const l = layerRef.current
      if (l) while (l.firstChild) l.removeChild(l.firstChild)
    }, ttl)
    timersRef.current.add(sweep)
  }, [sig])

  // Cancel all animations + timers + clear nodes on unmount (no leaks, no late mutation).
  useEffect(() => {
    const timers = timersRef.current
    const anims = animsRef.current
    return () => {
      for (const tm of timers) clearTimeout(tm)
      timers.clear()
      for (const a of anims) { try { a.cancel() } catch { /* gone */ } }
      anims.clear()
    }
  }, [])

  return <div className="mono-coinfly-layer" aria-hidden ref={layerRef} />
}
