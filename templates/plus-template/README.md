# plus-template

Foundation for any 3D game built on a Marble (World Labs) Gaussian splat world. Drop in a splat + collider + assets, write `src/game/Game.js`, ship.

```
Splat world  ──→  Cathedral / Dungeon / Forest / Gym  (any Marble world)
+ Character  ──→  VRM (default) / GLB / opensourceavatars.com avatars
+ Meshy AI   ──→  Boss enemies / props / pickups / cards / weights
+ Game.js    ──→  Souls battle / RuneScape harvest / TCG sim / Tap-to-lift
                  (you write this part)
```

90 fps on a M1 Mac with the cathedral, full post-processing, VRM character, mirror-clamped 3rd-person camera. Mobile-first input + DPR caps.

## Quick start

```bash
npm install
npm run dev      # http://localhost:3001/?slug=cathedral
```

Click the canvas to lock pointer, **WASD** to walk, **mouse** to look, **shift** to sprint, **space** to jump, **click** to place a demo marker, **R** to clear markers, **esc** to release pointer.

On mobile: virtual joystick (left thumb), look pad (right thumb drag), sprint + jump buttons (corners).

## Project structure

```
plus-template/
├── package.json                # vite, three, @sparkjsdev/spark, @dimforge/rapier3d-compat, @pixiv/three-vrm
├── index.html                  # canvas, HUD slots, boot overlay
├── public/
│   └── assets/
│       ├── worlds/<slug>.spz   # Marble Gaussian splats (3 tiers + collider + meta.json)
│       ├── models/             # GLB and VRM characters
│       ├── animations/         # Mixamo FBX clips for VRM
│       └── meshy/              # Meshy AI generations (per-asset folder + meta.json)
└── src/
    ├── main.js                 # ~150 lines — boot orchestrator + render loop
    ├── core/
    │   ├── Constants.js        # ALL config — DEVICE, WORLD, SPLAT, FAKE_FLOOR, FOG,
    │   │                       # POST, LIGHTING, LIGHTNESS, CHARACTER, PHYSICS,
    │   │                       # PLAYER, CAMERA, RENDERER, HUD
    │   ├── EventBus.js         # pub/sub for cross-module signals
    │   └── GameState.js        # centralised player + world state
    ├── render/
    │   ├── Renderer.js         # WebGLRenderer + PerspectiveCamera setup
    │   ├── Lighting.js         # ambient + hemi + warm directional with bbox-scaled shadow
    │   └── PostPipeline.js     # bloom + grade + vignette (composer.setPixelRatio(1) — saves ~12ms/frame)
    ├── world/
    │   ├── Physics.js          # Rapier wrapper + fixed-step
    │   ├── SplatTransform.js   # Y-flip + metric_scale_factor + ground_plane_offset
    │   ├── SplatLoader.js      # mini/low/full/progressive tier strategies
    │   ├── Collision.js        # collider GLB → bbox + raycast floorY + Rapier trimesh (with floor-cull)
    │   ├── FakeFloor.js        # smooth Rapier cuboid + textured marble slab
    │   ├── LightnessSampler.js # per-frame envMap modulation from lightness grid
    │   ├── BakeLightness.js    # offline bake (?bake=lightness)
    │   └── WorldLoader.js      # orchestrator
    ├── player/
    │   ├── Capsule.js          # Rapier kinematic capsule + character + state machine
    │   ├── AnimatedCharacter.js # auto-detect GLB vs VRM, mixer + idle/walk/run + bbox feet
    │   ├── VRMLoader.js        # @pixiv/three-vrm
    │   ├── MixamoRetarget.js   # Mixamo FBX → VRM bone retargeting
    │   ├── InputRouter.js      # keyboard + mouse + touch unified
    │   ├── MobileControls.js   # touch joystick + look pad + buttons (auto-mounts on touch primary)
    │   └── CameraMode.js       # first/third/topdown/side + spring-arm wall raycast
    ├── assets/
    │   ├── AssetLoader.js      # loadAsset + spawnAsset (universal GLB pipeline)
    │   └── MeshyLoader.js      # loadMeshy(meta.json) → AssetLoader
    ├── ui/
    │   └── HUD.js              # FPS counter + slot accessors (#hud-tl/tr/bl/br)
    └── game/                   # ← YOUR GAME LIVES HERE
        ├── Game.js             # class with onWorldLoaded / onUpdate / onClick / onKeyDown / etc
        └── raycast.js          # raycastPointer + raycastCenter utilities
```

**The contract:** anything outside `src/game/` is reusable infrastructure. To build a game, edit `src/game/Game.js` (and add new files in `src/game/` for your gameplay code). Don't modify the rest unless you're hacking the template itself.

## How to build a game

### 1. Pick a camera mode

URL: `?cam=first | third | topdown | side` (default `third`). Or set `CAMERA.mode` in `Constants.js`.

| Mode | Best for |
|---|---|
| `third` | Souls battle, RuneScape, gigachad-lift, exploration |
| `first` | FPS, immersive sims |
| `topdown` | TCG sim, ARPG, tactical |
| `side` | Tap-to-lift, 2.5D platformer |

Top-down + side modes use world-axis WASD (input meaning doesn't change as the camera rotates). First/third use camera-relative.

### 2. Edit `src/game/Game.js`

```js
import * as THREE from 'three';
import { spawnAsset, loadAsset } from '../assets/AssetLoader.js';
import { loadMeshy } from '../assets/MeshyLoader.js';

export class Game {
  async onWorldLoaded({ scene, world, physics, camera, hud }) {
    this.scene = scene; this.world = world; this.physics = physics;

    // Spawn an enemy at bbox centre, 5m in front of player
    const ctr = world.collider.bbox.getCenter(new THREE.Vector3());
    const boss = await loadMeshy('/assets/meshy/dragon-boss/dragon-boss.meta.json');
    spawnAsset(boss, scene, {
      position: [ctr.x, world.fakeFloor.topY, ctr.z + 5],
      rotation: [0, Math.PI, 0],
      scale: 2.0,
      withMixer: true,
    });

    // HUD: health bar in top-left
    hud.getSlot('tl').innerHTML = `<div id="hp">HP: 100</div>`;
  }

  onPlayerSpawn({ capsule, character }) {
    this.player = capsule;
    this.hp = 100;
  }

  onClick(hit) {
    if (!hit) return;
    // souls-style: attack toward camera-forward
    this.attackAt(hit.point);
  }

  onKeyDown(code) {
    if (code === 'KeyF') this.lightAttack();
    if (code === 'KeyR') this.heavyAttack();
  }

  onUpdate(dt) {
    // boss AI, projectile motion, etc
  }

  onFixedUpdate(dt) {
    // physics-coupled hit detection
  }
}
```

The default `Game.js` ships with a click-to-place-marker demo. Replace its body with your gameplay code.

### 3. URL params reference

```
World      ?slug=cathedral|forest|...    swap the world (loads /assets/worlds/<slug>.{spz,collider.glb,meta.json})
           ?scale=N                      override userScale (default 3.0)
           ?quality=mini|low|full|progressive   splat tier (default 'low' desktop, 'mini' mobile)

Visuals    ?post=0                       disable bloom + grade + vignette
           ?fog=0                        disable scene fog
           ?fakefloor=hidden             physics-only floor, no marble visual
           ?wireframe=1                  show green collider overlay
           ?exposure=N                   tone mapping exposure (default 1.0)

Player     ?cam=first|third|topdown|side  camera mode (default third)
           ?camDist=N                   third-person orbit distance
           ?camHeight=N                 topdown camera height
           ?character=vrm|robot|soldier|xbot|0   default vrm; 0 = no character

Lightness  ?bake=lightness               run offline bake → downloads <slug>-lightness.json
           ?lightness=0                  disable runtime lightness sampling

HUD        ?hud=0                        hide FPS counter
```

### 4. Common patterns

**Spawn a Meshy asset from a click hit:**

```js
import { loadMeshy, spawnAsset } from '../assets/MeshyLoader.js';

async onClick(hit) {
  if (!hit) return;
  const tree = await loadMeshy('/assets/meshy/oak-tree/tree.meta.json');
  spawnAsset(tree, this.scene, {
    position: [hit.point.x, this.world.fakeFloor.topY, hit.point.z],
    scale: 1.0 + Math.random() * 0.5,
    rotation: [0, Math.random() * Math.PI * 2, 0],
  });
}
```

**Per-frame raycast under the crosshair (highlight what you're aiming at):**

```js
import { raycastCenter } from './raycast.js';

onUpdate(dt) {
  const hit = raycastCenter(this.camera, this.world.collider.debug, 50);
  if (hit && hit.object !== this._lastHover) {
    this._lastHover = hit.object;
    // ... apply highlight, show name in HUD, etc
  }
}
```

**Read player position for AI / objectives:**

```js
import { GameState } from '../core/GameState.js';

onUpdate(dt) {
  const px = GameState.player.position.x;
  const pz = GameState.player.position.z;
  // distance to objective, AI vision, etc
}
```

**Drive a HUD widget:**

```js
onWorldLoaded({ hud }) {
  hud.getSlot('tr').innerHTML = `<div id="score">Score: 0</div>`;
}

onClick() {
  this.score += 10;
  document.getElementById('score').textContent = `Score: ${this.score}`;
}
```

**Listen to events from infrastructure:**

```js
import { EventBus, EVENTS } from '../core/EventBus.js';

EventBus.on(EVENTS.WORLD_LOADED, ({ bbox }) => { /* ... */ });
EventBus.on('splat:mesh-ready', (mesh) => { /* fog/mirror modifier hook */ });
```

## Swapping the world

The world is loaded from `public/assets/worlds/<slug>.*` based on `?slug=...`. To add a new world:

1. Generate it via Marble (text-to-3D) or download from World Labs / Marble's library
2. Convert: `splat-transform scene.ply scene.spz` (yields `.spz` + collider + meta.json)
3. Copy to `public/assets/worlds/<your-slug>.spz`, `<your-slug>-500k.spz`, `<your-slug>-100k.spz`, `<your-slug>-collider.glb`, `<your-slug>.meta.json`
4. Visit `?slug=<your-slug>`

The cathedral pattern works best for **mostly-empty interiors** with **photoreal walls/ceiling and a navigable floor**. Forest/courtyard scenes work too but you'll want `?fakefloor=hidden` so the splat ground reads.

## Swapping the character

Three character formats supported, all unified through `AnimatedCharacter`:

### GLB with baked animations (Soldier, Xbot, Robot from Three.js examples)

Add to `CHARACTER_PRESETS` in `Constants.js`:

```js
warrior: {
  glb: '/assets/models/warrior.glb',
  clipMap: { idle: 'Idle', walk: 'Walk', run: 'Run' },  // clip names from inside the GLB
  facingOffset: 0,           // model faces -Z by default
  scale: 1.0,
},
```

Use: `?character=warrior`.

### VRM + Mixamo animations (opensourceavatars.com, VRoid Hub)

```js
reia: {
  vrm: '/assets/models/reia.vrm',
  clipMap: {
    idle: '/assets/animations/idle.fbx',
    walk: '/assets/animations/walk.fbx',
    run:  '/assets/animations/run.fbx',
  },
  facingOffset: Math.PI,     // VRMs face +Z after VRMUtils.rotateVRM0
  scale: 1.0,
},
```

The VRM skeleton is standardized — same Mixamo clips work for every VRM (the retargeter remaps `mixamorigHips` → `hips` automatically). Bundled animation set is enough for most needs.

### opensourceavatars.com workflow

1. Visit https://www.opensourceavatars.com/en/gallery (CC0 — free, public domain)
2. Download a `.vrm`
3. Drop in `public/assets/models/<name>.vrm`
4. Add a CHARACTER_PRESET as above
5. `?character=<name>` and reload

## Adding Meshy AI assets

This template is designed for the [game-creator's `/meshyai` skill](../../skills/meshyai/SKILL.md). Generate via:

```bash
node scripts/meshy-generate.mjs --prompt "stone dragon boss with crystal armor" --output public/assets/meshy/dragon
```

That produces `public/assets/meshy/dragon/dragon.glb` + `dragon.meta.json`. Load via:

```js
import { loadMeshy, spawnAsset } from '../assets/MeshyLoader.js';
const dragon = await loadMeshy('/assets/meshy/dragon/dragon.meta.json');
spawnAsset(dragon, scene, { position: [...], scale: 2.0 });
```

For Meshy assets that ship with rigging + animations, set `withMixer: true` in spawnAsset and play named clips via the returned `actions`.

## Performance

90 fps cathedral + VRM + post on a 2021 M1 Mac. Frame budget breakdown:

| Phase | Cost |
|---|---|
| Splat render (Spark, ~5M tris LoD-budgeted) | ~6 ms |
| Post pipeline (bloom + grade + output) | ~2 ms (composer.setPixelRatio(1) — without it, ~14 ms) |
| Three.js scene render (fake floor + character + assets) | ~1 ms |
| Shadow render (1024 map, 16×16m camera around player) | ~1 ms |
| Physics step (Rapier 60Hz, kinematic capsule + 95k-tri trimesh) | ~0.5 ms |
| Camera spring-arm raycast (125k-tri Three.js Raycaster) | ~1 ms |
| Mixer + JS work | ~0.3 ms |

If FPS drops below 60, bisect with these URL params:

```
?character=0   no character
?post=0        no bloom/grade
?fog=0         no fog
?cam=first     no camera raycast (first-person)
?quality=mini  100k splat tier
```

Most likely culprit: post pipeline running at full DPR. The template hard-codes `composer.setPixelRatio(1)`; if you fork PostPipeline, KEEP THIS LINE — it's a 12ms/frame difference on retina.

## Mobile

Auto-detected via `matchMedia('(pointer: coarse)')`. When detected:

- **DPR cap 1.5** instead of 2 (reduces post pixel cost ~30%)
- **Splat tier `mini`** (100k splats, 1.4MB DL)
- **Shadow map 512** instead of 1024
- **Bloom strength 0.35** instead of 0.55
- **Touch joystick + look pad + sprint/jump buttons** mounted automatically
- **Pointer-lock skipped** (mobile browsers don't handle it cleanly)

Target: 60 fps on a 2-year-old phone, with full visual stack on. Test with Chrome DevTools mobile emulation OR by USB-debugging an actual phone.

## Genre starting points

Each combines a camera mode + a Game.js skeleton. All four work on the **same** template — just different `Game.js`.

### Souls battle

```
URL:           ?cam=third&character=vrm
World:         dark cathedral / dungeon (default)
Game.js:       boss enemy spawned in onWorldLoaded;
               click → light attack toward camera-forward;
               KeyF → heavy attack; KeyR → roll;
               HP/stamina bars in #hud-tl;
               raycastCenter every frame for hit detection
```

### Tree-chopping RuneScape

```
URL:           ?cam=third&character=robot     (or vrm)
World:         forest (generate via Marble)
Game.js:       trees scattered in onWorldLoaded (Meshy or library);
               click on tree → harvest progress, +1 wood;
               inventory bar in #hud-bl;
               XP gauge in #hud-br
```

### TCG sim

```
URL:           ?cam=topdown&character=0&post=0
World:         table room (small Marble interior)
Game.js:       cards as 2D DOM elements in #hud-bl,
               drag-and-drop to play areas;
               raycast on click to detect target;
               opponent state in #hud-tr
```

### Tap-to-lift gigachad

```
URL:           ?cam=side&character=xbot
World:         gym (Marble interior with mirrors)
Game.js:       weight bench prop in front of player;
               click button (or tap on mobile) → counter += 1, lift animation;
               muscle progress bar in #hud-tl;
               weight selector in #hud-bl
```

## Troubleshooting

- **Walls go black when looking outward** → camera escaped the room. The spring-arm raycast in `CameraMode.js` should prevent this; if it persists, increase `wallOffset` in main.js (default 0.4).
- **Character feet float / clip into floor** → bbox auto-correction in `AnimatedCharacter._loadGLB/VRM` should handle it; if a specific model is off, check that the model's rest-pose feet aren't far from the bbox bottom (some artists put origin at hips).
- **VRM appears with wrong facing** → adjust `facingOffset` in the preset (most VRMs need `Math.PI`, GLBs vary).
- **Mixamo animation explodes** → bone retargeting may have failed. Confirm the FBX is from Mixamo (has `mixamorigHips` etc); custom-rigged FBX won't work.
- **Splat upgrade stutters at boot** → that's the LoD-tree build on the full-res tier. Default is `quality=low` (no upgrade) to avoid this; opt back into `?quality=progressive` only for cinematic recordings.
- **Camera goes inside walls** → splat-wall thickness varies; `wallOffset` 0.4m clears most. Bump higher if needed.

## Licenses

| Component | License |
|---|---|
| Template code (this) | MIT |
| Three.js | MIT |
| Spark | MIT |
| Rapier | Apache 2.0 |
| @pixiv/three-vrm | MIT |
| Soldier.glb / Xbot.glb / RobotExpressive.glb | MIT (Three.js examples) |
| bloody.vrm sample | check splats-demo upstream — replace with your own VRM for production |
| Mixamo FBX animations | free with Mixamo / Adobe account |
| Marble splats | World Labs commercial terms |
| Meshy AI generations | Meshy commercial terms |
| Polyhaven marble texture | CC0 |
| opensourceavatars.com VRMs | CC0 |
