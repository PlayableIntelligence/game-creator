# Wire phase

Wire the resolved assets into the game. For 2D: load spritesheets, add the bobblehead body Container, and bind expression frame swaps to game events. For 3D: load rigged GLBs through the existing `AssetLoader`, clone with `SkeletonUtils`, and verify orientation/scale.

## When to use

After [resolve.md](resolve.md) finishes with a per-slug tier mapping and assets on disk. Runs once per `/meme-game` invocation.

## Inputs

- The per-slug tier mapping from resolve.
- The cached event names from audit.
- The existing entity files in `src/entities/` (the wire phase modifies them in place — never creates a parallel "MemePlayer.js" alongside `Player.js`).
- For 2D: `game-assets/character-pipeline.md` for the canonical bobblehead body pattern, EXPRESSION constants, scaling, head positioning.
- For 2D: [`../sub-pipelines/expression-wiring.md`](../sub-pipelines/expression-wiring.md) for the meme-game-specific event-to-expression mapping.

## Steps

### 2D flow

**1. Add expression infrastructure to `Constants.js`** (skip if already present):

```js
export const EXPRESSION = { NORMAL: 0, HAPPY: 1, ANGRY: 2, SURPRISED: 3 };
export const EXPRESSION_HOLD_MS = 600;
```

Plus the `CHARACTER` scaling constants from `game-assets/character-pipeline.md`.

**2. For each slug at Tier 1–4** (has a 4-frame spritesheet):

a. Update the entity constructor: load the spritesheet via Phaser's preloader, set initial frame to `EXPRESSION.NORMAL`.

b. Add the bobblehead body Container layering — shoes / legs / torso / neck Graphics under the head sprite, separate arm Graphics for animation. Layer order is in `game-assets/character-pipeline.md`. Don't reinvent it.

c. Wire EventBus events to expression frame swaps using the `setExpression(expression, holdMs)` helper from `character-pipeline.md`. Map per the event semantics in [`../sub-pipelines/expression-wiring.md`](../sub-pipelines/expression-wiring.md):

| Game event semantic | Expression | Default hold |
|---|---|---|
| Score / collect / hit target | `HAPPY` | 600ms |
| Take damage / lose life / die | `ANGRY` | 600ms |
| Power-up / streak / milestone | `SURPRISED` | 1000ms (linger) |
| Idle | `NORMAL` | auto-revert |

For named opponents/NPCs, mirror with inverted polarity (player scores → opponent ANGRY; opponent scores → opponent HAPPY).

d. Adjust physics body to match the new sprite dimensions (`setSize()` / `setCircle()`).

**3. For each slug at Tier 5** (pixel-art caricature):

Render via the existing `renderSpriteSheet()` path. No expression timer — Tier 5 has no expression frames. Use the Public-Figure Caricature archetype (32x48 grid at scale 4) per `game-assets/sprite-catalog.md`. Skip steps 1a–1c above for these slugs.

### 3D flow

**1. Wire the rigged GLB into the existing `AssetLoader`.**

Add or update entries in the `MODELS` config (in `Constants.js` or wherever the project keeps it) — `path`, `walkPath`, `runPath`, `scale`, `rotationY` per slug. Start with `rotationY: Math.PI` for Meshy output (most Meshy models face +Z).

**2. Use `SkeletonUtils.clone()` for rigged models.**

`from 'three/addons/utils/SkeletonUtils.js'`. Regular `.clone()` breaks skeleton bindings → T-pose. This is non-negotiable for rigged characters.

**3. Verify orientation and scale.**

For each loaded model:
- Log the bounding box size.
- Compute auto-scale to fit the target height.
- Align feet to floor: `position.y = -box.min.y`.
- Confirm the character faces the correct direction (adjust `rotationY` in Constants if not).
- Confirm the character fits inside its environment (ring, arena, platform).

**4. No 3D expression wiring.**

3D characters express through animation clips (idle / walk / run), not facial expression frames. The 4-tier 3D flow doesn't produce expression spritesheets. Skip the per-event expression binding from the 2D flow — let the existing animation system handle it.

### Optional (both flows): append Expression Map to `docs/gameplan.md`

If `docs/gameplan.md` exists at the project root, append (do not overwrite) an Expression Map section so future agents understand the wiring intent. Use the template in `../sub-pipelines/expression-wiring.md`. Skip this if there is no `docs/gameplan.md` — don't create one just for the Expression Map. Falls back to `design-brief.md` if that's the project's source of truth.

## Outputs

- Modified entity files in `src/entities/` with spritesheet loading + bobblehead Container layering (2D) OR `MODELS` entries + AssetLoader wiring (3D).
- Modified `Constants.js` with `EXPRESSION` + `EXPRESSION_HOLD_MS` + `CHARACTER` scaling (2D only, if not already present).
- Modified physics bodies sized to match the new sprite dimensions (2D).
- Optional Expression Map appended to `docs/gameplan.md`.

## Exit criteria

- For 2D: every slug at Tier 1–4 renders as a recognizable photo head on a cartoon body, and reverts to `NORMAL` after `EXPRESSION_HOLD_MS`. Slug at Tier 5 renders as the pixel-art caricature.
- For 3D: every slug renders as a rigged caricature model with correct orientation, scale, and feet-on-floor placement. Animations (walk / run) trigger on the existing entity events.
- No floating heads without bodies (2D) — that's a layering bug in the bobblehead Container.
- No T-poses (3D) — that's `.clone()` instead of `SkeletonUtils.clone()`.
- All physics bodies updated to match new sprite dimensions; no entities passing through walls or floating mid-air due to body/render mismatch.
