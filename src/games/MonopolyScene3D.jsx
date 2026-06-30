import { useEffect, useRef, useSyncExternalStore } from 'react'

// Stable empty token slice for the pre-mount / no-store fallback (avoids allocating
// a fresh literal on every players/store effect run).
const EMPTY_TOK = Object.freeze({ pos: {}, hopSeq: {}, mode: {}, active: null })
const EMPTY_ROLL = Object.freeze({ show: false, a: null, b: null, from: null, to: null, path: [], active: null, nonce: 0 })

// React wrapper around the framework-agnostic Scene3D. It mounts a <canvas>, and
// LAZY-imports the Three.js scene (so `three` stays out of the bundle until a 3D
// game actually starts — the lobby never pulls WebGL). The animator store slices
// and room/properties drive imperative scene setters in later phases; Phase 0
// renders the static baked board and routes tile clicks through the raycaster.
//
// The center action UI (renderCenter) is passed as `children` and overlaid as DOM
// above the canvas — crisp text, same handlers as the 2D path.
export default function MonopolyScene3D({
  onTile, store, reducedMotion, lang, onContextLost, children, moment = null, debug = false,
  players = [], properties = [], playerColor = {}, activeTile = null, auctionTile = null, activeColor = null,
  sceneApiRef = null,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const sceneRef = useRef(null)
  const onTileRef = useRef(onTile); onTileRef.current = onTile
  const onLostRef = useRef(onContextLost); onLostRef.current = onContextLost
  const reducedRef = useRef(reducedMotion); reducedRef.current = reducedMotion
  const playersRef = useRef(players); playersRef.current = players
  const bldRef = useRef(null); bldRef.current = { properties, playerColor, activeTile, auctionTile, activeColor }

  // The roll readout + destination/path slice. Subscribed here so the DOM readout
  // overlay re-renders on each roll/clear WITHOUT touching MonopolyGame's render path,
  // and so the 3D destination/path highlight is fed imperatively to the scene.
  const roll = useSyncExternalStore(
    store?.roll?.subscribe || ((cb) => { cb(); return () => {} }),
    store?.roll?.get || (() => EMPTY_ROLL),
  )

  // Mount (re-mount on language change so the baked tile labels follow the locale).
  useEffect(() => {
    let disposed = false
    let scene = null
    let pump = 0
    let unsub = null
    let unsubDice = null
    let unsubRoll = null
    let unsubCoin = null
    import('./three/Scene3D.js').then(({ default: Scene3D }) => {
      if (disposed || !canvasRef.current) return
      scene = new Scene3D({
        reducedMotion: reducedRef.current,
        lang,
        onContextLost: () => onLostRef.current?.(),
        preserveDrawingBuffer: debug, // dev harness only — keeps frames screenshot-able
      })
      scene.mount(canvasRef.current)
      sceneRef.current = scene
      if (__DEV_SERVER__ && typeof window !== 'undefined') window.__mono3d = scene
      // Drive the 3D pieces from the animator's token slice (read-only). Initial
      // sync + subscribe to every hop/glide/active change.
      if (store?.tokens) {
        scene.syncTokens(store.tokens.get(), playersRef.current)
        unsub = store.tokens.subscribe(() => scene.syncTokens(store.tokens.get(), playersRef.current))
      }
      // Drive the 3D dice from the animator's dice slice (tumble → settle to faces).
      if (store?.dice) {
        scene.syncDice(store.dice.get())
        unsubDice = store.dice.subscribe(() => scene.syncDice(store.dice.get()))
      }
      // Initial buildings / ownership / highlight state.
      const b = bldRef.current
      scene.syncBuildings(b.properties, b.playerColor, b.activeTile, b.auctionTile, b.activeColor)
      // Drive the destination/path "you'll land here" highlight from the roll slice.
      // Initial sync + subscribe to every roll/clear.
      if (store?.roll) {
        scene.syncRoll(store.roll.get(), b.playerColor)
        unsubRoll = store.roll.subscribe(() => scene.syncRoll(store.roll.get(), bldRef.current.playerColor))
      }
      // G3 — fire the gold coin-reward burst at the gaining token on each cash-gain edge.
      // Subscribe only (no initial fire — the mount snapshot isn't a "gain"); the nonce
      // bump on pushCoin re-triggers even for an identical id+amount. Park-safe downstream.
      if (store?.coin) {
        unsubCoin = store.coin.subscribe(() => { const c = store.coin.get(); if (c.id) scene.coinReward(c.id) })
      }
      // Dev harness: the headless preview tab pauses rAF, so pump renders on a timer.
      if (debug) pump = setInterval(() => scene.forceRender(), 250)
    }, () => {
      // The lazy three chunk (~134KB gz) failed to load (offline / network) →
      // fall back to the 2D renderer instead of a permanently blank board.
      if (!disposed) onLostRef.current?.()
    })
    return () => {
      disposed = true
      if (pump) clearInterval(pump)
      if (unsub) unsub()
      if (unsubDice) unsubDice()
      if (unsubRoll) unsubRoll()
      if (unsubCoin) unsubCoin()
      scene?.dispose()
      sceneRef.current = null
      if (__DEV_SERVER__ && typeof window !== 'undefined' && window.__mono3d === scene) window.__mono3d = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  useEffect(() => { sceneRef.current?.setReducedMotion(reducedMotion) }, [reducedMotion])

  // ITEM 4 — expose a tiny imperative API to the parent (MonopolyGame) so the HUD can fly
  // coins FROM a token into its balance card. tokenViewportPos returns the token's screen
  // position in VIEWPORT px (canvas-relative project() + the canvas rect offset), or null
  // if unavailable / off-screen → the caller then falls back to the token-side burst.
  // Populated on mount, cleared on unmount so a stale ref can't point at a disposed scene.
  useEffect(() => {
    if (!sceneApiRef) return undefined
    sceneApiRef.current = {
      tokenViewportPos: (id) => {
        const scene = sceneRef.current
        const canvas = canvasRef.current
        if (!scene || !canvas) return null
        const p = scene.tokenScreenPos(id)
        if (!p || !p.visible) return null
        const r = canvas.getBoundingClientRect()
        if (!r.width || !r.height) return null
        return { x: r.left + p.x, y: r.top + p.y }
      },
    }
    return () => { if (sceneApiRef.current && sceneApiRef.current.tokenViewportPos) sceneApiRef.current = null }
  }, [sceneApiRef])

  // Re-sync pieces when the player list changes (join / bankruptcy) even without a
  // token-slice tick, so meshes are added/removed to match.
  useEffect(() => { sceneRef.current?.syncTokens(store?.tokens?.get?.() || EMPTY_TOK, players) }, [players, store])

  // Re-sync buildings / ownership / mortgage / highlights on any property or turn change.
  useEffect(() => { sceneRef.current?.syncBuildings(properties, playerColor, activeTile, auctionTile, activeColor) }, [properties, playerColor, activeTile, auctionTile, activeColor])

  const handleClick = (e) => {
    const scene = sceneRef.current
    const canvas = canvasRef.current
    if (!scene || !canvas) return
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return
    const ndcX = ((e.clientX - r.left) / r.width) * 2 - 1
    const ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1)
    const idx = scene.raycast(ndcX, ndcY)
    if (idx != null) onTileRef.current?.(idx)
  }

  return (
    <div className="mono-board-3d" ref={wrapRef} dir="ltr">
      <canvas ref={canvasRef} className="mono-canvas" aria-hidden="true" onClick={handleClick} />
      {/* PROMINENT ROLL READOUT — pops on dice settle, auto-dismisses when the move ends
          (the roll slice clears). A pure DOM overlay → no effect on the WebGL loop. */}
      {roll.show && roll.a != null && roll.b != null && (
        <div className="mono-roll-readout" role="status" aria-live="polite" key={roll.nonce}>
          <span className="mono-roll-die">🎲</span>
          <span className="mono-roll-eq"><b>{roll.a}</b> + <b>{roll.b}</b> = <strong>{roll.a + roll.b}</strong></span>
        </div>
      )}
      <div className="mono-center-3d">{children}</div>
      {/* Decision-moment overlay lives INSIDE the board box so its scrim hugs the
          board exactly (not the wider stage track). It sets its own dir. */}
      {moment}
    </div>
  )
}
