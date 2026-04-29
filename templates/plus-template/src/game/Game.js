import * as THREE from 'three';
import { spawnAsset, loadAsset } from '../assets/AssetLoader.js';
import { loadMeshy } from '../assets/MeshyLoader.js';

/**
 * Game — the gameplay surface. THIS is where you write your game.
 *
 * Everything outside `src/game/` is reusable infrastructure (world loading,
 * physics, character, post-processing, etc.). Game.js is yours.
 *
 * Hooks fire in this order:
 *
 *   1.  onWorldLoaded({ scene, world, physics, camera, hud })
 *         Fires after the splat + collider + fake floor + lighting + post are
 *         all up. Use this to spawn boss/props/items, attach HUD widgets,
 *         init game state.
 *
 *   2.  onPlayerSpawn({ capsule, character })
 *         Fires once the kinematic capsule lands on the floor. Use this to
 *         attach gameplay state to the player (HP, inventory, deck, etc.).
 *
 *   3.  onClick({ point, object, distance, normal, locked })   [continuous]
 *         Fires on canvas click (desktop) or tap (mobile). `point` is the
 *         world-space hit on the collider. `locked` tells you if the
 *         pointer is currently locked.
 *
 *   4.  onKeyDown(code)                                         [continuous]
 *         Fires on keydown. `code` is the KeyboardEvent.code (KeyE, KeyF, etc).
 *
 *   5.  onUpdate(dt)                                            [every frame]
 *         Per-render-frame tick. Use for animations, AI, anything visual.
 *
 *   6.  onFixedUpdate(dt)                                       [60Hz fixed]
 *         Per-physics-step tick (1/60 s, decoupled from render rate). Use
 *         for deterministic physics-coupled logic (projectile motion,
 *         enemy-vs-player checks).
 *
 * Genre starting points (see plus-template README for full details):
 *
 *   - Souls battle    → spawn boss in onWorldLoaded; sword swing in onKeyDown('KeyF');
 *                        damage check in onFixedUpdate vs hitboxes
 *   - Tree-chop RPG   → scatter trees in onWorldLoaded; harvest in onClick
 *                        when target is a tree; inventory in HUD slot
 *   - TCG sim         → fixed top-down camera (?cam=topdown); cards as 2D
 *                        in #hud-bl; raycast in onClick to detect drops
 *   - Tap-to-lift gym → ?cam=side; counter += 1 in onClick (no raycast needed);
 *                        progress bar in HUD
 *
 * The default Game class ships with a tiny demo: click anywhere on the
 * cathedral floor → spawns a glowing red marker sphere at the hit point.
 * Replace this with your own logic.
 */
export class Game {
  constructor() {
    this.scene = null;
    this.world = null;
    this.physics = null;
    this.camera = null;
    this.hud = null;
    this.capsule = null;
    this.character = null;
    // Demo state — game-specific code lives here
    this._demoMarkers = [];
    this._demoMarkerPool = null;
  }

  // ------- Lifecycle hooks --------------------------------------------

  /** World loaded. Spawn props, init state. */
  async onWorldLoaded({ scene, world, physics, camera, hud }) {
    this.scene = scene;
    this.world = world;
    this.physics = physics;
    this.camera = camera;
    this.hud = hud;

    // Demo HUD widget — bottom-left counter
    const slot = hud.getSlot('bl');
    if (slot) {
      const widget = document.createElement('div');
      widget.id = 'demo-counter';
      widget.style.opacity = '0.85';
      widget.textContent = 'click — place marker · markers: 0';
      slot.appendChild(widget);
      this._demoCounter = widget;
    }

    // Spawn the Meshy-generated anvil at bbox center, on the fake floor.
    // Demo of the MeshyLoader — meta.json points at the GLB; loader caches
    // both. Replace `/assets/meshy/anvil/anvil.meta.json` with any other
    // Meshy generation to swap the prop.
    try {
      const anvil = await loadMeshy('/assets/meshy/anvil/anvil.meta.json');
      const ctr = world.collider.bbox.getCenter(new THREE.Vector3());
      // Place 5m IN FRONT of player spawn (camera default looks down -Z, so
      // negative Z is forward), 1m to the side so it's clearly visible
      // without overlapping. Meshy outputs at ~1m height; scale 2× reads as
      // a forge anvil (~2m).
      spawnAsset(anvil, scene, {
        position: [ctr.x + 1, world.fakeFloor.topY, ctr.z - 5],
        rotation: [0, Math.PI / 4, 0],   // horn pointing toward camera
        scale: 2.0,
        physics,             // ← pass physics so withCollider works
        withCollider: true,  // axis-aligned cuboid sized from bbox; player can't walk through
      });
      console.info('[Game] meshy anvil spawned with collider');
    } catch (err) {
      console.warn('[Game] anvil spawn failed:', err.message);
    }
  }

  /** Player capsule has landed on the floor. */
  onPlayerSpawn({ capsule, character }) {
    this.capsule = capsule;
    this.character = character;
  }

  /** Click/tap on canvas. `hit` may be null if the ray missed all geometry. */
  onClick(hit) {
    if (!hit) return;
    this._spawnDemoMarker(hit.point);
    if (this._demoCounter) {
      this._demoCounter.textContent = `click — place marker · markers: ${this._demoMarkers.length}`;
    }
  }

  /** Keydown (KeyboardEvent.code). */
  onKeyDown(code) {
    if (code === 'KeyR') {
      // Demo: clear all markers
      for (const m of this._demoMarkers) {
        m.parent?.remove(m);
        m.geometry?.dispose();
        m.material?.dispose();
      }
      this._demoMarkers.length = 0;
      if (this._demoCounter) this._demoCounter.textContent = 'click — place marker · markers: 0';
    }
  }

  /** Per-render-frame tick. */
  onUpdate(dt) {
    // Demo: pulse marker emissive over time so they're visible
    const t = performance.now() * 0.001;
    const pulse = 0.6 + 0.4 * Math.sin(t * 3);
    for (const m of this._demoMarkers) {
      if (m.material?.emissiveIntensity !== undefined) {
        m.material.emissiveIntensity = pulse;
      }
    }
  }

  /** Per-physics-step tick (60Hz fixed). */
  onFixedUpdate(_dt) {
    // game-specific physics-coupled logic
  }

  // ------- Demo helpers (delete when writing your own game) -----------

  _spawnDemoMarker(point) {
    if (!this._demoMarkerPool) {
      this._demoMarkerPool = new THREE.SphereGeometry(0.15, 16, 12);
    }
    const mat = new THREE.MeshStandardMaterial({
      color:     0xff5566,
      emissive:  0xff5566,
      emissiveIntensity: 1.0,
      roughness: 0.4,
      metalness: 0.0,
    });
    const marker = new THREE.Mesh(this._demoMarkerPool, mat);
    marker.position.copy(point);
    // Lift slightly off surface so it doesn't z-fight with the splat/floor
    marker.position.y += 0.1;
    marker.castShadow = true;
    this.scene.add(marker);
    this._demoMarkers.push(marker);
  }
}
