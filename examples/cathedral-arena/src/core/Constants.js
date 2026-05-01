/**
 * Constants — every magic number lives here.
 *
 * Step 1 scope: just DEVICE detection and the renderer/HUD basics. Other
 * subsystems will add their own sections in later steps.
 */

const params = new URLSearchParams(window.location.search);

// ---------------------------------------------------------------------------
// Device profile — detected once at boot, branched by every subsystem.
// ---------------------------------------------------------------------------

const isTouchPrimary =
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

// Cap pixel ratio aggressively on mobile — a 3× DPR phone screen × 4× post
// pixels = 12× the GPU work for sharpness no human can perceive. 1.5 is a
// good balance: text stays crisp, render cost stays manageable.
const dprCap = isTouchPrimary ? 1.5 : 2;
const pixelRatio = Math.min(window.devicePixelRatio || 1, dprCap);

export const DEVICE = {
  isTouchPrimary,
  pixelRatio,
  dprCap,
  // Coarse mobile/desktop split — most subsystem branches use this.
  // Touch-primary laptops (rare) get treated as desktop because their CPU/GPU
  // is desktop-class.
  isMobile: isTouchPrimary && navigator.maxTouchPoints > 1,
  // Useful for HUD layout decisions.
  viewport: {
    get width()  { return window.innerWidth; },
    get height() { return window.innerHeight; },
  },
};

// ---------------------------------------------------------------------------
// World — splat asset paths + transform tuning.
// ---------------------------------------------------------------------------

const slug = params.get('slug') || 'cathedral';

export const WORLD = {
  slug,
  // Per-tier paths. Mobile loads "mini" only (no upgrade), desktop loads "low"
  // first then upgrades to "full" in background. Override individually if your
  // bake produced different filenames.
  paths: {
    mini:     `/assets/worlds/${slug}-100k.spz`,
    low:      `/assets/worlds/${slug}-500k.spz`,
    full:     `/assets/worlds/${slug}.spz`,
    meta:     `/assets/worlds/${slug}.meta.json`,
    collider: `/assets/worlds/${slug}-collider.glb`,
  },
  /**
   * Multiplier on Marble's metric_scale_factor.
   * 1.0 = life-sized; 3.0 = cavernous (Souls-demo default — typical Marble
   * outputs are slightly under-scaled). Override with ?scale=N.
   */
  userScale: Number(params.get('scale') ?? 3.0),
  // Marble outputs are Y-down; flip 180° around X to align with Three.js Y-up
  flipY: params.get('flip') !== '0',
  // Apply Marble's metric_scale_factor + ground_plane_offset from meta.json
  applyMetric: params.get('metric') !== '0',
};

// ---------------------------------------------------------------------------
// Collider — Marble's auto-generated collision GLB (semantically clean,
// matches the splat geometry far better than a voxel flood-fill alternative
// like splat-transform's -K output, which we benchmarked and rejected).
// ---------------------------------------------------------------------------

export const COLLIDER = {
  // Show the green wireframe overlay? Off by default; toggle via ?wireframe=1
  // or programmatically: scene.getObjectByName('collision-debug').visible = true.
  showWireframe: params.get('wireframe') === '1',
  // Floor Y comes from a downward raycast at the bbox centre. If the raycast
  // misses (collider has a hole right below the centre), fall back to
  // bbox.min.y.
  fallbackToBboxMinY: true,
};

// ---------------------------------------------------------------------------
// Fake floor — smooth slab a few cm above the bumpy scanned floor. Walls and
// ceiling still come from the real Marble collider; only the floor gets the
// smoothing pass. THIS IS THE LOAD-BEARING UX FIX — without it, walking on
// photogrammetry-bumpy floors feels terrible (capsule jitters, sprint trips).
// ---------------------------------------------------------------------------

export const FAKE_FLOOR = {
  // Lift cuboid this many metres above the raycasted real floor. 5cm is
  // enough to hide micro-bumps without the player feeling elevated.
  lift: Number(params.get('floorlift') ?? 0.05),
  // Cuboid half-thickness in Y. Total slab height = halfY × 2 = 0.5m.
  // Thick enough that a 1m capsule can't tunnel through during a fall.
  halfY: 0.25,
  // Cuboid covers this fraction of bbox XZ. 90% so the slab doesn't cut
  // into walls — the wall trimesh still handles wall collisions.
  coverage: 0.9,
  // Show the textured marble slab? Off = invisible physics-only floor (the
  // splat's own floor is what the camera sees). Recommended on for indoor
  // scenes (cathedral, dungeon), off for outdoor (forest, courtyard) where
  // the splat ground reads better.
  visible: params.get('fakefloor') !== 'hidden',
  // CC0 marble from Polyhaven — neutral enough to blend with most
  // architectural styles. Override with FAKE_FLOOR.textureUrl per game.
  textureUrl: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/marble_01/marble_01_diff_1k.jpg',
  // Tile pattern repeats per metre (0.5 = one tile per 2m).
  tilesPerMetre: 0.5,
};

// ---------------------------------------------------------------------------
// Splat — Spark 2.0 SparkRenderer + per-mesh LoD config.
// ---------------------------------------------------------------------------

export const SPLAT = {
  /**
   * Quality strategy:
   *   'mini'        — load 100k tier only (mobile default — 1.4 MB)
   *   'low'         — load 500k tier only (desktop default — 7.8 MB, looks great)
   *   'full'        — load full tier directly (67 MB, slow boot, no swap)
   *   'progressive' — load 500k first, swap to full in background. The swap
   *                    causes a multi-second main-thread stutter from Spark's
   *                    LoD-tree build on 4.32M splats, plus an apparent
   *                    "downgrade" while the LoD ranker re-picks splats from
   *                    the larger source. Off by default — opt in for hero
   *                    shots / cinematic recordings.
   */
  quality: params.get('quality') ?? (DEVICE.isMobile ? 'mini' : 'low'),

  // Spark 2.0 renderer settings (verified against
  // node_modules/@sparkjsdev/spark/dist/types/SparkRenderer.d.ts):
  preBlurAmount:     0.1,                  // gentle softening — default 0.0
  minPixelRadius:    1,                    // skip sub-pixel splats
  maxPixelRadius:    DEVICE.isMobile ? 256 : 384,  // clamp huge near splats
  maxStdDev:         Math.sqrt(6.5),       // tighter kernel than default √8
  minSortIntervalMs: 16,                   // cap radial sort to ~60Hz
  // lodSplatScale: budget multiplier on Spark's auto platform detection.
  // Spark itself defaults to 500k (XR) / 1-1.5M (mobile) / 2.5M (desktop).
  lodSplatScale: Number(params.get('lodScale') ?? (DEVICE.isMobile ? 0.7 : 1.0)),
  // Don't pass: enableLod (default true), sortRadial (default true)
};

// ---------------------------------------------------------------------------
// Post-processing — bloom + split-tone grade + vignette + grain. Cinematic
// PS2-Souls vibe out of the box. THE single line that makes this affordable
// on retina is `composer.setPixelRatio(1)` in PostPipeline (saves ~12.8 ms /
// frame on a 1920×1080 retina display vs full-DPR composer).
// ---------------------------------------------------------------------------

export const POST = {
  enabled: params.get('post') !== '0',
  // Bloom — picks up bright spots in the splat (stained glass, sun shafts).
  // Threshold 0.45 (was 0.55) lets midtones contribute too, so the scene
  // reads more luminous instead of "dark with a few hot spots".
  bloomStrength:  DEVICE.isMobile ? 0.35 : 0.45,
  bloomRadius:    DEVICE.isMobile ? 0.5  : 0.7,
  bloomThreshold: DEVICE.isMobile ? 0.55 : 0.45,
  // Grade — cool shadows, warm highlights, MILD contrast lift. Tuned for a
  // generic template (most genres want legible scenes); flip to the
  // splats-demo Souls-dark via .post-souls config preset (TODO).
  saturation:        0.95,            // was 0.88 — slightly more chroma
  contrast:          1.05,            // was 1.12 — lighter touch
  shadowTint:        [0.92, 0.96, 1.05],  // was [0.78, 0.88, 1.05] — much less crush
  highlightTint:     [1.10, 1.02, 0.92],  // was [1.18, 1.02, 0.82] — less amber
  vignetteStart:     0.55,            // was 0.42 — vignette starts further out
  vignetteEnd:       1.05,
  vignetteStrength:  0.40,            // was 0.85 — half as heavy
  grain:             0.018,           // was 0.025 — subtle
};

// ---------------------------------------------------------------------------
// Lightness — baked grid of splat luminance, sampled at runtime to modulate
// envMapIntensity on dynamic PBR meshes (character, weapons, NPCs). Without
// this, characters look like cardboard cutouts pasted onto a photoreal
// background — they don't dim in shadow or brighten in light shafts.
//
// One-time bake via ?bake=lightness URL param. ~30s, produces ~40KB JSON.
// ---------------------------------------------------------------------------

export const LIGHTNESS = {
  enabled: params.get('lightness') !== '0',
  /** Per-world bake path. Falls back to /lightness.json if not present. */
  path:         `/${slug}-lightness.json`,
  fallbackPath: '/lightness.json',
  // Probe at floor + 1m — average eye-level for a 1.7m character.
  probeHeightAboveFloor: 1.0,
  cellSize: 1.0,
  faceResolution: 16,
  // envMapIntensity multipliers — clamp the dynamic range of modulation.
  attachMin: 0.15,
  attachMax: 1.4,
};

// ---------------------------------------------------------------------------
// Lighting — Souls-style PBR lighting for the fake floor + dynamic meshes.
// The splat carries its own baked lighting; these only affect non-splat geometry.
//
// Pattern: dim cool ambient/hemi for the deep-shadow baseline + one strong
// warm directional ("stained-glass sun") angled NOT vertical so cast shadows
// fall on the floor at a flattering angle, not flat under the character.
// ---------------------------------------------------------------------------

export const LIGHTING = {
  // Cool flat baseline. Sits under the warm key so unlit sides of dynamic
  // meshes don't go pure black. 0.85 (was 0.55) gives a more legible scene
  // for non-Souls genres.
  ambient:  { color: 0x9098b0, intensity: 0.85 },
  // Cool sky over neutral-cool ground — fills areas the directional doesn't
  // reach. Brighter sky tone + brighter intensity for legibility.
  hemi:     { sky: 0xa0b0c8, ground: 0x607078, intensity: 0.85 },
  // Warm key — neutral-warm white instead of strong amber. 1.6 (was 2.2)
  // because we boosted ambient/hemi; total light energy similar but more
  // diffused.
  sun:      { color: 0xfff0d8, intensity: 1.6 },
  // Shadow camera covers the playable area sized from bbox. Small map on
  // mobile (4× cheaper depth render). The camera is centred at bbox centre
  // with halfX = halfZ = min(size.x, size.z) * shadowCoverage.
  shadowCoverage:    0.6,
  shadowMapSize:     DEVICE.isMobile ? 512 : 1024,
  shadowBias:       -0.00025,
  shadowNormalBias:  0.04,
  shadowRadius:      3.0,
};

// ---------------------------------------------------------------------------
// Renderer / scene defaults.
// ---------------------------------------------------------------------------

export const RENDERER = {
  // FOV 60° matches the splats-demo "filmic" framing better than the typical
  // game-engine 70-75°. Override per-game via Constants extension if needed.
  fov: 60,
  near: 0.05,
  far: 1500,
  // Sky / clear color. Should match scene fog colour (added in step 9) so the
  // horizon never cracks open into a different colour where coverage ends.
  background: 0x0a0c14,
  // Tone mapping exposure. 1.0 (was 0.85) lifts the whole frame ~17%; the
  // splats demo used 0.85 for that crushed Souls-dark feel, but as a
  // template default 1.0 reads better across genres.
  toneMappingExposure: Number(params.get('exposure') ?? 1.0),
};

// ---------------------------------------------------------------------------
// Physics — Rapier 3D fixed-step config + capsule + gravity.
// ---------------------------------------------------------------------------

export const PHYSICS = {
  // World gravity (m/s²). Earth-y. Easy to stylize per-game (low gravity for
  // floaty platformer, very high for tactical FPS).
  gravity: { x: 0, y: -22, z: 0 },
  // Fixed timestep (60 Hz). Render loop accumulates dt; up to maxSubsteps
  // catch-up steps run per frame to bound the spiral of death.
  timestep: 1 / 60,
  maxSubsteps: 4,
};

export const CAPSULE = {
  // Total capsule height = (halfHeight + radius) × 2  =  (0.25 + 0.25) × 2 = 1m.
  halfHeight: 0.25,
  radius:     0.25,
  // KinematicCharacterController offset — sub-mm sliver between capsule and
  // surfaces, prevents penetration artifacts. 8cm is the splats-demo value.
  controllerOffset: 0.08,
  snapToGround:     0.4,
  autostepHeight:   0.6,
  autostepWidth:    0.25,
  maxSlopeClimb:    55 * Math.PI / 180,
  minSlopeSlide:    45 * Math.PI / 180,
  // Eye sits this far above the capsule centre. With halfHeight=0.25 +
  // radius=0.25 the capsule top is at centre + 0.5; eye at +0.35 means a
  // bit below the top — mirrors a 1.7m human's eye position naturally.
  eyeOffsetY: 0.35,
};

// ---------------------------------------------------------------------------
// Character — animated GLB rendered at the capsule's position. The capsule
// itself stays as the physics body; this is just the visible model.
//
// Three presets shipped: 'robot' (RobotExpressive, ~5k tris, low-poly stylized,
// MIT-licensed Three.js example), 'soldier' (Soldier.glb, ~14k tris, realistic
// PBR, also MIT), 'xbot' (Xbot.glb, ~12k tris, neutral grey reference rig).
// Default 'robot' for perf.
//
// Switch via ?character=robot|soldier|xbot|0  (0 = no character, capsule
// placeholder stays visible).
// ---------------------------------------------------------------------------

// facingOffset note: in this template's CameraMode convention, character
// rotation.y = (camera yaw) + facingOffset. At yaw=0 the camera looks down
// -Z, so we want the character to also face -Z. If the model defaults to
// facing -Z, offset = 0; if +Z, offset = π.
//
//   GLB:  Soldier / Xbot face -Z (offset 0); RobotExpressive faces +Z (π)
//   VRM:  three-vrm rotates 0.x assets to +Z-front via VRMUtils.rotateVRM0,
//         so all VRMs effectively face +Z by the time we see them → offset π
//
// VRMs ship without animations — `clipMap` paths point to Mixamo FBX clips
// that get retargeted onto the VRM's normalized humanoid at load time.
// Replace `glb` field with `vrm` to opt into the VRM path.
//
// To use a custom avatar from opensourceavatars.com (CC0 VRMs):
//   1. Download .vrm from https://www.opensourceavatars.com/en/gallery
//   2. Drop into public/assets/models/
//   3. Reference via ?character=custom or add a preset here
const CHARACTER_PRESETS = {
  robot: {
    glb: '/assets/models/RobotExpressive.glb',
    clipMap: { idle: 'Idle', walk: 'Walking', run: 'Running' },
    facingOffset: Math.PI,
    scale: 1.0,
  },
  soldier: {
    glb: '/assets/models/Soldier.glb',
    clipMap: { idle: 'Idle', walk: 'Walk', run: 'Run' },
    facingOffset: 0,
    scale: 1.0,
  },
  xbot: {
    glb: '/assets/models/Xbot.glb',
    clipMap: { idle: 'idle', walk: 'walk', run: 'run' },
    facingOffset: 0,
    scale: 1.0,
  },
  // VRM preset — uses Mixamo FBX animations retargeted to the VRM skeleton.
  // Cathedral arena ships the full souls anim set so a single AnimatedCharacter
  // mixer can drive locomotion + combat states.
  vrm: {
    vrm: '/assets/models/bloody.vrm',
    clipMap: {
      idle:        '/assets/animations/idle.fbx',
      walk:        '/assets/animations/walk.fbx',
      run:         '/assets/animations/run.fbx',
      lightAttack: '/assets/animations/light-attack.fbx',
      heavyAttack: '/assets/animations/heavy-attack.fbx',
      block:       '/assets/animations/block.fbx',
      roll:        '/assets/animations/roll.fbx',
      hit:         '/assets/animations/hit.fbx',
      death:       '/assets/animations/death.fbx',
    },
    facingOffset: Math.PI,
    scale: 1.0,
  },
};
const charStyle = params.get('character');
const _preset = CHARACTER_PRESETS[charStyle] || CHARACTER_PRESETS.vrm;
export const CHARACTER = {
  enabled: charStyle !== '0',
  ..._preset,
  // Convenience field — auto-derived URL of the model (whether glb or vrm).
  url: _preset.glb || _preset.vrm,
  // 0.3s crossfade — quick enough to feel snappy, smooth enough to not pop
  fadeMs: 300,
};

// ---------------------------------------------------------------------------
// Player movement — base speeds. Final speed = base × WORLD.userScale so a
// 3× cathedral doesn't feel glacial. Jump scales by √userScale so apex
// stays a fixed fraction of ceiling height.
// ---------------------------------------------------------------------------

export const PLAYER = {
  walkSpeed:        5.0,            // m/s at userScale=1
  sprintMultiplier: 2.0,
  jumpSpeed:        6.5,            // m/s at userScale=1; scales √userScale
  // Mouse-look sensitivity — radians per pixel of mouse movement.
  mouseSensitivity: 0.0025,
  // Touch-look sensitivity — touch deltas tend to be larger than mouse
  // movement (finger drag is slower but covers more pixels), so dial down.
  touchSensitivity: 0.006,
  // Pitch clamp — prevents looking straight up/down (which inverts WASD).
  pitchMin: -1.2,
  pitchMax:  0.8,
};

// ---------------------------------------------------------------------------
// Camera — 1st/3rd-person/topdown/side. Switch via ?cam=first|third|topdown|side.
// Default 'third' (third-person orbit) since it's the most universally useful
// for the genre examples (souls, RuneScape, gigachad-lift). TCG would use
// 'topdown'; side-scroller-style minigames would use 'side'.
// ---------------------------------------------------------------------------

const camMode = params.get('cam') || 'third';
export const CAMERA = {
  mode: ['first', 'third', 'topdown', 'side'].includes(camMode) ? camMode : 'third',
  // Third-person orbit distance. Scales by √userScale so the camera doesn't
  // clip walls in tiny rooms or float infinitely far in huge ones.
  // 3.4m matches souls-demo — close enough for over-the-shoulder combat reads
  // but far enough to see incoming swings.
  thirdDistance: Number(params.get('camDist') ?? 3.4),
  // Top-down camera height above the player (in world units). Scales like
  // distance.
  topdownHeight: Number(params.get('camHeight') ?? 12),
  // Side-camera offset (along +X by default). Negative = camera on -X side.
  sideOffset:    Number(params.get('camSide') ?? 6),
};

// ---------------------------------------------------------------------------
// HUD config.
// ---------------------------------------------------------------------------

export const HUD = {
  // Show FPS counter? Off with ?hud=0.
  enabled: params.get('hud') !== '0',
  // Frames sampled for the rolling FPS average. Larger = smoother number.
  fpsSamples: 30,
  // FPS thresholds for color-coding the counter.
  fpsWarn: 60,
  fpsBad: 30,
};

// ---------------------------------------------------------------------------
// Cathedral arena gameplay tuning
// ---------------------------------------------------------------------------

export const ARENA = {
  // Spawn points are placed evenly on a circle of this radius around the
  // cathedral's bbox centre, on the fake-floor surface.
  SPAWN_RADIUS: 6,
};

export const COMBAT = {
  MAX_HP: 100,
  ATTACK_DAMAGE: 25,
  HEAVY_DAMAGE: 45,
  ATTACK_REACH: 2.0,                    // metres
  ATTACK_CONE_RAD: (60 * Math.PI) / 180, // 60° total cone (±30° from facing)
  ATTACK_COOLDOWN_MS: 600,
  RESPAWN_DELAY_MS: 3000,
  // 0.0 = no mitigation, 1.0 = full block. 0.75 = 75% damage soaked when blocking.
  BLOCK_MITIGATION: 0.75,
};

export const MULTIPLAYER = {
  // Override via ?server=ws://localhost:1999 or VITE_MULTIPLAYER_SERVER
  SERVER_URL:
    params.get('server') ??
    import.meta.env?.VITE_MULTIPLAYER_SERVER ??
    'http://localhost:1999',
  DEFAULT_ROOM: params.get('room') ?? 'cathedral',
  TICK_RATE_HZ: 30,
  REMOTE_LERP_TAU: 0.12,                // smoothing for remote position lerp (sec)
  STALE_PEER_MS: 8000,                  // drop peers we haven't heard from in 8s
};

// ---------------------------------------------------------------------------
// URL params — read directly here so subsystems share a single parser.
// ---------------------------------------------------------------------------

export const URL_PARAMS = params;
