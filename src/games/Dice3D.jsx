import { memo } from 'react'

// A real CSS-3D cube. Six faces (opposite faces sum to 7) sit on the sides of a
// `preserve-3d` cube; `FACE_ROTATION[value]` rotates the cube so that value's
// face comes forward. While `rolling` it tumbles via a CSS @keyframes; on settle
// the inline transform takes over and the .d3d-cube transition bounces it home.
// Honors prefers-reduced-motion (handled in CSS: no tumble, instant face).

const FACE_ROTATION = {
  1: 'rotateX(-8deg) rotateY(8deg)', // tiny tilt so it reads as 3D, not flat
  2: 'rotateX(-90deg)',
  3: 'rotateY(-90deg)',
  4: 'rotateY(90deg)',
  5: 'rotateX(90deg)',
  6: 'rotateY(180deg)',
}

// Face placement around the cube + which value each carries.
const FACES = [
  { n: 1, t: 'rotateY(0deg)' },
  { n: 6, t: 'rotateY(180deg)' },
  { n: 3, t: 'rotateY(90deg)' },
  { n: 4, t: 'rotateY(-90deg)' },
  { n: 2, t: 'rotateX(90deg)' },
  { n: 5, t: 'rotateX(-90deg)' },
]

// 3×3 cell indices that carry a pip for each die value.
const PIPS = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

function Face({ n, t }) {
  const on = PIPS[n] || []
  return (
    <span className="d3d-face" style={{ transform: `${t} translateZ(var(--d3d-half))` }}>
      {Array.from({ length: 9 }).map((_, i) => (
        <span key={i} className={`d3d-pip${on.includes(i) ? ' on' : ''}`} />
      ))}
    </span>
  )
}

function Dice3D({ value, rolling }) {
  const v = value || 1
  return (
    <div className="d3d-scene" aria-hidden>
      <div
        className={`d3d-cube${rolling ? ' rolling' : ''}`}
        style={rolling ? undefined : { transform: FACE_ROTATION[v] }}
      >
        {FACES.map((f) => <Face key={f.n} n={f.n} t={f.t} />)}
      </div>
    </div>
  )
}

export default memo(Dice3D)
