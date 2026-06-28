import { useId } from 'react'
import MjgaLogo from './MjgaLogo.jsx'

// Flat-vector product mockups. Each garment is drawn as an SVG silhouette in the
// selected colourway, then the MJGA wordmark is composited on top via a CSS-
// positioned overlay (see shop.css `.pa-logo`). This gives us real, recolourable
// product imagery built from the same logo — no photography needed.

const FABRIC = {
  black: { base: '#2a2e35', shade: '#16181d', seam: '#0d0f12', rib: '#33373f', halo: 'rgba(255,255,255,.16)' },
  white: { base: '#f1f3f5', shade: '#d4d8dd', seam: '#bcc1c8', rib: '#e6e9ec', halo: 'rgba(0,0,0,.20)' },
  sand: { base: '#d6c7ab', shade: '#bba886', seam: '#9c8b68', rib: '#ddd0b8', halo: 'rgba(0,0,0,.18)' },
  olive: { base: '#646b50', shade: '#474d38', seam: '#353a2a', rib: '#6d7457', halo: 'rgba(255,255,255,.12)' },
}

// shared gradient/shadow defs for one garment instance
function Defs({ id, f }) {
  return (
    <defs>
      <linearGradient id={`${id}-b`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={f.base} />
        <stop offset="1" stopColor={f.shade} />
      </linearGradient>
      <linearGradient id={`${id}-l`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#fff" stopOpacity="0.07" />
        <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.16" />
      </linearGradient>
    </defs>
  )
}

function Tee({ f, sleeves = 'short' }) {
  const id = useId().replace(/[:]/g, '')
  const body = `url(#${id}-b)`
  const light = `url(#${id}-l)`
  const long = sleeves === 'long'
  // sleeves are drawn first so the torso seam overlaps them
  const leftSleeve = long
    ? 'M104 88 L72 98 L60 250 L98 256 L112 122 Z'
    : 'M106 86 L70 94 L56 132 L94 140 L114 104 Z'
  const rightSleeve = long
    ? 'M216 88 L248 98 L260 250 L222 256 L208 122 Z'
    : 'M214 86 L250 94 L264 132 L226 140 L206 104 Z'
  return (
    <svg className="garment" viewBox="0 0 320 300" xmlns="http://www.w3.org/2000/svg">
      <Defs id={id} f={f} />
      <path d={leftSleeve} fill={body} stroke={f.seam} strokeWidth="2" />
      <path d={rightSleeve} fill={body} stroke={f.seam} strokeWidth="2" />
      {/* torso */}
      <path
        d="M106 92 C106 82 114 76 126 74 C142 92 178 92 194 74 C206 76 214 82 214 92 L222 266 C222 272 218 276 212 276 L108 276 C102 276 98 272 98 266 Z"
        fill={body}
        stroke={f.seam}
        strokeWidth="2"
      />
      <path
        d="M106 92 C106 82 114 76 126 74 C142 92 178 92 194 74 C206 76 214 82 214 92 L222 266 C222 272 218 276 212 276 L108 276 C102 276 98 272 98 266 Z"
        fill={light}
      />
      {/* crew collar */}
      <path d="M126 74 C142 92 178 92 194 74" fill="none" stroke={f.rib} strokeWidth="7" strokeLinecap="round" />
      <path d="M129 79 C143 94 177 94 191 79" fill="none" stroke={f.seam} strokeWidth="2" />
      {/* hem + cuffs */}
      <path d="M104 262 L216 262" stroke={f.seam} strokeWidth="2" opacity="0.7" />
      {long ? (
        <>
          <path d="M62 248 L100 254" stroke={f.rib} strokeWidth="6" strokeLinecap="round" />
          <path d="M258 248 L220 254" stroke={f.rib} strokeWidth="6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M60 128 L92 136" stroke={f.seam} strokeWidth="2" opacity="0.7" />
          <path d="M260 128 L228 136" stroke={f.seam} strokeWidth="2" opacity="0.7" />
        </>
      )}
    </svg>
  )
}

function Polo({ f }) {
  const id = useId().replace(/[:]/g, '')
  const body = `url(#${id}-b)`
  const light = `url(#${id}-l)`
  return (
    <svg className="garment" viewBox="0 0 320 300" xmlns="http://www.w3.org/2000/svg">
      <Defs id={id} f={f} />
      <path d="M106 86 L70 94 L56 132 L94 140 L114 104 Z" fill={body} stroke={f.seam} strokeWidth="2" />
      <path d="M214 86 L250 94 L264 132 L226 140 L206 104 Z" fill={body} stroke={f.seam} strokeWidth="2" />
      <path
        d="M108 96 C108 86 116 80 128 78 L142 92 L160 132 L178 92 L192 78 C204 80 212 86 212 96 L220 266 C220 272 216 276 210 276 L110 276 C104 276 100 272 100 266 Z"
        fill={body}
        stroke={f.seam}
        strokeWidth="2"
      />
      <path
        d="M108 96 C108 86 116 80 128 78 L142 92 L160 132 L178 92 L192 78 C204 80 212 86 212 96 L220 266 C220 272 216 276 210 276 L110 276 C104 276 100 272 100 266 Z"
        fill={light}
      />
      {/* placket + buttons */}
      <rect x="152" y="92" width="16" height="46" rx="3" fill={f.shade} stroke={f.seam} strokeWidth="1.5" />
      <circle cx="160" cy="104" r="2.6" fill={f.rib} />
      <circle cx="160" cy="124" r="2.6" fill={f.rib} />
      {/* collar flaps */}
      <path d="M128 78 L142 92 L160 96 L144 80 Z" fill={f.rib} stroke={f.seam} strokeWidth="1.5" />
      <path d="M192 78 L178 92 L160 96 L176 80 Z" fill={f.rib} stroke={f.seam} strokeWidth="1.5" />
      <path d="M104 262 L216 262" stroke={f.seam} strokeWidth="2" opacity="0.7" />
    </svg>
  )
}

function Hoodie({ f }) {
  const id = useId().replace(/[:]/g, '')
  const body = `url(#${id}-b)`
  const light = `url(#${id}-l)`
  return (
    <svg className="garment" viewBox="0 0 320 300" xmlns="http://www.w3.org/2000/svg">
      <Defs id={id} f={f} />
      {/* long sleeves */}
      <path d="M100 96 L66 106 L54 252 L96 258 L112 128 Z" fill={body} stroke={f.seam} strokeWidth="2" />
      <path d="M220 96 L254 106 L266 252 L224 258 L208 128 Z" fill={body} stroke={f.seam} strokeWidth="2" />
      {/* hood behind shoulders */}
      <path
        d="M122 86 C118 50 142 34 160 34 C178 34 202 50 198 86 C182 74 138 74 122 86 Z"
        fill={f.shade}
        stroke={f.seam}
        strokeWidth="2"
      />
      <path d="M134 80 C150 70 170 70 186 80 C176 96 144 96 134 80 Z" fill={f.seam} opacity="0.6" />
      {/* torso */}
      <path
        d="M104 100 C104 90 112 84 124 82 C140 104 180 104 196 82 C208 84 216 90 216 100 L224 268 C224 274 220 278 214 278 L106 278 C100 278 96 274 96 268 Z"
        fill={body}
        stroke={f.seam}
        strokeWidth="2"
      />
      <path
        d="M104 100 C104 90 112 84 124 82 C140 104 180 104 196 82 C208 84 216 90 216 100 L224 268 C224 274 220 278 214 278 L106 278 C100 278 96 274 96 268 Z"
        fill={light}
      />
      {/* drawstrings */}
      <path d="M146 96 L142 150" stroke={f.rib} strokeWidth="3.5" strokeLinecap="round" />
      <path d="M174 96 L178 150" stroke={f.rib} strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="142" cy="152" r="3.4" fill={f.rib} />
      <circle cx="178" cy="152" r="3.4" fill={f.rib} />
      {/* kangaroo pocket */}
      <path d="M118 206 L202 206 L210 250 L110 250 Z" fill="none" stroke={f.seam} strokeWidth="2" opacity="0.8" />
      <path d="M122 210 L138 246" stroke={f.seam} strokeWidth="2" opacity="0.6" />
      <path d="M198 210 L182 246" stroke={f.seam} strokeWidth="2" opacity="0.6" />
      {/* ribbed hem + cuffs */}
      <rect x="96" y="266" width="128" height="12" rx="3" fill={f.rib} opacity="0.5" />
      <path d="M56 246 L98 252" stroke={f.rib} strokeWidth="7" strokeLinecap="round" />
      <path d="M264 246 L222 252" stroke={f.rib} strokeWidth="7" strokeLinecap="round" />
    </svg>
  )
}

function Cap({ f }) {
  const id = useId().replace(/[:]/g, '')
  const body = `url(#${id}-b)`
  const light = `url(#${id}-l)`
  return (
    <svg className="garment" viewBox="0 0 320 230" xmlns="http://www.w3.org/2000/svg">
      <Defs id={id} f={f} />
      {/* brim / peak */}
      <path
        d="M58 150 C104 184 236 184 280 150 C282 158 276 166 262 170 C212 186 116 186 70 170 C58 166 56 158 58 150 Z"
        fill={f.shade}
        stroke={f.seam}
        strokeWidth="2"
      />
      <path d="M64 152 C108 178 232 178 274 152" fill="none" stroke={f.seam} strokeWidth="2" opacity="0.5" />
      {/* crown */}
      <path
        d="M62 150 C62 82 102 44 166 44 C230 44 268 82 268 150 C232 162 98 162 62 150 Z"
        fill={body}
        stroke={f.seam}
        strokeWidth="2"
      />
      <path
        d="M62 150 C62 82 102 44 166 44 C230 44 268 82 268 150 C232 162 98 162 62 150 Z"
        fill={light}
      />
      {/* panel seams */}
      <path d="M166 46 C166 96 166 130 166 152" stroke={f.seam} strokeWidth="2" opacity="0.4" />
      <path d="M118 52 C126 100 130 132 132 152" stroke={f.seam} strokeWidth="2" opacity="0.4" />
      <path d="M214 52 C206 100 202 132 200 152" stroke={f.seam} strokeWidth="2" opacity="0.4" />
      {/* top button + eyelets */}
      <circle cx="166" cy="48" r="5" fill={f.rib} stroke={f.seam} strokeWidth="1.5" />
      <circle cx="142" cy="78" r="2.4" fill={f.seam} opacity="0.5" />
      <circle cx="190" cy="78" r="2.4" fill={f.seam} opacity="0.5" />
    </svg>
  )
}

const GARMENTS = {
  cap: (p) => <Cap {...p} />,
  tee: (p) => <Tee {...p} />,
  polo: (p) => <Polo {...p} />,
  hoodie: (p) => <Hoodie {...p} />,
  longsleeve: (p) => <Tee {...p} sleeves="long" />,
}

export default function ProductArt({
  type = 'tee',
  color = 'black',
  placement = 'center',
  logoVariant = 'flag',
  className = '',
}) {
  const f = FABRIC[color] || FABRIC.black
  const render = GARMENTS[type] || GARMENTS.tee
  return (
    <div className={`pa ${className}`} data-type={type} data-placement={placement}>
      {render({ f })}
      <span className="pa-logo">
        <MjgaLogo variant={logoVariant} outline={f.halo} fill={f.seam} />
      </span>
    </div>
  )
}

export { FABRIC }
