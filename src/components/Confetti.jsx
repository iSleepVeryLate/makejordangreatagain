import { useMemo } from 'react'

const COLORS = ['#22c277', '#18a361', '#e4002b', '#f0b428', '#ffffff']

// Lightweight one-shot celebration burst. Pure CSS animation, no canvas/deps.
// Renders nothing when the user prefers reduced motion.
export default function Confetti({ count = 46 }) {
  const reduced =
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.25,
        duration: 1.7 + Math.random() * 1.4,
        bg: COLORS[i % COLORS.length],
        size: 6 + Math.random() * 6,
        drift: (Math.random() - 0.5) * 60,
      })),
    [count],
  )

  if (reduced) return null

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 0.5}px`,
            background: p.bg,
            '--drift': `${p.drift}px`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  )
}
