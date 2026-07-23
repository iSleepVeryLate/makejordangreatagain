// المندس — the حارة (old Amman neighborhood) world map, v2.
// Pure data + geometry helpers; the canvas renders from this, the HUD reads
// station proximity from it.
//
// v2 layout doctrine (the v1 single-square was too open — nowhere to ambush,
// nowhere to be alone, every body found in seconds):
//   * a RING STREET (السكة) circles the hara; the courtyard sits at the heart,
//     linked to the ring by four narrow alleys — chokepoints you must cross.
//   * every room hangs off a street through a single door stub → most rooms
//     are DEAD ENDS. Walking into one is a commitment.
//   * the far corners are dangerous by design: the roof (NE), the garden (far
//     W), and the electrical room (far SE, OUTSIDE the ring) are long, lonely
//     walks — and the breaker lives out there, so a power cut forces someone
//     to make that walk in the dark.
//   * two زواريب (dead-end cul-de-sacs) off the streets: classic lure spots.
//   * four manholes (بالوعات) form the mundass's cross-map escape network.
//
// Walkability is the UNION of rects (rooms + streets + stubs): a move is legal
// if the feet-point stays inside any rect. Door stubs overlap both their room
// and their street by ~50px, which is also what visually punches the doorway
// through the wall when the streets are painted over the wall strokes.

export const WORLD = { w: 3200, h: 2000 }

// Rooms. `floor` tints the floor; labels are bilingual.
export const ROOMS = [
  { id: 'courtyard', en: 'Courtyard', ar: 'ساحة الحارة', x: 1280, y: 780, w: 640, h: 440, floor: '#c9b18a' },
  { id: 'diwan', en: 'Diwan', ar: 'الديوان', x: 560, y: 520, w: 480, h: 330, floor: '#b48a63' },
  { id: 'kitchen', en: 'Kitchen', ar: 'المطبخ', x: 1150, y: 520, w: 340, h: 260, floor: '#9aa06b' },
  { id: 'roof', en: 'Rooftop', ar: 'السطح', x: 2200, y: 60, w: 560, h: 320, floor: '#8f9bb0' },
  { id: 'shop', en: 'Corner shop', ar: 'الدكانة', x: 560, y: 1120, w: 380, h: 300, floor: '#ad8b5e' },
  { id: 'power', en: 'Electrical', ar: 'غرفة الكهرباء', x: 2880, y: 1250, w: 280, h: 420, floor: '#8a8f98' },
  { id: 'garden', en: 'Garden', ar: 'الحاكورة', x: 60, y: 1120, w: 240, h: 520, floor: '#7d9c6a' },
  { id: 'garage', en: 'Garage', ar: 'الكراج', x: 1750, y: 1250, w: 420, h: 250, floor: '#97918a' },
  { id: 'tap', en: 'Water tap', ar: 'حنفية الحارة', x: 2300, y: 1250, w: 360, h: 240, floor: '#7f9aa3' },
]

// Streets, links, door stubs, and the two زواريب. Drawn as darker stone,
// painted over the wall strokes (doorways appear wherever they overlap a room).
export const ALLEYS = [
  // the ring street
  { x: 340, y: 340, w: 2520, h: 110 }, // north street
  { x: 340, y: 1550, w: 2520, h: 110 }, // south street
  { x: 340, y: 340, w: 110, h: 1320 }, // west street
  { x: 2750, y: 340, w: 110, h: 1320 }, // east street
  // courtyard ↔ ring links (the four chokepoints)
  { x: 1545, y: 400, w: 110, h: 430 }, // north link
  { x: 1545, y: 1170, w: 110, h: 430 }, // south link
  { x: 400, y: 945, w: 930, h: 110 }, // west link
  { x: 1870, y: 945, w: 930, h: 110 }, // east link
  // door stubs (one per dead-end room; the diwan gets two — it's the hub room)
  { x: 860, y: 400, w: 110, h: 170 }, // north street → diwan
  { x: 740, y: 800, w: 110, h: 195 }, // diwan → west link
  { x: 1250, y: 400, w: 110, h: 170 }, // north street → kitchen
  { x: 2450, y: 330, w: 110, h: 120 }, // north street → roof stairs
  { x: 700, y: 1000, w: 110, h: 170 }, // west link → shop
  { x: 2810, y: 1400, w: 120, h: 110 }, // east street → electrical
  { x: 250, y: 1300, w: 140, h: 110 }, // west street → garden
  { x: 1900, y: 1450, w: 110, h: 150 }, // garage → south street
  { x: 2420, y: 1440, w: 110, h: 160 }, // tap → south street
  // زواريب — dead-end cul-de-sacs (nothing there… except sometimes a mundass)
  { x: 1900, y: 140, w: 110, h: 250 }, // north zaroub
  { x: 900, y: 1610, w: 110, h: 250 }, // south zaroub
]

const WALKABLE = [...ROOMS.map(({ x, y, w, h }) => ({ x, y, w, h })), ...ALLEYS]

// Task stations: engine TASK_IDS → world position + emoji prop + bilingual name.
// Deliberately flung to the corners — chores make you travel.
export const STATIONS = {
  wires: { x: 3030, y: 1560, room: 'power', icon: '🔌', en: 'Connect the wires', ar: 'وصّل الأسلاك' },
  tea: { x: 1330, y: 620, room: 'kitchen', icon: '🫖', en: 'Make the tea', ar: 'اعمل شاي' },
  satellite: { x: 2400, y: 170, room: 'roof', icon: '📡', en: 'Fix the satellite', ar: 'ظبّط الستلايت' },
  laundry: { x: 2620, y: 290, room: 'roof', icon: '👕', en: 'Hang the laundry', ar: 'انشر الغسيل' },
  coffee: { x: 780, y: 660, room: 'diwan', icon: '☕', en: 'Grind the coffee', ar: 'اطحن القهوة' },
  plants: { x: 170, y: 1270, room: 'garden', icon: '🪴', en: 'Water the plants', ar: 'اسقِ الزرع' },
  olives: { x: 170, y: 1540, room: 'garden', icon: '🫒', en: 'Pick the olives', ar: 'اقطف الزيتون' },
  shelf: { x: 740, y: 1280, room: 'shop', icon: '🛒', en: 'Stock the shelf', ar: 'رتّب الدكانة' },
  gas: { x: 1950, y: 1380, room: 'garage', icon: '🛢️', en: 'Swap the gas cylinder', ar: 'بدّل جرة الغاز' },
  water: { x: 2480, y: 1350, room: 'tap', icon: '🚰', en: 'Fill the jerrycan', ar: 'عبّي المي' },
}

// The mihbash (brass coffee grinder) — banging it calls the neighborhood meeting.
export const MIHBASH = { x: 1600, y: 930 }
// Breaker box — fixes the power cut. Far SE, outside the ring: the blackout
// walk is the scariest walk in the hara, on purpose.
export const BREAKER = { x: 3000, y: 1330 }
// Manholes (بالوعات) — mundass-only fast travel, cycled in order:
// courtyard → garage → electrical → garden → courtyard.
export const MANHOLES = [
  { x: 1350, y: 1150, room: 'courtyard' },
  { x: 2060, y: 1430, room: 'garage' },
  { x: 3060, y: 1610, room: 'power' },
  { x: 150, y: 1590, room: 'garden' },
]

export const SPAWN = { x: 1600, y: 1040, ring: 90 } // below the mihbash dais

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
