// المندس — the حارة (old Amman neighborhood) world map.
// Pure data + geometry helpers; the canvas renders from this, the HUD reads
// station proximity from it. World units are abstract pixels (~2000×1300).
// Walkability is the UNION of rects (rooms + courtyard + alleys): a move is
// legal if the feet-point stays inside any rect, which makes doorways free —
// rooms and alleys simply overlap.

export const WORLD = { w: 2000, h: 1300 }

// Rooms of the hara. `floor` tints the floor; labels are bilingual.
export const ROOMS = [
  { id: 'courtyard', en: 'Courtyard', ar: 'ساحة الحارة', x: 700, y: 450, w: 600, h: 400, floor: '#c9b18a' },
  { id: 'diwan', en: 'Diwan', ar: 'الديوان', x: 80, y: 80, w: 420, h: 300, floor: '#b48a63' },
  { id: 'kitchen', en: 'Kitchen', ar: 'المطبخ', x: 640, y: 80, w: 340, h: 280, floor: '#9aa06b' },
  { id: 'roof', en: 'Rooftop', ar: 'السطح', x: 1120, y: 80, w: 400, h: 300, floor: '#8f9bb0' },
  { id: 'shop', en: 'Corner shop', ar: 'الدكانة', x: 80, y: 520, w: 340, h: 280, floor: '#ad8b5e' },
  { id: 'power', en: 'Electrical', ar: 'غرفة الكهرباء', x: 1600, y: 520, w: 320, h: 260, floor: '#8a8f98' },
  { id: 'garden', en: 'Garden', ar: 'الحاكورة', x: 80, y: 940, w: 420, h: 300, floor: '#7d9c6a' },
  { id: 'garage', en: 'Garage', ar: 'الكراج', x: 760, y: 980, w: 400, h: 260, floor: '#97918a' },
  { id: 'tap', en: 'Water tap', ar: 'حنفية الحارة', x: 1480, y: 980, w: 440, h: 260, floor: '#7f9aa3' },
]

// Alleys (walkable connectors). Drawn as darker stone.
export const ALLEYS = [
  { x: 80, y: 590, w: 1840, h: 120 }, // main horizontal alley
  { x: 940, y: 80, w: 120, h: 1140 }, // main vertical alley
  { x: 240, y: 360, w: 120, h: 290 }, // diwan ↓
  { x: 1260, y: 360, w: 120, h: 290 }, // rooftop ↓
  { x: 240, y: 650, w: 120, h: 350 }, // ↓ garden
  { x: 1620, y: 650, w: 120, h: 380 }, // ↓ water tap
]

const WALKABLE = [...ROOMS.map(({ x, y, w, h }) => ({ x, y, w, h })), ...ALLEYS]

// Task stations: engine TASK_IDS → world position + emoji prop + bilingual name.
export const STATIONS = {
  wires: { x: 1780, y: 620, room: 'power', icon: '🔌', en: 'Connect the wires', ar: 'وصّل الأسلاك' },
  tea: { x: 800, y: 180, room: 'kitchen', icon: '🫖', en: 'Make the tea', ar: 'اعمل شاي' },
  satellite: { x: 1400, y: 170, room: 'roof', icon: '📡', en: 'Fix the satellite', ar: 'ظبّط الستلايت' },
  laundry: { x: 1210, y: 300, room: 'roof', icon: '👕', en: 'Hang the laundry', ar: 'انشر الغسيل' },
  coffee: { x: 270, y: 190, room: 'diwan', icon: '☕', en: 'Grind the coffee', ar: 'اطحن القهوة' },
  plants: { x: 190, y: 1120, room: 'garden', icon: '🪴', en: 'Water the plants', ar: 'اسقِ الزرع' },
  olives: { x: 400, y: 1030, room: 'garden', icon: '🫒', en: 'Pick the olives', ar: 'اقطف الزيتون' },
  shelf: { x: 230, y: 620, room: 'shop', icon: '🛒', en: 'Stock the shelf', ar: 'رتّب الدكانة' },
  gas: { x: 950, y: 1120, room: 'garage', icon: '🛢️', en: 'Swap the gas cylinder', ar: 'بدّل جرة الغاز' },
  water: { x: 1740, y: 1100, room: 'tap', icon: '🚰', en: 'Fill the jerrycan', ar: 'عبّي المي' },
}

// The mihbash (brass coffee grinder) — banging it calls the neighborhood meeting.
export const MIHBASH = { x: 1000, y: 620 }
// Breaker box — fixes the power cut.
export const BREAKER = { x: 1650, y: 700 }
// Manholes (بالوعات) — mundass-only fast travel, cycled in order.
export const MANHOLES = [
  { x: 780, y: 810, room: 'courtyard' },
  { x: 830, y: 1190, room: 'garage' },
  { x: 150, y: 990, room: 'garden' },
]

export const SPAWN = { x: 1000, y: 720, ring: 90 } // circle below the mihbash

export const INTERACT_RADIUS = 95
export const KILL_RADIUS = 85
export const REPORT_RADIUS = 110
export const SPEED = 260 // world units / s
export const GHOST_SPEED = 320
export const VISION = 360
export const VISION_BLACKOUT = 160 // crew vision during a power cut

// Player palette — 16 distinct, hara-flavored colors (index = players.color).
// 16 = the room cap; big Discord nights run 15 at a time.
export const COLORS = [
  '#ce1126', // Jordanian red
  '#2d7d46', // flag green
  '#2563eb', // blue
  '#f59e0b', // amber
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#0d9488', // teal
  '#f97316', // orange
  '#64748b', // slate
  '#a16207', // olive-brown
  '#ece5d5', // white
  '#2e3540', // charcoal
  '#56ccf2', // sky
  '#9acd32', // lime
  '#8b5a2b', // brown
  '#c026d3', // magenta
]
export const COLOR_NAMES = [
  { en: 'Red', ar: 'أحمر' }, { en: 'Green', ar: 'أخضر' }, { en: 'Blue', ar: 'أزرق' },
  { en: 'Amber', ar: 'عنبري' }, { en: 'Violet', ar: 'بنفسجي' }, { en: 'Pink', ar: 'زهري' },
  { en: 'Teal', ar: 'تركوازي' }, { en: 'Orange', ar: 'برتقالي' }, { en: 'Slate', ar: 'رمادي' },
  { en: 'Olive', ar: 'زيتوني' }, { en: 'White', ar: 'أبيض' }, { en: 'Charcoal', ar: 'فحمي' },
  { en: 'Sky', ar: 'سماوي' }, { en: 'Lime', ar: 'ليموني' }, { en: 'Brown', ar: 'بني' },
  { en: 'Magenta', ar: 'أرجواني' },
]

function inRect(x, y, r, pad = 0) {
  return x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad
}

export function isWalkable(x, y) {
  for (const r of WALKABLE) if (inRect(x, y, r, -6)) return true
  return false
}

/** Axis-separated collision slide: returns the allowed new position. */
export function moveWithCollision(x, y, dx, dy, ghost = false) {
  if (ghost) {
    // Ghosts drift through walls but stay inside the world.
    return {
      x: Math.min(WORLD.w - 40, Math.max(40, x + dx)),
      y: Math.min(WORLD.h - 40, Math.max(40, y + dy)),
    }
  }
  let nx = x
  let ny = y
  if (dx !== 0 && isWalkable(x + dx, y)) nx = x + dx
  if (dy !== 0 && isWalkable(nx, y + dy)) ny = y + dy
  return { x: nx, y: ny }
}

export function dist(ax, ay, bx, by) {
  const dx = ax - bx
  const dy = ay - by
  return Math.hypot(dx, dy)
}

export function roomAt(x, y) {
  for (const r of ROOMS) if (inRect(x, y, r)) return r
  return null
}

/**
 * Spawn position for player #i of n, ringed around the courtyard spawn point.
 * The ring grows into an ellipse with the head-count (16 beans need elbow room)
 * but stays capped inside the courtyard's walkable rect.
 */
export function spawnPoint(i, n) {
  const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2
  const rx = Math.min(240, SPAWN.ring + n * 10)
  const ry = Math.min(105, 55 + n * 4)
  return { x: SPAWN.x + Math.cos(a) * rx, y: SPAWN.y + Math.sin(a) * ry }
}

/**
 * The nearest interaction available to a LIVING player at (x,y):
 *   { kind: 'task', taskId } — an undone task of mine within reach
 *   { kind: 'mihbash' } | { kind: 'breaker' } | { kind: 'manhole', index }
 *   { kind: 'report', victim } — a body within reach
 * Priority: report > task > breaker > mihbash > manhole.
 */
export function nearestInteraction({ x, y, myTasks, bodies, isMundass, sabotage }) {
  for (const b of bodies || []) {
    if (dist(x, y, b.x, b.y) <= REPORT_RADIUS) return { kind: 'report', victim: b.victim }
  }
  for (const t of myTasks || []) {
    if (t.done) continue
    const s = STATIONS[t.id]
    if (s && dist(x, y, s.x, s.y) <= INTERACT_RADIUS) return { kind: 'task', taskId: t.id }
  }
  if (sabotage === 'power' && dist(x, y, BREAKER.x, BREAKER.y) <= INTERACT_RADIUS) {
    return { kind: 'breaker' }
  }
  if (!sabotage && dist(x, y, MIHBASH.x, MIHBASH.y) <= INTERACT_RADIUS) {
    return { kind: 'mihbash' }
  }
  if (isMundass) {
    for (let i = 0; i < MANHOLES.length; i++) {
      if (dist(x, y, MANHOLES[i].x, MANHOLES[i].y) <= INTERACT_RADIUS) {
        return { kind: 'manhole', index: i }
      }
    }
  }
  return null
}
