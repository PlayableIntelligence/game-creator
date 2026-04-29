# Perf Playbook — plus-template

Tight bookkeeping of every perf decision in `templates/plus-template/`. If you see slow framerates, work down this list. The numbers are from a 1920×1080 retina (DPR=2) MacBook running the cathedral scene with mirror + post + character + dust + bonfire.

## The single-biggest win

```js
// PostPipeline.js
composer.setPixelRatio(1);
```

**Saves ~12.8 ms / frame on retina.** Without this, EffectComposer renders bloom + grade at full device resolution (3840×2160 on a 1920×1080 retina). With it, post passes render at CSS resolution (1920×1080); only the final OutputPass blit back to canvas is full-DPR, and the splat itself renders at full-DPR via the RenderPass before bloom touches anything. Bloom is inherently soft — sampling artifacts from 1× post are imperceptible. Cathedral test: **43 fps → 95 fps**.

## Spark 2.0 settings (verified against `node_modules/@sparkjsdev/spark/dist/types/SparkRenderer.d.ts`)

```js
new SparkRenderer({
  renderer,
  preBlurAmount: 0.1,            // gentle softening, default 0.0
  minPixelRadius: 1,             // skip sub-pixel splats — free perf
  maxPixelRadius: 384,            // clamp huge near-camera splats — default 512
  maxStdDev: Math.sqrt(6.5),      // tighter kernel than default √8
  minSortIntervalMs: 16,          // cap radial sort to ~60Hz — default 0
  lodSplatScale: 1.0,             // budget multiplier — default 1.0
  // Don't pass: enableLod (default true), sortRadial (default true)
});
```

Default desktop `lodSplatCount` is 2,500,000 splats (Spark internal). Override if your scene has more total splats than that and you want them all visible at distance.

## Mirror tier — pick the cheapest you can stand

| Tier | URL flag | Splats | Use when |
|---|---|---|---|
| `mini` | `?mirrorTier=mini` (default) | ~100k | Mirror is far-view; 99% of cases |
| `low` | `?mirrorTier=low` | ~500k | Mirror is a hero feature, player will get close |
| `full` | `?mirrorTier=full` | ~7M | Cinematic screenshot; never for 60fps real-time |

Mirror has `lodScale: 0.5` baked in (further halves whatever LoD assigns it).

## Character — the second-biggest win

Triangle count matters more than file size:

| Character | File | ~Tris | Cost vs Soldier |
|---|---|---|---|
| **RobotExpressive** (default) | 464 KB | ~5k | 3× cheaper |
| Soldier | 2.2 MB | ~14k | baseline |
| Xbot | 2.9 MB | ~12k | similar to Soldier |

Switch via `?character=robot` or `?character=soldier`. URL `?character=0` removes character entirely (test isolator).

Mandatory character settings (see `AnimatedCharacter.load`):

```js
child.castShadow = true;
child.receiveShadow = false;          // per-fragment shadow lookup is the
                                       // single most expensive thing on a
                                       // moving SkinnedMesh. Skip it.
if (child.isSkinnedMesh) {
  child.frustumCulled = false;        // documented Three.js workaround:
                                       // unskinned bbox is wrong once bones move
}
```

Lightness sampler attaches to **one** representative mesh per character, not all (see `AnimatedCharacter.pickLightnessMesh`). The visual effect is identical — modulation is per-position, not per-mesh-shape — and it saves N-1 onBeforeRender hooks per frame.

## Shadow camera — sized to character, not world

```js
// Lighting.js
const half = Math.min(size.x, size.z) * 0.25;   // not 0.6
sun.shadow.mapSize.set(1024, 1024);              // not 2048
```

The cathedral's playable area is 30×60m, but the only shadow caster is the character. Sizing the shadow camera to a 16×16m square around the bbox center is plenty unless the player sprints to the very edge. 2k → 1k shadow map saves 4× depth-render cost.

## Other validated cuts

| Change | Cost saved |
|---|---|
| `DustMotes` `posAttr.setUsage(DynamicDrawUsage)` | 3× faster CPU→GPU upload per frame on the 200-mote position buffer |
| Lightness no-op when grid not loaded | early return in `onBeforeRender` |
| Mirror `lodScale: 0.5` | halves LoD budget when mirror runs with LoD on |
| Dust default 200 (was 300) | -1/3 sin ops + buffer uploads per frame |

## URL params for perf bisection

| URL | Purpose |
|---|---|
| `?post=0` | disable bloom + grade + vignette |
| `?character=0` | hide character entirely |
| `?character=soldier` | swap to heavy 14k-tri Soldier |
| `?mirror=0` | disable cathedral mirroring |
| `?dust=0` | disable atmospheric particles |
| `?bonfire=0` | disable spawn-point flame + light |
| `?lodScale=0.5` | half splat budget |
| `?fakefloor=hidden` | invisible physics floor |

The HUD format `<fps> · <ms> · <calls> · <tris>` is captured BEFORE the composer's OutputPass blit so triangle counts reflect the actual scene work, not the final 2-triangle full-screen quad.

## Three.js perf foot-guns to avoid

1. **`receiveShadow = true` on moving SkinnedMesh** → per-fragment shadow-map sample on potentially thousands of pixels every frame. Single most expensive thing in a typical scene.
2. **Frustum culling on SkinnedMesh** → uses unskinned bbox; bones moving outside cause flickering. Always set `frustumCulled = false` on SkinnedMeshes.
3. **`renderer.info.render.calls` after EffectComposer** → only sees the OutputPass. Reset before composer.render and read after.
4. **EffectComposer at full retina DPR** → bloom + post passes do 4× the pixel work. Use `composer.setPixelRatio(1)`.
5. **Dynamic BufferGeometry without `setUsage(DynamicDrawUsage)`** → driver treats it as static, fights every needsUpdate=true upload.
6. **Cloning materials per-instance unnecessarily** → fine when needed (lightness modulation), wasteful otherwise. Don't clone when sharing is fine.
7. **PointLight with `castShadow: true`** → 6-face cube shadow map, the most expensive shadow type in WebGL. Avoid for ambient/atmospheric lights (bonfire, candles).

## Target frame budgets (1080p retina, M1 Mac)

| Budget | Where it goes |
|---|---|
| ~6 ms | Splat render (RenderPass) — 8.8M tris through Spark |
| ~2 ms | Post (RenderPass output → bloom → grade → output) at 1× DPR |
| ~1 ms | Shadow render (1024² depth map, 16×16m cam) |
| ~0.5 ms | Three.js scene render (fake floor + character + bonfire + dust) |
| ~0.5 ms | Physics step (Rapier 60Hz, kinematic capsule + trimesh) |
| ~0.5 ms | JS work (mixer.update, fog uniform, dust drift, HUD update) |
| **~10.5 ms** | **Total — 95 fps** |

Off-budget signals (something's wrong):
- Frame > 16ms with no character: Spark misconfigured
- Frame > 16ms with no post: scene Three.js work or shadow
- Frame > 16ms with character only: SkinnedMesh receiveShadow / multi-mesh char
- Frame doubles when adding a feature: that feature is the bottleneck
