# Workstream F — Jordan Monopoly "Cinematic Scene & Grade" (the wow pass)

## Context / why
The A–E overhaul (merged to `main` as PR #3) modernized the board, tokens, board art, and HUD — clean engineering, but the result reads as a competent web-3D board, **not a premium scene**. The gap is **art direction, not code**: the board floats in a near-black void with flat, dim lighting and no world around it. This pass gives the board a *world* and a *cinematic look*. Branch off `feat/monopoly-wow` (already contains a dice over-bloom fix, commit `17ee61b`).

## Honest target & constraints (read first)
- This is **real-time WebGL on the player's GPU** — target "genuinely impressive real-time 3D," NOT offline-rendered cinematic. F1 + F3 deliver most of the perceived jump.
- **Preserve every A–E invariant** (non-negotiable): render-on-demand **PARK** loop (no perpetual rAF — any new post pass is static-when-idle → one frame then park), `invalidate()/pushTween()/popTween()`, `reducedMotion` snapping, `_track`/`dispose()` leak discipline (free every new RT/texture/geometry), DPR cap (≤2), 2D-Lite + low-power fallback intact, soft-degrade (HDRI/DoF/asset failure → graceful, never a black screen, never routed to the WebGL-context-loss/2D path).
- **Gate the expensive bits** (HDRI, DoF, physical materials) behind the non-low-power path; the 2D-Lite renderer must be untouched.
- All new assets **trademark-safe + CC0/original** (mirror `boardTexture.js` rationale).
- Core files: `src/games/three/Scene3D.js` (env, composer, camera, lights, board), `tokens3d.js`, `dice3d.js`, `buildings3d.js`, `boardTexture.js`, `MonopolyScene3D.jsx`. New assets under `public/`.

## Work items (ranked by wow-per-effort)

### F1 — Put the board in a lit world  ⭐ biggest lever
The single most impactful change. Today `_buildGround()` is an 80×80 near-black plane; the board floats.
- **Tabletop:** replace the flat dark ground with a real surface the board sits ON — a large felt or dark-walnut tabletop (PBR material; subtle texture/roughness variation) extending well past the board edges so there's context and grounded contact shadow.
- **Backdrop / atmosphere:** instead of the flat CSS void, give the scene depth — a large soft graded backdrop (gradient dome/curved plane) or a tasteful `scene.background` gradient, with the edges falling to dark so the board is the hero. Keep the existing vignette.
- **Grounding:** ensure the board casts a real soft contact shadow onto the tabletop (the key light already casts; tune `shadow` for a believable soft drop).
- Decision to make: in-scene background gradient vs. keep `alpha:true` + CSS void + add only the tabletop. Recommend an **in-scene** lit environment for the premium "product render" feel.
- Invariant: static geometry/lights → loop still parks. Dispose the new geo/materials/textures.

### F3 — Cinematic camera + depth of field
- **Hero angle:** lower the camera / widen slightly for a more dramatic 3/4 (tune `CAM_REST`, `CAM_TARGET`, FOV). Keep the existing aspect-aware `_computeFit` so it never crops.
- **Depth of field:** add a **subtle** `BokehPass` (three/examples/jsm/postprocessing/BokehPass) to the composer — focus on the board center, far edge softly blurred. Subtle is essential (over-DoF looks gimmicky).
- Invariants: BokehPass needs the depth buffer (RenderPass already renders the scene; enable depth). It's a post pass → integrate into the park loop exactly like bloom (static when idle → park) and the composer soft-degrade (if it fails to build, drop it, don't crash). Focus distance is fixed on the static board center (no per-frame rack-focus) so the loop can park. Under `reducedMotion`, no animated focus pulls. **Gate DoF behind non-low-power** (it's moderately expensive). Dispose its RT.

### F2 — Real HDRI environment (user opted into real HDR)
- Replace the procedural `RoomEnvironment` in `_buildEnvironment()` with a genuine studio/interior **HDRI** via `RGBELoader` → `PMREMGenerator` for believable reflections on the gold frame, silver tokens, and dice.
- Asset: a **CC0** studio/softbox HDRI (e.g. Poly Haven CC0), downscaled to 1k–2k, in `public/env/`. Lazy-load (only the 3D chunk). 
- **Fallback chain:** HDRI load fails OR low-power → keep `RoomEnvironment` (the current procedural IBL). Never block mount on the HDRI. Async load → `invalidate()` on ready. Dispose the env RT (and remember the RoomEnvironment-source-scene dispose fix from the A–E review).

### F4 — Material richness
- **Board face:** add a subtle **clearcoat varnish** (switch to `MeshPhysicalMaterial`, `clearcoat ~0.4`, low `clearcoatRoughness`) so it reads as printed-and-varnished cardstock; add the deferred procedural **roughnessMap** (paper grain) for micro-variation under raking light.
- **Gold frame:** richer metal (consider `anisotropy` / higher `envMapIntensity` now that a real HDRI feeds it).
- **Tokens:** more polished, reflective silver; consider giving them slightly more presence/scale so they pop as hero pieces.
- Invariant: heavier physical materials → gate clearcoat behind non-low-power if perf bites; measure.

### F6 — Grade & bloom polish
- Revisit bloom now that there's a real environment — aim for **tasteful specular**, not "glowy" (the dice were the worst offender; fixed in `17ee61b`, but re-check the whole scene under HDRI). Tune `strength`/`threshold` against the new lighting.
- Add a subtle **color grade** (warm cinematic LUT via a `ShaderPass`, or tuned `toneMappingExposure`) for a cohesive filmic tone; keep/repair the vignette; optional very-subtle film grain.
- Invariant: all static post → parks fine; soft-degrade; dispose.

### F5 — Authored GLB token models  (stretch / highest token fidelity)
- The loader hook (`tokenModels.js`) already swaps an authored `public/models/monopoly-tokens.glb` in with **zero code change**. Drop in 8 real sculpted classic pieces (CC0 or original, Draco-optimized, ≤~200 KB) for a big token-fidelity jump over the procedural primitives.
- This is an **art-asset task** (needs a modeler / generated set), so it's a stretch goal — the procedural pieces are acceptable without it.

## Sequencing (ship value early)
1. **F1** (environment) — biggest jump, lowest risk. Ship and look.
2. **F3** (camera + DoF) — the cinematic framing.
3. **F2** (HDRI) — reflection realism.
4. **F4** (materials) → **F6** (grade/bloom re-tune) — richness + cohesion.
5. **F5** (authored tokens) — stretch, when/if assets exist.
F1 + F3 alone should move it from "OK" to "wow"; do those first and get a reaction before the rest.

## Verification (per step)
- **Dev harness** `/__dev/monopoly3d` on a **real GPU** (not SwiftShader — software rendering misreads HDR/bloom/DoF): before/after screenshots; drive `walk +7` / `roll` / build / auction; toggle `reduced motion`.
- **Park-loop:** confirm the loop still PARKS when idle after adding DoF/env (idle GPU ~0; `renderStats().parked` true).
- **Soft-degrade:** block the HDRI URL → confirm RoomEnvironment fallback; force composer/DoF build failure → confirm plain-render, no black screen.
- **Low-power:** confirm HDRI/DoF/clearcoat are skipped and the 2D-Lite path is unchanged.
- **Perf:** frame time + draw calls on mid/low hardware; must stay smooth and park when idle. DPR cap respected.
- **Dispose:** mount/unmount the room repeatedly → no WebGL leak; new RTs/textures/geos freed; context-loss still falls back to 2D.
- **Build:** `npm run build` clean; new env/HDRI/decoder assets lazy-chunked, not in the main bundle.
- `npm run build` AND a real-GPU visual pass are both required before PR.

## Hand-off notes
- Branch: **`feat/monopoly-wow`** (off merged `main` `598adb9`; already has the dice fix `17ee61b`). Continue here; open a PR to `main` when F1–F3 (min) are in and verified.
- Keep commits per-item with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- Senior-arch review will run a multi-dimension adversarial pass on the diff before merge (same as A–E): leaks, park-loop, reduced-motion, soft-degrade, perf, DPR. Build green + real-GPU before/after screenshots are the gate.
