import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  WORLD, ROOMS, ALLEYS, STATIONS, MIHBASH, BREAKER, MANHOLES, COLORS,
  SPEED, GHOST_SPEED, VISION, VISION_BLACKOUT, KILL_RADIUS,
  moveWithCollision, nearestInteraction, spawnPoint, roomAt, dist,
} from './map.js'
import { drawNeighbor, roundRect } from './beanArt.js'

// المندس game view. The entire loop lives OUTSIDE React (refs + rAF): React only
// mounts the <canvas> and receives throttled "what can I do here" callbacks for
// the HUD (the Monopoly perf lesson — no per-frame setState, no infinite CSS
// loops). Movement is client-authoritative and shared over the ephemeral
// broadcast bus at 10 Hz; the server only ever validates roles/cooldowns.
//
// The hara itself (floors, rugs, olive tree, clothesline, string lights…) is
// prerendered ONCE into an offscreen layer — per-frame work is just a drawImage
// plus the dynamic actors, waypoints, vision mask, and feedback flashes.
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
//   onRoom(room|null)       — the room I'm standing in changed (HUD chip)
//   lang                    — 'en' | 'ar' (map labels)
//
// Imperative ref API: getPos(), teleport(x, y), respawn(index, count).

const BROADCAST_MS = 100
const PEER_TTL_MS = 6000

// ---------------------------------------------------------------- static layer
function buildMapLayer(lang) {
  const c = document.createElement('canvas')
  c.width = WORLD.w
  c.height = WORLD.h
  const ctx = c.getContext('2d')

  const glow = (x, y, r, color, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, color.replace('%a', String(a)))
    g.addColorStop(1, color.replace('%a', '0'))
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // -- night ground + scattered rubble --
  ctx.fillStyle = '#1b212b'
  ctx.fillRect(0, 0, WORLD.w, WORLD.h)
  ctx.fillStyle = 'rgba(255,255,255,0.025)'
  for (let i = 0; i < 260; i++) {
    const x = (i * 379.7) % WORLD.w
    const y = (i * 173.3) % WORLD.h
    ctx.fillRect(x, y, 3 + (i % 4), 2 + (i % 3))
  }

  // -- room floors --
  for (const r of ROOMS) {
    ctx.fillStyle = r.floor
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.save()
    ctx.beginPath()
    ctx.rect(r.x, r.y, r.w, r.h)
    ctx.clip()
    switch (r.id) {
      case 'courtyard': { // big sand flagstones
        ctx.strokeStyle = 'rgba(90,70,40,0.25)'
        ctx.lineWidth = 2
        for (let gx = r.x; gx < r.x + r.w; gx += 75) {
          for (let gy = r.y + ((gx / 75) % 2 ? 37 : 0); gy < r.y + r.h; gy += 75) {
            roundRect(ctx, gx + 3, gy + 3, 69, 69, 10)
            ctx.stroke()
          }
        }
        break
      }
      case 'kitchen': { // checkered tiles
        for (let gx = 0; gx < r.w; gx += 34) {
          for (let gy = 0; gy < r.h; gy += 34) {
            if (((gx + gy) / 34) % 2 === 0) {
              ctx.fillStyle = 'rgba(255,255,255,0.07)'
              ctx.fillRect(r.x + gx, r.y + gy, 34, 34)
            }
          }
        }
        break
      }
      case 'garden': { // grass tufts + soil rows
        ctx.strokeStyle = 'rgba(30,60,25,0.5)'
        ctx.lineWidth = 1.6
        for (let i = 0; i < 130; i++) {
          const x = r.x + ((i * 97.3) % r.w)
          const y = r.y + ((i * 53.9) % r.h)
          ctx.beginPath()
          ctx.moveTo(x, y)
          ctx.lineTo(x - 3, y - 7)
          ctx.moveTo(x, y)
          ctx.lineTo(x + 3, y - 7)
          ctx.stroke()
        }
        break
      }
      case 'garage': { // oil stains
        ctx.fillStyle = 'rgba(15,15,18,0.35)'
        ctx.beginPath(); ctx.ellipse(r.x + 150, r.y + 190, 46, 22, 0.4, 0, Math.PI * 2); ctx.fill()
        ctx.beginPath(); ctx.ellipse(r.x + 300, r.y + 90, 30, 15, -0.3, 0, Math.PI * 2); ctx.fill()
        break
      }
      case 'roof': { // concrete slabs
        ctx.strokeStyle = 'rgba(0,0,0,0.16)'
        ctx.lineWidth = 2
        for (let gx = 0; gx < r.w; gx += 100) { ctx.beginPath(); ctx.moveTo(r.x + gx, r.y); ctx.lineTo(r.x + gx, r.y + r.h); ctx.stroke() }
        for (let gy = 0; gy < r.h; gy += 100) { ctx.beginPath(); ctx.moveTo(r.x, r.y + gy); ctx.lineTo(r.x + r.w, r.y + gy); ctx.stroke() }
        break
      }
      default: { // generic tiling
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'
        ctx.lineWidth = 1
        for (let gx = 40; gx < r.w; gx += 40) { ctx.beginPath(); ctx.moveTo(r.x + gx, r.y); ctx.lineTo(r.x + gx, r.y + r.h); ctx.stroke() }
        for (let gy = 40; gy < r.h; gy += 40) { ctx.beginPath(); ctx.moveTo(r.x, r.y + gy); ctx.lineTo(r.x + r.w, r.y + gy); ctx.stroke() }
      }
    }
    // soft inner shadow around each room's edge (depth)
    const ig = ctx.createLinearGradient(r.x, r.y, r.x, r.y + 26)
    ig.addColorStop(0, 'rgba(0,0,0,0.3)')
    ig.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = ig
    ctx.fillRect(r.x, r.y, r.w, 26)
    ctx.restore()
  }

  // -- walls (then alleys punch doorways through them) --
  for (const r of ROOMS) {
    ctx.strokeStyle = '#0f0c08'
    ctx.lineWidth = 10
    ctx.strokeRect(r.x, r.y, r.w, r.h)
    ctx.strokeStyle = 'rgba(214,177,121,0.3)'
    ctx.lineWidth = 2.5
    ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10)
  }

  // -- alleys: worn cobblestone, painted OVER walls → natural doorways --
  for (const a of ALLEYS) {
    ctx.fillStyle = '#454e5c'
    ctx.fillRect(a.x, a.y, a.w, a.h)
    ctx.save()
    ctx.beginPath()
    ctx.rect(a.x, a.y, a.w, a.h)
    ctx.clip()
    ctx.strokeStyle = 'rgba(0,0,0,0.28)'
    ctx.lineWidth = 1.6
    for (let gx = a.x; gx < a.x + a.w + 46; gx += 46) {
      for (let gy = a.y + ((gx / 46) % 2 ? 21 : 0); gy < a.y + a.h + 42; gy += 42) {
        roundRect(ctx, gx + 2, gy + 2, 42, 38, 9)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  // ---- props ----
  const emoji = (e, x, y, size = 34) => {
    ctx.font = `${size}px system-ui`
    ctx.textAlign = 'center'
    ctx.fillText(e, x, y)
  }

  // Diwan: sadu rug + cushions
  {
    const r = ROOMS.find((rr) => rr.id === 'diwan')
    ctx.save()
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2 + 14)
    roundRect(ctx, -150, -70, 300, 140, 10)
    ctx.fillStyle = '#7d2430'
    ctx.fill()
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? '#3a1017' : '#c8a24a'
      ctx.fillRect(-150, -70 + 22 + i * 22, 300, 8)
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.lineWidth = 3
    roundRect(ctx, -150, -70, 300, 140, 10)
    ctx.stroke()
    ctx.restore()
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#8a3a3a' : '#4a6741'
      ctx.beginPath()
      ctx.arc(r.x + 60 + i * 90, r.y + 46, 17, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // Kitchen: counter + pots
  {
    const r = ROOMS.find((rr) => rr.id === 'kitchen')
    ctx.fillStyle = '#6b5238'
    ctx.fillRect(r.x + 14, r.y + 14, r.w - 28, 44)
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    ctx.strokeRect(r.x + 14, r.y + 14, r.w - 28, 44)
    emoji('🍲', r.x + 60, r.y + 48, 26)
    emoji('🫙', r.x + 240, r.y + 46, 22)
  }
  // Roof: water tank + dish pad + clothesline
  {
    const r = ROOMS.find((rr) => rr.id === 'roof')
    // the iconic rooftop water tank
    ctx.fillStyle = '#3b4654'
    ctx.beginPath()
    ctx.ellipse(r.x + 70, r.y + 90, 34, 26, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 3
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.beginPath()
    ctx.ellipse(r.x + 70, r.y + 82, 26, 16, 0, Math.PI, Math.PI * 2)
    ctx.stroke()
    // clothesline: two posts + sagging wire (clothes hung at the task station)
    const lx = r.x + 40
    const rx2 = r.x + r.w - 40
    const ly = r.y + 250
    ctx.strokeStyle = '#2a2119'
    ctx.lineWidth = 6
    ctx.beginPath(); ctx.moveTo(lx, ly - 46); ctx.lineTo(lx, ly + 8); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(rx2, ly - 46); ctx.lineTo(rx2, ly + 8); ctx.stroke()
    ctx.strokeStyle = 'rgba(220,220,220,0.55)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(lx, ly - 42)
    ctx.quadraticCurveTo((lx + rx2) / 2, ly - 28, rx2, ly - 42)
    ctx.stroke()
    ;['👕', '🩳', '🧦'].forEach((e2, i) => emoji(e2, lx + 80 + i * 90, ly - 16, 24))
  }
  // Garden: olive tree + planters + low stone wall
  {
    const r = ROOMS.find((rr) => rr.id === 'garden')
    const tx = r.x + 320
    const ty = r.y + 120
    ctx.strokeStyle = '#4a3524'
    ctx.lineWidth = 14
    ctx.beginPath(); ctx.moveTo(tx, ty + 60); ctx.quadraticCurveTo(tx - 6, ty + 20, tx + 4, ty - 6); ctx.stroke()
    for (const [ox, oy, rad] of [[-34, -30, 34], [10, -52, 40], [44, -22, 30], [0, -14, 36]]) {
      ctx.fillStyle = '#3f5c35'
      ctx.beginPath(); ctx.arc(tx + ox, ty + oy, rad, 0, Math.PI * 2); ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.beginPath(); ctx.arc(tx + ox - rad * 0.3, ty + oy - rad * 0.3, rad * 0.55, 0, Math.PI * 2); ctx.fill()
    }
    ctx.fillStyle = '#2c3f26'
    for (const [ox, oy] of [[-20, -36], [18, -48], [40, -16], [-4, -8], [28, -38]]) {
      ctx.beginPath(); ctx.arc(tx + ox, ty + oy, 3.4, 0, Math.PI * 2); ctx.fill()
    }
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = '#5d442e'
      roundRect(ctx, r.x + 40, r.y + 190 + i * 34, 150, 22, 6)
      ctx.fill()
      ctx.fillStyle = '#33502b'
      for (let px = 0; px < 5; px++) emoji('🌱', r.x + 58 + px * 30, r.y + 206 + i * 34, 15)
    }
  }
  // Shop: shelves + counter
  {
    const r = ROOMS.find((rr) => rr.id === 'shop')
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = '#4e3b26'
      ctx.fillRect(r.x + 16, r.y + 40 + i * 62, r.w - 32, 40)
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'
      ctx.strokeRect(r.x + 16, r.y + 40 + i * 62, r.w - 32, 40)
      const goods = ['🥫', '🫙', '🧴', '🍬', '🧃']
      for (let gI = 0; gI < 5; gI++) emoji(goods[(gI + i * 2) % goods.length], r.x + 46 + gI * 56, r.y + 70 + i * 62, 22)
    }
  }
  // Power room: breaker box + hazard stripes + cables
  {
    const r = ROOMS.find((rr) => rr.id === 'power')
    ctx.fillStyle = '#5b616b'
    roundRect(ctx, BREAKER.x - 30, BREAKER.y - 44, 60, 74, 6)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'
    ctx.lineWidth = 3
    roundRect(ctx, BREAKER.x - 30, BREAKER.y - 44, 60, 74, 6)
    ctx.stroke()
    ctx.save()
    ctx.beginPath()
    ctx.rect(BREAKER.x - 30, BREAKER.y + 14, 60, 16)
    ctx.clip()
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#d9a821' : '#1c1c1c'
      ctx.save()
      ctx.translate(BREAKER.x - 30 + i * 10, BREAKER.y + 22)
      ctx.rotate(-0.6)
      ctx.fillRect(-4, -14, 8, 30)
      ctx.restore()
    }
    ctx.restore()
    emoji('⚡', BREAKER.x, BREAKER.y - 6, 26)
    ctx.strokeStyle = 'rgba(20,20,20,0.65)'
    ctx.lineWidth = 4
    ctx.beginPath()
    ctx.moveTo(BREAKER.x + 30, BREAKER.y - 30)
    ctx.quadraticCurveTo(r.x + r.w - 40, r.y + 60, r.x + r.w - 24, r.y + 140)
    ctx.stroke()
  }
  // Garage: the old car + gas cylinders + tire
  {
    const r = ROOMS.find((rr) => rr.id === 'garage')
    ctx.save()
    ctx.translate(r.x + 150, r.y + 150)
    ctx.rotate(-0.06)
    ctx.fillStyle = '#7c4a3a'
    roundRect(ctx, -95, -48, 190, 96, 26)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    ctx.lineWidth = 3
    roundRect(ctx, -95, -48, 190, 96, 26)
    ctx.stroke()
    ctx.fillStyle = 'rgba(160,210,235,0.5)'
    roundRect(ctx, -38, -40, 46, 80, 10)
    ctx.fill()
    roundRect(ctx, 34, -38, 30, 76, 9)
    ctx.fill()
    ctx.fillStyle = '#181818'
    for (const [wx, wy] of [[-70, -52], [42, -52], [-70, 44], [42, 44]]) {
      roundRect(ctx, wx, wy, 34, 10, 5)
      ctx.fill()
    }
    ctx.restore()
    ctx.fillStyle = '#22262c'
    ctx.beginPath(); ctx.arc(r.x + 320, r.y + 200, 20, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = '#3a4048'
    ctx.lineWidth = 5
    ctx.beginPath(); ctx.arc(r.x + 320, r.y + 200, 12, 0, Math.PI * 2); ctx.stroke()
  }
  // Water tap: basin + jerrycans + puddle
  {
    const r = ROOMS.find((rr) => rr.id === 'tap')
    ctx.fillStyle = 'rgba(90,140,160,0.25)'
    ctx.beginPath()
    ctx.ellipse(STATIONS.water.x, STATIONS.water.y + 34, 52, 18, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#5a6672'
    roundRect(ctx, STATIONS.water.x - 44, STATIONS.water.y - 20, 88, 30, 8)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    roundRect(ctx, STATIONS.water.x - 44, STATIONS.water.y - 20, 88, 30, 8)
    ctx.stroke()
    emoji('🛢️', r.x + 90, r.y + 200, 26)
    emoji('🧴', r.x + 130, r.y + 206, 20)
  }
  // Courtyard: mihbash dais + planters + fairy-light strings
  {
    const r = ROOMS.find((rr) => rr.id === 'courtyard')
    ctx.fillStyle = '#a89066'
    ctx.beginPath(); ctx.arc(MIHBASH.x, MIHBASH.y + 8, 46, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#8a744d'
    ctx.beginPath(); ctx.arc(MIHBASH.x, MIHBASH.y + 8, 34, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.arc(MIHBASH.x, MIHBASH.y + 8, 46, 0, Math.PI * 2); ctx.stroke()
    for (const [px, py] of [[r.x + 34, r.y + 40], [r.x + r.w - 34, r.y + 40], [r.x + 34, r.y + r.h - 36], [r.x + r.w - 34, r.y + r.h - 36]]) {
      ctx.fillStyle = '#6d4c33'
      roundRect(ctx, px - 20, py - 14, 40, 26, 6)
      ctx.fill()
      emoji('🌺', px, py + 2, 20)
    }
    // sagging light strings across the courtyard
    const strings = [
      [r.x + 10, r.y + 20, r.x + r.w - 10, r.y + 64],
      [r.x + 16, r.y + r.h - 60, r.x + r.w - 16, r.y + r.h - 18],
    ]
    for (const [x1, y1, x2, y2] of strings) {
      ctx.strokeStyle = 'rgba(30,25,18,0.8)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.quadraticCurveTo((x1 + x2) / 2, Math.max(y1, y2) + 30, x2, y2)
      ctx.stroke()
      for (let i = 1; i < 10; i++) {
        const tt = i / 10
        const bx = (1 - tt) * (1 - tt) * x1 + 2 * (1 - tt) * tt * ((x1 + x2) / 2) + tt * tt * x2
        const by = (1 - tt) * (1 - tt) * y1 + 2 * (1 - tt) * tt * (Math.max(y1, y2) + 30) + tt * tt * y2
        glow(bx, by, 16, 'rgba(255,205,110,%a)', 0.5)
        ctx.fillStyle = '#ffd98a'
        ctx.beginPath(); ctx.arc(bx, by, 3, 0, Math.PI * 2); ctx.fill()
      }
    }
  }

  // -- task stations: stone pad + glow + icon --
  for (const id of Object.keys(STATIONS)) {
    const s = STATIONS[id]
    glow(s.x, s.y, 56, 'rgba(255,214,130,%a)', 0.22)
    ctx.fillStyle = 'rgba(255,255,255,0.10)'
    ctx.beginPath(); ctx.arc(s.x, s.y, 27, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(255,214,130,0.35)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(s.x, s.y, 27, 0, Math.PI * 2); ctx.stroke()
    emoji(s.icon, s.x, s.y + 12, 32)
  }

  // -- mihbash icon + label --
  glow(MIHBASH.x, MIHBASH.y, 80, 'rgba(255,205,110,%a)', 0.3)
  emoji('🏺', MIHBASH.x, MIHBASH.y + 12, 40)
  ctx.font = '700 19px "Segoe UI", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,225,150,0.85)'
  ctx.fillText(lang === 'ar' ? 'المهباش' : 'Mihbash', MIHBASH.x, MIHBASH.y + 56)

  // -- manholes with grates --
  for (const m of MANHOLES) {
    ctx.fillStyle = '#2c313a'
    ctx.beginPath(); ctx.arc(m.x, m.y, 23, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'
    ctx.lineWidth = 3.5
    ctx.stroke()
    ctx.strokeStyle = 'rgba(255,255,255,0.14)'
    ctx.lineWidth = 2
    ctx.beginPath(); ctx.arc(m.x, m.y, 15, 0, Math.PI * 2); ctx.stroke()
    ctx.beginPath()
    for (let i = -1; i <= 1; i++) { ctx.moveTo(m.x - 12, m.y + i * 7); ctx.lineTo(m.x + 12, m.y + i * 7) }
    ctx.stroke()
  }

  // -- room name plaques --
  for (const r of ROOMS) {
    const primary = lang === 'ar' ? r.ar : r.en
    const secondary = lang === 'ar' ? r.en : r.ar
    ctx.font = '800 26px "Segoe UI", system-ui, sans-serif'
    const w = Math.max(120, ctx.measureText(primary).width + 40)
    const px = r.x + r.w / 2
    const py = r.y + (r.id === 'courtyard' ? r.h - 34 : 40)
    ctx.fillStyle = 'rgba(15,12,8,0.72)'
    roundRect(ctx, px - w / 2, py - 22, w, 46, 12)
    ctx.fill()
    ctx.strokeStyle = 'rgba(214,177,121,0.4)'
    ctx.lineWidth = 1.5
    roundRect(ctx, px - w / 2, py - 22, w, 46, 12)
    ctx.stroke()
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(255,232,180,0.92)'
    ctx.fillText(primary, px, py + 3)
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,232,180,0.5)'
    ctx.fillText(secondary, px, py + 18)
  }

  // -- doorway lamp glows --
  for (const [gx, gy] of [[300, 620], [1000, 400], [1000, 900], [1680, 650], [300, 940], [1320, 620]]) {
    glow(gx, gy, 90, 'rgba(255,190,100,%a)', 0.14)
  }

  // -- edge vignette --
  const vg = ctx.createRadialGradient(WORLD.w / 2, WORLD.h / 2, WORLD.h * 0.45, WORLD.w / 2, WORLD.h / 2, WORLD.w * 0.72)
  vg.addColorStop(0, 'rgba(10,12,16,0)')
  vg.addColorStop(1, 'rgba(10,12,16,0.55)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, WORLD.w, WORLD.h)

  return c
}

// ---------------------------------------------------------------- component
const MundassCanvas = forwardRef(function MundassCanvas(
  { myId, players, stateRef, meRef, frozen, sendBroadcast, onMessage, onNearest, onKillTarget, onRoom, lang = 'en' },
  ref,
) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const posRef = useRef({ x: 1000, y: 720, fx: 1, moving: false })
  const velRef = useRef({ x: 0, y: 0 })
  const walkRef = useRef(0)
  const camRef = useRef({ x: 0, y: 0, init: false })
  const peersRef = useRef(new Map()) // uid -> {x,y,tx,ty,fx,ghost,moving,seen}
  const keysRef = useRef({})
  const joyRef = useRef(null)
  const frozenRef = useRef(frozen)
  const lastSentRef = useRef(0)
  const lastSentPosRef = useRef(null)
  const lastNearestRef = useRef('')
  const lastKillRef = useRef('')
  const lastRoomRef = useRef('')
  const playersRef = useRef(players)
  const bodiesLenRef = useRef(0)
  const wasAliveRef = useRef(true)
  const flashRef = useRef(0) // red feedback vignette deadline (ms epoch)
  const flashStrongRef = useRef(false)

  frozenRef.current = frozen
  playersRef.current = players

  useImperativeHandle(ref, () => ({
    getPos: () => ({ ...posRef.current }),
    teleport: (x, y) => {
      posRef.current.x = x
      posRef.current.y = y
      camRef.current.init = false
    },
    respawn: (index, count) => {
      const p = spawnPoint(index, count)
      posRef.current.x = p.x
      posRef.current.y = p.y
      camRef.current.init = false
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

    const down = (e) => {
      if (e.repeat) return
      keysRef.current[e.key.toLowerCase()] = true
    }
    const up = (e) => { keysRef.current[e.key.toLowerCase()] = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

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

      // ---- feedback flashes: a fresh body / my own death ----
      const nBodies = (st.bodies || []).length
      if (nBodies > bodiesLenRef.current) {
        flashRef.current = now + 500
        flashStrongRef.current = false
      }
      bodiesLenRef.current = nBodies
      if (wasAliveRef.current && iAmGhost) {
        flashRef.current = now + 950
        flashStrongRef.current = true
      }
      if (alive[myId] !== false) wasAliveRef.current = true
      else wasAliveRef.current = false

      // ---- movement with acceleration ----
      let ix = 0
      let iy = 0
      if (!frozenRef.current) {
        const k = keysRef.current
        if (k['w'] || k['arrowup']) iy -= 1
        if (k['s'] || k['arrowdown']) iy += 1
        if (k['a'] || k['arrowleft']) ix -= 1
        if (k['d'] || k['arrowright']) ix += 1
        const j = joyRef.current
        if (j && (j.dx || j.dy)) { ix += j.dx; iy += j.dy }
        const len = Math.hypot(ix, iy)
        if (len > 1) { ix /= len; iy /= len }
      }
      const speed = iAmGhost ? GHOST_SPEED : SPEED
      const vel = velRef.current
      const blend = Math.min(1, dt * 12)
      vel.x += (ix * speed - vel.x) * blend
      vel.y += (iy * speed - vel.y) * blend
      if (Math.hypot(vel.x, vel.y) > 8) {
        const next = moveWithCollision(pos.x, pos.y, vel.x * dt, vel.y * dt, iAmGhost)
        pos.x = next.x
        pos.y = next.y
        if (Math.abs(vel.x) > 20) pos.fx = vel.x > 0 ? 1 : -1
        pos.moving = (ix !== 0 || iy !== 0)
        if (pos.moving) walkRef.current += dt * 2.6
      } else {
        pos.moving = false
      }

      // ---- position broadcast: adaptive rate + idle keepalive ----
      // Big nights (15 players) at a fixed 10 Hz would push ~150 msg/s through
      // one channel — enough to brush realtime throttling. So the send rate
      // scales down with the head-count, and a standing-still player sends only
      // a 1s keepalive (so peers never time them out). The receiving side's
      // interpolation smooths the lower rate invisibly.
      const headCount = (playersRef.current || []).length
      const sendEvery = headCount > 12 ? 200 : headCount > 8 ? 150 : BROADCAST_MS
      const lastP = lastSentPosRef.current
      const movedSinceSend = !lastP
        || Math.abs(lastP.x - pos.x) > 1 || Math.abs(lastP.y - pos.y) > 1
        || lastP.m !== pos.moving || lastP.g !== iAmGhost || lastP.fx !== pos.fx
      const sinceSend = now - lastSentRef.current
      if ((movedSinceSend && sinceSend >= sendEvery) || sinceSend >= 1000) {
        lastSentRef.current = now
        lastSentPosRef.current = { x: pos.x, y: pos.y, m: pos.moving, g: iAmGhost, fx: pos.fx }
        sendBroadcast({ t: 'pos', id: myId, x: Math.round(pos.x), y: Math.round(pos.y), fx: pos.fx, g: iAmGhost ? 1 : 0, m: pos.moving ? 1 : 0 })
      }

      // ---- HUD callbacks (only on change) ----
      const inter = (st.phase === 'playing')
        ? nearestInteraction({
            x: pos.x, y: pos.y,
            myTasks: meSecret.tasks,
            bodies: iAmGhost ? [] : st.bodies,
            isMundass: isMundass && !iAmGhost,
            sabotage: st.sabotage,
          })
        : null
      const ghostSafe = iAmGhost && inter && inter.kind !== 'task' ? null : inter
      const interKey = ghostSafe ? `${ghostSafe.kind}:${ghostSafe.taskId || ghostSafe.victim || ghostSafe.index || ''}` : ''
      if (interKey !== lastNearestRef.current) {
        lastNearestRef.current = interKey
        onNearest?.(ghostSafe)
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
      const room = roomAt(pos.x, pos.y)
      const roomKey = room?.id || ''
      if (roomKey !== lastRoomRef.current) {
        lastRoomRef.current = roomKey
        onRoom?.(room || null)
      }

      // ---- camera (smoothed) ----
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const vw = canvas.width / dpr
      const vh = canvas.height / dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#131820'
      ctx.fillRect(0, 0, vw, vh)

      const scale = Math.max(0.55, Math.min(1.05, vw / 980))
      const cam = camRef.current
      let tx2 = pos.x - vw / (2 * scale)
      let ty2 = pos.y - vh / (2 * scale)
      tx2 = Math.max(-80, Math.min(WORLD.w + 80 - vw / scale, tx2))
      ty2 = Math.max(-80, Math.min(WORLD.h + 80 - vh / scale, ty2))
      if (!cam.init) { cam.x = tx2; cam.y = ty2; cam.init = true }
      const cb = Math.min(1, dt * 7)
      cam.x += (tx2 - cam.x) * cb
      cam.y += (ty2 - cam.y) * cb

      ctx.save()
      ctx.scale(scale, scale)
      ctx.translate(-cam.x, -cam.y)
      ctx.drawImage(mapLayer, 0, 0)

      // mihbash idle pulse (only when callable)
      if (st.phase === 'playing' && !st.sabotage) {
        const pr = 40 + Math.sin(now / 500) * 5
        ctx.strokeStyle = 'rgba(255,214,130,0.35)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(MIHBASH.x, MIHBASH.y + 4, pr, 0, Math.PI * 2)
        ctx.stroke()
      }

      // my undone task waypoints — bobbing gold markers over the stations
      if (st.phase === 'playing' && Array.isArray(meSecret.tasks)) {
        for (const task of meSecret.tasks) {
          if (task.done) continue
          const s = STATIONS[task.id]
          if (!s) continue
          const by = s.y - 52 + Math.sin(now / 260 + s.x) * 5
          ctx.fillStyle = 'rgba(255,214,90,0.95)'
          ctx.save()
          ctx.translate(s.x, by)
          ctx.rotate(Math.PI / 4)
          ctx.fillRect(-8, -8, 16, 16)
          ctx.restore()
          ctx.fillStyle = '#3a2c08'
          ctx.font = '900 15px "Segoe UI", system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('!', s.x, by + 5)
        }
      }

      // interaction pulse ring
      if (ghostSafe) {
        let px = 0
        let py = 0
        if (ghostSafe.kind === 'task') { px = STATIONS[ghostSafe.taskId].x; py = STATIONS[ghostSafe.taskId].y }
        else if (ghostSafe.kind === 'mihbash') { px = MIHBASH.x; py = MIHBASH.y }
        else if (ghostSafe.kind === 'breaker') { px = BREAKER.x; py = BREAKER.y }
        else if (ghostSafe.kind === 'manhole') { px = MANHOLES[ghostSafe.index].x; py = MANHOLES[ghostSafe.index].y }
        else if (ghostSafe.kind === 'report') {
          const b = (st.bodies || []).find((bb) => bb.victim === ghostSafe.victim)
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

      // actors (peers lerped; living clients don't see ghosts)
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
        const gait = d.moving ? (d.me ? walkRef.current : now / 240) : 0
        const bob = d.moving ? Math.abs(Math.sin(gait * Math.PI * 2)) * 4 : 0
        ctx.save()
        ctx.translate(d.x, d.y)
        drawNeighbor(ctx, colorOf(d.uid), { facing: d.fx, bob, walk: d.moving ? gait % 1 : 0, ghost: d.ghost, t: now })
        ctx.restore()
        ctx.font = '700 16px "Segoe UI", system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillStyle = d.me ? '#ffe9a8' : 'rgba(255,255,255,0.92)'
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'
        ctx.lineWidth = 3
        ctx.strokeText(nameOf(d.uid), d.x, d.y - 88)
        ctx.fillText(nameOf(d.uid), d.x, d.y - 88)
      }
      ctx.restore()

      // ---- vision mask ----
      const radius = (st.sabotage === 'power' && !isMundass && !iAmGhost) ? VISION_BLACKOUT : VISION
      const cx = (pos.x - cam.x) * scale
      const cy = (pos.y - cam.y) * scale
      const grad = ctx.createRadialGradient(cx, cy, radius * scale * 0.42, cx, cy, radius * scale)
      grad.addColorStop(0, 'rgba(8,10,14,0)')
      grad.addColorStop(0.72, iAmGhost ? 'rgba(8,10,14,0.3)' : 'rgba(8,10,14,0.62)')
      grad.addColorStop(1, iAmGhost ? 'rgba(8,10,14,0.55)' : 'rgba(8,10,14,0.94)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, vw, vh)

      // ---- edge arrow toward my nearest undone task (post-mask, always legible) ----
      if (st.phase === 'playing' && !frozenRef.current && Array.isArray(meSecret.tasks)) {
        let nearestS = null
        let nd = Infinity
        for (const task of meSecret.tasks) {
          if (task.done) continue
          const s = STATIONS[task.id]
          if (!s) continue
          const d = dist(pos.x, pos.y, s.x, s.y)
          if (d < nd) { nd = d; nearestS = s }
        }
        if (nearestS && nd > VISION * 0.9) {
          const ang = Math.atan2(nearestS.y - pos.y, nearestS.x - pos.x)
          const m = 46
          const ax = Math.max(m, Math.min(vw - m, cx + Math.cos(ang) * (Math.min(vw, vh) / 2 - m)))
          const ay = Math.max(m, Math.min(vh - m, cy + Math.sin(ang) * (Math.min(vw, vh) / 2 - m)))
          ctx.save()
          ctx.translate(ax, ay)
          ctx.rotate(ang)
          ctx.fillStyle = 'rgba(255,214,90,0.85)'
          ctx.beginPath()
          ctx.moveTo(14, 0)
          ctx.lineTo(-8, -9)
          ctx.lineTo(-4, 0)
          ctx.lineTo(-8, 9)
          ctx.closePath()
          ctx.fill()
          ctx.rotate(-ang)
          ctx.font = '16px system-ui'
          ctx.textAlign = 'center'
          ctx.fillText(nearestS.icon, 0, -14)
          ctx.restore()
        }
      }

      // ---- red feedback vignette (fresh body / my death) ----
      if (now < flashRef.current) {
        const k = (flashRef.current - now) / (flashStrongRef.current ? 950 : 500)
        const a = (flashStrongRef.current ? 0.5 : 0.28) * k
        const rg = ctx.createRadialGradient(vw / 2, vh / 2, Math.min(vw, vh) * 0.3, vw / 2, vh / 2, Math.max(vw, vh) * 0.72)
        rg.addColorStop(0, 'rgba(180,20,20,0)')
        rg.addColorStop(1, `rgba(180,20,20,${a})`)
        ctx.fillStyle = rg
        ctx.fillRect(0, 0, vw, vh)
      }

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
  }, [myId, lang, onMessage, sendBroadcast, onNearest, onKillTarget, onRoom, stateRef, meRef])

  return (
    <div ref={wrapRef} className="mun-canvas-wrap">
      <canvas ref={canvasRef} className="mun-canvas" />
    </div>
  )
})

export default MundassCanvas
