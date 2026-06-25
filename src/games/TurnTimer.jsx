import { useEffect, useState, memo } from 'react'

// Self-contained countdown bar for the current phase. It owns its OWN `now`
// ticking so the rest of MonopolyGame (the 40-tile board, log, player chips)
// doesn't re-render twice a second just to nudge a width %. The bar is a coarse
// percentage, so a 250ms interval is plenty smooth and near-free; rAF would fire
// ~60fps to move the bar <0.5%/frame — pure waste.
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
  return (
    <div className="draw-timer-bar mono-timer"><span style={{ width: `${pct}%` }} /></div>
  )
}

export default memo(TurnTimer)
