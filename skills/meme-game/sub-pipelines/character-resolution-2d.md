# Character Resolution — 5-Tier Fallback (2D)

For each named public figure, walk these tiers in order. Stop at the first tier that produces a usable spritesheet. Record which tier each character resolved to in `progress.md`.

## Plugin path resolution

The character library lives at `assets/characters/` relative to the plugin root. Find the plugin root by checking these paths in order:

1. The agent's plugin cache (e.g. `~/.claude/plugins/cache/local-plugins/game-creator/<version>/`)
2. The `templates/`-sibling `assets/characters/` directory relative to this plugin's install location

Once located, the asset paths below are stable.

## Tier 1 — Pre-built library (best)

Check if the slug exists in `<plugin-root>/assets/characters/manifest.json`. On hit, copy the spritesheet directly:

```bash
mkdir -p <project-dir>/public/assets/characters/<slug>/
cp <plugin-root>/assets/characters/characters/<slug>/sprites/* \
   <project-dir>/public/assets/characters/<slug>/
```

Result: 4-expression spritesheet (200×300 per frame, 800×300 total) ready for Phaser to load. Done — proceed to expression wiring.

## Tier 2 — Build from 4 photos (good)

WebSearch for 4 expression photos. **Any photo format works** (jpg, png, webp) — `process-head.mjs` runs ML background removal and `crop-head.mjs` runs face detection, so transparent PNGs are not required.

Search broadly:

| Expression | Search query |
|------------|--------------|
| **normal** | `"<Name> portrait photo"` or `"<Name> face"` — neutral expression |
| **happy** | `"<Name> smiling"` or `"<Name> laughing"` |
| **angry** | `"<Name> angry"` or `"<Name> serious stern"` |
| **surprised** | `"<Name> surprised"` or `"<Name> shocked"` |

Prefer real photographs over illustrations/cartoons. Head shots and half-body shots both work — face detection isolates the face automatically.

Download to `<project-dir>/public/assets/characters/<slug>/raw/normal.jpg` (etc.) and run the orchestrator:

```bash
node <plugin-root>/scripts/build-character.mjs "<Full Name>" \
  <project-dir>/public/assets/characters/<slug>/ --skip-find
```

`--skip-find` tells the script not to do its own image search since you already downloaded inputs. The script runs ML background removal, face crop, and assembles the final 800×300 spritesheet.

Result: 4-expression spritesheet. Done — proceed to expression wiring.

## Tier 3 — Build from 1‑3 photos (acceptable)

If WebSearch only finds 1–3 usable images, **duplicate the best image** (prefer normal) into the missing expression slots before running the pipeline:

```bash
# Example: only normal.jpg and happy.jpg were found
cp raw/normal.jpg raw/angry.jpg
cp raw/normal.jpg raw/surprised.jpg
node <plugin-root>/scripts/build-character.mjs "<Name>" \
  <project-dir>/public/assets/characters/<slug>/ --skip-find
```

Result: 4-frame spritesheet where some expressions share the same face. Expression wiring still works — the character just shows the same face for missing expressions. Functional and recognizable.

## Tier 4 — Single image (minimum photo-composite)

If only 1 usable image is found, or the pipeline fails on all but one image:

```bash
cp raw/normal.jpg raw/happy.jpg
cp raw/normal.jpg raw/angry.jpg
cp raw/normal.jpg raw/surprised.jpg
node <plugin-root>/scripts/build-character.mjs "<Name>" \
  <project-dir>/public/assets/characters/<slug>/ --skip-find
```

Result: All 4 frames identical. Character is photo-recognizable but has no expression variation. Still loads as a spritesheet; expression-wiring code still runs (no visible change on swap).

## Tier 5 — Pixel-art caricature (worst case)

Only when no photos can be sourced or the entire pipeline crashes (background removal fails on all images, face detection fails on all images, network errors). At this point, abandon photo-composite for this character and produce a pixel-art caricature using the Caricature archetype documented in `game-assets/SKILL.md`:

- Grid: **32×48 at scale 4** (renders to 128×192px, ~35% of canvas height)
- Use caricature proportions: large head (60%+ of sprite height), exaggerated signature features (signature hairstyle, glasses, facial hair, suit/clothing color)
- 2–4 frames (idle + walk minimum) via `renderSpriteSheet()`
- Wire as a standard pixel-art entity — no spritesheet expression frames, no expression timer

Note in `progress.md`: `<slug>: Tier 5 (pixel art caricature — no photo available)`.

Always exhaust image search first. Even a single photo (Tier 4) produces a more recognizable result than pixel-art for known public figures.

## Recording results

After resolving every character, append a section to `progress.md`:

```
## Meme Pass — Character Resolution
- trump: Tier 1 (pre-built, 4 expressions)
- musk: Tier 2 (built from 4 photos)
- altman: Tier 3 (2 photos found, duplicated to 4 slots)
- karpathy: Tier 4 (1 photo, no expression variation)
- some-niche-figure: Tier 5 (pixel-art caricature)
```

The expression-wiring step needs this list to know which characters get the full expression timer (Tiers 1–4) and which skip expression wiring entirely (Tier 5).
