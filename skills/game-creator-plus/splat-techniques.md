# Splat Techniques

Implementation reference for the post-generation pipeline that makes splats playable. Source patterns ported from `/Users/rshtirmer/Documents/work/opg/ai/splats` (OGP demo repo).

All four techniques live in `templates/plus-template/src/world/` and are loaded by `WorldLoader.loadSplatWorld()`. You only need to read this file if you're modifying them; the default behavior is correct for cathedral-pattern scenes.

## 1. Splat transform (Y-flip + metric scale)

Marble outputs splats in Y-down coordinates with an arbitrary scale. We transform once, apply the same matrix to both the SplatMesh and the collider, so render and physics never drift.

**Pattern:**

```js
// Build matrix from semantics_metadata in scene.meta.json
const sem = meta.assets.splats.semantics_metadata;
const metricScale = sem.metric_scale_factor;   // typically ~0.5–1.0
const groundOffset = sem.ground_plane_offset;  // typically ~0.3–0.5
const userScale = 3.0;                          // default — gives "cavernous cathedral" feel
const scale = metricScale * userScale;

// Order: M = Scale × RotateX(π) × Translate(0, -groundOffset, 0)
// Applied right-to-left: floor to y=0 → flip Y → scale to meters
const transform = new THREE.Matrix4()
  .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
  .multiply(new THREE.Matrix4().makeRotationX(Math.PI))
  .multiply(new THREE.Matrix4().makeTranslation(0, -groundOffset, 0));

// Decompose into pos/quat/scale on the Object3D — Spark reads matrixWorld
transform.decompose(splat.position, splat.quaternion, splat.scale);
splat.updateMatrixWorld(true);
```

**Why decompose vs setMatrix:** Spark internally reads `matrixWorld`. Setting position/quaternion/scale and calling `updateMatrixWorld(true)` matches Three.js's auto-update flow and avoids one-frame delays.

**Common bug:** people use `splat.scale.y = -1` to "flip" the splat. SparkJS breaks with negative parent scale (the splat shader's quaternion math goes wrong). Always use a rotation matrix.

## 2. Fake floor

Smooth Rapier cuboid 5cm above the scanned floor. Visual: optional textured marble slab.

**Three steps in order:**

```js
// 1. Find true floor Y by raycasting down from bbox center
const { bbox, floorY } = await peekColliderInfo(colliderUrl, transform);

// 2. Compute fake-floor top before loading collision
const FAKE_FLOOR_HALF_Y = 0.25;
const FAKE_FLOOR_LIFT = 0.05;
const fakeFloorTopY = floorY + FAKE_FLOOR_LIFT + 2 * FAKE_FLOOR_HALF_Y;

// 3. Load collision with floor culling
const collision = await loadCollision(colliderUrl, physics, transform, {
  floorCullY: fakeFloorTopY,  // drop triangles entirely below this
});

// 4. Install the fake floor itself
const fakeFloor = installFakeFloor(scene, physics, collision, floorY);
//   → fakeFloor.topY is the spawn height; capsule bottom sits here
```

**Geometry:**
- Cuboid is **90% of bbox XZ** so it doesn't cut into walls
- 0.5m thick — a 1m capsule can't tunnel
- Center matches bbox center (avoids needing to position by hand)

**Visual:**
- BoxGeometry mesh with `MeshStandardMaterial`
- Map: Polyhaven `marble_01_diff_1k.jpg` (CC0)
- `roughness: 1.0`, `metalness: 0.0`, `envMapIntensity: 0.0` — fully matte, won't pick up environment specular highlights that don't match the splat
- `renderOrder: 10` — drawn after splat so depth writes occlude any gaussians underneath
- `mesh.receiveShadow = true` — character shadows from directional light land cleanly

**When to skip:** outdoor scenes (real ground is fine) or scenes where the user has explicitly designed the floor (e.g., a stage with intentional bumps).

**When to make invisible:** if the splat's floor is gorgeous (e.g., user provided a great reference image and Marble preserved it), keep the cuboid for physics but set `fakeFloorVisible: false`. Player still walks on it; they just see the splat floor.

## 3. Lightness sampler

Runtime modulation of `envMapIntensity` on PBR meshes based on a baked grid. Makes characters feel lit by the splat.

**Pipeline:**

```js
// One-time bake (offline, takes ~30s)
const grid = await bakeLightnessGrid({
  scene, renderer, bbox: collision.bbox,
  probeY: fakeFloor.topY + 1.0,  // 1m above the floor
  hideDuringBake: [character, debug, fakeFloor.mesh],
  cell: 1.0,        // 1m × 1m cells
  faceRes: 16,      // 16×16 per cube face
});
downloadGrid(grid, 'lightness.json');  // user saves to public/

// Runtime sampling (every frame on attached meshes)
const lightness = new LightnessSampler();
await lightness.load('/lightness.json');

// Attach character — modulates envMapIntensity each frame
lightness.attach(characterMesh, { min: 0.15, max: 1.4 });
//   → mesh.onBeforeRender hook: sample(world.x, world.z) → set envMapIntensity
```

**Sampling math:** bilinear over the 4 nearest grid cells at the mesh's world XZ. Returns 0 outside the grid.

**Hookup:** `attach()` overrides `mesh.onBeforeRender`. If the mesh already had an onBeforeRender, that's preserved (the new hook chains it). The detach returned function restores the original.

**Min/max tuning:**
- `min: 0.15` — character in deepest shadow has 15% of base envMapIntensity (almost flat)
- `max: 1.4` — character in brightest light has 140% (slight overshoot for HDR feel)
- For a moodier look: `min: 0.05, max: 1.0`
- For brighter scenes: `min: 0.3, max: 2.0`

**Performance:**
- 6-face cube render per probe × 16×16 pixels × N probes = ~30s bake on a typical room
- `readRenderTargetPixels` blocks the GPU pipeline; the bake yields to the browser every 16 probes
- Runtime cost is **near-zero** — bilinear sample of a 4×4 array per attached mesh per frame

**Mobile:**
- Bake is fine on desktop; mobile won't bake but loads fine
- For mobile-only games: bake on a desktop dev machine, ship the JSON

## 4. Splat fog

Per-gaussian distance fade matching `scene.fog`. Makes splats and PBR meshes fade together.

**Why this exists:** Three.js's `scene.fog` is a fixed-function uniform read by `MeshStandardMaterial`'s shader chunks. Spark splats render through a custom shader and never see it. Without splat fog, distant stained-glass windows stay crisp while characters fade into the mist — the seam between "near (clear)" and "far (foggy)" is jarring.

**Pattern:**

```js
import { dyno } from '@sparkjsdev/spark';

const splatFog = createSplatFog({
  density: 0.015,
  color: new THREE.Color(0x1a1a2a),  // match scene.fog.color
});

// Apply once per SplatMesh, including any progressive-LOD upgrade
onMesh(splat) {
  splatFog.apply(splat);
}

// Push camera position uniform every frame
function tick() {
  splatFog.update(camera);
  renderer.render(scene, camera);
}
```

**Internals:** A dyno worldModifier appended to `mesh.worldModifiers`. The block computes `factor = 1 - exp(-density² · dist²)` per gaussian, mixes RGB toward `fogColor`. Same math as `THREE.FogExp2`.

**Tuning:**
- `density: 0.005–0.02` for metric-scale rooms
- Higher density (0.05+) for dense atmosphere ("foggy moor")
- For "no fog" leave `density: 0` — modifier compiles to no-op

**Compatibility:** Works alongside the mirror Z-flip dyno modifier (just appends, doesn't replace). If you write your own dyno modifier, append don't replace `mesh.worldModifiers`.

## 5. Mirror (advanced, optional)

Reflect the splat across a Z-plane to extend a level without a second generation. Skip unless you specifically need symmetry.

**Architecture:** shader-level Z-flip dyno modifier + global SplatEdit clip. Spark's uniform-scale constraint (it averages 3-component scale to a float) means naive `scale.z = -1` shrinks the mirror to ⅓ size. The dyno modifier flips at the gaussian level instead.

**Use case:** user has a "half-cathedral" generation that looks great on one side. Mirror it Z-axis to get a full-symmetric cathedral for free. The clip hides original-far-half splats; the mirror shows reflected-original-near-half splats; both halves walkable.

**Caveats:**
- Collision **is** mirrored (port of `loadCollision` mirror branch — Z-flips the trimesh vertices)
- Anisotropic gaussians (rare for Marble output) won't be reflected at the orientation level — only position
- Doubles GPU cost in worst case (both LOD trees loaded). Use `mirrorTier: 'low'` to keep mirror at 500k while original goes full-res

**Don't use for:** anything that's not architecturally symmetric. Mirroring a corridor with a sign on one wall = sign appears mirrored on both sides, with the text reversed on the mirror copy.

## 6. Progressive LOD

Load 500k tier first (fast), upgrade to full-res in background.

**Pattern:**

```js
// 500k loads in ~2s, scene visible immediately
const splat = new SplatMesh({ url: '/scene-500k.spz' });
await splat.initialized;
scene.add(splat);
applyDynoModifiers(splat);  // fog + mirror
onMesh(splat);

// Full-res in background
(async () => {
  const full = new SplatMesh({ url: '/scene.spz' });
  await full.initialized;
  scene.add(full);
  applyDynoModifiers(full);
  onMesh(full);
  scene.remove(splat);
  splat.dispose();
})();
```

**Quality knobs (SparkRenderer constructor):**

| Knob | Default | When to tune |
|---|---|---|
| `lodSplatScale` | 1.0 | Raise to 2.0 if close-up splats look chunky; drop to 0.5 for mobile |
| `lodRenderScale` | 1.0 | Raise to 2.0 if distant splats pop in/out; visual stability over perf |
| `maxPixelRadius` | 512 | Drop to 256 on mobile to clamp huge near-camera splats |
| `sortRadial` | true | Keep true — eliminates black-bar artifacts on camera rotation |
| `minSortIntervalMs` | 16 | Cap radial sort to ~60 Hz; raise to 33 if sort is hot in profile |

**Splat-fog quality interaction:** the splat-fog dyno modifier runs per-gaussian, so its cost scales with rendered-splat count. `lodSplatScale: 0.5` halves splat count and halves fog cost. No special tuning needed.

## File map (after Phase 1 ports complete)

```
templates/plus-template/
├── package.json                # vite, three@^0.180, @sparkjsdev/spark@^2.0, @dimforge/rapier3d-compat
├── index.html                  # canvas + module imports
└── src/
    ├── main.js                 # entry, init scene/camera/renderer, render loop
    ├── core/
    │   ├── EventBus.js         # standard pattern
    │   ├── GameState.js        # standard pattern
    │   └── Constants.js        # WORLD config, fake-floor params, lightness min/max
    ├── level/
    │   ├── WorldLoader.js      # loadSplatWorld(scene, physics, slug) — orchestrator
    │   ├── SplatTransform.js   # buildSplatTransform(meta) — Y-flip + metric scale
    │   ├── SplatLoader.js      # progressive LOD load (500k → full)
    │   ├── Collision.js        # peekColliderInfo + loadCollision (Rapier trimesh)
    │   ├── FakeFloor.js        # installFakeFloor (Rapier cuboid + visual mesh)
    │   ├── LightnessSampler.js # runtime grid sample + attach()
    │   ├── BakeLightness.js    # offline bake, ?bake=lightness URL trigger
    │   └── SplatFog.js         # createSplatFog dyno modifier
    └── player/
        └── PlayerController.js # Rapier kinematic capsule + WASD + camera orbit
```

Next port targets are tracked in tasks 3 & 4. The TS sources in `/Users/rshtirmer/Documents/work/opg/ai/splats/src/` are the reference; ports translate to JS (no TS), keep `Rapier` (lighter than rolling our own collider math), and drop the VRM character bits (template uses Meshy GLBs instead).
