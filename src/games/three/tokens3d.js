// ============================================================================
// TokenField — the 3D player pieces (Phase 1, cinematic rebuild).
//
// One sculpted SILVER classic-game piece per non-bankrupt player (hat, car, dog,
// ship, thimble, boot, iron, wheelbarrow), each standing on a colored base ring in
// the player's token color. Pieces are built procedurally from primitives — no asset
// ships — so they pick up the scene IBL for a real pewter look. A dormant GLB hook
// (tokenModels.js) can swap in hand-authored sculpts later with no code change.
//
// Subscribes (via Scene3D) to the animator's token slice: when a player's rendered
// tile changes it tweens the mesh there with an arc HOP (STEP_MS) or a flat GLIDE
// (GLIDE_MS), re-triggering a landing squash on each hopSeq bump. Multiple pieces on
// a tile fan out. The active player's piece gets a gold ground-glow + a contact-shadow
// blob, and Scene3D points the camera at its tile.
//
// Pure draw layer: it READS the slice, never writes it. Timings mirror
// useBoardAnimator (STEP_MS/GLIDE_MS) so the 3D motion matches the 2D path.
// ============================================================================
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  TILE_CENTERS_3D, TOKEN_RADIUS, TOKEN_HEIGHT, TOKEN_REST_Y, HOP_PEAK_Y, SURFACE_Y, INNER_TRACK,
} from './coords3d.js'
import { tokenMeta } from '../monopolyTokens.js'
import { lowPower } from './capability.js'
import { loadTokenModels, modelsReady, getTokenGeometry } from './tokenModels.js'
import { sound } from '../../lib/sound.js'
import SparkleBurst from './sparkleBurst.js'

const STEP_MS = 165 // per-tile hop — matches useBoardAnimator
const GLIDE_MS = 460 // card/jail relocation glide — matches useBoardAnimator
const SQUASH_MS = 140
// Squash amplitudes (named for tuning). Horizontal amplitude is deliberately small —
// large sideways scaling reads as "crushing" on asymmetric shapes (a car's length, a
// hat's brim). Vertical settle is kept; horizontal is roughly halved.
const HOP_LIFT = 0.09 // vertical gain at hop apex
const HOP_LATERAL = 0.045 // horizontal squeeze at hop apex
const LAND_BULGE = 0.05 // horizontal bulge at landing dip
const LAND_SQUASH = 0.10 // vertical squash at landing dip
// G2 — the FINAL landing (end of a hop sequence) is beefier than a mid-hop squash.
const FINAL_BULGE = 0.11 // horizontal bulge on the headline landing (vs LAND_BULGE mid-hop)
const FINAL_SQUASH = 0.20 // vertical squash on the headline landing (vs LAND_SQUASH mid-hop)
const FINAL_SQUASH_MS = 200 // a touch longer settle than SQUASH_MS so the payoff reads
// How long after the LAST hop bump (active token) with no further hop we treat the move
// as ended → fire the landing payoff. One STEP_MS of quiet means no further hop is coming;
// the +SQUASH_MS clears the last hop's own mid-squash (scheduled at STEP_MS*0.6) so the
// beefy FINAL squash starts from rest, not mid-dip (no scale discontinuity).
const LAND_DEBOUNCE_MS = STEP_MS + SQUASH_MS
const now = () => (typeof performance !== 'undefined' ? performance.now() : 0)

// Fan-out offsets (world units) so stacked pieces don't fully overlap (mirrors
// TokenLayer.STACK, scaled to the inner track).
const S = INNER_TRACK * 0.3
const STACK = [[0, 0], [S, -S * 0.7], [-S, S * 0.7], [S, S * 0.7], [-S, -S * 0.7], [0, S * 1.05], [S * 1.1, 0], [-S * 1.1, 0]]

const easeOutCubic = (k) => 1 - Math.pow(1 - k, 3)
const lerp = (a, b, k) => a + (b - a) * k

export default class TokenField {
  constructor(host) {
    this.host = host // { scene, invalidate, pushTween, popTween, focusTile, ... }
    this.tokens = new Map() // profileId -> entry
    this.activeTile = null
    this._disposables = new Set()
    this._disposed = false
    this._pieceCache = new Map() // key -> [{ geo, pos, rot }] procedural part specs (shared geos)

    const R = TOKEN_RADIUS; const H = TOKEN_HEIGHT
    // Shared finishes (one dispose each). The silver body material is shared across
    // ALL pieces and players — only the base ring is tinted per player.
    this._silverMat = new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.2 })
    this._goldMat = new THREE.MeshStandardMaterial({ color: 0xd9b84a, roughness: 0.28, metalness: 0.9, envMapIntensity: 1.1 })
    this._ringGeo = new THREE.CylinderGeometry(R * 1.15, R * 1.30, H * 0.16, 40)
    this._trimGeo = new THREE.TorusGeometry(R * 1.16, R * 0.05, 12, 44)
    this._glowGeo = new THREE.CircleGeometry(R * 1.95, 44)
    // contact-shadow blob (A3) — kills the "floating" look; dark so it never blooms
    this._blobTex = this._makeBlobTexture()
    this._blobGeo = new THREE.PlaneGeometry(R * 3.0, R * 3.0)
    this._blobMat = new THREE.MeshBasicMaterial({ map: this._blobTex, transparent: true, opacity: 0.32, depthWrite: false })
    this._track(this._silverMat, this._goldMat, this._ringGeo, this._trimGeo, this._glowGeo, this._blobTex, this._blobGeo, this._blobMat)

    // G2 — the gold landing-sparkle pop. ONE shared burst (the active token lands one
    // at a time), reused per landing. Skipped on clearly low-power devices (the particle
    // cloud + per-frame position upload is the heaviest new work). dispose() frees it.
    this._spark = lowPower() ? null : new SparkleBurst(this.host, { count: 24, size: 0.34 })

    // Kick off the optional GLB load (skipped on clearly low-power devices). On
    // success, swap the procedural pieces for the real sculpts in place.
    if (!lowPower()) {
      loadTokenModels({ TOKEN_RADIUS: R, TOKEN_HEIGHT: H }).then((ok) => { if (ok && !this._disposed) this._swapInModels() }, () => {})
    }
  }

  _track(...o) { for (const x of o) if (x) this._disposables.add(x) }

  _makeBlobTexture() {
    const SZ = 128
    const cv = document.createElement('canvas'); cv.width = SZ; cv.height = SZ
    const ctx = cv.getContext('2d')
    const g = ctx.createRadialGradient(SZ / 2, SZ / 2, 0, SZ / 2, SZ / 2, SZ / 2)
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.55, 'rgba(0,0,0,0.26)'); g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g; ctx.fillRect(0, 0, SZ, SZ)
    const tex = new THREE.CanvasTexture(cv)
    return tex
  }

  // ---- procedural piece geometry (built once per key, shared across players) ----
  // Each spec is built with the piece BASE at local y=0; the piece holder is then
  // positioned to sit on top of the ring. Footprint stays within ~TOKEN_RADIUS so the
  // camera-fit envelope (SURFACE_Y + TOKEN_HEIGHT) holds.
  _pieceParts(key) {
    if (this._pieceCache.has(key)) return this._pieceCache.get(key)
    const u = TOKEN_RADIUS
    const parts = []
    const add = (geo, pos = [0, 0, 0], rot = [0, 0, 0]) => { this._track(geo); parts.push({ geo, pos, rot }) }
    switch (key) {
      case 'hat': {
        const brimR = 1.0 * u;
        const brimH = 0.12 * u;
        const brimGeo = new THREE.CylinderGeometry(brimR, brimR, brimH, 48);
        add(brimGeo, [0, brimH / 2, 0]);

        const crownBotR = 0.6 * u;
        const crownTopR = 0.66 * u;
        const crownH = 1.18 * u;
        const crownGeo = new THREE.CylinderGeometry(crownTopR, crownBotR, crownH, 48);
        add(crownGeo, [0, brimH + crownH / 2, 0]);

        const topGeo = new THREE.CylinderGeometry(crownTopR, crownTopR, 0.04 * u, 48);
        add(topGeo, [0, brimH + crownH + 0.02 * u, 0]);

        const bandRadius = crownBotR + 0.03 * u;
        const bandTube = 0.07 * u;
        const bandGeo = new THREE.TorusGeometry(bandRadius, bandTube, 16, 48);
        add(bandGeo, [0, brimH + 0.11 * u, 0], [Math.PI / 2, 0, 0]);
        break;
      }

      case 'thimble': {
        const pts = [];
        pts.push(new THREE.Vector2(0.0, 0.0));
        pts.push(new THREE.Vector2(0.62, 0.0));
        pts.push(new THREE.Vector2(0.78, 0.02));
        pts.push(new THREE.Vector2(0.82, 0.07));
        pts.push(new THREE.Vector2(0.80, 0.14));
        pts.push(new THREE.Vector2(0.74, 0.18));
        pts.push(new THREE.Vector2(0.70, 0.30));
        pts.push(new THREE.Vector2(0.66, 0.50));
        pts.push(new THREE.Vector2(0.62, 0.72));
        pts.push(new THREE.Vector2(0.57, 0.95));
        pts.push(new THREE.Vector2(0.50, 1.14));
        pts.push(new THREE.Vector2(0.40, 1.30));
        pts.push(new THREE.Vector2(0.27, 1.42));
        pts.push(new THREE.Vector2(0.14, 1.49));
        pts.push(new THREE.Vector2(0.05, 1.515));
        pts.push(new THREE.Vector2(0.0, 1.52));
        const profile = pts.map(p => new THREE.Vector2(p.x * u, p.y * u));
        const g = new THREE.LatheGeometry(profile, 64);
        add(g);
        break;
      }

      case 'car': {
        const wheelR = 0.40 * u; const wheelW = 0.16 * u; const axleY = wheelR; const bodyW = 1.95 * u; const bodyD = 0.78 * u; const bodyH = 0.40 * u; const bodyY = axleY + 0.04 * u;
        const body = new THREE.BoxGeometry(bodyW, bodyH, bodyD, 1, 1, 1); add(body, [0, bodyY + bodyH / 2, 0]);
        const hoodW = 0.62 * u; const hoodH = 0.20 * u; const hood = new THREE.BoxGeometry(hoodW, hoodH, bodyD * 0.82); add(hood, [bodyW / 2 - hoodW / 2 + 0.02 * u, bodyY + bodyH / 2 - 0.02 * u, 0]);
        const cabinW = 0.70 * u; const cabinH = 0.56 * u; const cabin = new THREE.BoxGeometry(cabinW, cabinH, bodyD * 0.74); add(cabin, [-bodyW / 2 + cabinW / 2 + 0.10 * u, bodyY + bodyH + cabinH / 2 - 0.03 * u, 0]);
        const cowlW = 0.34 * u; const cowl = new THREE.BoxGeometry(cowlW, 0.16 * u, bodyD * 0.70); add(cowl, [-bodyW / 2 + cabinW + cowlW / 2 + 0.06 * u, bodyY + bodyH + 0.05 * u, 0]);
        const wheel = () => new THREE.CylinderGeometry(wheelR, wheelR, wheelW, 20); const wx = bodyW / 2 - 0.30 * u; const wz = bodyD / 2 - wheelW / 2 + 0.02 * u; const rot = [Math.PI / 2, 0, 0];
        add(wheel(), [wx, axleY, wz], rot); add(wheel(), [wx, axleY, -wz], rot); add(wheel(), [-wx, axleY, wz], rot); add(wheel(), [-wx, axleY, -wz], rot);
        const hubR = 0.10 * u; const hub = () => new THREE.CylinderGeometry(hubR, hubR, wheelW + 0.02 * u, 12);
        add(hub(), [wx, axleY, wz], rot); add(hub(), [wx, axleY, -wz], rot); add(hub(), [-wx, axleY, wz], rot); add(hub(), [-wx, axleY, -wz], rot);
        break;
      }

      case 'wheelbarrow': {
        const wheelR = 0.42 * u;
        const wheelThick = 0.16 * u;
        const tubW = 1.05 * u;
        const tubH = 0.5 * u;
        const tubD = 0.62 * u;
        const tubCx = 0.18 * u;
        const tubCy = wheelR + 0.34 * u;
        const wheel = new THREE.CylinderGeometry(wheelR, wheelR, wheelThick, 28);
        add(wheel, [-0.78 * u, wheelR, 0], [Math.PI / 2, 0, 0]);
        const hubR = wheelR * 0.34;
        const hub = new THREE.CylinderGeometry(hubR, hubR, wheelThick * 1.25, 18);
        add(hub, [-0.78 * u, wheelR, 0], [Math.PI / 2, 0, 0]);
        const fork = new THREE.BoxGeometry(0.5 * u, 0.1 * u, 0.09 * u);
        add(fork, [-0.5 * u, wheelR + 0.04 * u, 0.2 * u], [0, 0, 0.32]);
        add(fork.clone(), [-0.5 * u, wheelR + 0.04 * u, -0.2 * u], [0, 0, 0.32]);
        const tub = new THREE.BoxGeometry(tubW, tubH, tubD);
        add(tub, [tubCx, tubCy, 0], [0, 0, 0.06]);
        const innerW = tubW * 0.78;
        const innerH = tubH * 0.6;
        const inner = new THREE.BoxGeometry(innerW, innerH, tubD * 0.78);
        add(inner, [tubCx, tubCy + tubH * 0.34, 0], [0, 0, 0.06]);
        const leg = new THREE.BoxGeometry(0.1 * u, 0.42 * u, 0.1 * u);
        add(leg, [0.5 * u, 0.2 * u, 0.24 * u], [0, 0, -0.12]);
        add(leg.clone(), [0.5 * u, 0.2 * u, -0.24 * u], [0, 0, -0.12]);
        const handleLen = 0.95 * u;
        const handle = new THREE.BoxGeometry(handleLen, 0.1 * u, 0.1 * u);
        add(handle, [0.86 * u, tubCy + 0.1 * u, 0.26 * u], [0, 0, 0.2]);
        add(handle.clone(), [0.86 * u, tubCy + 0.1 * u, -0.26 * u], [0, 0, 0.2]);
        const grip = new THREE.CylinderGeometry(0.08 * u, 0.08 * u, 0.16 * u, 14);
        add(grip, [1.22 * u, tubCy + 0.18 * u, 0.26 * u], [Math.PI / 2, 0, 0]);
        add(grip.clone(), [1.22 * u, tubCy + 0.18 * u, -0.26 * u], [Math.PI / 2, 0, 0]);
        break;
      }

      case 'dog': {
        // Scottie terrier from rounded primitives — soft (beveled) edges, reads
        // volumetrically at the 3/4 board angle; no self-intersection risk.
        const RB = (w, h, d) => new RoundedBoxGeometry(w * u, h * u, d * u, 3, Math.min(w, h, d) * 0.16 * u);
        const legG = RB(0.18, 0.42, 0.16);
        for (const sx of [-0.34, 0.42]) for (const sz of [-0.13, 0.13]) add(legG, [sx * u, 0.21 * u, sz * u]);
        add(RB(1.06, 0.44, 0.40), [0.02 * u, 0.62 * u, 0]);
        add(RB(0.30, 0.34, 0.13), [-0.58 * u, 0.86 * u, 0], [0, 0, -0.5]);
        add(RB(0.44, 0.50, 0.36), [0.60 * u, 0.85 * u, 0]);
        add(RB(0.32, 0.24, 0.30), [0.90 * u, 0.66 * u, 0]);
        const earG = RB(0.13, 0.22, 0.12);
        for (const sz of [-0.10, 0.10]) add(earG, [0.52 * u, 1.14 * u, sz * u]);
        break;
      }

      case 'boot': {
        const s = new THREE.Shape();
        s.moveTo(-0.78 * u, 0.00 * u);
        s.lineTo(0.62 * u, 0.00 * u);
        s.quadraticCurveTo(0.92 * u, 0.00 * u, 0.94 * u, 0.16 * u);
        s.quadraticCurveTo(0.95 * u, 0.30 * u, 0.74 * u, 0.34 * u);
        s.lineTo(0.18 * u, 0.40 * u);
        s.lineTo(0.02 * u, 0.62 * u);
        s.lineTo(0.06 * u, 1.18 * u);
        s.quadraticCurveTo(0.07 * u, 1.34 * u, -0.06 * u, 1.36 * u);
        s.lineTo(-0.42 * u, 1.38 * u);
        s.quadraticCurveTo(-0.56 * u, 1.38 * u, -0.56 * u, 1.24 * u);
        s.lineTo(-0.54 * u, 0.66 * u);
        s.quadraticCurveTo(-0.54 * u, 0.46 * u, -0.62 * u, 0.40 * u);
        s.lineTo(-0.78 * u, 0.34 * u);
        s.quadraticCurveTo(-0.86 * u, 0.30 * u, -0.86 * u, 0.18 * u);
        s.quadraticCurveTo(-0.86 * u, 0.00 * u, -0.78 * u, 0.00 * u);
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.45 * u, bevelEnabled: true, bevelThickness: 0.03 * u, bevelSize: 0.03 * u, bevelSegments: 2, steps: 1 });
        g.computeBoundingBox();
        const b = g.boundingBox;
        g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        add(g);
        break;
      }

      case 'iron': {
        const s = new THREE.Shape();
        s.moveTo(0.00 * u, 0.00 * u);
        s.lineTo(1.55 * u, 0.10 * u);
        s.lineTo(1.62 * u, 0.18 * u);
        s.lineTo(1.55 * u, 0.26 * u);
        s.lineTo(0.55 * u, 0.30 * u);
        s.lineTo(0.45 * u, 0.62 * u);
        s.lineTo(0.42 * u, 0.74 * u);
        s.lineTo(0.62 * u, 0.78 * u);
        s.lineTo(0.95 * u, 0.92 * u);
        s.lineTo(1.12 * u, 1.14 * u);
        s.lineTo(1.12 * u, 1.30 * u);
        s.lineTo(0.96 * u, 1.36 * u);
        s.lineTo(0.92 * u, 1.22 * u);
        s.lineTo(0.78 * u, 1.04 * u);
        s.lineTo(0.58 * u, 0.96 * u);
        s.lineTo(0.40 * u, 0.96 * u);
        s.lineTo(0.28 * u, 1.06 * u);
        s.lineTo(0.24 * u, 1.24 * u);
        s.lineTo(0.30 * u, 1.38 * u);
        s.lineTo(0.14 * u, 1.40 * u);
        s.lineTo(0.06 * u, 1.22 * u);
        s.lineTo(0.06 * u, 0.92 * u);
        s.lineTo(0.14 * u, 0.62 * u);
        s.lineTo(0.18 * u, 0.30 * u);
        s.lineTo(0.04 * u, 0.24 * u);
        s.lineTo(0.00 * u, 0.14 * u);
        s.closePath();
        const g = new THREE.ExtrudeGeometry(s, { depth: 0.45 * u, bevelEnabled: true, bevelThickness: 0.03 * u, bevelSize: 0.03 * u, bevelSegments: 2, steps: 1 });
        g.computeBoundingBox();
        const b = g.boundingBox;
        g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
        add(g);
        break;
      }

      case 'ship': {
        // hull (extruded silhouette) + volumetric funnels/mast/deckhouse so it reads
        // as a steamship from any angle (a flat silhouette alone read as a sliver).
        const s = new THREE.Shape();
        s.moveTo(-0.95 * u, 0.00 * u);
        s.lineTo(0.85 * u, 0.00 * u);
        s.lineTo(1.04 * u, 0.30 * u);
        s.lineTo(0.72 * u, 0.38 * u);
        s.lineTo(-0.80 * u, 0.38 * u);
        s.lineTo(-0.95 * u, 0.00 * u);
        const hull = new THREE.ExtrudeGeometry(s, { depth: 0.52 * u, bevelEnabled: true, bevelThickness: 0.03 * u, bevelSize: 0.03 * u, bevelSegments: 2, steps: 1 });
        hull.translate(0, 0, -0.26 * u);
        add(hull);
        add(new THREE.BoxGeometry(0.6 * u, 0.22 * u, 0.34 * u), [-0.28 * u, 0.49 * u, 0]);
        const funnel = () => new THREE.CylinderGeometry(0.12 * u, 0.13 * u, 0.5 * u, 20);
        add(funnel(), [-0.05 * u, 0.63 * u, 0]);
        add(funnel(), [0.28 * u, 0.63 * u, 0]);
        add(new THREE.CylinderGeometry(0.03 * u, 0.04 * u, 0.95 * u, 12), [0.55 * u, 0.85 * u, 0]);
        break;
      }

      default: {
        const baseR = 0.62 * u;
        const baseTopR = 0.46 * u;
        const baseH = 0.30 * u;
        const baseGeo = new THREE.CylinderGeometry(baseTopR, baseR, baseH, 48);
        add(baseGeo, [0, baseH / 2, 0]);

        const collarGeo = new THREE.CylinderGeometry(0.40 * u, 0.48 * u, 0.10 * u, 48);
        add(collarGeo, [0, baseH + 0.05 * u, 0]);

        const stemH = 0.70 * u;
        const stemBotR = 0.26 * u;
        const stemTopR = 0.20 * u;
        const stemGeo = new THREE.CylinderGeometry(stemTopR, stemBotR, stemH, 48);
        const stemY = baseH + 0.10 * u;
        add(stemGeo, [0, stemY + stemH / 2, 0]);

        const neckGeo = new THREE.CylinderGeometry(0.24 * u, 0.20 * u, 0.10 * u, 48);
        add(neckGeo, [0, stemY + stemH + 0.05 * u, 0]);

        const ballR = 0.30 * u;
        const ballGeo = new THREE.SphereGeometry(ballR, 40, 28);
        add(ballGeo, [0, stemY + stemH + 0.10 * u + ballR, 0]);
        break;
      }
    }
    this._pieceCache.set(key, parts)
    return parts
  }

  // Populate a piece holder group: a single GLB mesh if the models loaded, else the
  // procedural part meshes. All share the one silver material.
  _populatePiece(holder, key) {
    while (holder.children.length) holder.remove(holder.children[0])
    const glb = modelsReady() ? getTokenGeometry(key) : null
    if (glb) {
      const m = new THREE.Mesh(glb, this._silverMat)
      m.castShadow = true; m.material.shadowSide = THREE.FrontSide
      holder.add(m)
    } else {
      for (const p of this._pieceParts(key)) {
        const m = new THREE.Mesh(p.geo, this._silverMat)
        m.position.set(p.pos[0], p.pos[1], p.pos[2])
        m.rotation.set(p.rot[0], p.rot[1], p.rot[2])
        m.castShadow = true
        holder.add(m)
      }
    }
  }

  _make(id, key) {
    const hex = tokenMeta(key).color
    const color = new THREE.Color(hex)
    const H = TOKEN_HEIGHT
    const baseY = -H / 2 // bottom of the token envelope, in body-local space

    // per-player tinted base ring + shared gold trim
    const ringMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.35, envMapIntensity: 0.9 })
    this._track(ringMat)
    const ring = new THREE.Mesh(this._ringGeo, ringMat)
    ring.position.y = baseY + H * 0.08; ring.castShadow = true
    const trim = new THREE.Mesh(this._trimGeo, this._goldMat)
    trim.rotation.x = Math.PI / 2; trim.position.y = baseY + H * 0.16

    // the sculpted piece sits on top of the ring
    const pieceHolder = new THREE.Group()
    pieceHolder.position.y = baseY + H * 0.16
    this._populatePiece(pieceHolder, key)

    const body = new THREE.Group()
    body.add(ring, trim, pieceHolder)
    body.position.y = TOKEN_REST_Y

    // active gold ground-glow (static — so the loop can PARK)
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.5, depthWrite: false })
    this._track(glowMat)
    const glow = new THREE.Mesh(this._glowGeo, glowMat)
    glow.rotation.x = -Math.PI / 2; glow.position.y = SURFACE_Y + 0.012; glow.visible = false; glow.renderOrder = 2

    // contact shadow blob (shared material, under the glow)
    const blob = new THREE.Mesh(this._blobGeo, this._blobMat)
    blob.rotation.x = -Math.PI / 2; blob.position.y = SURFACE_Y + 0.006; blob.renderOrder = 1

    const group = new THREE.Group()
    group.add(blob); group.add(glow); group.add(body)
    this.host.scene.add(group)

    const entry = {
      id, key, group, body, glow, ring, pieceHolder,
      ownMats: [ringMat, glowMat], // per-token mats freed on _remove (silver/gold/blob are shared)
      cur: { x: 0, z: 0 }, from: { x: 0, z: 0 }, to: { x: 0, z: 0 },
      t0: 0, dur: 0, arc: false, tweening: false,
      hopSeen: -1, squashT0: 0, tile: -1,
      // G2 landing-payoff detection: landArmAt = deadline by which, if no further hop
      // arrived, this token's move has ENDED. landBigSquash flags the next squash as the
      // beefier final one. Both reset after the payoff fires.
      landArmAt: 0, landBigSquash: false,
    }
    this.tokens.set(id, entry)
    return entry
  }

  // Swap every live piece's sculpt to the freshly-loaded GLB geometry, in place —
  // preserving position / hop state / glow. One repaint, then re-park.
  _swapInModels() {
    if (this._disposed) return
    for (const e of this.tokens.values()) {
      if (getTokenGeometry(e.key)) this._populatePiece(e.pieceHolder, e.key)
    }
    this.host.invalidate()
  }

  _remove(id) {
    const e = this.tokens.get(id)
    if (!e) return
    if (e.tweening) { e.tweening = false; this.host.popTween() }
    this.host.scene.remove(e.group)
    // Free THIS token's own materials (ring + glow). Shared silver/gold/ring-geo/blob
    // stay. Per-player piece meshes share geometry, so nothing else to free here.
    for (const m of e.ownMats) { m.dispose(); this._disposables.delete(m) }
    this.tokens.delete(id)
  }

  // React to a new token slice + the player list.
  sync(tok, players) {
    const live = players.filter((p) => !p.bankrupt)
    const liveIds = new Set(live.map((p) => p.profile_id))
    for (const id of [...this.tokens.keys()]) if (!liveIds.has(id)) this._remove(id)

    // rendered positions + stacking, mirroring TokenLayer (stack by rendered tile)
    const rpos = {}
    for (const p of live) rpos[p.profile_id] = tok.pos[p.profile_id] ?? p.position
    const counts = {}; const stackIdx = {}
    for (const p of live) { const n = counts[rpos[p.profile_id]] || 0; stackIdx[p.profile_id] = n; counts[rpos[p.profile_id]] = n + 1 }

    const activeId = tok.active
    let activeTile = null

    for (const p of live) {
      const id = p.profile_id
      const tile = TILE_CENTERS_3D[rpos[id]] || TILE_CENTERS_3D[0]
      const [dx, dz] = STACK[stackIdx[id] % STACK.length]
      const tx = tile.x + dx; const tz = tile.z + dz
      const newTile = rpos[id]
      let e = this.tokens.get(id)
      if (!e) { e = this._make(id, p.token); e.cur = { x: tx, z: tz }; e.to = { x: tx, z: tz }; e.group.position.set(tx, 0, tz); e.body.position.y = TOKEN_REST_Y; e.hopSeen = tok.hopSeq[id] || 0; e.tile = newTile }

      const moved = Math.abs(tx - e.to.x) > 1e-4 || Math.abs(tz - e.to.z) > 1e-4
      const tileChanged = newTile !== e.tile // false = same tile, only the stack fan-out shifted
      const hop = (tok.hopSeq[id] || 0)
      const glide = tok.mode[id] === 'glide'
      if (moved && this.host.reducedMotion) {
        // Reduced motion: the animator already snapped pos — place instantly, no slide.
        if (e.tweening) { e.tweening = false; this.host.popTween() }
        e.cur = { x: tx, z: tz }; e.to = { x: tx, z: tz }; e.squashT0 = 0
        e.group.position.set(tx, 0, tz); e.body.position.y = TOKEN_REST_Y; e.body.scale.set(1, 1, 1)
        e.hopSeen = hop
      } else if (moved) {
        e.from = { x: e.cur.x, z: e.cur.z }
        e.to = { x: tx, z: tz }
        e.t0 = now(); e.dur = glide ? GLIDE_MS : STEP_MS
        // Only arc when the actual tile changed; a pure stack re-shuffle slides flat.
        e.arc = !glide && tileChanged
        if (!e.tweening) { e.tweening = true; this.host.pushTween() }
        // A4: nudge the camera focus toward the active player's destination on a real move.
        if (id === activeId && tileChanged) this.host.focusTile?.(newTile)
      }
      e.tile = newTile
      // squash near landing — scheduled off STEP_MS (a stale e.dur from a prior glide
      // could push it past a parked loop). Only on a real tile change.
      const hopBumped = hop !== e.hopSeen
      if (hopBumped && tileChanged && !this.host.reducedMotion) { e.hopSeen = hop; e.squashT0 = now() + STEP_MS * 0.6 } else if (hopBumped) e.hopSeen = hop
      // G2 — arm/re-arm the landing payoff for the ACTIVE token on every REAL move bump.
      // Each bump pushes the deadline out by LAND_DEBOUNCE_MS; the LAST bump's deadline is
      // the one that actually fires (update() detects it once the token has settled and no
      // further bump moved it). A genuine move = a hop to a new tile (hopBumped) OR a glide
      // relocation — NOT a pure stack fan-out re-shuffle (moved && !tileChanged && !glide),
      // which happens when ANOTHER player lands on/leaves this tile and must not trigger a
      // phantom payoff. Disabled under reduced motion. A non-active token never arms → the
      // payoff fires ONCE, for the player whose move it is.
      const realMove = (hopBumped && tileChanged) || (glide && moved)
      if (id === activeId && realMove && !this.host.reducedMotion) {
        e.landArmAt = now() + (glide ? GLIDE_MS : 0) + LAND_DEBOUNCE_MS
      }

      // Static gold ground-glow on the active piece (no per-frame pulse, so the
      // render loop can still PARK when nothing is moving — see Scene3D._loop).
      e.glow.visible = id === activeId
      e.glow.material.opacity = id === activeId ? 0.5 : 0
      if (id === activeId) activeTile = rpos[id]
    }

    this.activeTile = activeTile
    this.host.invalidate()
  }

  // Advance tweens; returns true while anything is animating.
  update(t) {
    let animating = false
    for (const e of this.tokens.values()) {
      if (e.tweening) {
        const k = e.dur > 0 ? Math.min(1, (t - e.t0) / e.dur) : 1
        const ek = easeOutCubic(k)
        e.cur.x = lerp(e.from.x, e.to.x, ek)
        e.cur.z = lerp(e.from.z, e.to.z, ek)
        e.group.position.x = e.cur.x
        e.group.position.z = e.cur.z
        if (e.arc) {
          const arcH = HOP_PEAK_Y - TOKEN_REST_Y
          e.body.position.y = TOKEN_REST_Y + arcH * Math.sin(Math.PI * k)
          // gentle airborne stretch — small horizontal squeeze so asymmetric shapes
          // don't look crushed (see HOP_* constants).
          const sv = 1 + HOP_LIFT * Math.sin(Math.PI * k)
          const sh = 1 - HOP_LATERAL * Math.sin(Math.PI * k)
          e.body.scale.set(sh, sv, sh)
        } else {
          e.body.position.y = TOKEN_REST_Y
          e.body.scale.set(1, 1, 1) // glide carries no squash; clear any residual flatten
        }
        if (k >= 1) {
          e.tweening = false
          e.body.position.y = TOKEN_REST_Y
          this.host.popTween()
        } else animating = true
      }
      // G2 — landing payoff: the active token's move has ENDED (its arm deadline passed
      // and it's no longer tweening → it has settled on the destination tile). Fire ONCE:
      // a beefier final squash, the gold sparkle pop, a camera punch, and the thud SFX.
      // Disarmed immediately so it never re-fires. (landArmAt is only ever set for the
      // active token, and re-armed on each hop, so this is genuinely the last landing.)
      if (e.landArmAt && t >= e.landArmAt && !e.tweening) {
        e.landArmAt = 0
        e.landBigSquash = true
        e.squashT0 = t // fire the (now beefier) squash right now
        if (this._spark) this._spark.burst(e.group.position.x, SURFACE_Y + 0.02, e.group.position.z)
        this.host.cameraPunch?.() // reuse the dice-land punch API
        sound.play('land')
        sound.play('shimmer') // soft gold glint layered under the thud
      } else if (e.landArmAt) {
        animating = true // arm pending → keep the loop awake until the deadline fires
      }

      // landing squash (independent of the arc, retriggered per hopSeq). The FINAL landing
      // (landBigSquash) uses heavier amplitudes + a slightly longer settle for the payoff.
      if (e.squashT0) {
        const big = e.landBigSquash
        const sdur = big ? FINAL_SQUASH_MS : SQUASH_MS
        if (t >= e.squashT0) {
          const sk = (t - e.squashT0) / sdur
          if (sk >= 1) { e.squashT0 = 0; e.landBigSquash = false; if (!e.tweening) e.body.scale.set(1, 1, 1) }
          else {
            const dip = Math.sin(Math.PI * sk) // 0→1→0
            const bulge = big ? FINAL_BULGE : LAND_BULGE
            const squash = big ? FINAL_SQUASH : LAND_SQUASH
            e.body.scale.set(1 + bulge * dip, 1 - squash * dip, 1 + bulge * dip)
            animating = true
          }
        } else {
          animating = true // squash pending → keep the loop awake until it fires
        }
      }
    }
    // G2 — advance the shared gold sparkle (self-terminates + pops its own tween).
    if (this._spark && this._spark.update(t)) animating = true
    return animating
  }

  // Settle every in-flight hop/glide/squash instantly (called when reduced motion turns on).
  snapAll() {
    for (const e of this.tokens.values()) {
      if (e.tweening) { e.tweening = false; this.host.popTween() }
      e.cur = { x: e.to.x, z: e.to.z }
      e.group.position.set(e.to.x, 0, e.to.z)
      e.body.position.y = TOKEN_REST_Y
      e.body.scale.set(1, 1, 1)
      e.squashT0 = 0
      e.landArmAt = 0 // drop any pending landing payoff — reduced motion shows no FX
      e.landBigSquash = false
    }
    this._spark?.snap() // kill an in-flight sparkle + release its tween
  }

  dispose() {
    this._disposed = true
    try { this._spark?.dispose() } catch { /* gone */ } // frees its geo/mat/tex + pops any live tween
    this._spark = null
    for (const e of this.tokens.values()) this.host.scene.remove(e.group)
    this.tokens.clear()
    for (const o of this._disposables) { try { o.dispose?.() } catch { /* gone */ } }
    this._disposables.clear()
    this._pieceCache.clear()
  }
}
