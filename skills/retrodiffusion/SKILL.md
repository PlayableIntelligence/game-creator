---
name: retrodiffusion
description: Generate true pixel art sprites, tilesets, and animations with the Retro Diffusion API — the best dedicated pixel art model. Use when the user says "generate pixel art", "make a sprite with AI", "use Retro Diffusion", "rdpk", or wants high-quality pixel art faster than hand-coded sprite arrays. Requires a Retro Diffusion account and RETRODIFFUSION_API_KEY (paid credits). Great for quick prototyping of 2D Phaser games.
argument-hint: "[prompt]"
license: MIT
compatibility: Requires a Retro Diffusion account, RETRODIFFUSION_API_KEY environment variable, and internet access for API calls. Each generation consumes paid credits from the user's account.
metadata:
  author: OpusGameLabs
  version: 1.0.0
  tags: [game, 2d, pixel-art, retro-diffusion, ai, image-generation, sprites, tilesets, animation]
---

# Retro Diffusion — True Pixel Art Generation

Generate authentic pixel art sprites, tilesets, and animations from text prompts or reference images using the [Retro Diffusion](https://www.retrodiffusion.ai) API. Output is true pixel art (clean integer-pixel grids, limited palettes), not blurry diffusion-model output downscaled into pixels — making it the best AI option for shippable 2D game art and fast prototyping.

> **Paid service.** Retro Diffusion requires an account at https://www.retrodiffusion.ai and an API key with credits. **Always tell the user this requires a paid Retro Diffusion account before generating anything**, and confirm they understand each call deducts from their balance.

## Reference Files

| File | Description |
|------|-------------|
| [api-reference.md](./api-reference.md) | Full API endpoints, models, prompt_style values, response shape, pricing, and error codes |

## When to Use

- **Quick prototypes** — generate dozens of unique sprites in a minute instead of hand-coding 16×16 arrays
- **Polish pass on a working game** — replace placeholder shapes with cohesive pixel art that already matches a chosen style
- **Tilesets** — wang-style ground/wall sets without manually drawing every transition tile
- **Sprite animations** — walk cycles, idle bobs, attacks delivered as transparent GIFs or spritesheets

**Choose this over `add-assets` (code-only pixel art) when:** the user wants AI-generated art, has a Retro Diffusion key, or the game needs more visual variety than hand-coded matrices can deliver in a reasonable time. The two skills compose well — Retro Diffusion for hero sprites/tilesets, code-only matrices as a free fallback for quick filler.

**Do NOT use this for:** 3D models (use `meshyai`), 3D worlds (use `worldlabs`), audio (use `game-audio`), or when the user explicitly wants the all-code procedural pixel art approach (use `add-assets`).

## Authentication

Before prompting the user, check if the key already exists:
```bash
test -f .env && grep -q '^RETRODIFFUSION_API_KEY=.' .env && echo "found"
```
If found, export it with `set -a; . .env; set +a` and skip the prompt.

If the key is **not** set, **ask the user immediately and explain the cost model**:

> I'll generate true pixel art with Retro Diffusion — the best dedicated pixel art model for shippable game sprites.
>
> **Heads up: this is a paid service.** You'll need a Retro Diffusion account with credits. Each image typically costs between $0.015 (RD_FAST) and $0.18 (RD_PRO). Get a key in 60 seconds:
>
> 1. Sign up at https://www.retrodiffusion.ai
> 2. Buy credits (smallest pack is fine for prototyping)
> 3. Account → API → Generate API key
>
> Paste your key like: `RETRODIFFUSION_API_KEY=rdpk-...`
> (It will be saved to `.env` and redacted from this conversation.)
>
> Or type "skip" to fall back to free hand-coded pixel art via `/add-assets`.

If the user provides a key, save it to `.env` and use it via `set -a; . .env; set +a && node scripts/retrodiffusion-generate.mjs ...`.

If the user skips, **stop and hand off to `/add-assets`** — do not silently degrade to a different art style without telling them.

## CLI Script — `scripts/retrodiffusion-generate.mjs`

Zero-dependency Node.js script. Handles all six modes: generate, img2img, animate, tileset, edit, and balance.

### Generate (text-to-pixel-art)

```bash
# Single 64×64 sprite, RD_FAST (cheapest)
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode generate \
  --prompt "a cute green slime with big eyes" \
  --model RD_FAST --style retro \
  --width 64 --height 64 \
  --output public/assets/sprites/ --slug slime

# Higher quality with RD_PRO (flat $0.18, supports up to 256×256)
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode generate \
  --prompt "a heroic knight, full body, side view" \
  --model RD_PRO --style fantasy \
  --width 128 --height 128 \
  --output public/assets/sprites/ --slug knight

# Transparent background for game sprites
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode generate --prompt "a treasure chest, closed" \
  --model RD_FAST --style game-asset \
  --width 64 --height 64 --remove-bg \
  --output public/assets/sprites/ --slug chest

# Seamless tiling texture (e.g., grass, water)
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode generate --prompt "lush grass texture, top down" \
  --model RD_PLUS --style top-down \
  --width 64 --height 64 --tile-x --tile-y \
  --output public/assets/tiles/ --slug grass

# Estimate cost before paying for it
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode generate --prompt "..." --check-cost
```

### Image-to-Image (refine a reference)

```bash
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode img2img \
  --image ./concept-art/hero-sketch.png \
  --prompt "a heroic knight in shining armor" \
  --model RD_FAST --style retro \
  --width 64 --height 64 --strength 0.75 \
  --output public/assets/sprites/ --slug hero
```

`--strength` controls how much the AI deviates from the input (0 = identical, 1 = ignore input). 0.5–0.8 is the useful range.

### Animations (walk cycles, idles, attacks)

```bash
# Walk cycle — returns spritesheet PNG or transparent GIF (style-dependent)
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode animate \
  --prompt "a knight walking" \
  --model RD_PRO --style walk-cycle \
  --width 64 --height 64 \
  --output public/assets/sprites/ --slug knight-walk

# Idle bob from an existing character
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode animate --image public/assets/sprites/knight.png \
  --prompt "knight idle breathing" --style idle \
  --output public/assets/sprites/ --slug knight-idle
```

Animation styles cost $0.07–$0.25 depending on type. See [api-reference.md](./api-reference.md) for the full style list.

### Tilesets

```bash
# Wang-style tileset (auto-tiling ground/wall sets)
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode tileset \
  --prompt "stone dungeon floor, mossy" \
  --model RD_PLUS --style wang-tile \
  --width 96 --height 96 \
  --output public/assets/tiles/ --slug dungeon-floor

# Single detailed tile
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode tileset --prompt "wooden bridge plank" --style single-tile \
  --width 64 --height 64 --output public/assets/tiles/ --slug bridge
```

### Edit (progressive refinement)

Flat $0.06 per edit. Use to tweak a generated sprite without re-rolling from scratch.

```bash
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs \
  --mode edit --image public/assets/sprites/knight.png \
  --prompt "give the knight a red cape" \
  --output public/assets/sprites/ --slug knight-red
```

### Balance check

```bash
RETRODIFFUSION_API_KEY=<key> node scripts/retrodiffusion-generate.mjs --mode balance
```

## Model Selection Guide

| Model | Cost | Sizes | Best for |
|-------|------|-------|----------|
| **RD_FAST** | $0.015–0.04 | 64×64 to 384×384 | Bulk prototyping, simple sprites, items |
| **RD_PLUS** | $0.025–0.08 | 16×16 to 192×192 | Tilesets, top-down, watercolor, Minecraft-style |
| **RD_PRO** | $0.18 flat | 64×64 to 256×256 | Hero sprites, isometric scenes, polish pass (17+ styles, supports up to 9 reference images) |
| **RD_MINI** | varies | very small | Routes to PLUS/FAST for tiny pickups |

Default to **RD_FAST** for prototyping. Upgrade individual hero sprites to **RD_PRO** when the prototype is shipping.

See [api-reference.md](./api-reference.md) for the complete per-model `prompt_style` list.

## Prompt Engineering for Pixel Art

Good prompts are short, specific about silhouette and palette, and call out the perspective:

| Goal | Prompt | Why |
|------|--------|-----|
| Game character | "a cute green slime, big eyes, side view" | Single subject, perspective named |
| Item | "a glowing red potion bottle" | Specific shape + color |
| Tile | "lush grass texture, top down, seamless" | Perspective + tiling intent |
| Enemy | "a skeleton warrior, hunched, side view" | Silhouette cue ("hunched") |

**Avoid:**
- Multiple subjects in one prompt — generate separately and composite in-game
- Abstract concepts ("the feeling of dread") — describe the visual instead
- Mismatched perspective ("top-down knight, side view") — pick one

## Integration with Phaser Games

Retro Diffusion outputs are normal PNGs — they slot directly into Phaser's loader.

```js
// In a preload scene:
this.load.image('slime', 'assets/sprites/slime.png');
this.load.spritesheet('knight-walk', 'assets/sprites/knight-walk.png', {
  frameWidth: 64,
  frameHeight: 64,
});

// In create():
const slime = this.physics.add.sprite(100, 100, 'slime');
this.anims.create({
  key: 'knight-walk',
  frames: this.anims.generateFrameNumbers('knight-walk', { start: 0, end: 7 }),
  frameRate: 12,
  repeat: -1,
});
```

**Pixel-perfect rendering** — when using AI pixel art, configure the Phaser game with crisp scaling so sprites stay sharp:

```js
// In main.js, Phaser config:
const config = {
  type: Phaser.AUTO,
  pixelArt: true,           // disables antialiasing, preserves hard pixel edges
  roundPixels: true,        // snaps sprite positions to integers
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // ...
};
```

Without `pixelArt: true`, the browser will smooth-scale the PNGs and the pixel-art look is lost.

## Spritesheet Slicing

Animation styles return either a transparent GIF or a horizontal spritesheet (style-dependent — check the output PNG dimensions). For spritesheets, infer `frameWidth = imageWidth / frameCount` and load with `this.load.spritesheet()`. The `.meta.json` file written next to each output records the requested width/height so frame count is recoverable.

## Cost Discipline

Every call costs real money from the user's balance. Apply these defaults to avoid waste:

1. **Use `--check-cost` first** when generating at unfamiliar sizes or with RD_PRO.
2. **Default to RD_FAST + 64×64** for prototypes. Only upgrade specific hero sprites.
3. **Use `--seed`** when iterating on a prompt — same seed + same prompt = same image, so you can A/B test prompt edits without re-rolling random variations.
4. **Cache outputs** — generated PNGs are committed to `public/assets/sprites/`. Never regenerate an asset that already exists unless the user asked for a new variant.
5. **Run `--mode balance`** before a big batch so the user sees their remaining credits.

## Output Convention

```
public/assets/sprites/
  slime.png            # generated image
  slime.meta.json      # prompt, model, style, cost, balance, timestamps
  knight-walk.png      # animation spritesheet or GIF
  knight-walk.meta.json
public/assets/tiles/
  grass.png            # tiling texture
  grass.meta.json
```

Always write a `.meta.json` next to each PNG so the prompt and seed are recoverable for later regeneration.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `RETRODIFFUSION_API_KEY` not set | Key missing | Ask the user for their key (https://www.retrodiffusion.ai → Account → API). Save to `.env`. |
| HTTP 401 Unauthorized | Wrong header or invalid key | Header must be `X-RD-Token: <key>`, NOT `Authorization: Bearer`. Verify the key on the dashboard. |
| HTTP 400 "insufficient credits" | Account balance is empty | Tell the user to top up at the dashboard before retrying. Run `--mode balance` to confirm. |
| Sprite looks blurry in Phaser | Browser is smooth-scaling the PNG | Set `pixelArt: true` and `roundPixels: true` in the Phaser config. |
| Output ignores prompt details | Prompt is being auto-expanded into something different | Try `--bypass-prompt-expansion` to send the prompt verbatim. |
| Tileset edges don't match | Style isn't a wang/tile style | Use `--style wang-tile` for auto-tiling sets, or `--tile-x --tile-y` for seamless single textures. |
| img2img output ignores reference | Strength too high | Lower `--strength` to 0.4–0.6. Strength 0 keeps the input; strength 1 ignores it. |
| Inconsistent style across batch | Different seeds and slight prompt variation | Pin `--seed` and reuse the exact same prompt structure for sibling sprites (same character family). |

## Checklist

- [ ] **User informed this is a paid service** — Retro Diffusion account + credits required
- [ ] `RETRODIFFUSION_API_KEY` checked in `.env` or env, prompted if missing
- [ ] Model + style chosen for the budget (RD_FAST for prototyping, RD_PRO for hero sprites)
- [ ] `--check-cost` used for the first call at any new size
- [ ] Prompt is specific about subject, perspective, and silhouette
- [ ] `--seed` pinned when generating siblings (e.g., walk + idle of the same character)
- [ ] `--remove-bg` used for game sprites (transparent PNG)
- [ ] `--tile-x`/`--tile-y` used for textures, `--style wang-tile` for auto-tiling
- [ ] PNG written to `public/assets/sprites/` (or `tiles/`) with `.meta.json` alongside
- [ ] Phaser config has `pixelArt: true` and `roundPixels: true`
- [ ] Spritesheet `frameWidth`/`frameHeight` matches the requested width/height
- [ ] User shown remaining balance after the batch
