---
name: meshyai
description: Generate custom 3D models from text or images using Meshy AI, then auto-rig and animate them for Three.js games. The preferred source for all 3D game assets. Use when the user says "generate a 3D model", "create a character model", "use Meshy", or needs a custom GLB model that doesn't exist in free libraries.
argument-hint: "[text-prompt or image-path]"
license: MIT
compatibility: Requires MESHY_API_KEY environment variable and internet access for Meshy AI API calls.
metadata:
  author: OpusGameLabs
  version: 1.3.0
  tags: [game, 3d, meshy, ai, model-generation, rigging, animation]
---

# Meshy AI — 3D Model Generation, Rigging & Animation

You are an expert at generating custom 3D models with Meshy AI and integrating them into Three.js browser games. **Meshy is the preferred source for all 3D game assets** — it generates exactly what you need from a text description or reference image, with consistent art style and game-ready topology.

## Performance Notes

- Take your time with each step. Quality is more important than speed.
- Do not skip validation steps — they catch issues early.
- Read the full context of each file before making changes.
- Always run post-generation verification. Never assume orientation or scale.

## Reference Files

| File | Description |
|------|-------------|
| [api-reference.md](./api-reference.md) | Full API endpoint specs, payloads, responses, task statuses, and asset retention policy |
| [rigging-pipeline.md](./rigging-pipeline.md) | Complete generate -> rig -> animate -> integrate pipeline with fadeToAction pattern and code examples |
| [verification-patterns.md](./verification-patterns.md) | Auto-orientation check, auto-scale fitting, floor alignment code patterns |

## Why Meshy First

- **Exact match**: Generate precisely the character, prop, or scenery your game needs — no compromises
- **Consistent style**: All assets from the same generation pipeline share a cohesive look
- **Custom characters**: Named public figures, branded characters, unique creatures — all generated to spec
- **Full pipeline**: Generate → rig → animate, all from one tool
- **Game-ready**: Control polycount, topology, and PBR textures for optimal Three.js performance

## Fallback Sources

If `MESHY_API_KEY` is not available and the user declines to set one up, fall back to these in order:

| Fallback | Source | Best for |
|----------|--------|----------|
| `assets/3d-characters/` | Pre-built GLBs | Quick animated humanoids (Soldier, Xbot, Robot, Fox) |
| `find-3d-asset.mjs` | Sketchfab, Poly Haven, Poly.pizza | Searching existing free model libraries |
| Procedural geometry | Code | BoxGeometry/SphereGeometry as last resort |

## Authentication

All Meshy API calls require `MESHY_API_KEY`. **Always check for this key before starting any 3D asset work.**

Before prompting the user, check if the key already exists:
`test -f .env && grep -q '^MESHY_API_KEY=.' .env && echo "found"`
If found, export it with `set -a; . .env; set +a` and skip the prompt.

If the key is not set in the environment or `.env`, **ask the user immediately**:

> I'll generate custom 3D models with Meshy AI for the best results. You can get a free API key in 30 seconds:
> 1. Sign up at https://app.meshy.ai
> 2. Go to Settings → API Keys
> 3. Create a new API key
>
> Paste your key below like: `MESHY_API_KEY=your-key-here`
> (It will be saved to .env and redacted from this conversation automatically.)
>
> Or type "skip" to use free model libraries instead.

If the user provides a key, use it via: `set -a; . .env; set +a && node scripts/meshy-generate.mjs ...`

If the user skips, proceed with fallback sources (character library → Sketchfab → Poly Haven).

## CLI Script — `scripts/meshy-generate.mjs`

Zero-dependency Node.js script. Handles the full lifecycle: submit task → poll → download GLB → write meta.json.

### Text to 3D (full pipeline)

Generates a 3D model from a text prompt. Two-step process: preview (geometry) → refine (texturing).

```bash
# Full pipeline: preview → refine → download
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode text-to-3d \
  --prompt "a cartoon knight with sword and shield" \
  --output public/assets/models/ \
  --slug knight

# Preview only (faster, untextured — good for geometry check)
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode text-to-3d \
  --prompt "a wooden barrel" \
  --preview-only \
  --output public/assets/models/ \
  --slug barrel

# With PBR textures and specific polycount
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode text-to-3d \
  --prompt "a sci-fi hover bike" \
  --pbr \
  --polycount 15000 \
  --ai-model meshy-6 \
  --output public/assets/models/ \
  --slug hoverbike
```

### Image to 3D

Turn a reference image into a 3D model. Supports URLs, local files, and base64 data URIs.

```bash
# From URL
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode image-to-3d \
  --image "https://example.com/character-concept.png" \
  --output public/assets/models/ \
  --slug character

# From local file (auto-converts to base64)
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode image-to-3d \
  --image "./concept-art/hero.png" \
  --output public/assets/models/ \
  --slug hero
```

### Auto-Rig (humanoids only — MANDATORY for all bipedal characters)

Adds a skeleton to a generated humanoid model and **auto-downloads walking + running animation GLBs**. The input task ID comes from a completed text-to-3d or image-to-3d task.

```bash
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode rig \
  --task-id <meshy-task-id> \
  --height 1.8 \
  --output public/assets/models/ \
  --slug hero
```

This produces 3 files automatically:
- `hero.glb` — rigged model with skeleton
- `hero-walk.glb` — walking animation (auto-downloaded)
- `hero-run.glb` — running animation (auto-downloaded)

**Always chain generate → rig as one atomic step for humanoids.** Never leave humanoid characters as static models.

**Limitations:** Rigging works only on textured humanoid (bipedal) models with clearly defined limbs. Won't work on animals, vehicles, abstract shapes, or untextured meshes.

### Animate

Apply an animation to a rigged model. Requires a completed rig task ID and an animation action ID.

```bash
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode animate \
  --task-id <rig-task-id> \
  --action-id 1 \
  --output public/assets/models/ \
  --slug hero-walk
```

### Check Status

Poll any task's current status.

```bash
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode status \
  --task-id <task-id> \
  --task-type text-to-3d   # or: image-to-3d, rigging, animations
```

### Non-blocking Mode

Submit a task without waiting. Useful in pipelines.

```bash
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode text-to-3d \
  --prompt "a crystal sword" \
  --no-poll

# Later:
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode status --task-id <id> --task-type text-to-3d
```

## Automatic GLB Optimization

All downloaded GLBs are automatically optimized via `scripts/optimize-glb.mjs` to reduce file sizes by 80–95%. The pipeline resizes textures to 1024×1024, converts them to WebP, and applies meshopt compression.

- Optimization runs by default after every GLB download (text-to-3d, image-to-3d, rig, animate)
- Use `--no-optimize` to skip optimization and keep the raw Meshy output
- Use `--texture-size <n>` to change the max texture dimension (default: 1024)
- First run may take a moment as `npx` downloads `@gltf-transform/cli`
- If `gltf-transform` is unavailable, the script warns and continues with the raw file

Optimized GLBs use meshopt compression and require `MeshoptDecoder` at runtime — the template `AssetLoader.js` includes this automatically.

```bash
# Skip optimization for a specific generation
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode text-to-3d --prompt "a barrel" --preview-only \
  --no-optimize --output public/assets/models/ --slug barrel

# Custom texture size (e.g., 512 for mobile)
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode text-to-3d --prompt "a barrel" --preview-only \
  --texture-size 512 --output public/assets/models/ --slug barrel

# Re-optimize an existing GLB directly
node scripts/optimize-glb.mjs public/assets/models/barrel.glb --texture-size 512
```

## API Reference

See [api-reference.md](./api-reference.md) for full endpoint specs, payloads, responses, task statuses, and asset retention policy.

## Quick Reference: Static Props (no rig needed)

For non-humanoid assets (props, scenery, buildings), skip rigging:

```bash
# Generate
MESHY_API_KEY=<key> node scripts/meshy-generate.mjs \
  --mode text-to-3d --prompt "a wooden barrel, low poly game asset" \
  --polycount 5000 --output public/assets/models/ --slug barrel

# Integrate with loadModel (regular clone, no SkeletonUtils)
const barrel = await loadModel('assets/models/barrel.glb');
scene.add(barrel);
```

## Post-Generation Verification (MANDATORY)

See [verification-patterns.md](./verification-patterns.md) for auto-orientation check, auto-scale fitting, and floor alignment code patterns.

## Rigging: Mandatory for Humanoid Characters

See [rigging-pipeline.md](./rigging-pipeline.md) for the full generate -> rig -> animate -> integrate pipeline, including when to rig, the fadeToAction pattern, and integration code examples.

## Prompt Engineering Tips

Good prompts produce better models:

| Goal | Prompt | Why |
|------|--------|-----|
| Game character | "a stylized goblin warrior, low poly game character, full body" | "low poly" + "game character" = game-ready topology |
| Prop | "a wooden treasure chest, stylized, closed" | Simple, specific, single object |
| Environment piece | "a fantasy stone archway, low poly, game asset" | "game asset" signals clean geometry |
| Vehicle | "a sci-fi hover bike, side view, clean topology" | "clean topology" = fewer artifacts |

**Avoid:**
- Multiple objects in one prompt ("a knight AND a dragon") — generate separately
- Vague prompts ("something cool") — be specific about style and form
- Interior/architectural scenes — Meshy is best for single objects

## Integration with Existing Pipeline

Meshy-generated models slot into the existing 3D asset pipeline:

```
┌─────────────────────────────────────────────────────┐
│                 3D Asset Sources                     │
├──────────────┬──────────────┬───────────────────────┤
│ Free Libraries│ Character Lib │     Meshy AI          │
│ find-3d-asset │ 3d-char-lib/ │ meshy-generate.mjs    │
│   .mjs       │              │ text/image → 3D       │
│              │              │ rig → animate         │
├──────────────┴──────────────┴───────────────────────┤
│              AssetLoader.js                         │
│         loadModel() / loadAnimatedModel()           │
├─────────────────────────────────────────────────────┤
│              Three.js Game                          │
└─────────────────────────────────────────────────────┘
```

All sources output GLB files into `public/assets/models/`. The `AssetLoader.js` doesn't care where the GLB came from — it loads them all the same way.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| `MESHY_API_KEY` not set | Environment variable missing | Ask the user for their key or run `export MESHY_API_KEY=<key>`. Free keys available at https://app.meshy.ai under Settings -> API Keys. |
| Task stuck in PENDING | API queue backlog or invalid parameters | Wait 2-3 minutes, then poll status. If still PENDING after 5 minutes, cancel and resubmit with simpler prompt or lower polycount. |
| Asset download returns 404 | Meshy retains assets for only 3 days | Re-run the generation pipeline. Always download GLBs immediately after task succeeds. Store locally in `public/assets/models/`. |
| Rigging fails or produces broken skeleton | Model is not a clearly bipedal humanoid, or mesh is untextured | Ensure the model is a textured humanoid with visible limbs. Rigging does not work on animals, vehicles, abstract shapes, or preview-only (untextured) meshes. Re-generate with `--pbr` and a prompt specifying "full body humanoid". |
| Generated model does not match prompt | Vague or multi-object prompt | Use specific, single-object prompts. Include style cues ("low poly", "stylized", "game character") and avoid combining multiple objects. See Prompt Engineering Tips. |

## Checklist

- [ ] `MESHY_API_KEY` checked — prompted user if not set, or user skipped to fallbacks
- [ ] Prompt is specific (style, poly count, single object)
- [ ] **All humanoid characters rigged** — never skip rigging for bipedal models
- [ ] Downloaded GLB before 3-day expiration
- [ ] **Post-generation verification done** — orientation, scale, floor alignment checked
- [ ] **Playwright screenshot taken** — visually confirmed facing direction + fit in environment
- [ ] `rotationY` set per model in Constants.js (most Meshy models need `Math.PI`)
- [ ] Static models use `loadModel()` (regular clone)
- [ ] Rigged models use `loadAnimatedModel()` (SkeletonUtils.clone)
- [ ] Clip names logged and `clipMap` defined for animated models
- [ ] `.meta.json` saved alongside GLB with task IDs for traceability
- [ ] `npm run build` succeeds
