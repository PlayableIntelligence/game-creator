---
name: atlascloud-3d
description: Generate game-ready GLB assets from text or images through Atlas Cloud. Use when the user asks for Atlas Cloud, Hunyuan3D, an optional Meshy alternative, or a generated 3D prop for a Three.js game. Do not use for rigging, animation, or when the user wants free library assets only.
argument-hint: "[prompt-or-image]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.3.0
  tags: [game, 3d, atlascloud, hunyuan3d, glb, threejs, model-generation]
---

# Atlas Cloud 3D Generation

Generate GLB models with Atlas Cloud as an optional provider in the game asset pipeline. The existing Meshy path remains the default because it also supports rigging and animation; use Atlas Cloud when the user requests it or already has `ATLASCLOUD_API_KEY` configured.

## Cost and Key Check

Atlas Cloud generation consumes paid credits. Before a generation POST:

1. Check without printing the key: `test -n "$ATLASCLOUD_API_KEY" && echo "found"`.
2. Tell the user that the request is paid and confirm they want to submit it.
3. Never retry a generation POST. The script submits once; only result GET polling backs off.

If the key is not present, ask for `ATLASCLOUD_API_KEY=<key>`. The repository's prompt hook stores explicit key assignments in `.env` and blocks them from entering the conversation.

## Text to 3D

```bash
ATLASCLOUD_API_KEY=<key> node scripts/atlascloud-3d-generate.mjs \
  --mode text-to-3d \
  --prompt "a stylized low-poly treasure chest, closed, game prop" \
  --slug treasure-chest \
  --output public/assets/models/ \
  --pbr
```

## Image to 3D

`--image` accepts a public URL, data URI, or a local JPG/PNG/WEBP up to 4.5 MB.

```bash
ATLASCLOUD_API_KEY=<key> node scripts/atlascloud-3d-generate.mjs \
  --mode image-to-3d \
  --image concept-art.png \
  --slug concept-model \
  --output public/assets/models/ \
  --pbr
```

## Submission and Status

Use `--no-poll` to submit once and retain the prediction ID for later:

```bash
ATLASCLOUD_API_KEY=<key> node scripts/atlascloud-3d-generate.mjs \
  --mode text-to-3d --prompt "low-poly pine tree" --no-poll

ATLASCLOUD_API_KEY=<key> node scripts/atlascloud-3d-generate.mjs \
  --mode status --task-id <prediction-id>
```

The completed run downloads `{slug}.glb`, runs the existing GLB optimizer unless `--no-optimize` is set, and writes `{slug}.meta.json` with the provider, model, prediction ID, output metadata, and reported credits.

## Dry Run

Validate the exact request body without a key or network call:

```bash
node scripts/atlascloud-3d-generate.mjs \
  --mode text-to-3d --prompt "low-poly pine tree" --pbr --dry-run
```

## Integration Checks

- Load the GLB with `GLTFLoader` and `MeshoptDecoder` after optimization.
- Measure its bounding box, auto-scale to the target height, and align it to the floor.
- Verify facing direction and scale in a Playwright screenshot.
- Atlas Cloud generation does not rig or animate the model. Use the existing Meshy rigging path or a compatible external rigging tool when skeletal animation is required.
