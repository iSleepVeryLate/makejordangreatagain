import { useId } from 'react'

// The MJGA wordmark — the brand logo printed on every product. The letters are
// clipped out of the Jordan flag (black/white/green bands + red triangle + white
// star), so "MJGA" reads as the flag itself. Same flag palette as <Mark>.
//   variant 'flag'  → full-colour flag fill (the hero look)
//   variant 'tonal' → tone-on-tone, for an embroidered / subtle treatment
const STAR =
  'M12 2l2.6 6.3 6.8.5-5.2 4.4 1.7 6.6L12 16.8 6.1 20.3l1.7-6.6L2.6 8.8l6.8-.5z'

// One source of truth for the letter geometry so the clip path and the legibility
// halo line up to the pixel.
function Word(props) {
  return (
    <text
      x="6"
      y="72"
      textAnchor="start"
      fontFamily="'Plus Jakarta Sans', system-ui, -apple-system, sans-serif"
      fontWeight="800"
      fontSize="76"
      letterSpacing="-3"
      {...props}
    >
      MJGA
    </text>
  )
}

export default function MjgaLogo({
  variant = 'flag',
  fill = '#11131a', // letter colour for the tonal variant
  outline = null, // optional halo so the mark seats on busy fabric
  className,
  ariaLabel = 'MJGA',
}) {
  const clipId = `mjga-${useId().replace(/[:]/g, '')}`
  return (
    <svg
      viewBox="0 0 240 92"
      className={className}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id={clipId}>
          <Word />
        </clipPath>
      </defs>

      {outline && (
        <Word fill="none" stroke={outline} strokeWidth="7" strokeLinejoin="round" />
      )}

      {variant === 'flag' ? (
        <g clipPath={`url(#${clipId})`}>
          <rect x="0" y="8" width="240" height="24" fill="#111315" />
          <rect x="0" y="32" width="240" height="24" fill="#ffffff" />
          <rect x="0" y="56" width="240" height="30" fill="#18a361" />
          <path d="M2 8 L96 47 L2 86 Z" fill="#e4002b" />
          <path d={STAR} transform="translate(11,26) scale(1.7)" fill="#ffffff" />
        </g>
      ) : (
        <Word fill={fill} />
      )}
    </svg>
  )
}
