---
name: muapi-3d
description: Generate static game-ready GLB assets from text or images through MuAPI. Use when the user explicitly requests MuAPI 3D generation or has MUAPI_API_KEY configured. Do not use for rigging, animation, or free-library-only requests.
argument-hint: "[prompt-or-image]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.0.0
  tags: [game, 3d, muapi, glb, threejs, model-generation]
---

# MuAPI 3D Generation

Use this skill as an opt-in route for static GLB generation. The current MuAPI 3D catalog
includes text-to-3D and image-to-3D models. Keep the existing default provider flow unchanged
unless the user asks for MuAPI or has already configured `MUAPI_API_KEY`.

## Authorization and cost

MuAPI generation is paid. Before a generation POST:

1. Check the key without printing it: `test -n "$MUAPI_API_KEY" && echo "found"`.
2. Tell the user that the request may consume credits and confirm the submission.
3. Submit exactly once. Never retry a generation POST; only result GET polling may retry.

If no key is configured, ask for `MUAPI_API_KEY`. The repository hook stores explicit key
assignments in `.env`; do not paste keys into source, logs, or generated metadata.

## Text-to-3D

```bash
MUAPI_API_KEY=<key> node scripts/muapi-3d-generate.mjs \
  --mode text-to-3d \
  --prompt "a stylized low-poly treasure chest, closed, game prop" \
  --slug treasure-chest --output public/assets/models/ --topology quad --pbr
```

Use `--preview` for the faster preview mode. The helper uses the current `meshy-6-text-to-3d`
endpoint and validates the prompt and mesh controls before sending.

## Image-to-3D

`--image` accepts an HTTPS URL, data URI, or a local JPG/PNG/WEBP file. Local files are converted
to a bounded data URI before submission.

```bash
MUAPI_API_KEY=<key> node scripts/muapi-3d-generate.mjs \
  --mode image-to-3d --image concept-art.png \
  --slug concept-model --output public/assets/models/ --pbr
```

## Dry run and status handoff

Inspect the exact request without a key or network call:

```bash
node scripts/muapi-3d-generate.mjs \
  --mode text-to-3d --prompt "low-poly pine tree" --dry-run
```

Use `--no-poll` when the request ID should be retained for a later status check. If the finite
poll budget is exhausted, preserve the ID and reconcile it through the MuAPI prediction endpoint;
do not create a replacement generation.

## Output integration

The helper downloads the completed HTTPS GLB to `public/assets/models/`, writes a source metadata
file, and can run the existing GLB optimizer. Load the model with `GLTFLoader`, measure its
bounding box, align it to the floor, and verify scale in a browser screenshot. MuAPI does not
provide the rigging/animation stage; use the repository's existing Meshy rigging flow or a
compatible pre-rigged model for animated humanoids.

## Official references

- [MuAPI AI 3D Model API](https://muapi.ai/ai-3d-model-api)
- [MuAPI API reference](https://muapi.ai/docs/api-reference)
- [MuAPI access keys](https://muapi.ai/access-keys)
