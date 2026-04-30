# Step 2 — Visual Polish

## Files

### Created
- `src/systems/PolishSystem.js` — single juice layer. Subscribes to TANK_FIRED, TANK_DIED, BULLET_RICOCHET, BULLET_EXPIRED, ROUND_COUNTDOWN, ROUND_STARTED, ROUND_ENDED. Owns a `worldFx` container (rides the maze offset) and a procedural radial-gradient vignette image at the camera-fixed depth 800. Particle pool: each particle is a tiny `Phaser.Graphics` reused via `_acquireParticle` / `_releaseParticle`. Bullet trails are drawn as a single `Graphics` per frame (one `lineStyle` + segments) — the per-bullet position buffer lives in a `Map`. Cleans up listeners + state on scene SHUTDOWN.

### Modified
- `src/core/Constants.js` — added `POLISH` block: muzzle, smoke, ricochet, explosion (size + frame timing), shake, smoke, freeze-frame, crown, draw tint, GO/winner banners, bullet trail, vignette. ~40 named values, no magic numbers in PolishSystem.
- `src/scenes/GameScene.js` — imports + instantiates `PolishSystem` after `RoundSystem`; calls `polishSystem.update(time, delta)` at the end of each frame.
- `src/sprites/effects.js` — added `CROWN_SPRITE` (12x8, gold body via palette index 7 + bright highlights via index 8 + outline via index 1).
- `src/sprites/registerSprites.js` — registers the new `crown` texture alongside existing effects.
- `src/entities/Bullet.js` — `BULLET_RICOCHET` event payload now includes `nx, ny, vx, vy` so the polish layer can fire sparks along the wall normal. **No new event** — same event, expanded payload.

## Polish Elements (mapped to brief sections)

| # | Element | Status | Notes |
|---|---------|--------|-------|
| 1 | Muzzle flash on TANK_FIRED | Done | 16x16 sprite scales 1.0→1.6 over 30ms then fades + shrinks over 80ms. 4 yellow sparks shoot out in a 28° cone along the rotation. |
| 2 | Smoke trail behind moving tanks | Done | 80ms emit interval, only when tank actually moved >0.4 design-px since last frame. 4×4 grey particle, drifts in random direction, fades over 600ms. |
| 3 | Ricochet sparks on BULLET_RICOCHET | Done | 5 sparks (alternating white/yellow) shot in a 70° cone along the wall normal. 6px white circle flash at the impact point fades + scales over 90ms. |
| 4 | Explosion on TANK_DIED | Done | 4-frame spritesheet, 110ms per frame. 56px display size. `camera.shake(140ms, 0.006)`. 10 dark smoke particles (`0x222630`) drift up + outward over ~800ms. |
| 5 | Victory crown | Done | 12×8 gold pixel-art crown above the winning tank's chassis, bobs ±4px every 800ms (sine yoyo loop). Disappears on next ROUND_STARTED. For DRAW: no crown — `camera.flash(600ms, 80,96,112)` provides the desaturate pulse instead of a tint. |
| 6 | Round transition juice | Done | ROUND_COUNTDOWN: countdown digit (RoundSystem subBanner) tweens scale 1.4→1.0 + alpha 0→1 over 300ms each second. ROUND_STARTED: "GO!" text scales 0.6→2.0 with alpha→0 over 400ms. ROUND_ENDED: existing winner banner is yanked from below the screen up to its position with `Bounce.easeOut` over 350ms. |
| 7 | Vignette | Done | Procedural radial gradient rendered to a 256×256 canvas texture (`textures.addCanvas`), displayed at full screen, alpha 0 inner → ~0.55 outer with a kink at 0.5. Single image — no per-frame cost. |
| 8 | Optional: freeze-frame on death | Done | `scene.time.timeScale = 0.35` for 90ms (real-time setTimeout, not scene timer) then back to 1.0. Tween system also throttled to keep visual rhythm consistent. |
| 8 | Optional: bullet trail | Done | Per-bullet ring buffer of 6 positions, redrawn each frame as 5 line segments with alpha ramp 0→0.6. Single shared `Graphics` for all bullets — one draw call. |

## Architecture

PolishSystem is a parallel observer:
- **No gameplay touched.** No physics, AI, scoring, or round-state changes. Only freeze-frame uses `scene.time.timeScale` (a Phaser time-scaling primitive, not a state mutation).
- **No new EventBus events.** The single payload addition on `BULLET_RICOCHET` (`nx, ny, vx, vy`) is additive and ignored by anything not looking for it.
- **No external assets.** Crown is pixel art via the existing `PixelRenderer`. Vignette is canvas2D radial gradient. Sparks/smoke are 1×1 colored Graphics rectangles.
- **HMR-safe.** PolishSystem registers all listeners in the constructor and removes them in the SHUTDOWN handler. Vignette texture is gated by `scene.textures.exists()` so a hot-reload can't add a duplicate.

## Performance notes

Worst-case particle count:
- 4 tanks moving + thrusting → 4 × 12.5 smoke particles/sec = ~50 active smoke particles.
- ~10 bullets × ~2 ricochets/lifetime × 5 sparks = ~100 spark particles in flight.
- Plus muzzle (4 sparks/shot, ~1 shot/sec/tank = ~16 sparks) and a handful of death smoke during round-end.

Total ceiling ~200 active particles. Each is a single `Phaser.Graphics` reused via the pool, so no per-frame allocation. Bullet trails redraw a single shared `Graphics` per frame (cheap). Headless Chromium ran 4 simulated rounds without dropping frames or warnings.

## Deviations / things that didn't make the cut

1. **Draw uses `camera.flash()` instead of a desaturating tint.** A real desaturate would need a color matrix shader or a fullscreen blue-grey overlay. Phaser cameras support `setTint` but tints multiply per-pixel and turn the maze bluish-green (incorrect). `camera.flash(600ms, 80,96,112)` produces a brief blue-grey pulse that reads as "freeze the action" — the same emotional beat in fewer LOC.
2. **Crown stays anchored above the winning tank's *current* x position** (it tracks `crownTank.x` per frame), but the bob tween owns y. If the winning tank starts moving during the round-over hold (it shouldn't — `roundState !== 'playing'` blocks input + AI), the crown follows. Tested OK.
3. **Brief 1-frame ricochet white circle** — implemented as a quick 90ms tween rather than a literal 1-frame flash, because at 60 fps a single frame (16ms) is borderline imperceptible after the post-impact bullet repositioning. 90ms reads as "punchy flash" without overstaying.
4. **Countdown "pulse"** modulates the existing `RoundSystem.subBanner` rather than spawning a separate text. This avoids double-rendering and keeps the layout coherent. Side effect: the polish system reaches into RoundSystem internals (`scene.roundSystem.subBanner` / `.banner`) to add tweens. Acceptable because both live in the same scene and the banners are stable references — but it is a coupling worth noting.
5. **No SPECTACLE_HIT / SPECTACLE_ACTION listeners.** Tank.kill and Tank.tryFire emit these in addition to TANK_DIED / TANK_FIRED. The existing handlers cover the same triggers, so subscribing to spectacle channels too would just double-fire effects. Left untouched for the audio pass to use.
6. **Tank death emits `SPECTACLE_HIT`** — I considered using that to add a hit-mark/blood splat but it's not in the brief; the explosion already conveys impact.

## Verification

Smoke-tested via Playwright + swiftshader against the running dev server at `http://localhost:3001/`:

- Boot + countdown + 1 round of gameplay completes with `NO ERRORS` (0 console errors, 0 page errors).
- Player drove forward and fired → screenshot captured **muzzle flash** at barrel tip, **yellow sparks** flying with bullet, **smoke trail** behind player tank, **bullet trail** clearly visible as fading yellow line.
- Forced ricochet (bullet spawned heading at a wall) → screenshot captured **sparks burst + flash** at impact point.
- Programmatic kill of one tank → frame-by-frame captures of explosion show **frame 0 bright orange core**, **frame 1 smoke ring**, **frame 2 fade**, plus visible **camera shake** between frames and **dark smoke drifting up**.
- Killed 3 of 4 tanks → **gold crown** rendered above the surviving RED tank, bobbing.
- Killed all 4 simultaneously → **DRAW** banner displayed (with bounce-in slide), **camera flash** triggered (blue-grey desaturate pulse), no crown.
- Multiple rounds played → state machine intact (R1 RED 1 → R2 → R2 DRAW), wins persisted, polish layer reset cleanly between rounds.
- HMR: vite log shows ~10 hot reloads of `PolishSystem.js` and `Constants.js` during development with no breakage and no duplicate-texture warnings.

## Loose ends

- **The freeze-frame uses `window.setTimeout` to restore `scene.time.timeScale`** rather than the scene's own delayedCall, because we can't schedule a delayed call on a clock that's depressed. Side effect: if the page is backgrounded during the 90ms freeze, the timer fires when the tab regains focus and the restoration could be late. Negligible in practice.
- **Crown texture key `crown`** is reused across rounds and never destroyed. PixelRenderer's `textures.exists` guard prevents duplication on HMR; explicit destroy on scene shutdown isn't needed because the scene SHUTDOWN clears the texture cache.
- **Bullet trails carry over for ~1 frame after a bullet's last position update before being culled** (because `_updateBulletTrails` iterates `scene.bullets` which still contains the dying bullet for one frame before `bullets = bullets.filter(b => b.alive)` runs in GameScene.update). Visual: the trail's last segment pops 1 frame after the bullet sprite vanishes. Imperceptible at 60 fps.
- **The Step 1.5 brief noted the HUD overlaps the top wall row.** Step 2 didn't fix this — the brief told me to "stay focused on combat juice" and "don't add a HUD beyond the existing one." Worth flagging again for whichever step takes UI.
