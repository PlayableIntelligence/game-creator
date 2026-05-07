---
name: add-assets
description: Replace geometric shapes (circles, rectangles) with pixel art sprites — generic characters, enemies, items, and projectiles. Use when the user says "add sprites", "add pixel art", "convert shapes to art", "replace the shapes with sprites", or "add game assets". For 3D games, use add-3d-assets instead. Do NOT use for: 3D models (use add-3d-assets), gameplay changes (use add-feature), or swapping in **real public figures** like Trump/Musk/Altman/CEOs as photo-composite characters (use `/meme-game`).
argument-hint: "[path-to-game]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.3.0
  tags: [game, assets, sprites, pixel-art, characters, 2d]
---

## Performance Notes

- Take your time to do this thoroughly
- Quality is more important than speed
- Do not skip validation steps

# Add Assets

Replace basic geometric shapes (circles, rectangles) with pixel art sprites for all game entities. Every character, enemy, item, and projectile gets a recognizable visual identity — all generated as code, no external image files needed.

## Instructions

Analyze the game at `$ARGUMENTS` (or the current directory if no path given).

First, load the game-assets skill to get the full pixel art system, archetypes, and integration patterns.

### Step 1: Audit

- Read `package.json` to identify the engine (Phaser or Three.js — this skill is Phaser-focused)
- Read `src/core/Constants.js` to understand entity types, colors, and sizes
- Read all entity files (`src/entities/*.js`) and find every `generateTexture()`, `fillCircle()`, `fillRect()`, or `fillEllipse()` call that creates an entity sprite
- Read scene files to check for inline shape drawing used as game entities
- List every entity that currently uses geometric shapes

### Step 2: Plan

Present a table of sprites to create:

| Entity | Archetype | Grid | Frames | Description |
|--------|-----------|------|--------|-------------|
| Player | Humanoid | 16x16 | 4 | Idle + walk frames |
| Enemy X | Flying | 16x16 | 2 | Wings up/down |
| Pickup | Item | 8x8 | 1 | Bobs in place |

Choose the palette that best matches the game's existing color scheme:
- **DARK** — gothic, horror, dark fantasy
- **BRIGHT** — arcade, platformer, casual
- **RETRO** — NES-style, muted tones

Grid sizes range from 8x8 (tiny pickups) through 16x16 (standard entities) to 24x24 / 32x32 (boss / vehicle). For an oversized hero, push to 32x32; otherwise stick with 16x16.

**Public-figure / photo-composite characters are out of scope for this skill.** If the user wants real public figures (Trump, Musk, Altman, etc.) as recognizable photo-composite characters with reactive expressions, redirect them to `/meme-game [path] [name1,name2,...]`. That skill owns the character library, the WebSearch + face-detection pipeline, the bobblehead body pattern, and the expression wiring. `/add-assets` stays focused on generic pixel art for fictional or unnamed entities.

### Step 3: Implement

1. Create `src/core/PixelRenderer.js` — the `renderPixelArt()` and `renderSpriteSheet()` utility functions
2. Create `src/sprites/palette.js` — the shared color palette
3. Create sprite data files in `src/sprites/`:
   - `player.js` — player idle + walk frames
   - `enemies.js` — all enemy type sprites and frames
   - `items.js` — pickups, gems, hearts, etc.
   - `projectiles.js` — bullets, fireballs, bolts (if applicable)
4. Update each entity constructor:
   - Replace `fillCircle()` / `generateTexture()` with `renderPixelArt()` or `renderSpriteSheet()`
   - Add Phaser animations for entities with multiple frames
   - Adjust physics body dimensions if sprite size changed (`setCircle()` or `setSize()`)
5. For static items (gems, pickups), add a bob tween if not already present

### Step 4: Verify

- Run `npm run build` to confirm no errors
- Check that collision detection still works (physics bodies may need size adjustments)
- List all files created and modified
- Remind the user to run the game and check visuals
- Suggest running `/game-creator:qa-game` to update visual regression snapshots since all entities look different now

## Example Usage

### Standard game
```
/add-assets examples/asteroid-dodge
```
Result: Audits all entities using geometric shapes → creates `src/sprites/` with player, asteroids, and gem pixel art → replaces `fillCircle()`/`fillRect()` with `renderPixelArt()` → collision bounds adjusted.

### Public-figure / meme game
```
/meme-game examples/nick-land-dodger trump,musk
```
For real public figures, use `/meme-game` instead of `/add-assets`. It handles the photo-composite character pipeline, expression wiring, and the bobblehead body pattern.

## Troubleshooting

### Sprites appear but are wrong size
**Cause:** Pixel art dimensions don't match original hitbox.
**Fix:** Keep sprite dimensions close to the original fillRect/fillCircle size. Adjust collision bounds if needed.

### Sprites don't appear
**Cause:** Canvas texture not created before first render frame.
**Fix:** Generate textures in scene preload() or create(), not in update().

## Next Step

Tell the user:

> Your game entities now have pixel art sprites instead of geometric shapes! Each character, enemy, and item has a distinct visual identity.
>
> **Files created:**
> - `src/core/PixelRenderer.js` — rendering engine
> - `src/sprites/palette.js` — shared color palette
> - `src/sprites/player.js`, `enemies.js`, `items.js` — sprite data
>
> Run the game to see the new visuals. If you have Playwright tests, run `/game-creator:qa-game` to update the visual regression snapshots.
