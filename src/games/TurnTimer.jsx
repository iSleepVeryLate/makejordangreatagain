import { useEffect, useState, memo } from 'react'

// Self-contained countdown for the current phase. It owns its OWN `now` ticking
// so the rest of MonopolyGame (the 40-tile board, log, player cards) doesn't
// re-render twice a second just to nudge a width %. A coarse 250ms interval is
// plenty smooth for the bar and the whole-second readout.
function TurnTimer({ phaseEndsAt, turnSeconds, serverNow }) {
  // Use the server-skew-corrected clock (the same offset pumpIfDue fires on) so the
  // displayed countdown matches the real deadline even if the device clock is off.
  const clock = () => (serverNow ? serverNow() : Date.now())
  const [now, setNow] = useState(clock)

  useEffect(() => {
    if (!phaseEndsAt) return undefined
    setNow(clock())
    const i = setInterval(() => setNow(clock()), 250)
    return () => clearInterval(i)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseEndsAt, serverNow])

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
