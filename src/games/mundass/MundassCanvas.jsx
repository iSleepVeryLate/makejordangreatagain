import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  WORLD, ROOMS, ALLEYS, STATIONS, MIHBASH, BREAKER, MANHOLES, COLORS,
  SPEED, GHOST_SPEED, VISION, VISION_BLACKOUT, KILL_RADIUS,
  moveWithCollision, nearestInteraction, spawnPoint, dist,
} from './map.js'

// المندس game view. The entire loop lives OUTSIDE React (refs + rAF): React only
// mounts the <canvas> and receives throttled "what can I do here" callbacks for
// the HUD (the Monopoly perf lesson — no per-frame setState, no infinite CSS
// loops). Movement is client-authoritative and shared over the ephemeral
// broadcast bus at 10 Hz; the server only ever validates roles/cooldowns.
//
// Props:
//   myId, players           — membership rows (color, profile) for names/colors
//   stateRef                — ref to the latest room.state (alive/bodies/sabotage)
//   meRef                   — ref to my latest secret (role/tasks) — never rendered
//                             for anyone else
//   frozen                  — true during meetings/task modals (input ignored)
//   sendBroadcast/onMessage — the ephemeral bus from useMundassRoom
//   onNearest(interaction)  — HUD contextual action changed (null = none)
//   onKillTarget(uid|null)  — nearest kill victim changed (mundass only)
//   lang                    — 'en' | 'ar' (map labels)
//
// Imperative ref API: getPos(), teleport(x, y), respawn(index, count).

const BROADCAST_MS = 100
const PEER_TTL_MS = 6000

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// A neighbor: bean body in the player color, wearing the شماغ (white keffiyeh
// with the red pattern) held by the black عقال. Drawn at (0,0) feet-center.
function drawNeighbor(ctx, color, { facing = 1, bob = 0, ghost = false, dead = false } = {}) {
  ctx.save()
  if (ghost) ctx.globalAlpha = 0.45
  if (dead) {
    // Knocked-out bean lying down — cartoonish, no gore.
    ctx.rotate(Math.PI / 2)
    ctx.translate(6, 10)
  }
  ctx.translate(0, -bob)
  ctx.scale(facing, 1)
  // shadow
  if (!dead && !ghost) {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'
    ctx.beginPath()
    ctx.ellipse(0, 2 + bob, 20, 7, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  // legs
  ctx.fillStyle = color
  roundRect(ctx, -16, -18, 13, 20, 6)
  ctx.fill()
  roundRect(ctx, 3, -18, 13, 20, 6)
  ctx.fill()
  // body capsule
  roundRect(ctx, -20, -62, 40, 52, 18)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = 2.5
  roundRect(ctx, -20, -62, 40, 52, 18)
  ctx.stroke()
  // backpack
  ctx.fillStyle = color
  roundRect(ctx, -30, -52, 12, 30, 5)
  ctx.fill()
  ctx.stroke()
  // visor
  ctx.fillStyle = ghost ? 'rgba(190,225,255,0.8)' : '#bfe1ff'
  roundRect(ctx, -6, -54, 24, 15, 7)
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.3)'
  roundRect(ctx, -6, -54, 24, 15, 7)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  roundRect(ctx, 2, -51, 10, 5, 2.5)
  ctx.fill()
  // شماغ — white wrap over the head with red stitches
  ctx.fillStyle = '#f4f1ea'
  ctx.beginPath()
  ctx.arc(0, -60, 17, Math.PI * 0.92, Math.PI * 2.08)
  ctx.closePath()
  ctx.fill()
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'
  ctx.stroke()
  // tail of the shemagh down the back
  ctx.fillStyle = '#f4f1ea'
  roundRect(ctx, -24, -60, 10, 26, 4)
  ctx.fill()
  // red pattern
  ctx.strokeStyle = '#c22a2a'
  ctx.lineWidth = 1.4
  ctx.beginPath()
  for (let i = -14; i <= 14; i += 6) {
    ctx.moveTo(i, -72)
    ctx.lineTo(i + 4, -66)
  }
  ctx.stroke()
  // عقال — the black double band
  ctx.strokeStyle = '#151515'
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.ellipse(0, -66, 15, 6, 0, Math.PI * 1.05, Math.PI * 1.95)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.ellipse(0, -62.5, 15.5, 6, 0, Math.PI * 1.08, Math.PI * 1.92)
  ctx.stroke()
  if (dead) {
    // little departed-soul swirl
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(8, -46, 4, 0, Math.PI * 1.5)
    ctx.stroke()
  }
  ctx.restore()
}

// Pre-render the static hara (floors, alleys, props, labels) once.
function buildMapLayer(lang) {
  const c = document.createElement('canvas')
  c.width = WORLD.w
  c.height = WORLD.h
  const ctx = c.getContext('2d')
  // night ground
  ctx.fillStyle = '#232a33'
  ctx.fillRect(0, 0, WORLD.w, WORLD.h)
  // alleys — worn stone
  for (const a of ALLEYS) {
    ctx.fillStyle = '#4c5563'
    ctx.fillRect(a.x, a.y, a.w, a.h)
  }
  // rooms
  for (const r of ROOMS) {
    ctx.fillStyle = r.floor
    ctx.fillRect(r.x, r.y, r.w, r.h)
    // simple tiling texture
    ctx.strokeStyle = 'rgba(0,0,0,0.08)'
    ctx.lineWidth = 1
    for (let gx = r.x + 40; gx < r.x + r.w; gx += 40) {
      ctx.beginPath(); ctx.moveTo(gx, r.y); ctx.lineTo(gx, r.y + r.h); ctx.stroke()
    }
    for (let gy = r.y + 40; gy < r.y + r.h; gy += 40) {
      ctx.beginPath(); ctx.moveTo(r.x, gy); ctx.lineTo(r.x + r.w, gy); ctx.stroke()
    }
    // wall edging
    ctx.strokeStyle = 'rgba(20,16,10,0.85)'
    ctx.lineWidth = 6
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    // label
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    ctx.font = '700 30px "Segoe UI", system-ui, sans-serif'
    ctx.textAlign = 'center'
    const label = lang === 'ar' ? r.ar : r.en
    ctx.fillText(label, r.x + r.w / 2, r.y + 34)
  }
  // task stations
  ctx.textAlign = 'center'
  for (const id of Object.keys(STATIONS)) {
    const s = STATIONS[id]
    ctx.fillStyle = 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    ctx.arc(s.x, s.y, 26, 0, Math.PI * 2)
    ctx.fill()
    ctx.font = '34px system-ui'
    ctx.fillText(s.icon, s.x, s.y + 12)
  }
  // mihbash (meeting caller)
  ctx.fillStyle = 'rgba(255,215,120,0.2)'
  ctx.beginPath()
  ctx.arc(MIHBASH.x, MIHBASH.y, 34, 0, Math.PI * 2)
  ctx.fill()
  ctx.font = '40px system-ui'
  ctx.fillText('🏺', MIHBASH.x, MIHBASH.y + 14)
  ctx.font = '700 20px "Segoe UI", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,225,150,0.75)'
  ctx.fillText(lang === 'ar' ? 'المهباش' : 'Mihbash', MIHBASH.x, MIHBASH.y + 52)
  // breaker
  ctx.font = '30px system-ui'
  ctx.fillText('⚡', BREAKER.x, BREAKER.y + 10)
  // manholes
  for (const m of MANHOLES) {
    ctx.fillStyle = '#3a3f47'
    ctx.beginPath()
    ctx.arc(m.x, m.y, 22, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.15)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(m.x, m.y, 14, 0, Math.PI * 2)
    ctx.stroke()
  }
  return c
}

const MundassCanvas = forwardRef(function MundassCanvas(
  { myId, players, stateRef, meRef, frozen, sendBroadcast, onMessage, onNearest, onKillTarget, lang = 'en' },
  ref,
) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const posRef = useRef({ x: 1000, y: 720, fx: 1, moving: false })
  const peersRef = useRef(new Map()) // uid -> {x,y,tx,ty,fx,ghost,moving,seen}
  const keysRef = useRef({})
  const joyRef = useRef(null) // {cx, cy, dx, dy, id}
  const frozenRef = useRef(frozen)
  const lastSentRef = useRef(0)
  const lastNearestRef = useRef('')
  const lastKillRef = useRef('')
  const playersRef = useRef(players)

  frozenRef.current = frozen
  playersRef.current = players

  useImperativeHandle(ref, () => ({
    getPos: () => ({ ...posRef.current }),
    teleport: (x, y) => {
      posRef.current.x = x
      posRef.current.y = y
    },
    respawn: (index, count) => {
      const p = spawnPoint(index, count)
      posRef.current.x = p.x
      posRef.current.y = p.y
    },
  }), [])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return undefined
    const ctx = canvas.getContext('2d')
    const mapLayer = buildMapLayer(lang)
    let raf = 0
    let timer = 0
    let last = performance.now()
    let disposed = false

    // rAF while visible; a slow 4 fps setTimeout while hidden — a backgrounded
    // tab keeps broadcasting its position (peers don't watch you evaporate) and
    // keeps peer targets fresh for the return.
    const schedule = () => {
      if (disposed) return
      if (typeof document !== 'undefined' && document.hidden) {
        timer = setTimeout(() => loop(performance.now()), 250)
      } else {
        raf = requestAnimationFrame(loop)
      }
    }

    // ---- resize (DPR-aware) ----
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      canvas.width = Math.max(1, Math.round(w * dpr))
      canvas.height = Math.max(1, Math.round(h * dpr))
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // ---- input: keyboard ----
    const down = (e) => {
      if (e.repeat) return
      keysRef.current[e.key.toLowerCase()] = true
    }
    const up = (e) => { keysRef.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    // ---- input: touch joystick (any press on the canvas drags a stick) ----
    const pDown = (e) => {
      if (e.pointerType === 'mouse') return
      canvas.setPointerCapture(e.pointerId)
      joyRef.current = { cx: e.clientX, cy: e.clientY, dx: 0, dy: 0, id: e.pointerId }
    }
    const pMove = (e) => {
      const j = joyRef.current
      if (!j || j.id !== e.pointerId) return
      const dx = e.clientX - j.cx
      const dy = e.clientY - j.cy
      const len = Math.hypot(dx, dy) || 1
      const cap = Math.min(len, 48)
      j.dx = (dx / len) * (cap / 48)
      j.dy = (dy / len) * (cap / 48)
    }
    const pUp = (e) => {
      if (joyRef.current?.id === e.pointerId) joyRef.current = null
    }
    canvas.addEventListener('pointerdown', pDown)
    canvas.addEventListener('pointermove', pMove)
    canvas.addEventListener('pointerup', pUp)
    canvas.addEventListener('pointercancel', pUp)

    // ---- inbound peer positions ----
    const off = onMessage((msg) => {
      if (!msg || msg.t !== 'pos' || msg.id === myId) return
      const cur = peersRef.current.get(msg.id) || { x: msg.x, y: msg.y }
      peersRef.current.set(msg.id, {
        x: cur.x, y: cur.y,
        tx: msg.x, ty: msg.y,
        fx: msg.fx || 1, ghost: !!msg.g, moving: !!msg.m,
        seen: performance.now(),
      })
    })

    // ---- main loop ----
    const loop = (now) => {
      if (disposed) return
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const st = stateRef.current || {}
      const meSecret = meRef.current || {}
      const alive = st.alive || {}
      const iAmGhost = alive[myId] === false
      const isMundass = meSecret.role === 'mundass'
      const pos = posRef.current

      // -- move --
      let vx = 0
      let vy = 0
      if (!frozenRef.current) {
        const k = keysRef.current
        if (k['w'] || k['arrowup']) vy -= 1
        if (k['s'] || k['arrowdown']) vy += 1
        if (k['a'] || k['arrowleft']) vx -= 1
        if (k['d'] || k['arrowright']) vx += 1
        const j = joyRef.current
        if (j && (j.dx || j.dy)) { vx += j.dx; vy += j.dy }
        const len = Math.hypot(vx, vy)
        if (len > 1) { vx /= len; vy /= len }
      }
      const speed = iAmGhost ? GHOST_SPEED : SPEED
      if (vx || vy) {
        const next = moveWithCollision(pos.x, pos.y, vx * speed * dt, vy * speed * dt, iAmGhost)
        pos.x = next.x
        pos.y = next.y
        if (vx !== 0) pos.fx = vx > 0 ? 1 : -1
        pos.moving = true
      } else {
        pos.moving = false
      }

      // -- broadcast my position at 10 Hz (always: ghosts too, flagged) --
      if (now - lastSentRef.current > BROADCAST_MS) {
        lastSentRef.current = now
        sendBroadcast({ t: 'pos', id: myId, x: Math.round(pos.x), y: Math.round(pos.y), fx: pos.fx, g: iAmGhost ? 1 : 0, m: pos.moving ? 1 : 0 })
      }

      // -- HUD callbacks (only on change) --
      const inter = (!iAmGhost && st.phase === 'playing')
        ? nearestInteraction({
            x: pos.x, y: pos.y,
            myTasks: meSecret.tasks, bodies: st.bodies,
            isMundass, sabotage: st.sabotage,
          })
        : (iAmGhost && st.phase === 'playing')
          ? nearestInteraction({ x: pos.x, y: pos.y, myTasks: meSecret.tasks, bodies: [], isMundass: false, sabotage: null })
          : null
      const interKey = inter ? `${inter.kind}:${inter.taskId || inter.victim || inter.index || ''}` : ''
      if (interKey !== lastNearestRef.current) {
        lastNearestRef.current = interKey
        onNearest?.(inter)
      }
      let killTarget = null
      if (isMundass && !iAmGhost && st.phase === 'playing') {
        const mates = new Set(meSecret.mates || [])
        let best = KILL_RADIUS
        for (const [uid, peer] of peersRef.current) {
          if (mates.has(uid) || alive[uid] === false || peer.ghost) continue
          const d = dist(pos.x, pos.y, peer.x, peer.y)
          if (d <= best) { best = d; killTarget = uid }
        }
      }
      const killKey = killTarget ? `${killTarget}:${Math.round(pos.x)}` : ''
      if (killKey !== lastKillRef.current) {
        lastKillRef.current = killKey
        onKillTarget?.(killTarget ? { victim: killTarget, x: pos.x, y: pos.y } : null)
      }

      // -- draw --
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const vw = canvas.width / dpr
      const vh = canvas.height / dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#161a20'
      ctx.fillRect(0, 0, vw, vh)

      const scale = Math.max(0.55, Math.min(1.05, vw / 980))
      let camX = pos.x - vw / (2 * scale)
      let camY = pos.y - vh / (2 * scale)
      camX = Math.max(-80, Math.min(WORLD.w + 80 - vw / scale, camX))
      camY = Math.max(-80, Math.min(WORLD.h + 80 - vh / scale, camY))

      ctx.save()
      ctx.scale(scale, scale)
      ctx.translate(-camX, -camY)

      ctx.drawImage(mapLayer, 0, 0)

      // interaction pulse ring
      if (inter) {
        let px = 0
        let py = 0
        if (inter.kind === 'task') { px = STATIONS[inter.taskId].x; py = STATIONS[inter.taskId].y }
        else if (inter.kind === 'mihbash') { px = MIHBASH.x; py = MIHBASH.y }
        else if (inter.kind === 'breaker') { px = BREAKER.x; py = BREAKER.y }
        else if (inter.kind === 'manhole') { px = MANHOLES[inter.index].x; py = MANHOLES[inter.index].y }
        else if (inter.kind === 'report') {
          const b = (st.bodies || []).find((bb) => bb.victim === inter.victim)
          if (b) { px = b.x; py = b.y }
        }
        if (px) {
          const pulse = 30 + Math.sin(now / 180) * 6
          ctx.strokeStyle = 'rgba(255,220,120,0.9)'
          ctx.lineWidth = 4
          ctx.beginPath()
          ctx.arc(px, py, pulse, 0, Math.PI * 2)
          ctx.stroke()
        }
      }

      const colorOf = (uid) => {
        const row = (playersRef.current || []).find((p) => p.profile_id === uid)
        return COLORS[(row?.color || 0) % COLORS.length]
      }
      const nameOf = (uid) => {
        const row = (playersRef.current || []).find((p) => p.profile_id === uid)
        return row?.profile?.global_name || row?.profile?.username || '؟'
      }

      // bodies
      for (const b of st.bodies || []) {
        ctx.save()
        ctx.translate(b.x, b.y)
        drawNeighbor(ctx, colorOf(b.victim), { dead: true })
        ctx.restore()
      }

      // peers (lerp toward target; living clients don't see ghosts)
      const drawList = []
      for (const [uid, peer] of peersRef.current) {
        if (now - peer.seen > PEER_TTL_MS) { peersRef.current.delete(uid); continue }
        peer.x += (peer.tx - peer.x) * Math.min(1, dt * 12)
        peer.y += (peer.ty - peer.y) * Math.min(1, dt * 12)
        if (peer.ghost && !iAmGhost) continue
        drawList.push({ uid, x: peer.x, y: peer.y, fx: peer.fx, ghost: peer.ghost, moving: peer.moving, me: false })
      }
      drawList.push({ uid: myId, x: pos.x, y: pos.y, fx: pos.fx, ghost: iAmGhost, moving: pos.moving, me: true })
      drawList.sort((a, b) => a.y - b.y)
      for (const d of drawList) {
        const bob = d.moving ? Math.abs(Math.sin(now / 90)) * 5 : 0
        ctx.save()
        ctx.translate(d.x, d.y)
        drawNeighbor(ctx, colorOf(d.uid), { facing: d.fx, bob, ghost: d.ghost })
        ctx.restore()
        ctx.font = '700 16px "Segoe UI", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = d.me ? '#ffe9a8' : 'rgba(255,255,255,0.92)'
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.lineWidth = 3
        ctx.strokeText(nameOf(d.uid), d.x, d.y - 86)
        ctx.fillText(nameOf(d.uid), d.x, d.y - 86)
      }
      ctx.restore()

      // vision mask (ghosts and the mundass see through the blackout)
      const radius = (st.sabotage === 'power' && !isMundass && !iAmGhost) ? VISION_BLACKOUT : VISION
      const cx = (pos.x - camX) * scale
      const cy = (pos.y - camY) * scale
      const grad = ctx.createRadialGradient(cx, cy, radius * scale * 0.45, cx, cy, radius * scale)
      grad.addColorStop(0, 'rgba(10,12,16,0)')
      grad.addColorStop(1, iAmGhost ? 'rgba(10,12,16,0.55)' : 'rgba(10,12,16,0.93)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, vw, vh)

      schedule()
    }
    schedule()

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      ro.disconnect()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      canvas.removeEventListener('pointerdown', pDown)
      canvas.removeEventListener('pointermove', pMove)
      canvas.removeEventListener('pointerup', pUp)
      canvas.removeEventListener('pointercancel', pUp)
      off?.()
    }
  }, [myId, lang, onMessage, sendBroadcast, onNearest, onKillTarget, stateRef, meRef])

  return (
    <div ref={wrapRef} className="mun-canvas-wrap">
      <canvas ref={canvasRef} className="mun-canvas" />
    </div>
  )
})

export default MundassCanvas
