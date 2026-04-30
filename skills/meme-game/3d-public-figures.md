# 3D Public-Figure Characters

For 3D games (Three.js), public-figure characters need rigged caricature models with walk/run animations. The 4-tier flow below mirrors the 2D resolution but produces GLB models instead of spritesheets. The generic 3D asset pipeline (rig, SkeletonUtils.clone, world props, AssetLoader) is owned by `make-game` Step 1.5 and the `game-3d-assets` skill — this file covers only the public-figure-specific pieces.

## Prerequisite

`MESHY_API_KEY` should be set in `.env` or the environment. If not, ask the user before proceeding (Tier 1 is the dramatically better option for named real people — the caricature prompt captures specific visual features that the generic library cannot).

## Tier 1 — Meshy AI caricature (preferred)

Generate + rig as a two-step chain. Always run BOTH for humanoid characters — static models require hacky programmatic animation that looks artificial.

```bash
# Step A: Generate the caricature model
MESHY_API_KEY=<key> node <plugin-root>/scripts/meshy-generate.mjs \
  --mode text-to-3d \
  --prompt "a cartoon caricature of <Name>, <distinguishing features>, low poly game character, full body" \
  --polycount 15000 --pbr \
  --output <project-dir>/public/assets/models/ --slug <character-slug>

# Step B: Read refineTaskId from meta, then rig (auto-downloads walk/run GLBs)
REFINE_ID=$(python3 -c "import json; print(json.load(open('<project-dir>/public/assets/models/<character-slug>.meta.json'))['refineTaskId'])")
MESHY_API_KEY=<key> node <plugin-root>/scripts/meshy-generate.mjs \
  --mode rig --task-id $REFINE_ID --height 1.7 \
  --output <project-dir>/public/assets/models/ --slug <character-slug>
```

After completion you have 3 files per character:

- `<slug>.glb` — rigged model with skeleton (load with `loadAnimatedModel()` + `SkeletonUtils.clone()`)
- `<slug>-walk.glb` — walking animation (auto-downloaded by the rig step)
- `<slug>-run.glb` — running animation (auto-downloaded by the rig step)

### Prompt guidance for named public figures

Be specific about distinguishing features so the model actually resembles the person:

| Person | Prompt addition |
|--------|-----------------|
| Trump | `blonde combover, dark suit, red tie` |
| Musk | `casual t-shirt or leather jacket, short brown hair` |
| Altman | `short brown hair, casual button-down shirt, neutral face` |
| Amodei | `curly dark hair, glasses, casual shirt` |
| Huang | `black leather jacket, short black hair` |
| Zuckerberg | `short brown hair, t-shirt, smooth face` |
| Karpathy | `long dark hair, casual hoodie or t-shirt` |

For multiple characters in the same game, generate each with a distinct description for visual variety. Run the generate→rig chain in parallel across characters to save time.

## Tier 2 — Pre-built library lookup

If Meshy is unavailable or generation fails, check `<plugin-root>/assets/3d-characters/manifest.json` for a slug match. Copy the GLB:

```bash
cp <plugin-root>/assets/3d-characters/models/<slug>.glb \
   <project-dir>/public/assets/models/<slug>.glb
```

The library currently contains a small number of public-figure GLBs (e.g. trump, biden) plus generic models (Soldier, Xbot, RobotExpressive, Fox). Public-figure entries are the only useful Tier 2 results — generic models are Tier 4.

## Tier 3 — Sketchfab search

Use `find-3d-asset.mjs` to search for an animated model matching the character name:

```bash
node <plugin-root>/scripts/find-3d-asset.mjs \
  --query "<character name> animated character" \
  --max-faces 10000 --list-only
```

Review the listing manually before downloading — Sketchfab results vary widely in quality and licensing. Prefer CC-BY or CC0 licenses.

## Tier 4 — Generic library fallback

When all public-figure-specific tiers fail, fall back to the best generic model from `assets/3d-characters/`:

- **Soldier** — action / military / default human
- **Xbot** — sci-fi / tech / futuristic
- **RobotExpressive** — cartoon / casual / fun (most animations available)
- **Fox** — nature / animal

When 2+ characters fall back to the library, pick **different** models for visual differentiation. Note in `progress.md` that the character is unrecognizable as the named person — this is a degraded result.

## Wiring into the game

The generic 3D asset wiring (AssetLoader, SkeletonUtils.clone, mixer setup, fadeToAction transitions) is owned by `game-3d-assets`. This skill only adds the public-figure models alongside whatever the game already loads.

For each public-figure model:

1. Add to `MODELS` config in `Constants.js` with `path` (rigged GLB), `walkPath`, `runPath`, `scale`, `rotationY`. Start with `rotationY: Math.PI` — most Meshy models face +Z and need flipping.
2. Load with `loadAnimatedModel()` (NOT `loadModel()` — that's for static props), create an `AnimationMixer`, register walk/run clips as mixer actions.
3. Log clip names: `console.log('Clips:', clips.map(c => c.name))`.
4. Store mixer + actions in entity `userData`. Call `mixer.update(delta)` every frame.
5. Verify orientation and scale: log bounding box, auto-scale to target height, align feet to floor (`position.y = -box.min.y`), confirm character faces the correct direction relative to its environment.
6. Add a primitive fallback in the `.catch()` so a failed public-figure load doesn't break the scene.

## Recording results

Append to `progress.md`:

```
## Meme Pass — 3D Characters
- player (trump): Tier 1 — Meshy AI caricature, rigged with idle/walk/run
- enemy (musk): Tier 1 — Meshy AI caricature, rigged
- npc (altman): Tier 4 — RobotExpressive fallback (Meshy quota hit)
```

Tier 4 entries should also note in `progress.md` that the character is not visually recognizable as the named person, so the user knows to retry later with a working Meshy key.
