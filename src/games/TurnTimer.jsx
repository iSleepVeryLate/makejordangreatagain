import { useEffect, useState, memo } from 'react'

// Self-contained countdown for the current phase. It owns its OWN `now` ticking
// so the rest of MonopolyGame (the 40-tile board, log, player cards) doesn't
// re-render twice a second just to nudge a width %. A coarse 250ms interval is
// plenty smooth for the bar and the whole-second readout.
function TurnTimer({ phaseEndsAt, turnSeconds }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!phaseEndsAt) return undefined
    setNow(Date.now())
    const i = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(i)
  }, [phaseEndsAt])

  if (!phaseEndsAt) return null
  const remaining = Math.max(0, (new Date(phaseEndsAt).getTime() - now) / 1000)
  const pct = Math.min(100, (remaining / (turnSeconds || 1)) * 100)
  const low = remaining <= 10
  return (
    <div className={`mono-timer-wrap${low ? ' low' : ''}`}>
      <div className="draw-timer-bar mono-timer"><span style={{ width: `${pct}%` }} /></div>
      <span className="mono-timer-num">{Math.ceil(remaining)}s</span>
    </div>
  )
}

export default memo(TurnTimer)
