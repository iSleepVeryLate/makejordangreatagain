import { memo, useSyncExternalStore } from 'react'

// Floating +N / −N cash deltas, anchored at the player's token (% coords baked in
// by the animator at fire time). Subscribes to the animator's float slice only,
// so a money pop never re-renders the board or the log. Sits above the tokens.
function MoneyFloatLayer({ store }) {
  const floats = useSyncExternalStore(store.floats.subscribe, store.floats.get)
  return (
    <div className="mono-float-layer" aria-hidden>
      {floats.map((f) => (
        <span
          key={f.key}
          className={`mono-float ${f.amount > 0 ? 'pos' : 'neg'}`}
          style={{ left: `${f.x}%`, top: `${f.y}%` }}
        >
          {f.amount > 0 ? '+' : '−'}{Math.abs(f.amount)}
        </span>
      ))}
    </div>
  )
}

export default memo(MoneyFloatLayer)
