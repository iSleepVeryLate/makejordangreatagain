import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATIONS } from './map.js'
import { sound } from '../../lib/sound.js'

// المندس task minigames — eleven little machines, each a real (5-20s) game with
// skill, feedback, and a failure state, not a button to press:
//
//   wires      drag live wires across a panel to their matching terminals
//   tea        load the pot, then lift it off the بابور at the boil — or it boils over
//   satellite  tune azimuth + elevation until the TV static clears, hold the lock
//   laundry    drag clothes up onto a SWAYING line, pin by pin
//   coffee     دقّ المهباش on the beat — off-beat knocks don't grind
//   plants     carry the watering can pot to pot and pour until each blooms
//   olives     shake olives loose and catch them with a moving basket
//   shelf      memorize the shelf, then restore it (with a decoy item)
//   gas        close the valve (real rotation), swap the jarrah, open, flame on
//   water      hold the tap only while the pressure needle is in the good zone
//   fix        flip every breaker ON while tripped switches fight back
//
// All pointer-driven (mouse + touch identical), no dependencies, coordinates in
// explicit LTR pixels so RTL page direction never mirrors a mechanism.
// Everything here is modal-scoped and short-lived — tiny interval loops are fine.

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const L = (lang, en, ar) => (lang === 'ar' ? ar : en)

// Best-effort pointer capture. setPointerCapture THROWS (NotFoundError) when
// the pointer is no longer active by the time the handler runs — real thing on
// fast taps / pens / some webviews — and it sits at the TOP of every drag
// handler, so an uncaught throw silently kills the whole minigame. Capture is
// an optimization (drag keeps tracking outside the field), never a requirement.
function capturePointer(el, e) {
  try { el?.setPointerCapture?.(e.pointerId) } catch { /* keep the drag alive */ }
}

/** win() → brief final-state beat → onDone (the modal adds its ✓ flash after). */
function useWin(onDone) {
  const [won, setWon] = useState(false)
  const firedRef = useRef(false)
  const win = useCallback(() => {
    if (firedRef.current) return
    firedRef.current = true
    setWon(true)
    setTimeout(onDone, 350)
  }, [onDone])
  return [won, win]
}

/** Pointer position relative to an element, clamped inside it. */
function relPos(e, el) {
  const r = el.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(r.width, e.clientX - r.left)),
    y: Math.max(0, Math.min(r.height, e.clientY - r.top)),
    w: r.width,
    h: r.height,
  }
}

// =========================================================== 1. WIRES (drag)
const WIRE_COLORS = ['#e23c3c', '#2f7ee0', '#e2b53c', '#3ca85a']

function Wires({ onDone }) {
  const svgRef = useRef(null)
  const [connected, setConnected] = useState({}) // leftIdx -> true
  const [drag, setDrag] = useState(null) // {i, x, y}
  const [won, win] = useWin(onDone)
  const rightOrder = useMemo(() => shuffle([0, 1, 2, 3]), [])
  const W = 340
  const H = 232
  const yFor = (i) => 36 + i * 54
  const rightY = (i) => yFor(rightOrder.indexOf(i))

  const move = (e) => {
    if (!drag) return
    const p = relPos(e, svgRef.current)
    setDrag({ ...drag, x: p.x * (W / p.w), y: p.y * (H / p.h) })
  }
  const drop = () => {
    if (!drag) return
    const i = drag.i
    const ty = rightY(i)
    if (Math.abs(drag.x - (W - 26)) < 46 && Math.abs(drag.y - ty) < 27) {
      sound.play('build')
      const next = { ...connected, [i]: true }
      setConnected(next)
      if (Object.keys(next).length === 4) win()
    }
    setDrag(null)
  }

  return (
    <svg
      ref={svgRef}
      className="mun-g-svg"
      viewBox={`0 0 ${W} ${H}`}
      onPointerMove={move}
      onPointerUp={drop}
      onPointerLeave={drop}
    >
      <rect x="0" y="0" width={W} height={H} rx="12" fill="#232a34" stroke="rgba(255,255,255,.12)" />
      {[0, 1, 2, 3].map((i) => {
        const done = connected[i]
        const c = WIRE_COLORS[i]
        return (
          <g key={i}>
            {/* left nub */}
            <rect
              x="6" y={yFor(i) - 12} width="34" height="24" rx="6" fill={c}
              stroke="rgba(0,0,0,.5)" style={{ cursor: 'grab', touchAction: 'none' }}
              onPointerDown={(e) => {
                if (done || won) return
                capturePointer(e.currentTarget.ownerSVGElement, e)
                const p = relPos(e, svgRef.current)
                setDrag({ i, x: p.x * (W / p.w), y: p.y * (H / p.h) })
              }}
            />
            {/* right terminal */}
            <rect x={W - 40} y={rightY(i) - 12} width="34" height="24" rx="6" fill={c} stroke="rgba(0,0,0,.5)" />
            {/* LED */}
            <circle cx={W - 14} cy={rightY(i) - 18} r="4" fill={done ? '#5dff8a' : '#333'} stroke="rgba(0,0,0,.6)" />
            {/* settled wire */}
            {done && (
              <path
                d={`M 40 ${yFor(i)} C ${W / 2} ${yFor(i)}, ${W / 2} ${rightY(i)}, ${W - 40} ${rightY(i)}`}
                stroke={c} strokeWidth="9" fill="none" strokeLinecap="round"
              />
            )}
            {/* live dragging wire */}
            {drag?.i === i && !done && (
              <path
                d={`M 40 ${yFor(i)} C ${(40 + drag.x) / 2} ${yFor(i)}, ${(40 + drag.x) / 2} ${drag.y}, ${drag.x} ${drag.y}`}
                stroke={c} strokeWidth="9" fill="none" strokeLinecap="round" opacity="0.9"
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ============================================================ 2. TEA (2 acts)
function Tea({ lang, onDone }) {
  const [inPot, setInPot] = useState([]) // ingredient ids
  const [drag, setDrag] = useState(null) // {id, x, y}
  const [boil, setBoil] = useState(0) // 0..110
  const [overs, setOvers] = useState(0)
  const fieldRef = useRef(null)
  const [won, win] = useWin(onDone)
  const items = [
    { id: 'water', icon: '💧', en: 'Water', ar: 'ماء' },
    { id: 'tea', icon: '🍃', en: 'Tea', ar: 'شاي' },
    { id: 'mint', icon: '🌿', en: 'Mint', ar: 'نعنع' },
    { id: 'sugar', icon: '🍬', en: 'Sugar', ar: 'سكر' },
  ]
  const loaded = inPot.length === items.length

  // Act 2: the boil rises on its own — lift the pot inside the band or it
  // boils over and you lose a third of the heat.
  useEffect(() => {
    if (!loaded || won) return undefined
    const iv = setInterval(() => {
      setBoil((b) => {
        const next = b + 1.5 + Math.random() * 1.1
        if (next >= 108) {
          sound.play('tax')
          setOvers((o) => o + 1)
          return 55
        }
        return next
      })
    }, 60)
    return () => clearInterval(iv)
  }, [loaded, won])

  const inBand = boil >= 84 && boil <= 100
  const lift = () => {
    if (!loaded || won) return
    if (inBand) win()
    else {
      sound.play('tax')
      setBoil((b) => Math.max(20, b - 25))
    }
  }

  const move = (e) => {
    if (!drag) return
    const p = relPos(e, fieldRef.current)
    setDrag({ ...drag, x: p.x, y: p.y })
  }
  const drop = (e) => {
    if (!drag) return
    const p = relPos(e, fieldRef.current)
    // pot zone = center
    if (Math.abs(p.x - p.w / 2) < 70 && p.y < p.h * 0.62) {
      sound.play('ui')
      setInPot((s) => (s.includes(drag.id) ? s : [...s, drag.id]))
    }
    setDrag(null)
  }

  return (
    <div className="mun-g-field" ref={fieldRef} onPointerMove={move} onPointerUp={drop}>
      {!loaded ? (
        <>
          <div className="mun-g-hint">{L(lang, 'Drag everything into the pot', 'اسحب كل شي عالبراد')}</div>
          <div className="mun-g-pot">🫖</div>
          <div className="mun-g-potcount">{inPot.length}/4</div>
          <div className="mun-g-tray">
            {items.filter((it) => !inPot.includes(it.id)).map((it) => (
              <button
                key={it.id}
                className="mun-g-ing"
                onPointerDown={(e) => {
                  capturePointer(e.currentTarget, e)
                  const p = relPos(e, fieldRef.current)
                  setDrag({ id: it.id, x: p.x, y: p.y })
                }}
              >
                <span>{it.icon}</span>{L(lang, it.en, it.ar)}
              </button>
            ))}
          </div>
          {drag && (
            <div className="mun-g-dragghost" style={{ left: drag.x, top: drag.y }}>
              {items.find((i) => i.id === drag.id)?.icon}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="mun-g-hint">
            {L(lang, 'Lift it at the boil — not before, not after!', 'ارفعه عالغلوة — لا قبل ولا بعد!')}
            {overs > 0 && <span className="mun-g-oops"> {L(lang, 'It boiled over!', 'فار الشاي!')}</span>}
          </div>
          <div className={`mun-g-pot boiling ${boil > 84 ? 'hard' : ''}`}>🫖</div>
          <div className="mun-g-flame">🔥</div>
          <div className="mun-g-boilmeter">
            <div className="mun-g-boilband" />
            <div className="mun-g-boilfill" style={{ height: `${Math.min(100, boil)}%` }} />
          </div>
          <button className={`mun-g-bigbtn ${inBand ? 'go' : ''}`} onClick={lift}>
            {L(lang, 'Lift the pot!', 'ارفع البراد!')}
          </button>
        </>
      )}
    </div>
  )
}

// ==================================================== 3. SATELLITE (2 dials)
function Satellite({ lang, onDone }) {
  const target = useMemo(() => ({ az: 12 + Math.random() * 76, el: 12 + Math.random() * 76 }), [])
  const [az, setAz] = useState(50)
  const [el, setEl] = useState(50)
  const [lockMs, setLockMs] = useState(0)
  const [won, win] = useWin(onDone)
  const signal = Math.max(0, 100 - (Math.abs(az - target.az) + Math.abs(el - target.el)) * 1.7)
  const locked = signal > 88

  useEffect(() => {
    if (won) return undefined
    const iv = setInterval(() => {
      setLockMs((m) => {
        if (!locked) return 0
        const next = m + 100
        if (next >= 900) win()
        return next
      })
    }, 100)
    return () => clearInterval(iv)
  }, [locked, won, win])

  return (
    <div className="mun-g-center">
      <div className="mun-g-tv">
        <div className="mun-g-static" style={{ opacity: Math.max(0, 1 - signal / 100) }} />
        <div className="mun-g-show" style={{ opacity: Math.max(0, (signal - 40) / 60) }}>📺✨</div>
        <div className={`mun-g-lockbar ${locked ? 'on' : ''}`} style={{ width: `${(lockMs / 900) * 100}%` }} />
      </div>
      <div className="mun-g-signalrow">
        {Array.from({ length: 8 }, (_, i) => (
          <i key={i} className={signal > (i + 1) * 12 ? 'on' : ''} />
        ))}
        <span className="mun-g-signaltxt">{Math.round(signal)}%</span>
      </div>
      <label className="mun-g-sliderlab">🧭 {L(lang, 'Direction', 'الاتجاه')}
        <input type="range" min="0" max="100" step="0.5" value={az} onChange={(e) => setAz(+e.target.value)} className="mun-mg-range" />
      </label>
      <label className="mun-g-sliderlab">📐 {L(lang, 'Tilt', 'الميلان')}
        <input type="range" min="0" max="100" step="0.5" value={el} onChange={(e) => setEl(+e.target.value)} className="mun-mg-range" />
      </label>
    </div>
  )
}

// ================================================== 4. LAUNDRY (sway + drag)
function Laundry({ lang, onDone }) {
  const fieldRef = useRef(null)
  const items = useMemo(() => shuffle(['👕', '👖', '🧦', '🧣']), [])
  const [hung, setHung] = useState({}) // slot -> icon
  const [drag, setDrag] = useState(null) // {icon, x, y}
  const [won, win] = useWin(onDone)
  const remaining = items.filter((ic) => !Object.values(hung).includes(ic))

  const move = (e) => {
    if (!drag) return
    const p = relPos(e, fieldRef.current)
    setDrag({ ...drag, x: p.x, y: p.y })
  }
  const drop = (e) => {
    if (!drag) return
    const p = relPos(e, fieldRef.current)
    if (p.y < p.h * 0.42) {
      const slot = Math.max(0, Math.min(3, Math.floor((p.x / p.w) * 4)))
      if (!hung[slot]) {
        sound.play('ui')
        const next = { ...hung, [slot]: drag.icon }
        setHung(next)
        if (Object.keys(next).length === 4) win()
      }
    }
    setDrag(null)
  }

  return (
    <div className="mun-g-field" ref={fieldRef} onPointerMove={move} onPointerUp={drop}>
      <div className="mun-g-hint">{L(lang, 'Drag each piece up onto the line', 'اسحب كل قطعة وعلّقها عالحبل')}</div>
      <div className="mun-g-line-sway">
        <div className="mun-g-line" />
        {[0, 1, 2, 3].map((s) => (
          <div key={s} className={`mun-g-pin ${hung[s] ? 'used' : ''}`} style={{ left: `${12.5 + s * 25}%` }}>
            <i>🪝</i>
            {hung[s] && <span className="mun-g-hungitem">{hung[s]}</span>}
          </div>
        ))}
      </div>
      <div className="mun-g-basket">🧺</div>
      <div className="mun-g-tray low">
        {remaining.map((ic) => (
          <button
            key={ic}
            className="mun-g-ing"
            onPointerDown={(e) => {
              capturePointer(e.currentTarget, e)
              const p = relPos(e, fieldRef.current)
              setDrag({ icon: ic, x: p.x, y: p.y })
            }}
          >
            <span>{ic}</span>
          </button>
        ))}
      </div>
      {drag && <div className="mun-g-dragghost" style={{ left: drag.x, top: drag.y }}>{drag.icon}</div>}
    </div>
  )
}

// =================================================== 5. COFFEE (rhythm taps)
const BEAT_MS = 820
const BEAT_WINDOW = 170
const COFFEE_HITS = 7

function Coffee({ lang, onDone }) {
  const t0 = useRef(performance.now())
  const [good, setGood] = useState(0)
  const [judge, setJudge] = useState(null) // 'hit' | 'miss'
  const [ringT, setRingT] = useState(0)
  const [won, win] = useWin(onDone)

  useEffect(() => {
    const iv = setInterval(() => {
      setRingT(((performance.now() - t0.current) % BEAT_MS) / BEAT_MS)
    }, 40)
    return () => clearInterval(iv)
  }, [])

  const tap = () => {
    if (won) return
    const phase = (performance.now() - t0.current) % BEAT_MS
    const offBeat = Math.min(phase, BEAT_MS - phase)
    if (offBeat <= BEAT_WINDOW) {
      sound.play('build')
      setJudge('hit')
      setGood((g) => {
        const n = g + 1
        if (n >= COFFEE_HITS) win()
        return n
      })
    } else {
      sound.play('tax')
      setJudge('miss')
    }
    setTimeout(() => setJudge(null), 220)
  }

  // the ring shrinks into the pestle on each beat
  const ringScale = 1.9 - ringT * 0.9

  return (
    <div className="mun-g-center">
      <div className="mun-g-hint">{L(lang, 'Pound WITH the beat — feel the دقة', 'دقّ عالإيقاع — حس بالدقة')}</div>
      <button className={`mun-g-mihbash ${judge || ''}`} onClick={tap}>
        <span className="mun-g-beatring" style={{ transform: `scale(${ringScale})`, opacity: 1.15 - ringScale * 0.45 }} />
        <span className="mun-g-pestle" style={{ transform: judge === 'hit' ? 'translateY(6px)' : undefined }}>🏺</span>
      </button>
      <div className="mun-g-beans">
        {Array.from({ length: COFFEE_HITS }, (_, i) => (
          <span key={i} className={i < good ? 'ground' : ''}>{i < good ? '☕' : '🫘'}</span>
        ))}
      </div>
      {judge === 'miss' && <div className="mun-g-oops">{L(lang, 'Off the beat!', 'برا الإيقاع!')}</div>}
    </div>
  )
}

// ==================================================== 6. PLANTS (carry-pour)
function Plants({ lang, onDone }) {
  const fieldRef = useRef(null)
  const [fills, setFills] = useState([0, 0, 0, 0, 0])
  const [can, setCan] = useState(null) // {x, y}
  const canRef = useRef(null)
  const [won, win] = useWin(onDone)
  canRef.current = can

  useEffect(() => {
    if (won) return undefined
    const iv = setInterval(() => {
      const c = canRef.current
      if (!c) return
      setFills((f) => {
        const el = fieldRef.current
        if (!el) return f
        const w = el.clientWidth
        const idx = Math.floor((c.x / w) * 5)
        if (idx < 0 || idx > 4) return f
        // pour only while the can is held roughly over the pot row
        if (c.y < el.clientHeight * 0.35 || c.y > el.clientHeight * 0.85) return f
        if (f[idx] >= 100) return f
        const next = f.slice()
        next[idx] = Math.min(100, next[idx] + 7)
        if (next.every((v) => v >= 100)) win()
        return next
      })
    }, 90)
    return () => clearInterval(iv)
  }, [won, win])

  const move = (e) => {
    if (!can) return
    const p = relPos(e, fieldRef.current)
    setCan({ x: p.x, y: p.y })
  }

  return (
    <div
      className="mun-g-field"
      ref={fieldRef}
      onPointerDown={(e) => {
        capturePointer(e.currentTarget, e)
        const p = relPos(e, fieldRef.current)
        setCan({ x: p.x, y: p.y })
      }}
      onPointerMove={move}
      onPointerUp={() => setCan(null)}
    >
      <div className="mun-g-hint">{L(lang, 'Hold the can over each pot until it blooms', 'خلّي المرش فوق كل أصيص حتى يزهّر')}</div>
      <div className="mun-g-potsrow">
        {fills.map((f, i) => (
          <div key={i} className="mun-g-plantpot">
            <span className="mun-g-plant">{f >= 100 ? '🌷' : f > 55 ? '🌱' : '🥀'}</span>
            <div className="mun-g-plantmeter"><i style={{ height: `${f}%` }} /></div>
          </div>
        ))}
      </div>
      <div className={`mun-g-can ${can ? 'pouring' : ''}`} style={can ? { left: can.x, top: can.y } : undefined}>
        🚿{can && <span className="mun-g-drops">💧</span>}
      </div>
    </div>
  )
}

// ================================================= 7. OLIVES (drop + catch)
function Olives({ lang, onDone }) {
  const fieldRef = useRef(null)
  const [basketX, setBasketX] = useState(50) // %
  const [falling, setFalling] = useState([]) // {id, x%, y%}
  const [caught, setCaught] = useState(0)
  const [won, win] = useWin(onDone)
  const nextIdRef = useRef(1)
  const basketRef = useRef(50)
  basketRef.current = basketX

  // spawn a falling olive every beat; advance gravity; catch check
  useEffect(() => {
    if (won) return undefined
    const spawn = setInterval(() => {
      setFalling((f) => (f.length >= 3 ? f : [
        ...f,
        { id: nextIdRef.current++, x: 12 + Math.random() * 76, y: 12 },
      ]))
    }, 950)
    const grav = setInterval(() => {
      setFalling((f) => {
        const out = []
        for (const o of f) {
          const ny = o.y + 3.4
          if (ny >= 82) {
            if (Math.abs(o.x - basketRef.current) < 13) {
              sound.play('ui')
              setCaught((c) => {
                const n = c + 1
                if (n >= 6) win()
                return n
              })
            }
            continue // caught or splatted — either way it leaves the tree
          }
          out.push({ ...o, y: ny })
        }
        return out
      })
    }, 60)
    return () => { clearInterval(spawn); clearInterval(grav) }
  }, [won, win])

  const move = (e) => {
    const p = relPos(e, fieldRef.current)
    setBasketX((p.x / p.w) * 100)
  }

  return (
    <div
      className="mun-g-field tree"
      ref={fieldRef}
      onPointerDown={(e) => { capturePointer(e.currentTarget, e); move(e) }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') move(e) }}
    >
      <div className="mun-g-hint">{L(lang, 'Catch the falling olives — 6 fill the basket', 'التقط الزيتون النازل — 6 حبات تعبّي السلة')}</div>
      <div className="mun-g-canopy">🌳</div>
      {falling.map((o) => (
        <span key={o.id} className="mun-g-olive" style={{ left: `${o.x}%`, top: `${o.y}%` }}>🫒</span>
      ))}
      <div className="mun-g-catchbasket" style={{ left: `${basketX}%` }}>
        🧺
        <span className="mun-g-count">{caught}/6</span>
      </div>
    </div>
  )
}

// ===================================================== 8. SHELF (memory)
const SHELF_GOODS = [
  { id: 'a', icon: '🫙' }, { id: 'b', icon: '🥫' }, { id: 'c', icon: '🧴' },
  { id: 'd', icon: '🍬' }, { id: 'e', icon: '🧃' },
]

function Shelf({ lang, onDone }) {
  const layout = useMemo(() => shuffle(SHELF_GOODS).slice(0, 4), []) // 4 slots; 1 decoy stays
  const [phase, setPhase] = useState('memorize') // memorize | restore
  const [placed, setPlaced] = useState({}) // slot -> id
  const [sel, setSel] = useState(null)
  const [shakeSlot, setShakeSlot] = useState(-1)
  const [won, win] = useWin(onDone)

  useEffect(() => {
    const to = setTimeout(() => setPhase('restore'), 2800)
    return () => clearTimeout(to)
  }, [])

  const counterItems = useMemo(() => shuffle(SHELF_GOODS), [])
  const usedIds = new Set(Object.values(placed))

  const place = (slot) => {
    if (phase !== 'restore' || won || sel == null || placed[slot]) return
    if (layout[slot].id === sel) {
      sound.play('ui')
      const next = { ...placed, [slot]: sel }
      setPlaced(next)
      setSel(null)
      if (Object.keys(next).length === 4) win()
    } else {
      sound.play('tax')
      setShakeSlot(slot)
      setSel(null)
      setTimeout(() => setShakeSlot(-1), 350)
    }
  }

  return (
    <div className="mun-g-center">
      <div className="mun-g-hint">
        {phase === 'memorize'
          ? L(lang, 'MEMORIZE the shelf…', 'احفظ ترتيب الرف…')
          : L(lang, 'Now restore it (one item is a trick!)', 'رجّع الترتيب (وحدة منهم خدعة!)')}
      </div>
      <div className="mun-g-shelf">
        {layout.map((it, slot) => (
          <button
            key={slot}
            className={`mun-mg-slot ${placed[slot] ? 'filled' : ''} ${shakeSlot === slot ? 'mun-g-shake' : ''}`}
            onClick={() => place(slot)}
          >
            {phase === 'memorize'
              ? <span className="mun-mg-emoji">{it.icon}</span>
              : placed[slot]
                ? <span className="mun-mg-emoji">{SHELF_GOODS.find((g) => g.id === placed[slot])?.icon}</span>
                : null}
          </button>
        ))}
      </div>
      {phase === 'restore' && (
        <div className="mun-mg-row">
          {counterItems.filter((g) => !usedIds.has(g.id)).map((g) => (
            <button
              key={g.id}
              className={`mun-mg-chip small ${sel === g.id ? 'sel' : ''}`}
              onClick={() => setSel(g.id)}
            >
              <span className="mun-mg-emoji">{g.icon}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ====================================================== 9. GAS (valve swap)
function useRotary(onTurn) {
  const ref = useRef(null)
  const lastRef = useRef(null)
  const down = (e) => {
    capturePointer(e.currentTarget, e)
    const r = ref.current.getBoundingClientRect()
    lastRef.current = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2))
  }
  const move = (e) => {
    if (lastRef.current == null) return
    const r = ref.current.getBoundingClientRect()
    const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2))
    let d = a - lastRef.current
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    lastRef.current = a
    onTurn(d * (180 / Math.PI))
  }
  const up = () => { lastRef.current = null }
  return { ref, onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerLeave: up }
}

const VALVE_TURN = 400 // degrees to close/open

function Gas({ lang, onDone }) {
  const [step, setStep] = useState(0) // 0 close valve, 1 swap jarrah, 2 open valve
  const [closeDeg, setCloseDeg] = useState(0)
  const [openDeg, setOpenDeg] = useState(0)
  const [oldOut, setOldOut] = useState(false)
  const [newIn, setNewIn] = useState(false)
  const [dragJar, setDragJar] = useState(null) // {which, x}
  const fieldRef = useRef(null)
  const [won, win] = useWin(onDone)

  const rot = useRotary((d) => {
    if (step === 0) {
      setCloseDeg((v) => {
        const n = Math.max(0, v - Math.min(0, d) * 1) // counter-clockwise counts
        if (n >= VALVE_TURN) { sound.play('build'); setStep(1) }
        return Math.min(VALVE_TURN, n)
      })
    } else if (step === 2) {
      setOpenDeg((v) => {
        const n = Math.max(0, v + Math.max(0, d) * 1) // clockwise counts
        if (n >= VALVE_TURN) win()
        return Math.min(VALVE_TURN, n)
      })
    }
  })

  const angle = step === 0 ? -closeDeg : step === 2 ? openDeg - VALVE_TURN : -VALVE_TURN

  const jarMove = (e) => {
    if (!dragJar) return
    const p = relPos(e, fieldRef.current)
    setDragJar({ ...dragJar, x: p.x })
    if (dragJar.which === 'old' && p.x > p.w * 0.8) {
      sound.play('ui')
      setOldOut(true)
      setDragJar(null)
    }
    if (dragJar.which === 'new' && Math.abs(p.x - p.w * 0.32) < 30) {
      sound.play('build')
      setNewIn(true)
      setDragJar(null)
      setStep(2)
    }
  }

  const hints = [
    L(lang, 'Close the valve — turn it anticlockwise', 'سكّر المحبس — برمه عكس عقارب الساعة'),
    oldOut
      ? L(lang, 'Slide the NEW jarrah under the valve', 'ركّب الجرة الجديدة تحت المحبس')
      : L(lang, 'Drag the empty jarrah out of the way', 'اسحب الجرة الفاضية عالجنب'),
    L(lang, 'Open the valve — clockwise — until the flame lights', 'افتح المحبس مع عقارب الساعة حتى تولع النار'),
  ]

  return (
    <div className="mun-g-field" ref={fieldRef} onPointerMove={jarMove} onPointerUp={() => setDragJar(null)}>
      <div className="mun-g-hint">{hints[step]}</div>
      <div className="mun-g-stove">{won ? '🔥' : step === 2 && openDeg > VALVE_TURN * 0.65 ? '✨' : ''}</div>
      <div
        className={`mun-g-valve ${step === 1 ? 'idle' : ''}`}
        {...rot}
        style={{ touchAction: 'none' }}
      >
        <div className="mun-g-valvewheel" style={{ transform: `rotate(${angle}deg)` }}>☸️</div>
        <div className="mun-g-valveprog">
          <i style={{ width: `${((step === 0 ? closeDeg : step === 2 ? openDeg : VALVE_TURN) / VALVE_TURN) * 100}%` }} />
        </div>
      </div>
      {/* jarrahs */}
      {!oldOut && (
        <div
          className="mun-g-jarrah old"
          style={dragJar?.which === 'old' ? { left: dragJar.x } : undefined}
          onPointerDown={(e) => {
            if (step !== 1) return
            capturePointer(e.currentTarget, e)
            const p = relPos(e, fieldRef.current)
            setDragJar({ which: 'old', x: p.x })
          }}
        >🛢️</div>
      )}
      {oldOut && !newIn && (
        <div
          className="mun-g-jarrah new"
          style={dragJar?.which === 'new' ? { left: dragJar.x } : undefined}
          onPointerDown={(e) => {
            capturePointer(e.currentTarget, e)
            const p = relPos(e, fieldRef.current)
            setDragJar({ which: 'new', x: p.x })
          }}
        >🆕🛢️</div>
      )}
      {newIn && <div className="mun-g-jarrah set">🛢️</div>}
    </div>
  )
}

// =================================================== 10. WATER (pressure)
function Water({ lang, onDone }) {
  const [pressure, setPressure] = useState(50)
  const [pct, setPct] = useState(0)
  const [spill, setSpill] = useState(false)
  const holdRef = useRef(false)
  const pctRef = useRef(0)
  const tRef = useRef(0)
  const [won, win] = useWin(onDone)

  useEffect(() => {
    if (won) return undefined
    const iv = setInterval(() => {
      tRef.current += 0.09
      // wandering pressure: two sines + drift
      const p = 50 + Math.sin(tRef.current) * 26 + Math.sin(tRef.current * 2.7) * 14
      setPressure(p)
      if (holdRef.current) {
        const good = p >= 42 && p <= 72
        pctRef.current = Math.min(104, pctRef.current + (good ? 1.7 : 0.3))
        if (!good) setSpill(true)
        else setSpill(false)
        if (pctRef.current >= 104) pctRef.current = 0 // overflow → start over
        setPct(pctRef.current)
      } else {
        setSpill(false)
      }
    }, 55)
    return () => clearInterval(iv)
  }, [won])

  const release = () => {
    if (!holdRef.current || won) return
    holdRef.current = false
    if (pctRef.current >= 80 && pctRef.current <= 97) win()
    else if (pctRef.current > 97) { pctRef.current = 0; setPct(0) }
  }

  const goodZone = pressure >= 42 && pressure <= 72

  return (
    <div className="mun-g-center">
      <div className="mun-g-hint">
        {L(lang, 'Fill ONLY while the pressure holds — release in the band', 'عبّي بس لما الضغط مليح — وافلت جوّا الخط')}
      </div>
      <div className="mun-g-gauge">
        <div className="mun-g-gaugezone" />
        <div className={`mun-g-needle2 ${goodZone ? 'good' : ''}`} style={{ left: `${pressure}%` }} />
      </div>
      <div className="mun-mg-jar">
        <div className="mun-mg-jar-band" />
        <div className={`mun-mg-jar-water ${spill ? 'sputter' : ''}`} style={{ height: `${Math.min(100, pct)}%` }} />
      </div>
      <button
        className="mun-mg-mash hold"
        onPointerDown={() => { holdRef.current = true }}
        onPointerUp={release}
        onPointerLeave={release}
      >
        <span className="mun-mg-emoji big">🚰</span>
      </button>
    </div>
  )
}

// ============================================== 11. FIX (trip-switch panel)
function Breaker({ lang, onDone }) {
  const [switches, setSwitches] = useState(() => shuffle([true, false, false, true, false, false]))
  const tripsLeftRef = useRef(3)
  const [won, win] = useWin(onDone)

  useEffect(() => {
    if (won) return undefined
    const iv = setInterval(() => {
      if (tripsLeftRef.current <= 0) return
      setSwitches((s) => {
        if (s.every(Boolean)) return s
        const onIdx = s.map((v, i) => (v ? i : -1)).filter((i) => i >= 0)
        if (onIdx.length === 0) return s
        tripsLeftRef.current -= 1
        sound.play('tax')
        const pick = onIdx[Math.floor(Math.random() * onIdx.length)]
        const next = s.slice()
        next[pick] = false
        return next
      })
    }, 1500)
    return () => clearInterval(iv)
  }, [won])

  const flip = (i) => {
    if (won) return
    sound.play('ui')
    setSwitches((s) => {
      const next = s.slice()
      next[i] = !next[i]
      if (next.every(Boolean)) win()
      return next
    })
  }

  return (
    <div className="mun-g-center">
      <div className="mun-g-hint">
        {L(lang, 'Flip everything ON — the old breakers fight back!', 'ارفع كل القواطع — القواطع العتيقة بتقاوم!')}
      </div>
      <div className="mun-g-breaker">
        {switches.map((on, i) => (
          <div key={i} className="mun-g-switchcol">
            <i className={`mun-g-led ${on ? 'on' : ''}`} />
            <button className={`mun-g-switch ${on ? 'on' : ''}`} onClick={() => flip(i)}>
              <span />
            </button>
          </div>
        ))}
      </div>
      <div className={`mun-g-powerbar ${switches.every(Boolean) ? 'full' : ''}`}>
        <i style={{ width: `${(switches.filter(Boolean).length / switches.length) * 100}%` }} />
      </div>
    </div>
  )
}

// ================================================================ the modal
const FLAVOR = {
  wires: { en: 'The hara lights flicker again…', ar: 'كهربا الحارة عم تقطّع من زمان…' },
  tea: { en: 'The diwan is waiting for its tea.', ar: 'الديوان مستني الشاي.' },
  satellite: { en: 'The match starts in five minutes!', ar: 'المباراة بتبلش بعد خمس دقايق!' },
  laundry: { en: 'Hang it before the dust wind comes.', ar: 'انشر قبل ما تيجي الغبرة.' },
  coffee: { en: 'A proper دقة has a rhythm.', ar: 'الدقة الأصيلة إلها إيقاع.' },
  plants: { en: 'The حاكورة is thirsty tonight.', ar: 'الحاكورة عطشانة الليلة.' },
  olives: { en: 'Don’t bruise a single olive.', ar: 'ولا حبة زيتون توقع عالأرض.' },
  shelf: { en: 'Abu Mahmoud knows his shelf by heart.', ar: 'أبو محمود حافظ رفّه عن ظهر قلب.' },
  gas: { en: 'Careful — do it in the right order.', ar: 'انتبه — خطوة خطوة عالأصول.' },
  water: { en: 'The pressure comes and goes, as always.', ar: 'الضغط بيجي وبيروح، متل كل مرة.' },
  fix: { en: 'Someone cut the power. Again.', ar: 'حدا قطع الكهربا. كمان مرة.' },
}

function bodyFor(taskId, lang, onDone) {
  switch (taskId) {
    case 'wires': return <Wires onDone={onDone} />
    case 'tea': return <Tea lang={lang} onDone={onDone} />
    case 'satellite': return <Satellite lang={lang} onDone={onDone} />
    case 'laundry': return <Laundry lang={lang} onDone={onDone} />
    case 'coffee': return <Coffee lang={lang} onDone={onDone} />
    case 'plants': return <Plants lang={lang} onDone={onDone} />
    case 'olives': return <Olives lang={lang} onDone={onDone} />
    case 'shelf': return <Shelf lang={lang} onDone={onDone} />
    case 'gas': return <Gas lang={lang} onDone={onDone} />
    case 'water': return <Water lang={lang} onDone={onDone} />
    case 'fix': return <Breaker lang={lang} onDone={onDone} />
    default: return null
  }
}

export default function TaskModal({ taskId, lang, onDone, onClose, t }) {
  const station = STATIONS[taskId]
  const [flash, setFlash] = useState(false)
  const doneRef = useRef(false)
  const title = taskId === 'fix'
    ? t('mundass.fixPower')
    : station
      ? (lang === 'ar' ? station.ar : station.en)
      : taskId

  // children report the win; the modal celebrates, then tells the page.
  const handleDone = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    setFlash(true)
    setTimeout(() => onDone(taskId), 700)
  }, [onDone, taskId])

  const flavor = FLAVOR[taskId]

  return (
    <div className="mun-modal-backdrop" role="dialog" aria-modal="true">
      <div className="mun-modal">
        <div className="mun-modal-head">
          <span className="mun-modal-title">
            {taskId === 'fix' ? '⚡' : station?.icon} {title}
          </span>
          <button className="mun-modal-x" onClick={onClose} aria-label="close">✕</button>
        </div>
        {flavor && <div className="mun-g-flavor">{L(lang, flavor.en, flavor.ar)}</div>}
        {/* mechanisms use explicit pixel coordinates — never mirror them */}
        <div dir="ltr">
          {bodyFor(taskId, lang, handleDone)}
        </div>
        {flash && (
          <div className="mun-g-successflash">
            <span>✓</span>
            <b>{L(lang, 'Done!', 'أحسنت!')}</b>
          </div>
        )}
      </div>
    </div>
  )
}
