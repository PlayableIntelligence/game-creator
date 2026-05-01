# Retro Diffusion API Reference

Companion file for [SKILL.md](./SKILL.md). Full API endpoint specifications based on the official examples repo: https://github.com/Retro-Diffusion/api-examples.

## Base URL

```
https://api.retrodiffusion.ai/v1
```

## Authentication

All requests require this header:

```
X-RD-Token: <your-api-key>
```

Keys come from the Retro Diffusion dashboard (https://www.retrodiffusion.ai → Account → API). Keys typically start with `rdpk-`.

> **Wrong format:** the API does **not** use `Authorization: Bearer <key>`. Using the wrong header returns HTTP 401.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/inferences` | Main image generation (text-to-image, img2img, animation, tileset) |
| `POST` | `/edit` | Progressive image edit (flat $0.06) |
| `GET`  | `/inferences/credits` | Check remaining account balance |
| `POST` | `/styles` | Create a custom RD_PRO style |
| `GET`  | `/styles` | List custom styles |
| `PATCH`| `/styles/{id}` | Update a custom style |
| `DELETE`| `/styles/{id}` | Delete a custom style |

## POST /inferences — Generate Image

### Request body

```json
{
  "prompt": "a cute green slime",
  "negative_prompt": "blurry, photorealistic",
  "model": "RD_FAST",
  "prompt_style": "retro",
  "width": 64,
  "height": 64,
  "num_images": 1,
  "seed": 12345,
  "input_image": "<base64 PNG, optional>",
  "input_palette": "<base64 PNG, optional>",
  "strength": 0.75,
  "remove_bg": false,
  "tile_x": false,
  "tile_y": false,
  "bypass_prompt_expansion": false,
  "check_cost": false,
  "include_downloadable_data": false
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `prompt` | string | yes | Short, specific. Include perspective ("side view", "top down") and silhouette cues. |
| `negative_prompt` | string | no | What to avoid (e.g. "blurry, antialiased, photorealistic"). |
| `model` | string | yes | One of `RD_PRO`, `RD_FAST`, `RD_PLUS`, `RD_MINI`. |
| `prompt_style` | string | yes | Style key — see [Style Catalog](#style-catalog) below. |
| `width`, `height` | int | yes | Output dimensions. Range depends on model — see [Model Sizes](#model-sizes). |
| `num_images` | int | no | 1–4 typical. Each image bills separately. |
| `seed` | int | no | Reproducible generation. Same prompt + style + seed = same output. |
| `input_image` | string (base64) | conditional | Required for img2img and most animation styles. PNG, RGB, max ~4MB. |
| `input_palette` | string (base64) | no | Reference palette image — output uses these colors. |
| `strength` | float (0–1) | img2img only | 0 = identical to input, 1 = ignore input. 0.5–0.8 is the practical range. |
| `remove_bg` | bool | no | Returns transparent PNG instead of solid background. Best for sprites. |
| `tile_x`, `tile_y` | bool | no | Seamless tiling on that axis (textures, not wang sets). |
| `bypass_prompt_expansion` | bool | no | Skips the model's auto-expansion of short prompts. |
| `check_cost` | bool | no | Returns `balance_cost` only, no images, no charge. |
| `include_downloadable_data` | bool | no | For inventory/spritesheet styles, returns structured JSON metadata. |

### Response (success)

```json
{
  "created_at": 1733425519,
  "model": "rd_fast",
  "balance_cost": 0.025,
  "remaining_balance": 100.75,
  "base64_images": ["iVBORw0KGgo..."],
  "downloadable_data": null
}
```

| Field | Notes |
|-------|-------|
| `created_at` | Unix timestamp. |
| `model` | Resolved model (RD_MINI may resolve to PLUS or FAST). |
| `balance_cost` | USD charged for this call. |
| `remaining_balance` | USD remaining in the account after this call. |
| `base64_images` | Array of base64-encoded PNGs (or GIFs for animation styles). Length = `num_images`. |
| `downloadable_data` | Structured JSON, only present when `include_downloadable_data: true`. |

### Response (error)

```json
{ "error": "Insufficient credits" }
```

| HTTP | Meaning | Common cause |
|------|---------|--------------|
| 400 | Bad request | Invalid model/style combo, dimension out of range, insufficient credits |
| 401 | Unauthorized | Missing or invalid `X-RD-Token`, or used `Authorization: Bearer` |
| 403 | Forbidden | Style not available on the user's plan |
| 429 | Rate limited | Slow down — exponential backoff |
| 500 | Server error | Transient — retry with backoff |

## POST /edit — Edit an Image

Flat **$0.06** per call. Lighter-weight than re-rolling a full inference.

### Request body

```json
{
  "prompt": "give the knight a red cape",
  "input_image": "<base64 PNG>"
}
```

### Response

Same shape as `/inferences` — `base64_images[0]` contains the edited PNG.

## GET /inferences/credits — Check Balance

No body. Response:

```json
{ "credits": 24.50 }
```

(Field name may also appear as `remaining_balance` depending on plan tier.)

## Model Sizes

| Model | Min size | Max size | Notes |
|-------|----------|----------|-------|
| **RD_PRO** | 64×64 | 256×256 | 17+ styles. Supports up to 9 reference images. Flat $0.18 per image. |
| **RD_FAST** | 64×64 | 384×384 | 15 styles. Cheapest tier ($0.015–0.04). |
| **RD_PLUS** | 16×16 | 192×192 | 18+ styles. Good for tilesets and small assets ($0.025–0.08). |
| **RD_MINI** | varies | varies | Routes to PLUS or FAST. Optimized for tiny dimensions. |

Out-of-range dimensions return HTTP 400. Always check the per-model limits before sending.

## Style Catalog

Each model exposes its own `prompt_style` keys. Common values seen in the official examples:

### RD_PRO (17+ styles)
`default`, `painterly`, `fantasy`, `ui-panel`, `horror`, `sci-fi`, `isometric`, `platformer`, `dungeon-map`, `character-turnaround`, `walk-cycle`, `idle`, `attack`, `inventory-sheet`, `portrait`, `concept`, `creature`

### RD_FAST (15 styles)
`default`, `retro`, `arcade`, `simple`, `detailed`, `anime`, `texture`, `ui`, `game-asset`, `character`, `portrait`, `prop`, `effect`, `weapon`, `enemy`

### RD_PLUS (18+ styles)
`default`, `watercolor`, `top-down`, `cartoon`, `isometric-asset`, `minecraft`, `low-res-16`, `low-res-32`, `low-res-64`, `wang-tile`, `single-tile`, `terrain`, `building`, `plant`, `creature`, `weapon`, `effect`, `ui`

### RD_MINI
Routes — pass any RD_PLUS or RD_FAST style key.

> The exact set of keys is updated by Retro Diffusion server-side. If a style returns 400 ("invalid style"), check the dashboard or the official examples repo for the current list. The names above are stable enough for prototyping.

## Pricing (as of 2026)

| Operation | Cost |
|-----------|------|
| RD_FAST inference | $0.015–$0.04 (size-dependent) |
| RD_PLUS inference | $0.025–$0.08 (size-dependent) |
| RD_PRO inference | $0.18 flat |
| Animation style | $0.07–$0.25 (style-dependent) |
| Tileset (wang) | $0.10 flat |
| Image edit | $0.06 flat |

Multiply by `num_images` for batch calls. Use `check_cost: true` on `/inferences` to preview before paying.

## Custom Styles (POST /styles)

Custom styles are RD_PRO-based. Useful for locking a consistent look across a whole game.

### Request body

```json
{
  "name": "my-game-style",
  "description": "Muted NES palette, side-view characters",
  "reference_images": ["<base64 PNG>", "..."],
  "llm_instructions": "Always render in NES-style limited palette, side-view, ...",
  "forced_dimensions": { "width": 96, "height": 96 }
}
```

`forced_dimensions` is optional and accepts widths/heights between 96 and 256.

### Response

```json
{ "id": "style-abc123", "name": "my-game-style", "created_at": 1733425519 }
```

Use the returned `id` as `prompt_style` on subsequent `/inferences` calls.

## Source

Official examples repo (recommended reading before integrating):
- https://github.com/Retro-Diffusion/api-examples
- `img2img.py` — minimal Python example with full request/response handling
