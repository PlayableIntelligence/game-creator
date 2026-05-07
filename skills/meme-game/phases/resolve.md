# Resolve phase

Walk the tiered fallback for each slug in the audit phase's slug list. Stop at the first tier that produces a usable asset for that slug. Record which tier each character resolved to.

## When to use

After [audit.md](audit.md) finishes with a non-empty slug list. Runs once per `/meme-game` invocation.

## Inputs

- The slug list and role assignments from audit.
- The project's `package.json` to determine engine (`phaser` → 2D flow, `three` → 3D flow).
- The plugin root for resolving `assets/characters/manifest.json` (2D) and `assets/3d-characters/manifest.json` (3D).
- `MESHY_API_KEY` in the environment for the 3D Tier 1 path. If absent for a 3D game, ask the user before proceeding (Tier 1 is the dramatically better option for named real people).

## Steps

**1. Choose the engine flow.**

Read `package.json`. If the project depends on `phaser`, run the 2D flow ([`../sub-pipelines/character-resolution-2d.md`](../sub-pipelines/character-resolution-2d.md)). If it depends on `three`, run the 3D flow ([`../sub-pipelines/character-resolution-3d.md`](../sub-pipelines/character-resolution-3d.md)). If both are present (rare), default to 2D and warn the user.

**2. Run the per-slug fallback.**

For each slug in the list, walk the tiers in order. Stop at the first success. Both flows share the same shape — pre-built library first, generative fallback last:

- **2D**: 5-tier fallback (pre-built spritesheet → WebSearch 4 photos → 1‑3 photos → 1 photo → pixel-art caricature). Full details in `character-resolution-2d.md`.
- **3D**: 4-tier fallback (Meshy AI caricature + rig → pre-built library → Sketchfab search → generic library model). Full details in `character-resolution-3d.md`.

**3. Run slugs in parallel where the tier allows.**

For 3D Tier 1 (Meshy generate → rig), each slug is two API calls plus polling. Run multiple slugs in parallel — the script's polling logic doesn't conflict across characters. For 2D Tier 2/3/4, WebSearch + `build-character.mjs` can also run in parallel per slug.

For 2D Tier 1 and 3D Tier 2 (pre-built library copies), the cost is so low that parallelism doesn't matter — run sequentially.

**4. Record results.**

After every slug resolves (or hits Tier 5 / fallback), record the outcome in `docs/STATE.md`:

```
## Meme Pass — Resolve
- trump: Tier 1 (pre-built, 4 expressions)
- musk: Tier 2 (built from 4 photos)
- altman: Tier 4 (single image, no expression variation)
- karpathy: Tier 5 (pixel-art caricature — WebSearch returned no usable photos)
```

For 3D, record the GLB filenames produced (e.g. `trump.glb`, `trump-walk.glb`, `trump-run.glb`).

Falls back to appending to `progress.md` if `docs/STATE.md` does not exist.

## Outputs

- Per-slug resolved assets in `<project>/public/assets/characters/<slug>/` (2D) or `<project>/public/assets/models/` (3D).
- A tier mapping (which tier each slug resolved to), passed to the wire phase.
- Updated `docs/STATE.md` (or `progress.md`) with the resolve outcomes.

## Exit criteria

- Every slug from audit has at least one usable asset (a spritesheet for 2D, a rigged GLB for 3D, or a pixel-art definition for 2D Tier 5).
- The tier mapping is recorded so the wire phase knows whether to wire full expression changes (Tiers 1–4 in 2D) or skip expression logic (Tier 5 in 2D, all 3D models — 3D uses animation clips, not expression frames).
- No slug is left unresolved. If a slug cannot be resolved at all (every tier failed including the pixel-art fallback), abort with a clear message rather than silently continuing.
