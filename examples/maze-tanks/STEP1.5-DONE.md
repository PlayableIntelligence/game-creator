# Step 1.5 — Sprites

## Files

### Created
- `src/core/PixelRenderer.js` — `renderPixelArt(scene, pixels, palette, key, scale)` and `renderSpriteSheet(scene, frames, palette, key, scale)`. Both idempotent (early-return if key exists) so HMR-driven re-runs don't pile up textures. Canvas is created with `imageSmoothingEnabled = false` for crisp pixels.
- `src/sprites/palette.js` — Single shared palette (12 indices, index 0 transparent). Indices 11/12/13 are per-tank shadow/body/highlight, filled at runtime by `getTankPalette(colorName)` from `Constants.COLORS`. Per-tank palettes are cached.
- `src/sprites/tank.js` — Tank body matrix (36×22). Chassis fills cols 0–27 (matching `TANK.WIDTH = 28`); barrel protrudes to cols 22–33 so it sticks past the chassis like the original Graphics version. Exports `TANK_SPRITE_WIDTH/HEIGHT/ORIGIN_X/ORIGIN_Y` so Tank.js can place the chassis center at the rotation pivot.
- `src/sprites/bullet.js` — 8×8 yellow pellet (`BULLET_PELLET`), bright core + outline.
- `src/sprites/walls.js` — `WALL_TILE` (32×32, top-left highlight bevel + bottom-right shadow bevel + 4 corner rivets) and `FLOOR_TILE` (32×32, dark concrete with hand-placed interior grit speckles — speckles avoid edge rows/cols so the tile is seamless).
- `src/sprites/effects.js` — `EXPLOSION_FRAMES` (4× 32×32, computed with center-distance test fn) and `MUZZLE_FLASH` (16×16 hand-drawn). Textures registered for Step 2 to wire animations.
- `src/sprites/registerSprites.js` — One-shot registration: 4 tank textures (RED/BLUE/GREEN/YELLOW) + bullet + wall + floor + explosion spritesheet + muzzle flash. Picks `renderScale = max(1, round(PX))` so canvases approximate display size; final fit happens via `setDisplaySize()` on each Phaser image.

### Modified
- `src/core/Constants.js` — Added `SPRITE_SCALE = PX` (currently unused in entity code; available for future scale-tuning).
- `src/scenes/BootScene.js` — Calls `registerSprites(this)` before `scene.start('GameScene')`. Ensures textures exist before any entity draws.
- `src/systems/MazeSystem.js` — `draw()` rewritten: per-tile `scene.add.image('floor_tile')` for every cell + per-tile `scene.add.image('wall_tile')` for `'#'` cells. Each image uses `setDisplaySize(tileSize, tileSize)`. Removed the `Graphics`-based rectangle fills and the bulk floor `add.rectangle`. Phaser batches identical-texture images, so 880 floor + ~150 wall images = 2 batches.
- `src/entities/Tank.js` — `draw()` rewritten: single `scene.add.image('tank_body_<color>')` replacing 5 Graphics primitives (chassis + 2 treads + turret base + barrel). Sprite origin is the chassis center within the wider 36-px sprite (`TANK_SPRITE_ORIGIN_X = 14/36`) so rotation pivots around the chassis, not the sprite midpoint. Removed `Phaser` import (no longer needed).
- `src/entities/Bullet.js` — Replaced `scene.add.circle(...)` + `setStrokeStyle` with `scene.add.image('bullet')` + `setDisplaySize(8*PX, 8*PX)`. Removed `COLORS` import (no longer needed).

## Palette

```
0  transparent
1  0x0a0c10  deep outline (matches COLORS.BG)
2  0x2a313e  steel shadow
3  0x444c5e  steel mid (COLORS.WALL)
4  0x5a6378  steel highlight
5  0x1a1d24  floor dark (COLORS.FLOOR)
6  0x252932  floor grit
7  0xffe066  bullet core glow (COLORS.BULLET)
8  0xfff2a8  muzzle bright (COLORS.MUZZLE)
9  0x7a7a82  smoke
10 0xff7a3a  explosion flame orange
11 <per-tank shadow>      (= 0.55 × COLORS[colorName])
12 <per-tank body>        (= COLORS[colorName])
13 <per-tank highlight>   (clamped 1.35 × COLORS[colorName])
```

Total 11 fixed indices + 3 swappable = 14 logical slots; any single rendered sprite uses ≤ 12 colors, hitting the cap. Tank body matrix is one shared template; the four tank textures differ only in the tank-specific shades injected via `getTankPalette()`.

## Notes / deviations

1. **Tank sprite is 36×22, not 28×22** as the brief listed. The brief said "28×22" for the chassis, but the original Step 1 barrel extended past the chassis edge (turret length 18 from center → 4px past chassis right edge). To preserve that silhouette, the sprite is 36 wide with the barrel protruding from cols 22–33, and `TANK_SPRITE_ORIGIN_X = 14/36` puts the rotation pivot at the chassis center. Collision/physics are unchanged — they still use `TANK.WIDTH=28`. Net visual: the barrel sticks past the chassis like before, just in pixel art.
2. **Render scale = `Math.max(1, Math.round(PX))`**, not `SPRITE_SCALE = PX`. PX is fractional (e.g., 1.5 on retina); rendering at fractional canvas size produces blurry source pixels. Integer-scaled textures stay crisp; the small fractional rescale at display time (handled by `setDisplaySize`) is barely visible with `antialias: true` already on. `SPRITE_SCALE` is exported in Constants for completeness but not currently consumed.
3. **Floor tiles render as 880 individual images** (40×22 grid), not a single `tileSprite`. tileSprite shrinks the source canvas under the hood at higher DPRs, killing the speckle. Per-tile images batch identically by texture key, so this is 1 draw call for the floor on the GPU side.
4. **Removed the wall tile's bottom-edge shadow streak** (cols 4–27 row 29). With the streak, vertically stacked wall tiles showed prominent dark horizontal seams that broke the "monolithic block" feel. Without it, adjacent walls read as solid steel structures while individual tiles still pop via their bevels and rivets.
5. **No `preload()` call added** to BootScene. Sprites are registered synchronously in `BootScene.create()` before `scene.start('GameScene')`. PixelRenderer creates Canvas-backed textures (no async file load), so this is safe.
6. **Explosion + muzzle flash textures are registered but unused.** Step 2 wires the TANK_FIRED → muzzle flash and TANK_DIED → explosion animations. Frame 0 of the explosion is bright core, frame 1 expanded ring + smoke, frame 2 smoke only, frame 3 dissipating wisp. Muzzle flash is single-frame radial burst.

## Loose ends

- **`SPRITE_SCALE` constant is currently unused.** Exported for future use (e.g., if Step 2 wants to override per-sprite scale), but no entity reads it. Could be removed if Step 2 doesn't end up needing it (no-unused-exports rule).
- **Tank sprite origin uses `14/36 = 0.388…` for X.** A value of exactly `14/36` floats to `0.3888...` — pixel-perfect at integer-scale sources, but if the texture is rescaled to fractional display sizes the pivot may sit on a sub-pixel boundary. Visually fine in testing.
- **The 4 tank palettes are cached in module scope** (`_tankPaletteCache` in palette.js). HMR replacing palette.js drops the cache, but `renderPixelArt`'s key check still skips re-render — so cached textures survive HMR. Verified: hot-reloading palette.js does not re-color tanks until full page reload, which is acceptable for dev.
- **Tank highlight color is a clamped factor multiply** (1.35×). For YELLOW (0xf1c40f), the green channel `0xc4 × 1.35 = 264.6 → clamp 255` and the others clamp similarly, producing a slightly desaturated highlight. Looks fine in the dark arena, but if a future tank color is near-white the highlight will collapse to white. Worth revisiting if more tank colors are added.
- **Wall tile rivets are at the inner-corner positions (cols 3,3 / 27,3 / 3,27 / 27,27).** When two wall tiles abut, the rivets along the shared edge sit close to each other — visible in the screenshots as 2-pixel-wide dark dots near each tile boundary. Reads as decorative bolts in stacked steel; if Step 2 wants a more featureless "fortress wall" it could remove or de-emphasize them.

## Verification

- Smoke test against `http://localhost:3001/` (Playwright + swiftshader) — 0 console errors, 0 page errors.
- All textures registered: `tank_body_red/blue/green/yellow`, `bullet`, `wall_tile`, `floor_tile`, `explosion`, `muzzle_flash`.
- Texture dimensions verified: tanks 36×22, walls/floor 32×32, bullet 8×8, muzzle 16×16, explosion 128×32 (4 frames).
- Player drove (W) + rotated (A) + fired (Space) → tank moved from (80,80) to (107,84), rotation -0.5, 2 bullets spawned.
- Bot tanks moved on their own; visible across the map.
- Killed BLUE tank programmatically → `alpha=0.25` fade visible in screenshot.
- HMR-tested (~25 reloads during development) without breakage; no duplicate-texture warnings.
