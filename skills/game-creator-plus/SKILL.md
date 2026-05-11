---
name: game-creator-plus
description: Premium tier — generate playable splat-based 3D game levels with the Cathedral Pattern (Marble 1.1 Plus + image-guided + prompt-augmented + fake-floor + lightness bake + splat fog). Pay-as-you-go via OpenGameProtocol Plus credits — no subscriptions, passthrough pricing; Claude prints a one-click Stripe Checkout URL when you need to top up. Use when the user says "make a splat game", "generate a level", "use plus", "premium game", or wants the full cathedral-quality pipeline. Free tier is `make-game` + `worldlabs` skills; this skill is the polished production path.
argument-hint: "[scene description] [--image path/url]"
license: MIT
compatibility: Requires GCPLUS_TOKEN (proxy mode, billed) OR WORLDLABS_API_KEY + MESHY_API_KEY (BYO-key mode, free) environment variables. Internet access required.
metadata:
  author: OpusGameLabs
  version: 0.1.0
  tags: [game, 3d, premium, plus, worldlabs, marble, gaussian-splat, spark, cathedral-pattern, monetization]
---

# game-creator-plus — Cathedral-Quality Splat Levels

Premium pipeline that turns a sentence + a reference image into a playable 3D level with photorealistic lighting, smooth movement, and a usable physics body — in 5–10 minutes, for $1.20–$2.40 of API cost.

This is the **product** of OpenGameProtocol Plus. The free `make-game` / `worldlabs` skills will get you a splat in a scene; this skill makes that splat **playable**.

## Reference Files

| File | Description |
|------|-------------|
| [cathedral-pattern.md](./cathedral-pattern.md) | The prompting + reference-image recipe. Why "mostly empty interior" + image gives playable rooms. Worked examples. |
| [splat-techniques.md](./splat-techniques.md) | Fake floor, lightness bake, splat fog, mirror — the post-generation pipeline that makes splats playable. |
| [perf-playbook.md](./perf-playbook.md) | Performance reference. The 12.8ms `composer.setPixelRatio(1)` win, character tri counts, Spark 2.0 settings, frame budget targets, URL bisection guide. |
| [credit-flow.md](./credit-flow.md) | How users add credits: Claude prints a Stripe Checkout link → user clicks → webhook credits account. Pricing table. |
| [proxy-protocol.md](./proxy-protocol.md) | Wire format for the Plus proxy: signup, balance, marble/meshy passthrough, asset mirroring. |

## When to Use

Use this skill when the user wants any of:

- A **playable** splat-based 3D level (not just a viewer)
- **Marble 1.1 Plus** specifically (auto-expanding worlds, biggest model)
- The **cathedral pattern** — large, walkable, photorealistic rooms ready for boss fights
- Production-quality output ready to monetize on Play.fun / sub.games
- Pay-as-you-go billing (no subscription) — Claude prints a one-click Stripe Checkout URL for credit top-ups

Do NOT use this skill for:
- 2D games — use `phaser` / `make-game` instead
- Quick prototypes — `quick-game` is faster and free
- Generic 3D character work — `meshyai` standalone is enough
- Non-game splat viewers — use the bare `worldlabs` skill

## The Cathedral Pattern (the actual product)

> **Empty + Image + Floor + Light = Playable.**

Four ingredients in this exact order:

1. **Empty interior prompt augmentation** — auto-prepend "mostly empty interior, high ceilings, clear walking paths, no furniture or debris on the floor" to whatever the user typed. Marble's collider degrades fast on cluttered scenes; clutter = invisible walls.
2. **Reference image (strongly recommended)** — generation faithfulness comes from the image, not the prompt. Without one, walls and atmosphere are a coin flip. With one, the model matches stained-glass placement, lighting direction, and material vocabulary.
3. **Fake floor cuboid** — install a smooth Rapier cuboid 5cm above the scanned floor, floor-cull the bumpy real-floor triangles below it. Players never tunnel, never trip, can sprint and jump cleanly.
4. **Lightness bake (optional, +30s)** — one-time grid bake of splat luminance at 1m cells. Dynamic objects (player, enemies, props) sample it via `envMapIntensity` so they look lit by the same environment.

That's the whole product. Everything else is plumbing.

See [cathedral-pattern.md](./cathedral-pattern.md) for the full recipe with worked examples and bad-prompt failure modes.

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Splat generation | World Labs Marble 1.1 Plus (~$1.20 base + $0.24/cube) |
| Character/prop generation | Meshy AI (~$0.40–$1.00 per asset) |
| Splat rendering | SparkJS 2.0 (`@sparkjsdev/spark`) on Three.js |
| Physics | Rapier 3D (`@dimforge/rapier3d-compat`) — kinematic capsule + trimesh world |
| Splat post-processing | dyno worldModifiers (splat-fog, mirror Z-flip) |
| Lighting | Lightness grid bake → runtime `envMapIntensity` modulation |
| Billing | OGP Plus proxy (Stripe Checkout, no UI) |
| Deploy | here.now (default) or GitHub Pages |

## Authentication & Billing

This skill has two operating modes — both work; only the billing differs.

### Proxy Mode (default, billed)

```bash
# User signs up via Claude on first run:
node scripts/plus-auth.mjs signup --email <user@example.com>
# → returns Stripe Checkout URL, opens in browser, user pays
# → token saved to ~/.gcplus/token

# Subsequent calls auto-route through proxy:
node scripts/plus-generate-world.mjs --prompt "..." --image ./ref.jpg
# Reads ~/.gcplus/token, calls plus.gamecreator.dev, debits ledger
```

Costs are passthrough + Stripe fees (~3% + $0.30) + minimal infra overhead. See [credit-flow.md](./credit-flow.md) for the exact pricing table.

### BYO-Key Mode (free, advanced users)

```bash
# .env:
WORLDLABS_API_KEY=...
MESHY_API_KEY=...

node scripts/plus-generate-world.mjs --prompt "..." --image ./ref.jpg
# No GCPLUS_TOKEN → falls back to direct API calls with user's keys
```

The skill itself is identical in both modes. Only the network destination changes (`api.worldlabs.ai` vs `plus.gamecreator.dev/v1/marble`). All cathedral-pattern logic, fake-floor, lightness bake — those run client-side and are free.

## End-to-End Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. User: "make a gothic cathedral boss fight"               │
│ 2. Skill asks for reference image (or accepts text-only)    │
│ 3. plus-generate-world.mjs:                                  │
│      - Augments prompt: "...mostly empty interior, high      │
│        ceilings, clear walking paths..."                     │
│      - Forces model=marble-1.1-plus                         │
│      - Uploads image, submits generation                     │
│      - Polls 3–8 min, downloads SPZ + collider + meta        │
│ 4. Lightness bake in-browser (optional, +30s):               │
│      - Append ?bake=lightness to the running template URL    │
│      - JSON file downloads → drop next to splat              │
│ 5. Template wired up:                                        │
│      - WorldLoader applies splat transform (Y-flip + scale)  │
│      - peekColliderInfo finds floor Y from bbox raycast      │
│      - installFakeFloor places smooth cuboid 5cm above       │
│      - loadCollision builds Rapier trimesh, floor-culled     │
│      - SplatFog dyno modifier matches scene.fog              │
│      - LightnessSampler attached to player + props           │
│ 6. User playable in browser, ready to add gameplay           │
└─────────────────────────────────────────────────────────────┘
```

## Process

1. **Detect mode**
   - `[ -f ~/.gcplus/token ]` → proxy mode
   - else if `WORLDLABS_API_KEY` set → BYO mode
   - else → walk user through signup ([credit-flow.md](./credit-flow.md))

2. **Ask for reference image** (always)

   > For best results, share a reference image of the environment you want.
   > A photo, concept art, or screenshot — anything that shows the **lighting**, **architecture style**, and **material palette**.
   >
   > - Path or URL? → I'll use it as the primary input
   > - No image? → I'll generate from text alone (results vary; faithfulness drops)

3. **Generate world** with cathedral-pattern prompt augmentation

   ```bash
   node scripts/plus-generate-world.mjs \
     --prompt "<user prompt>" \
     --image <path-or-url> \
     --slug <name> \
     --output public/assets/worlds/
   ```

   Internally this calls `worldlabs-generate.mjs` with:
   - `--model marble-1.1-plus`
   - Augmented prompt with cathedral guidance prepended
   - Image upload via `media-assets:prepare_upload`

4. **Bake lightness grid (optional)**

   Recommended for any scene with PBR characters/props. Skip if pure-splat with no Meshy characters.

   The bake runs in-browser. With the template's dev server running:

   ```
   open http://localhost:5173/?bake=lightness
   ```

   The page samples a 1 m grid through the world and triggers a download
   of `<slug>-lightness.json`. Move it next to the splat and the template's
   `LightnessSampler` will pick it up on next load.

5. **Wire up the template**

   If creating a new game, scaffold from `templates/plus-template/` (includes WorldLoader, FakeFloor, LightnessSampler, SplatFog, PlayerController pre-wired).

   If adding to an existing Three.js game, copy the modules from `templates/plus-template/src/world/` (WorldLoader, FakeFloor, Collision, SplatFog) into your project's `src/world/` and call `loadSplatWorld(scene, '/assets/worlds/<slug>')` from `init()`.

6. **Verify**
   - Player walks on smooth floor (no jitter, no falling through)
   - Splat renders at expected scale (cathedral ≈ 30m wide, not 3m or 300m)
   - Distance fog fades splats AND meshes together (no seam)
   - Player character `envMapIntensity` shifts as they walk between bright/dark areas (if lightness bake ran)

7. **Deploy & monetize**

   Standard `game-deploy` + `monetize-game` chain works unchanged. Splat-level games are normal Three.js games on the wire.

## Cost & Pricing

See [credit-flow.md](./credit-flow.md) for full detail. Summary:

| Operation | Cost (passthrough) | Plus credits | Time |
|-----------|---|---|---|
| Marble 1.1 Plus — text → world | $1.26–$2.46 | 148–288 cr (preauth max, settle actual) | 3–8 min |
| Marble 1.1 Plus — image → world | $1.20–$2.40 | 140–281 cr (preauth max, settle actual) | 3–8 min |
| Marble 1.1 / 1.0 (fixed) | $1.20–$1.26 | 140–150 cr | 3–8 min |
| Marble Draft (1.0-draft) | $0.12–$0.18 | 14–22 cr | ~30s |
| Meshy text-to-3D (preview) | $0.40 | 47 cr | 2–4 min |
| Meshy text-to-3D (refine) | $0.20 | 23 cr | 1–3 min |
| Meshy image-to-3D | $0.40–$0.60 | 47–70 cr | 2–4 min |
| Meshy rigging | $0.10 | 12 cr | 1 min |
| Meshy animation per clip | $0.06 | 7 cr | 30s |
| Lightness bake | $0 (client-side) | 0 cr | 30s |

Marble 1.1 Plus is variable-cost: pre-debit at the worst-case ceiling, settle to actual after the operation completes. Backend reconciler refunds the delta automatically. See [credit-flow.md](./credit-flow.md) for the full breakdown.

**1 Plus-credit = $0.01.** Top-ups: $5 / $20 / $50 / $100. Stripe fees baked in (~3% + $0.30 minimum).

## Pipeline Integration

`game-creator-plus` is a **superset** of the free pipeline — it can wrap `make-game` step 4 (3D environment) entirely:

```
make-game (free)              game-creator-plus (premium)
─────────────────             ─────────────────────────────
1. scaffold                ─→ 1. scaffold (templates/plus-template)
2. design                  ─→ 2. design
3. plus-generate-world     ─→ 3. cathedral-prompt + marble-1.1-plus
4. ?bake=lightness         ─→ 4. lightness grid
5. game-assets (Meshy)     ─→ 5. game-assets (Meshy, billed via proxy)
6. game-audio              ─→ 6. game-audio
7. qa-game                 ─→ 7. qa-game
8. game-deploy             ─→ 8. game-deploy
9. monetize-game           ─→ 9. monetize-game (plus play.fun + sub.games)
```

Every step that hits a paid API (worldlabs, meshy) routes through the proxy when `GCPLUS_TOKEN` is set; everything else is identical.

## Troubleshooting

### "Marble world looks great but I keep walking through walls"
Cathedral pattern wasn't applied. Check the `.meta.json` for the augmented prompt — it should start with "mostly empty interior, high ceilings...". If user's original prompt described a cluttered scene ("a packed marketplace"), regenerate with augmentation forced or pick a different concept.

### "Player falls through the floor"
The fake-floor cuboid wasn't installed, OR `floorY` from `peekColliderInfo` is wrong (raycast missed). Check console for `fake-floor: real floor y=...`. If `floorY === bbox.min.y` it means the raycast didn't hit anything — usually means the splat is upside-down (Y-flip not applied) or the collider GLB is empty.

### "Characters look flat against the splat"
Lightness bake didn't run, or `LightnessSampler.attach()` wasn't called on the character mesh. Check that `public/lightness.json` exists and is non-empty (~30–80 KB for a typical room). Re-bake with `?bake=lightness` if missing.

### "Distance fog cuts off splats but not characters (seam visible)"
`SplatFog.update(camera)` not being called every frame. Add to render loop alongside `renderer.render(scene, camera)`. The dyno modifier needs the camera-position uniform pushed each frame to compute per-gaussian distance correctly.

### "Marble Plus generation is taking 20+ minutes"
1.1 Plus auto-expands when the prompt implies a larger world (more cubes = longer generation). Either prompt for a single room ("a single cathedral interior, no exterior, no surrounding city") or accept the wait. Per-cube billing means the longer wait also costs more — usually 8–12 min for ~3-cube worlds at $1.92 total.

### "I'm out of credits and the proxy returned 402"
Hand the user the topup URL. The skill should call `node scripts/plus-auth.mjs topup --amount 20` which returns a Stripe Checkout URL; user opens it, pays, webhook credits the account, generation auto-resumes if `--retry` was set on the original call.

### "BYO-key mode gives different results from proxy mode"
It shouldn't — the proxy is a passthrough. If you see deterministic differences, file an issue. Most likely cause: BYO mode hits Marble's free-tier rate limits; proxy uses a Pro account.

### "Can I use 1.1 Standard instead of 1.1 Plus to save money?"
Yes — pass `--model marble-1.1` to override. You lose auto-expanding worlds (single 30m³ box) but save 20–50% on cost. The cathedral pattern still works fine for single-room scenes.

## Operations

The proxy backend lives in a separate **private** repo and is hosted at `gamecreator.dev`. The deployed instance ships a single-page admin dashboard at `https://gamecreator.dev/admin` (gated by `x-admin-token`).

The dashboard surfaces:

- **Today's spend** (gross, refunded, net, by-kind), broken down per model
- **Upstream Meshy balance** (probed via `/openapi/v1/balance`) — Marble has no API; check `platform.worldlabs.ai/billing` manually
- **Live in-flight jobs** with age + upstream id
- **Stuck jobs** (Meshy > 30min, Marble > 2h45m) — these auto-cancel + refund
- **Recent failures** with error text + refund status
- **p50/p95 generation time** per kind from last 7 days
- **Drift check** — sums `users.balance_cr` against `credit_ledger.delta_cr`; should always equal

Background alerts (logged at WARN level — wire to PagerDuty/Slack in prod):

- Meshy balance below threshold (default 500cr ≈ $10) — top up at `platform.meshy.ai/settings/api`
- Today success rate below 70% with at least 5 jobs
- Any stuck job
- Ledger drift detected

Key endpoints for ad-hoc queries:

- `GET /v1/admin/metrics` — full snapshot (JSON, requires `x-admin-token`)
- `POST /v1/admin/grant` — pre-fund accounts without Stripe (dev / support)
- `DELETE /v1/jobs/:job_id` — cancel a Meshy job (Marble can't be cancelled — eats the credit)

### "Marble released a price change quietly"
Pricing on Marble has historically jumped without much warning (e.g. pano-edit went 50cr → 150cr in Dec 2025). Watch their release notes at `docs.worldlabs.ai/marble/release-notes` and update the `MARBLE_CR_TO_OUR_CR` constant in `marble.service.ts` if their billing rate changes. Same for Meshy at `docs.meshy.ai/api/changelog`.

## Checklist

- [ ] `GCPLUS_TOKEN` (proxy mode) **OR** `WORLDLABS_API_KEY` + `MESHY_API_KEY` (BYO) set
- [ ] User asked for reference image (image path/URL provided OR explicitly declined)
- [ ] `scripts/plus-generate-world.mjs` invoked with `--image` when available
- [ ] Cathedral-pattern prompt augmentation visible in `.meta.json` (`augmented_prompt` field)
- [ ] Marble 1.1 Plus used (check `model` field in `.meta.json`)
- [ ] SPZ + collider GLB downloaded successfully (check file sizes, both > 1KB)
- [ ] `templates/plus-template/` cloned (or modules copied to existing project)
- [ ] `WorldLoader.loadSplatWorld()` called with the slug — applies transform, loads collider, installs fake floor
- [ ] In-browser test: player walks on smooth floor at expected scale (~1.7m tall, room is ~30m³)
- [ ] Lightness bake completed (or explicitly skipped — note in progress.md)
- [ ] `SplatFog.update(camera)` in render loop
- [ ] `LightnessSampler.attach(playerMesh)` called for any PBR characters
- [ ] `progress.md` updated with: world ID, augmented prompt, generation cost, fake-floor topY, lightness grid stats
