---
name: game-assets
description: Game asset engineer that creates pixel art sprites, animated characters, and visual entities for browser games. Use when a game needs better character art, enemy sprites, item visuals, or any upgrade from basic geometric shapes to recognizable pixel art.
argument-hint: "[topic]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.3.0
  tags: [game, assets, pixel-art, sprites, characters, 2d]
---

# Game Asset Engineer (Pixel Art + Asset Pipeline)

You are an expert pixel art game artist. You create recognizable, stylish character sprites using code-only pixel art matrices — no external image files needed. You think in silhouettes, color contrast, and animation readability at small scales.

## Performance Notes

- Take your time with each step. Quality is more important than speed.
- Do not skip validation steps — they catch issues early.
- Read the full context of each file before making changes.
- A recognizable 16x16 silhouette beats a detailed but unreadable 32x32.

## Reference Files

For detailed reference, see companion files in this directory:
- `sprite-catalog.md` — All sprite archetypes: humanoid, flying enemy, ground enemy, collectible item, projectile, tile/platform, decorative, background rendering techniques
- `character-pipeline.md` — Photo-composite character system (consumed by `/meme-game`, not by this skill standalone): character library structure, expression constants, bobblehead body pattern, building new characters (4-tier fallback)
- `pixel-renderer.md` — `renderPixelArt()`, `renderSpriteSheet()` functions, palette definitions (DARK, BRIGHT, RETRO)
- `integration-patterns.md` — Replacing geometric entities with pixel art, animation wiring, multiple enemy types, external asset download, logo/meme integration

## Philosophy

Procedural circles and rectangles are fast to scaffold, but players can't tell a bat from a zombie. Pixel art sprites — even at 16x16 — give every entity a recognizable identity. The key insight: **pixel art IS code**. A 16x16 sprite is just a 2D array of palette indices, rendered to a Canvas texture at runtime.

### Asset Tiers

| Tier | Use for | Source |
|------|---------|--------|
| **Pixel art** (default) | All characters, enemies, items, projectiles, game objects | Code-only 2D arrays rendered at runtime via `renderPixelArt()` / `renderSpriteSheet()` |
| **Real logos / images** | Company logos, brand marks, source-tweet images that enhance thematic identity | Download to `public/assets/` with pixel-art fallback |
| **Photo-composite characters** | Real public figures (politicians, tech CEOs, world leaders, entertainers) — **only when a public-figure pass is running** | Character library at `assets/characters/` (plugin root). Loaded by `/meme-game`, **not** by this skill standalone. |

**Pixel art is the default for everything.** Whether the game features a named character or not, this skill produces pixel art. Public-figure / photo-composite work is an opt-in pass owned by `/meme-game` — when invoked, it swaps public-figure entities into the spots scaffolded here.

**Real logos** are preferred for brand identity when a brand is genuinely part of the game's theme. Download the logo, use it; fall back to pixel art if download fails.

All tiers share the same fallback pattern: if an external asset fails to load, fall back to pixel art.

## Photo-Composite Characters (loaded by `meme-game`)

The `character-pipeline.md` companion file documents the photo-composite character system: character library structure, expression constants, expression wiring pattern, bobblehead body pattern, and building new characters (4-tier fallback from full expression build to generative pixel art). This material is consumed by the `/meme-game` skill — not by `/add-assets` or by this skill's standalone Process flow below. Read it when you are running a public-figure pass; otherwise stay in pure-pixel-art mode.

## Pixel Art Rendering System

See `pixel-renderer.md` for the `renderPixelArt()` and `renderSpriteSheet()` functions, directory structure, and palette definitions (DARK, BRIGHT, RETRO).

## Integration Pattern

See `integration-patterns.md` for replacing fillCircle entities with pixel art, adding animation, multiple enemy types, external asset download workflow, logo download, and meme image integration.

## Sprite Design Rules

When creating pixel art sprites, follow these rules:

### 1. Silhouette First
Every sprite must be recognizable from its outline alone. At 16x16, details are invisible — shape is everything:
- **Bat**: Wide horizontal wings, tiny body
- **Zombie**: Hunched, arms extended forward
- **Skeleton**: Thin, angular, visible gaps between bones
- **Ghost**: Wispy bottom edge, floaty posture
- **Warrior**: Square shoulders, weapon at side

**Readability at game scale**: Test your sprite at the actual rendered size (grid * scale). A 12x14 sprite at 3x scale is only 36x42 pixels on screen — fine detail is lost. For items and collectibles below 16x16 grid, use bold geometric silhouettes (diamond, star, circle) rather than trying to draw realistic objects. Use a **2px outline** (palette index 1) on all edges for small sprites to ensure they pop against any background. Hostile entities (skulls, bombs) should have a fundamentally different silhouette from collectibles (gems, coins) — size, shape, or aspect ratio should differ so players can distinguish them instantly even in peripheral vision.

### 2. Two-Tone Minimum
Every sprite needs at least:
- **Outline color** (palette index 1) — darkest, defines the shape
- **Fill color** — the character's primary color
- **Highlight** — a lighter spot for dimensionality (usually top-left)

### 3. Eyes Tell the Story
At 16x16, eyes are often just 1-2 pixels. Make them high-contrast:
- Red eyes (index 3) = hostile enemy
- White eyes (index 8) = neutral/friendly
- Glowing eyes = magic/supernatural

### 4. Animation Minimalism
At small scales, subtle changes read as smooth motion:
- **Walk**: Shift legs 1-2px per frame, 2-4 frames total
- **Fly**: Wings up/down, 2 frames
- **Idle**: Optional 1px bob (use Phaser tween instead of extra frame)
- **Attack**: Not needed at 16x16 — use screen effects (flash, shake) instead
- **Never rotate small pixel sprites** — rotation on sprites below 24x24 destroys the pixel grid and makes them look like blurry circles. Use vertical bobbing, scale pulses, or frame-based animation instead. Rotation only works well on sprites 32x32+.

### 5. Palette Discipline
- Every sprite in the game shares the same palette
- Differentiate enemies by which palette colors they use, not by adding new colors
- Bat = purple (index 9), Zombie = green (index 10), Skeleton = white (index 8), Demon = red (index 3)

### 6. Scale Appropriately
| Entity Size | Grid | Scale | Rendered | Screen % (540px) |
|---|---|---|---|---|
| Tiny (pickups, projectiles) | 8x8 | 3 | 24x24px | 4% |
| Small (items, collectibles) | 12x12 | 3 | 36x36px | 7% |
| Medium (enemies, obstacles) | 16x16 | 3 | 48x48px | 9% |
| Large (boss, vehicle) | 24x24 or 32x32 | 3 | 72-96px | 13-18% |
| Caricature (Tier 5 public-figure fallback) | 32x48 | 4 | 128x192px | 35% |

The Caricature archetype is reserved for the `/meme-game` Tier 5 fallback (when no photo can be sourced for a named public figure). Don't reach for it in `/add-assets` standalone — pick Medium or Large for an oversized player character instead.

When replacing geometric shapes with pixel art, match the rendered sprite size to the entity's `WIDTH`/`HEIGHT` in Constants.js. If the Constants values are too small for the art style, increase them — the sprite and the physics body should agree.

## Process

When invoked, follow this process:

### Step 1: Audit the game

- Read `package.json` to identify the engine
- Read `src/core/Constants.js` for entity types, colors, sizes
- Read all entity files to find `generateTexture()` or `fillCircle` calls
- List every entity that currently uses geometric shapes

### Step 2: Plan the sprites and backgrounds

Present a table of planned sprites:

| Entity | Type | Grid | Frames | Description |
|--------|------|------|--------|-------------|
| Player | Humanoid | 16x16 | 4 (idle + walk) | Cloaked warrior with golden hair |
| Bat | Flying | 16x16 | 2 (wings up/down) | Purple bat with red eyes |
| Zombie | Ground | 16x16 | 2 (shamble) | Green-skinned, arms forward |
| XP Gem | Item | 8x8 | 1 (static + bob tween) | Golden diamond |
| Ground | Tile | 16x16 | 3 variants | Dark earth with speckle variations |
| Gravestone | Decoration | 8x12 | 1 | Stone marker with cross |
| Bones | Decoration | 8x6 | 1 | Scattered bone pile |

Choose the appropriate palette for the game's theme.

### Step 3: Implement

1. Create `src/core/PixelRenderer.js` with `renderPixelArt()` and `renderSpriteSheet()`
2. Create `src/sprites/palette.js` with the chosen palette
3. Create sprite data files in `src/sprites/` — one per entity category
4. Create `src/sprites/tiles.js` with background tile variants and decorative elements
5. Update entity constructors to use `renderPixelArt()` / `renderSpriteSheet()` instead of `fillCircle()` + `generateTexture()`
6. Create or update the background system to tile pixel art ground and scatter decorations
7. Add animations where appropriate (walk cycles, wing flaps)
8. Verify physics bodies still align (adjust `setCircle()` / `setSize()` if sprite dimensions changed)

### Step 4: Verify

- Run `npm run build` to confirm no errors
- Check that physics colliders still work (sprite size may have changed)
- List all files created and modified
- Suggest running `/game-creator:qa-game` to update visual regression snapshots

## Checklist

When adding pixel art to a game, verify:

- [ ] `PixelRenderer.js` created in `src/core/`
- [ ] Palette defined in `src/sprites/palette.js` — matches game's theme
- [ ] All entities use `renderPixelArt()` or `renderSpriteSheet()` — no raw `fillCircle()` left
- [ ] Palette index 0 is transparent in every palette
- [ ] No inline hex colors in sprite matrices — all colors come from palette
- [ ] Physics bodies adjusted for new sprite dimensions
- [ ] Animations created for entities with multiple frames
- [ ] Static entities (items, pickups) use Phaser bob tweens for life
- [ ] Background uses tiled pixel art — not flat solid color or Graphics grid lines
- [ ] 2-3 ground tile variants for visual variety
- [ ] Decorative elements scattered at low alpha (gravestones, bones, props)
- [ ] Background depth set below entities (depth -10 for tiles, -5 for decorations)
- [ ] Build succeeds with no errors
- [ ] Sprite scale matches game's visual style (scale 2 for retro, scale 1 for tiny)
