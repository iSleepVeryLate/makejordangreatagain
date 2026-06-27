import { memo, useSyncExternalStore } from 'react'
import { tokenMeta } from './monopolyTokens.js'
import { CENTERS } from './monopolyGeometry.js'

// Absolutely-positioned overlay above the board grid. Each player is ONE
// persistent element (keyed by profile_id) whose left/top % come from the
// ANIMATOR's token slice (the *rendered* position, which lags authoritative
// `position` during a tile-by-tile walk) — not from raw player.position. The
// outer element slides between tiles via CSS transition; a tiny inner span
// re-keys on each hop to retrigger the bounce. Subscribing to the slice here
// (not props) means a hop re-renders only this layer, never the 40 tiles.

// Fan-out offsets (px) so multiple tokens sharing a tile don't fully overlap.
const STACK = [[0, 0], [9, -7], [-9, 7], [9, 7], [-9, -7], [0, 11], [11, 1], [-11, 1]]

function TokenLayer({ players, store }) {
  const tok = useSyncExternalStore(store.tokens.subscribe, store.tokens.get)

  // Stack by RENDERED position so a tile's pieces fan out as they arrive.
  const renderedPos = {}
  for (const p of players) {
    if (p.bankrupt) continue
    renderedPos[p.profile_id] = tok.pos[p.profile_id] ?? p.position
  }
  const stackIdx = {}
  const counts = {}
  for (const p of players) {
    if (p.bankrupt) continue
    const pos = renderedPos[p.profile_id]
    const n = counts[pos] || 0
    stackIdx[p.profile_id] = n
    counts[pos] = n + 1
  }

  return (
    <div className="mono-token-layer" aria-hidden>
      {players.map((p) => {
        if (p.bankrupt) return null
        const pos = renderedPos[p.profile_id]
        const c = CENTERS[pos] || CENTERS[0]
        const [dx, dy] = STACK[stackIdx[p.profile_id] % STACK.length]
        const meta = tokenMeta(p.token)
        const mode = tok.mode[p.profile_id]
        const hopSeq = tok.hopSeq[p.profile_id] || 0
        const active = tok.active === p.profile_id
        return (
          <span
            key={p.profile_id}
            className={`mono-token-fly${active ? ' active' : ''}`}
            style={{
              left: `${c.x}%`,
              top: `${c.y}%`,
              transitionDuration: mode === 'glide' ? '0.46s' : '0.16s',
              transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)`,
              '--tok': meta.color,
            }}
            title={p.token}
          >
            <span key={hopSeq} className="mono-token-hop">{meta.emoji}</span>
          </span>
        )
      })}
    </div>
  )
}

export default memo(TokenLayer)
