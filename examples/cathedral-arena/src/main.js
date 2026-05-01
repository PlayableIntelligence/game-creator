/**
 * main.js — boot orchestrator.
 *
 * Step 2 scope: load splat world via WorldLoader. The placeholder cube is
 * gone; instead the cathedral splat renders right-side-up at user scale.
 * No physics, no character, no input yet.
 */
import * as THREE from 'three';
import { createRenderer, createScene, createCamera, attachResize } from './render/Renderer.js';
import { installLighting } from './render/Lighting.js';
import { PostPipeline } from './render/PostPipeline.js';
import { Physics } from './world/Physics.js';
import { loadWorld } from './world/WorldLoader.js';
import { bakeLightnessGrid, downloadGrid } from './world/BakeLightness.js';
import { Capsule } from './player/Capsule.js';
import { InputRouter } from './player/InputRouter.js';
import { MobileControls } from './player/MobileControls.js';
import { CameraMode } from './player/CameraMode.js';
import { Game } from './game/Game.js';
import { raycastPointer } from './game/raycast.js';
import { HUD } from './ui/HUD.js';
import { GameState } from './core/GameState.js';
import { EventBus, EVENTS } from './core/EventBus.js';
import { WORLD, LIGHTNESS, POST, URL_PARAMS, DEVICE } from './core/Constants.js';

// ---------------------------------------------------------------------------
// Renderer + scene + camera
// ---------------------------------------------------------------------------

const canvas   = document.getElementById('canvas');
const renderer = createRenderer(canvas);
const scene    = createScene();
const camera   = createCamera();
const hud      = new HUD();

let post = null;

attachResize(renderer, camera, (w, h) => {
  post?.setSize(w, h);
});
HUD.logDeviceProfile();

// Input router — keyboard + mouse + touch unified. Mounted before any
// player object so the Capsule can read input on first fixedUpdate.
const input = new InputRouter(canvas);

// Mobile controls — virtual joystick + look pad + buttons. No-op on desktop.
const mobile = new MobileControls(input);

// Lighting installed AFTER world load (needs bbox for shadow camera size).

// ---------------------------------------------------------------------------
// Boot — load world
// ---------------------------------------------------------------------------

let world;
let physics;
let capsule;
let cameraMode;
let game;

(async () => {
  try {
    HUD.setBootStatus('Initializing physics…');
    physics = await Physics.create();

    HUD.setBootStatus('Loading world…');
    world = await loadWorld(scene, renderer, physics, HUD.setBootStatus);

    // Now install lighting — needs the world bbox for bbox-scaled shadow cam
    HUD.setBootStatus('Installing lighting…');
    installLighting(scene, world.collider.bbox);

    // Post pipeline — bloom + grade + vignette + grain. The composer
    // setPixelRatio(1) trick saves ~12.8ms/frame on retina.
    if (POST.enabled) {
      HUD.setBootStatus('Installing post pipeline…');
      post = new PostPipeline(renderer, scene, camera, window.innerWidth, window.innerHeight);
    }

    // Spawn the kinematic capsule at bbox centre, feet on fake floor top.
    HUD.setBootStatus('Spawning capsule…');
    const ctr = world.collider.bbox.getCenter(new THREE.Vector3());
    capsule = new Capsule(physics, scene, {
      x: ctr.x,
      y: world.fakeFloor.topY,
      z: ctr.z,
    });

    // Wire input + camera mode → capsule. Camera mode raycasts against
    // the collider's wall mesh (already loaded, hidden Group) for accurate
    // spring-arm clamping in 3rd-person — independent of bbox shape, works
    // for asymmetric/thick/complex room geometry.
    cameraMode = new CameraMode(camera, capsule, physics, {
      colliderRoot:  world.collider.debug,
      fakeFloorTopY: world.fakeFloor.topY,
      ceilingY:      world.collider.bbox.max.y,
      wallOffset:    0.4,
    });
    capsule.input = input;
    capsule.cameraMode = cameraMode;

    // Instantiate the cathedral-arena Game class and fire lifecycle hooks.
    game = new Game();
    game.onWorldLoaded({ scene, world, physics, camera, hud });
    game.onPlayerSpawn({ capsule, character: capsule.character });

    // Click/tap → raycast against collider → game.onClick(hit | null)
    canvas.addEventListener('pointerdown', (e) => {
      // Skip the first click (it triggers pointer lock) — only fire onClick
      // once we're already locked, OR on touch primary (mobile is "always
      // interactive"). This stops the lock-triggering click from
      // accidentally placing markers / firing weapons / etc.
      if (!GameState.pointerLocked && !DEVICE.isTouchPrimary) return;
      const hit = raycastPointer(e, camera, world.collider.debug, GameState.pointerLocked);
      game.onClick(hit);
    });

    // Keyboard → game.onKeyDown(code). Mobile gets a separate path (touch
    // buttons → InputRouter → game-specific). For desktop the unified
    // listener works.
    window.addEventListener('keydown', (e) => {
      // Skip keys the input router needs (movement) so onKeyDown only sees
      // gameplay keys (E to interact, F to attack, R to reset, etc.)
      if (['KeyW','KeyA','KeyS','KeyD','Space','ShiftLeft','ShiftRight'].includes(e.code)) return;
      game.onKeyDown(e.code);
    });

    GameState.booted = true;
    HUD.setBootStatus(`Ready — ${WORLD.slug}`);
    HUD.dismissBoot();
    EventBus.emit(EVENTS.BOOT_READY);

    // ?bake=lightness — one-time offline bake. Hide debug overlay + fake
    // floor so the probe camera sees only splats. Saves <slug>-lightness.json.
    if (URL_PARAMS.get('bake') === 'lightness') {
      // Wait one render frame so the splat is fully on screen
      await new Promise((r) => setTimeout(r, 500));
      console.info('[main] starting lightness bake…');
      HUD.setBootStatus('Baking lightness…');
      const probeY = world.fakeFloor.topY + LIGHTNESS.probeHeightAboveFloor;
      const grid = await bakeLightnessGrid({
        scene, renderer,
        bbox: world.collider.bbox,
        probeY,
        hideDuringBake: [
          world.collider.debug,
          world.fakeFloor.mesh,
        ].filter(Boolean),
        cell:    LIGHTNESS.cellSize,
        faceRes: LIGHTNESS.faceResolution,
        onProgress: (done, total, value) => {
          if (done % 16 === 0 || done === total) {
            HUD.setBootStatus(`Baking ${done}/${total} (${value.toFixed(2)})`);
          }
        },
      });
      downloadGrid(grid, `${WORLD.slug}-lightness.json`);
      console.info(`[main] bake complete — saved ${WORLD.slug}-lightness.json`);
      HUD.setBootStatus(`Saved ${WORLD.slug}-lightness.json — drop in public/, reload without ?bake=`);
    }
  } catch (err) {
    console.error('[main] boot failed:', err);
    GameState.bootError = err.message;
    HUD.setBootStatus(`Failed: ${err.message}`);
    EventBus.emit(EVENTS.BOOT_FAILED, err);
  }
})();

// ---------------------------------------------------------------------------
// Render loop — same renderer.info.reset() pattern as step 1
// ---------------------------------------------------------------------------

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();

  // Step physics first — fixed-step, calls capsule.fixedUpdate per substep.
  // Game.onFixedUpdate runs in the same callback so gameplay logic sees
  // identical timesteps regardless of render rate.
  physics?.step(dt, (fdt) => {
    capsule?.fixedUpdate(fdt);
    game?.onFixedUpdate(fdt);
  });

  capsule?.syncMesh(dt);
  cameraMode?.update();
  game?.onUpdate(dt);

  // info.reset() before render so the HUD reports actual scene work, not
  // post's final 2-triangle blit. Same pattern whether post is on or off.
  renderer.info.reset();
  if (post) {
    post.render(dt);
  } else {
    renderer.render(scene, camera);
  }
  hud.setRenderStats(renderer.info.render.calls, renderer.info.render.triangles);

  hud.update(dt);
});

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------

window.render_game_to_text = function () {
  const bbox = GameState.worldBbox;
  const p = GameState.player;
  return JSON.stringify({
    step: 5,
    booted: GameState.booted,
    error: GameState.bootError,
    world: GameState.worldMeta?.slug || null,
    worldLoaded: GameState.worldLoaded,
    floorY: GameState.worldFloorY?.toFixed?.(2) ?? null,
    fakeFloorTopY: GameState.fakeFloorTopY?.toFixed?.(2) ?? null,
    bboxSize: bbox ? {
      x: (bbox.max.x - bbox.min.x).toFixed(1),
      y: (bbox.max.y - bbox.min.y).toFixed(1),
      z: (bbox.max.z - bbox.min.z).toFixed(1),
    } : null,
    colliderTriangles: GameState.colliderTriangles,
    player: p ? {
      x: p.position.x.toFixed(2),
      y: p.position.y.toFixed(2),
      z: p.position.z.toFixed(2),
      grounded: p.grounded,
    } : null,
  }, null, 2);
};

window.advanceTime = (ms) => new Promise((r) => setTimeout(r, ms));
