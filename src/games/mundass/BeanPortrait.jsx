import { useEffect, useRef } from 'react'
import { paintPortrait } from './beanArt.js'
import { COLORS } from './map.js'

// A little canvas bust of the shemagh bean in a player's color — used on
// meeting cards, the lobby list, and the end screen so the in-world character
// is the player's identity everywhere.
export default function BeanPortrait({ colorIndex = 0, ghost = false, size = 40, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    paintPortrait(ref.current, COLORS[(colorIndex || 0) % COLORS.length], { ghost, size })
  }, [colorIndex, ghost, size])
  return (
    <canvas
      ref={ref}
      className={`mun-portrait ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    />
  )
}
