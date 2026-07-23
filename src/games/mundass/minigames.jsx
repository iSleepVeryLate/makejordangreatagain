import { useEffect, useMemo, useRef, useState } from 'react'
import { STATIONS } from './map.js'

// المندس task minigames. All pointer-driven (tap / hold / select-then-place —
// no drag math, so they behave identically on touch and mouse), each 5-15s.
// TaskModal picks the mechanic for a task id and calls onDone() exactly once
// on success. The special id 'fix' is the breaker-box hold (power sabotage).

function shuffle(arr) {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function useSuccess(onDone) {
  const [won, setWon] = useState(false)
  const firedRef = useRef(false)
  const win = () => {
    if (firedRef.current) return
    firedRef.current = true
    setWon(true)
    setTimeout(onDone, 650)
  }
  return [won, win]
}

// ---- Mechanic: tap the steps in order (tea) ----
function TapSequence({ steps, onDone }) {
  const [next, setNext] = useState(0)
  const [shake, setShake] = useState(-1)
  const [won, win] = useSuccess(onDone)
  const order = useMemo(() => shuffle(steps.map((_, i) => i)), [steps])
  const tap = (idx) => {
    if (won) return
    if (idx === next) {
      if (idx === steps.length - 1) win()
      setNext(idx + 1)
    } else {
      setShake(idx)
      setTimeout(() => setShake(-1), 350)
      setNext(0)
    }
  }
  return (
    <div className="mun-mg-grid">
      {order.map((idx) => (
        <button
          key={idx}
          className={`mun-mg-chip ${idx < next ? 'done' : ''} ${shake === idx ? 'shake' : ''}`}
          onClick={() => tap(idx)}
        >
          <span className="mun-mg-emoji">{steps[idx].icon}</span>
          <span>{steps[idx].label}</span>
          {idx < next && <span className="mun-mg-check">✓</span>}
        </button>
      ))}
    </div>
  )
}

// ---- Mechanic: tap every item once (plants, olives) ----
function TapAll({ count, icon, doneIcon, onDone, scatter = false }) {
  const [hit, setHit] = useState(() => Array(count).fill(false))
  const [won, win] = useSuccess(onDone)
  const spots = useMemo(
    () => Array.from({ length: count }, () => ({
      left: 8 + Math.random() * 78,
      top: 10 + Math.random() * 65,
    })),
    [count],
  )
  const tap = (i) => {
    if (won || hit[i]) return
    const next = hit.slice()
    next[i] = true
    setHit(next)
    if (next.every(Boolean)) win()
  }
  return (
    <div className={`mun-mg-field ${scatter ? 'tree' : ''}`}>
      {spots.map((s, i) => (
        <button
          key={i}
          className={`mun-mg-spot ${hit[i] ? 'done' : ''}`}
          style={{ left: `${s.left}%`, top: `${s.top}%` }}
          onClick={() => tap(i)}
        >
          {hit[i] ? doneIcon : icon}
        </button>
      ))}
    </div>
  )
}

// ---- Mechanic: mash to fill (coffee grinding) ----
function Mash({ target, icon, onDone }) {
  const [n, setN] = useState(0)
  const [won, win] = useSuccess(onDone)
  const tap = () => {
    if (won) return
    const next = n + 1
    setN(next)
    if (next >= target) win()
  }
  return (
    <div className="mun-mg-center">
      <button className={`mun-mg-mash ${won ? 'done' : ''}`} onClick={tap}>
        <span className="mun-mg-emoji big">{icon}</span>
      </button>
      <div className="mun-mg-meter"><div style={{ width: `${(n / target) * 100}%` }} /></div>
    </div>
  )
}

// ---- Mechanic: press & hold to fill (gas swap, breaker fix) ----
function Hold({ ms, icon, onDone }) {
  const [pct, setPct] = useState(0)
  const [won, win] = useSuccess(onDone)
  const holdRef = useRef(false)
  const pctRef = useRef(0)
  useEffect(() => {
    const iv = setInterval(() => {
      if (!holdRef.current || pctRef.current >= 100) return
      pctRef.current = Math.min(100, pctRef.current + (100 * 50) / ms)
      setPct(pctRef.current)
      if (pctRef.current >= 100) win()
    }, 50)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms])
  return (
    <div className="mun-mg-center">
      <button
        className={`mun-mg-mash hold ${won ? 'done' : ''}`}
        onPointerDown={() => { holdRef.current = true }}
        onPointerUp={() => { holdRef.current = false }}
        onPointerLeave={() => { holdRef.current = false }}
      >
        <span className="mun-mg-emoji big">{icon}</span>
      </button>
      <div className="mun-mg-meter"><div style={{ width: `${pct}%` }} /></div>
    </div>
  )
}

// ---- Mechanic: select an item, then its slot (wires, laundry, shelf) ----
function SelectPlace({ items, matched, onDone }) {
  // items: [{id, icon, color?}]; slots are shuffled copies. matched=true → the
  // slot must be the same id; matched=false → any empty slot accepts any item.
  const [placed, setPlaced] = useState({}) // slotIdx -> itemId
  const [sel, setSel] = useState(null)
  const [won, win] = useSuccess(onDone)
  const slots = useMemo(() => shuffle(items), [items])
  const usedItems = new Set(Object.values(placed))
  const place = (slotIdx) => {
    if (won || sel == null || placed[slotIdx]) return
    if (matched && slots[slotIdx].id !== sel) return
    const next = { ...placed, [slotIdx]: sel }
    setPlaced(next)
    setSel(null)
    if (Object.keys(next).length === items.length) win()
  }
  return (
    <div className="mun-mg-place">
      <div className="mun-mg-row">
        {items.map((it) => (
          <button
            key={it.id}
            className={`mun-mg-chip small ${sel === it.id ? 'sel' : ''} ${usedItems.has(it.id) ? 'gone' : ''}`}
            style={it.color ? { borderColor: it.color } : undefined}
            disabled={usedItems.has(it.id)}
            onClick={() => setSel(it.id)}
          >
            <span className="mun-mg-emoji">{it.icon}</span>
          </button>
        ))}
      </div>
      <div className="mun-mg-arrow">↓</div>
      <div className="mun-mg-row">
        {slots.map((s, i) => (
          <button
            key={i}
            className={`mun-mg-slot ${placed[i] ? 'filled' : ''}`}
            style={s.color ? { borderColor: s.color } : undefined}
            onClick={() => place(i)}
          >
            {placed[i]
              ? <span className="mun-mg-emoji">{items.find((it) => it.id === placed[i])?.icon}</span>
              : matched
                ? <span className="mun-mg-ghosted">{s.icon}</span>
                : null}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---- Mechanic: tune a dial into the target band and hold it (satellite) ----
function DialTune({ onDone }) {
  const target = useMemo(() => 15 + Math.random() * 70, [])
  const [v, setV] = useState(0)
  const [locked, setLocked] = useState(0) // ms accumulated inside the band
  const [won, win] = useSuccess(onDone)
  const inBand = Math.abs(v - target) < 6
  useEffect(() => {
    if (won) return undefined
    const iv = setInterval(() => {
      setLocked((l) => {
        if (!inBand) return 0
        const next = l + 100
        if (next >= 800) win()
        return next
      })
    }, 100)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inBand, won])
  return (
    <div className="mun-mg-center">
      <div className="mun-mg-signal">
        <div className="mun-mg-band" style={{ left: `${target - 6}%`, width: '12%' }} />
        <div className={`mun-mg-needle ${inBand ? 'good' : ''}`} style={{ left: `${v}%` }} />
      </div>
      <div className="mun-mg-meter thin"><div style={{ width: `${(locked / 800) * 100}%` }} /></div>
      <input
        className="mun-mg-range"
        type="range"
        min="0"
        max="100"
        step="0.5"
        value={v}
        onChange={(e) => setV(Number(e.target.value))}
      />
      <div className="mun-mg-emoji big">📡</div>
    </div>
  )
}

// ---- Mechanic: fill and release inside the band (water jerrycan) ----
function FillWindow({ onDone }) {
  const [pct, setPct] = useState(0)
  const [won, win] = useSuccess(onDone)
  const holdRef = useRef(false)
  const pctRef = useRef(0)
  useEffect(() => {
    const iv = setInterval(() => {
      if (won) return
      if (holdRef.current) {
        pctRef.current = Math.min(104, pctRef.current + 1.6)
        if (pctRef.current >= 104) pctRef.current = 0 // overflow! start over
        setPct(pctRef.current)
      }
    }, 40)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [won])
  const release = () => {
    if (!holdRef.current || won) return
    holdRef.current = false
    if (pctRef.current >= 78 && pctRef.current <= 96) win()
    else { pctRef.current = 0; setPct(0) }
  }
  return (
    <div className="mun-mg-center">
      <div className="mun-mg-jar">
        <div className="mun-mg-jar-band" />
        <div className="mun-mg-jar-water" style={{ height: `${Math.min(100, pct)}%` }} />
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

const WIRE_COLORS = ['#e23c3c', '#2f7ee0', '#e2b53c', '#3ca85a']

function bodyFor(taskId, lang, onDone) {
  switch (taskId) {
    case 'tea':
      return (
        <TapSequence
          onDone={onDone}
          steps={[
            { icon: '🔥', label: lang === 'ar' ? 'بابور' : 'Stove' },
            { icon: '🫖', label: lang === 'ar' ? 'براد' : 'Teapot' },
            { icon: '🍃', label: lang === 'ar' ? 'شاي' : 'Tea' },
            { icon: '🌿', label: lang === 'ar' ? 'نعنع' : 'Mint' },
            { icon: '🍬', label: lang === 'ar' ? 'سكر' : 'Sugar' },
          ]}
        />
      )
    case 'plants':
      return <TapAll count={5} icon="🥀" doneIcon="🌷" onDone={onDone} />
    case 'olives':
      return <TapAll count={8} icon="🫒" doneIcon="✨" scatter onDone={onDone} />
    case 'coffee':
      return <Mash target={12} icon="🏺" onDone={onDone} />
    case 'gas':
      return <Hold ms={3000} icon="🛢️" onDone={onDone} />
    case 'fix':
      return <Hold ms={3000} icon="⚡" onDone={onDone} />
    case 'wires':
      return (
        <SelectPlace
          matched
          onDone={onDone}
          items={WIRE_COLORS.map((c, i) => ({ id: `w${i}`, icon: '🔌', color: c }))}
        />
      )
    case 'laundry':
      return (
        <SelectPlace
          onDone={onDone}
          items={[
            { id: 'a', icon: '👕' }, { id: 'b', icon: '👖' },
            { id: 'c', icon: '🧦' }, { id: 'd', icon: '🧣' },
          ]}
        />
      )
    case 'shelf':
      return (
        <SelectPlace
          matched
          onDone={onDone}
          items={[
            { id: 'x', icon: '🫙' }, { id: 'y', icon: '🥫' }, { id: 'z', icon: '🧴' },
          ]}
        />
      )
    case 'satellite':
      return <DialTune onDone={onDone} />
    case 'water':
      return <FillWindow onDone={onDone} />
    default:
      return null
  }
}

export default function TaskModal({ taskId, lang, onDone, onClose, t }) {
  const station = STATIONS[taskId]
  const title = taskId === 'fix'
    ? t('mundass.fixPower')
    : station
      ? (lang === 'ar' ? station.ar : station.en)
      : taskId
  return (
    <div className="mun-modal-backdrop" role="dialog" aria-modal="true">
      <div className="mun-modal">
        <div className="mun-modal-head">
          <span className="mun-modal-title">
            {taskId === 'fix' ? '⚡' : station?.icon} {title}
          </span>
          <button className="mun-modal-x" onClick={onClose} aria-label="close">✕</button>
        </div>
        {bodyFor(taskId, lang, onDone)}
      </div>
    </div>
  )
}
