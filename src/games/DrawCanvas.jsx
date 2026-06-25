import { useEffect, useRef, useState } from 'react'
import { Eraser, Undo2, Trash2 } from 'lucide-react'

// Shared whiteboard. The drawer's pointer movements are broadcast as normalised
// (0..1) line segments over the room's ephemeral channel; everyone else replays
// them. Nothing is persisted — strokes live only in memory for the round. A late
// joiner asks for a full snapshot via { t:'req' } and the drawer answers { t:'sync' }.

const PALETTE = ['#15171b', '#e4002b', '#188a3d', '#2563eb', '#f0b428', '#a25bff', '#ffffff']
const SIZES = [3, 7, 14]
const BG = '#fbfbf7'

export default function DrawCanvas({ canDraw, roundKey, sendBroadcast, onMessage }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const strokesRef = useRef([]) // full history: [{ color, size, pts:[{x,y}] }]
  const curRef = useRef(null) // stroke in progress
  const drawingRef = useRef(false)

  const [color, setColor] = useState(PALETTE[0])
  const [size, setSize] = useState(SIZES[1])
  const colorRef = useRef(color)
  const sizeRef = useRef(size)
  useEffect(() => { colorRef.current = color }, [color])
  useEffect(() => { sizeRef.current = size }, [size])

  // ---- rendering ----
  const sizeCanvas = () => {
    const cv = canvasRef.current
    const wrap = wrapRef.current
    if (!cv || !wrap) return
    const rect = wrap.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(rect.width * dpr)
    cv.height = Math.round(rect.height * dpr)
    cv.style.height = `${rect.width * 0.62}px` // 1:0.62 board
    const ctx = cv.getContext('2d')
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctxRef.current = ctx
    redraw()
  }

  const px = () => {
    const cv = canvasRef.current
    const dpr = window.devicePixelRatio || 1
    return { w: cv.width / dpr, h: cv.height / dpr }
  }

  const redraw = () => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { w, h } = px()
    ctx.fillStyle = BG
    ctx.fillRect(0, 0, w, h)
    for (const s of strokesRef.current) drawStroke(s)
  }

  const drawStroke = (s) => {
    const ctx = ctxRef.current
    if (!ctx || !s.pts.length) return
    const { w, h } = px()
    ctx.strokeStyle = s.color
    ctx.lineWidth = s.size
    ctx.beginPath()
    ctx.moveTo(s.pts[0].x * w, s.pts[0].y * h)
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x * w, s.pts[i].y * h)
    if (s.pts.length === 1) ctx.lineTo(s.pts[0].x * w + 0.01, s.pts[0].y * h + 0.01)
    ctx.stroke()
  }

  const drawSegment = (color, sz, a, b) => {
    const ctx = ctxRef.current
    if (!ctx) return
    const { w, h } = px()
    ctx.strokeStyle = color
    ctx.lineWidth = sz
    ctx.beginPath()
    ctx.moveTo(a.x * w, a.y * h)
    ctx.lineTo(b.x * w, b.y * h)
    ctx.stroke()
  }

  // ---- mount: size + inbound message handling ----
  useEffect(() => {
    sizeCanvas()
    const ro = new ResizeObserver(sizeCanvas)
    if (wrapRef.current) ro.observe(wrapRef.current)

    const off = onMessage((p) => {
      if (!p) return
      if (p.t === 'seg') {
        const last = strokesRef.current[strokesRef.current.length - 1]
        // attach to the matching in-flight stroke, or start one
        let s = last && last.id === p.id ? last : null
        if (!s) {
          s = { id: p.id, color: p.color, size: p.size, pts: [p.a] }
          strokesRef.current.push(s)
        }
        s.pts.push(p.b)
        drawSegment(p.color, p.size, p.a, p.b)
      } else if (p.t === 'clear') {
        strokesRef.current = []
        redraw()
      } else if (p.t === 'sync' && Array.isArray(p.strokes)) {
        strokesRef.current = p.strokes
        redraw()
      } else if (p.t === 'req') {
        // only the drawer answers, and only if they have something to share
        if (canDraw && strokesRef.current.length) {
          sendBroadcast({ t: 'sync', strokes: strokesRef.current })
        }
      }
    })

    // a fresh (re)mounted viewer asks for the current board
    if (!canDraw) sendBroadcast({ t: 'req' })

    return () => {
      ro.disconnect()
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // new round / new drawer -> wipe the board locally
  useEffect(() => {
    strokesRef.current = []
    curRef.current = null
    redraw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundKey])

  // ---- drawing (drawer only) ----
  const pointFromEvent = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    }
  }

  const start = (e) => {
    if (!canDraw) return
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawingRef.current = true
    const id = `${Date.now()}-${Math.round(performance.now() % 100000)}`
    const pt = pointFromEvent(e)
    const s = { id, color: colorRef.current, size: sizeRef.current, pts: [pt] }
    strokesRef.current.push(s)
    curRef.current = s
    drawStroke(s) // a dot for a tap
  }

  const move = (e) => {
    if (!canDraw || !drawingRef.current) return
    const s = curRef.current
    if (!s) return
    const a = s.pts[s.pts.length - 1]
    const b = pointFromEvent(e)
    s.pts.push(b)
    drawSegment(s.color, s.size, a, b)
    sendBroadcast({ t: 'seg', id: s.id, color: s.color, size: s.size, a, b })
  }

  const end = () => {
    drawingRef.current = false
    curRef.current = null
  }

  const clearBoard = () => {
    strokesRef.current = []
    redraw()
    sendBroadcast({ t: 'clear' })
  }
  const undo = () => {
    strokesRef.current.pop()
    redraw()
    sendBroadcast({ t: 'sync', strokes: strokesRef.current })
  }

  return (
    <div className="draw-canvas-wrap">
      <div className="draw-canvas-board" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="draw-canvas"
          style={{ touchAction: 'none', cursor: canDraw ? 'crosshair' : 'default' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
        />
      </div>

      {canDraw && (
        <div className="draw-tools">
          <div className="draw-swatches">
            {PALETTE.map((c) => (
              <button
                key={c}
                className={`draw-swatch${color === c ? ' on' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`color ${c}`}
              />
            ))}
            <button
              className={`draw-swatch eraser${color === BG ? ' on' : ''}`}
              onClick={() => setColor(BG)}
              aria-label="eraser"
            >
              <Eraser size={14} />
            </button>
          </div>
          <div className="draw-sizes">
            {SIZES.map((s) => (
              <button
                key={s}
                className={`draw-size${size === s ? ' on' : ''}`}
                onClick={() => setSize(s)}
                aria-label={`brush ${s}`}
              >
                <span style={{ width: s + 4, height: s + 4 }} />
              </button>
            ))}
          </div>
          <div className="draw-tool-actions">
            <button className="btn btn-line btn-sm" onClick={undo}><Undo2 size={15} /></button>
            <button className="btn btn-line btn-sm" onClick={clearBoard}><Trash2 size={15} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
