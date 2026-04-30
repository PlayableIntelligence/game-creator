---
name: meme-game
description: Turn an existing game into a public-figure (meme) version — swap the player and named entities for photo-composite characters of real people (politicians, tech CEOs, world leaders, entertainers) and wire reactive expressions to game events. Auto-invoked by `/make-game` Step 1.6 when the prompt or source tweet explicitly names a public figure or a public company (mapped to its CEO); can also be run manually with `/meme-game [path] [name1,name2,...]`. Use when the user explicitly mentions a public figure ("make me a Trump game", "add Altman as the player", "feature Musk", "OpenAI/Anthropic-themed game") or asks to "make this a meme game". Do NOT use for fictional characters, brand mascots, or generic pixel-art conversion (use `/add-assets`); for new game scaffolding use `/make-game`.
argument-hint: "[path-to-game] [name1,name2,...]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.0.0
  tags: [game, public-figure, meme, characters, photo-composite, 2d, 3d]
---

# Meme Game (Public-Figure Pass)

Transform an existing game into a public-figure version. The skill resolves named real people (politicians, tech CEOs, world leaders, entertainers) into photo-composite spritesheets (2D) or rigged caricature models (3D), then wires reactive expressions to existing game events. The underlying gameplay is unchanged — only the visual identity of named entities is upgraded.

`/meme-game` is **the engine** for public-figure work. It runs in two ways:

1. **Auto-invoked** by `/make-game` Step 1.6 when the prompt or source tweet explicitly names a public figure or a public company (e.g. "OpenAI" → `altman`).
2. **Manual** invocation by the user (`/meme-game <path> <names>`) on any existing game — same engine, manual targeting.

In either mode, the skill stays out of generic games. If a game like `maze-tank` has no public figures named, this skill is not invoked, and no real-person content is injected anywhere.

## Reference Files

- **[character-resolution.md](character-resolution.md)** — 5-tier character resolution flow (pre-built library → WebSearch 4 expressions → 1‑3 expressions → 1 image → pixel-art caricature) for 2D photo-composites. Reuses `scripts/build-character.mjs`, `scripts/crop-head.mjs`, `scripts/process-head.mjs`, and `assets/characters/manifest.json`.
- **[expression-wiring.md](expression-wiring.md)** — meme-game-specific wiring workflow (event → expression mapping, idle revert, Expression Map for `design-brief.md`). The static technique (EXPRESSION constants, bobblehead body pattern, CHARACTER scaling, head positioning) is in `game-assets/character-pipeline.md` — load that as a reference.
- **[3d-public-figures.md](3d-public-figures.md)** — 3D public-figure character flow: Meshy AI caricature prompts, `assets/3d-characters/manifest.json` lookup, and Sketchfab fallback for named characters.

## Philosophy

Recognition is the meme hook. A photo-composite head of Trump, Altman, or Musk on a tiny South Park-style cartoon body is instantly readable at any size, on any screen — that's the whole reason the photo-composite pipeline exists. Pixel-art caricatures are a real fallback (when no photo can be sourced), but the pipeline always tries to land on a recognizable photo first.

This skill is **purely additive**. It modifies entity rendering and wires expressions. It does not change gameplay mechanics, scoring, fail conditions, or the core loop.

## When to use

- The user says "make this a [Person] game", "make me the player", "use Trump as the enemy", etc.
- The user passes `/meme-game <path> <name1,name2,...>` with explicit names.
- Invoked from `make-game` Step 1.6 when public-figure detection fires (either form — direct prompt naming a public figure, or tweet input where the same logic runs against the tweet text).

**Do not use** for generic pixel-art passes (that's `/add-assets`), for new game scaffolding (that's `/make-game`), or for visual polish (that's `/design-game`).

## Instructions

### Step 1: Audit and identify targets

Read in this order:

1. `progress.md` at the project root — understand what was scaffolded, what assets exist, what events fire.
2. `src/core/Constants.js` — entity sizes, colors, configured palettes.
3. `src/core/EventBus.js` — events you'll wire expressions to (`SCORE_CHANGED`, `PLAYER_DAMAGED`, `BIRD_DIED`, `SPECTACLE_*`, etc.).
4. `src/core/GameState.js` — confirm which entities are stateful targets.
5. `src/entities/*.js` — identify which entities are candidates for public-figure replacement.
6. `design-brief.md` if it exists — note any prior creative direction.

**Determine the targets:**

- If `$ARGUMENTS` includes explicit names (`name1,name2`), use those. Map them to entity slots based on the game (player gets the first name; named opponents get the rest; collectibles only get a name if the game explicitly riffs on the figure, e.g. "Altman heads to collect").
- Otherwise, ask the user concisely: "Which characters should this game feature? E.g. `trump,musk` for player + opponent." Wait for confirmation before doing any work.

For each name, normalize to a slug (`donald-trump` → `trump`, `Sam Altman` → `altman`).

### Step 2: Resolve each character (2D)

For each target slug, walk the 5-tier fallback in order. See [character-resolution.md](character-resolution.md) for the full flow. Stop at the first tier that succeeds and record the result:

1. **Tier 1 — Pre-built library**: Check `assets/characters/manifest.json` (relative to plugin root). On hit, copy the spritesheet into `<project>/public/assets/characters/<slug>/`.
2. **Tier 2 — Build from 4 photos**: WebSearch for normal/happy/angry/surprised photos, download to `raw/`, run `build-character.mjs` (which uses `process-head.mjs` for ML background removal and `crop-head.mjs` for face detection — any photo format works).
3. **Tier 3 — Build from 1‑3 photos**: Duplicate the best image (prefer normal) into missing slots before running the pipeline.
4. **Tier 4 — Single image**: Use one image for all 4 slots. No expression variation, but still photo-recognizable.
5. **Tier 5 — Pixel-art caricature**: Last resort. Use the Caricature archetype from `game-assets` (32x48 grid at scale 4) with hand-designed caricature features (signature hairstyle, glasses, facial hair, clothing). No spritesheet, no expression system.

### Step 3: Wire expressions (2D)

For each character that resolved to Tiers 1–4 (i.e. has a 4-frame spritesheet):

1. Add `EXPRESSION` and `EXPRESSION_HOLD_MS` to `Constants.js` if not present (see `game-assets/character-pipeline.md` for the canonical values).
2. Update the entity constructor to load the spritesheet via Phaser's preloader and set frame to `EXPRESSION.NORMAL`.
3. Add the bobblehead body Graphics + Container layering (shoes/legs/torso/neck under the head sprite, separate arm Graphics for animation). See `game-assets/character-pipeline.md` for the full layer order, `CHARACTER` scaling constants, and head positioning math.
4. Wire EventBus events to expression frame swaps:
   - `SCORE_CHANGED` / scoring events → `HAPPY`
   - `PLAYER_DAMAGED` / death events → `ANGRY`
   - `SPECTACLE_STREAK` / milestone events → `SURPRISED`
   - Idle timer reverts to `NORMAL` after `EXPRESSION_HOLD_MS`.
5. For opponents/NPCs: wire complementary reactions (`OPPONENT_HIT` → ANGRY, `OPPONENT_SCORES` → HAPPY).

For Tier 5 characters: skip steps 1–4. Render via the existing `renderSpriteSheet()` path.

### Step 4: 3D character flow

For 3D games, the pipeline differs — see [3d-public-figures.md](3d-public-figures.md). Summary:

1. **Tier 1**: Generate a caricature with Meshy AI using a public-figure-specific prompt (`"a cartoon caricature of <Name>, <distinguishing features>, low poly game character, full body"`), then run the rig step. Walk/run animation GLBs are auto-downloaded.
2. **Tier 2**: Look up the slug in `assets/3d-characters/manifest.json`.
3. **Tier 3**: Search Sketchfab with `find-3d-asset.mjs` using the character name.
4. **Tier 4**: Generic library model fallback (Soldier / Xbot / RobotExpressive / Fox).

Wire the rigged GLB into the existing `AssetLoader`. Use `SkeletonUtils.clone()` (NOT `.clone()`) for rigged models. Verify orientation (`rotationY: Math.PI` is the typical starting point for Meshy output) and scale before returning.

### Step 5: Update progress.md and design-brief.md

Append a `## Meme Pass` section to `progress.md`:

```
## Meme Pass
- Player: trump (Tier 1, pre-built, 4 expressions)
- Opponent: musk (Tier 2, built from 4 photos)
- Collectible: altman-head (Tier 4, single image, no expression variation)
```

Append (don't overwrite) an Expression Map to `design-brief.md` if it exists. Use the template in expression-wiring.md.

### Step 6: Verify

Run from the project directory:

```bash
npm run build
```

Build must succeed. Then start (or check) the dev server and visually confirm via Playwright MCP / `scripts/iterate-client.js`:

- Each character renders as a recognizable photo head on a cartoon body (Tiers 1–4) or as the pixel-art caricature (Tier 5).
- Expressions change on the wired events and revert to NORMAL after the hold timer.
- Physics bodies still match new sprite sizes (adjust `setSize()` / `setCircle()` if needed).
- No broken layouts, off-screen entities, or floating-head sprites without bodies.

Run `npm test` if a Playwright test suite exists. Visual snapshots will need updating — the entities now look completely different.

## Example Usage

### Standalone, on an existing game
```
/meme-game examples/asteroid-dodge trump,musk
```
Result: Player becomes Trump (photo head + cartoon body), opponent becomes Musk. Expressions wire to score / damage / streak events. Physics and gameplay unchanged.

### Invoked from the tweet pipeline
```
/make-game https://x.com/.../status/...   # tweet about Sam Altman
```
Form B detects "Sam Altman" as a public figure and, after Step 1.5 finishes, automatically calls `/meme-game` with `altman` as the target. End state matches what the old monolithic pipeline used to produce, but the public-figure work is cleanly attributed and skippable.

### Pixel-art only (Tier 5 forced)
```
/meme-game examples/space-runner karpathy
```
If WebSearch finds no usable photos and the pipeline fails, falls back to pixel-art caricature with signature features (long hair, casual clothing).

## Checklist

When completing a meme pass, verify:

- [ ] Each named character resolved to a tier and recorded in `progress.md`
- [ ] Photo-composite heads paired with cartoon bodies (no floating heads alone)
- [ ] `EXPRESSION` and `EXPRESSION_HOLD_MS` defined in `Constants.js`
- [ ] Expression changes wired to at least 3 game events per character (score, damage, streak)
- [ ] Idle timer reverts to NORMAL after `EXPRESSION_HOLD_MS`
- [ ] Physics bodies adjusted for new sprite dimensions
- [ ] `npm run build` succeeds
- [ ] Visual check confirms all characters render and react to events
- [ ] `progress.md` updated with `## Meme Pass` section
- [ ] No gameplay logic changed — only entity rendering and expression wiring
