import { SparkRenderer } from '@sparkjsdev/spark';
import { buildSplatTransform } from './SplatTransform.js';
import { loadSplat } from './SplatLoader.js';
import { peekColliderInfo, loadStaticTrimesh } from './Collision.js';
import { installFakeFloor } from './FakeFloor.js';
import { LightnessSampler } from './LightnessSampler.js';
import { WORLD, SPLAT, DEVICE, LIGHTNESS } from '../core/Constants.js';
import { EventBus, EVENTS } from '../core/EventBus.js';
import { GameState } from '../core/GameState.js';

/**
 * WorldLoader — public entry: loadWorld(scene, renderer)
 *
 * Step 2 scope:
 *   1. Fetch meta.json
 *   2. Compute splat transform from semantics
 *   3. Add SparkRenderer to scene (mandatory — must be added BEFORE any SplatMesh)
 *   4. Load splat tier(s) based on device
 *
 * Later steps will extend the returned object with collider, fakeFloor,
 * splatFog, mirror, lightness etc.
 */
export async function loadWorld(scene, renderer, physics, onStatus) {
  const status = onStatus || (() => {});

  // ----- 1. Metadata -------------------------------------------------------
  status('Loading metadata…');
  const metaRes = await fetch(WORLD.paths.meta);
  if (!metaRes.ok) {
    throw new Error(`world meta not found at ${WORLD.paths.meta} (HTTP ${metaRes.status})`);
  }
  const meta = await metaRes.json();
  GameState.worldMeta = meta;
  console.info(`[WorldLoader] metadata loaded for "${meta.slug || WORLD.slug}"`);

  // ----- 2. Transform ------------------------------------------------------
  const xform = buildSplatTransform(meta);

  // ----- 3. SparkRenderer --------------------------------------------------
  // Settings copied verbatim from splats-demo for perf parity. Don't pass
  // defaults like enableLod/sortRadial here (verified default-true in .d.ts);
  // passing them is a no-op at best and noise at worst.
  const spark = new SparkRenderer({
    renderer,
    preBlurAmount:     SPLAT.preBlurAmount,
    minPixelRadius:    SPLAT.minPixelRadius,
    maxPixelRadius:    SPLAT.maxPixelRadius,
    maxStdDev:         SPLAT.maxStdDev,
    minSortIntervalMs: SPLAT.minSortIntervalMs,
    lodSplatScale:     SPLAT.lodSplatScale,
  });
  scene.add(spark);
  console.info(
    `[Spark] preBlur=${SPLAT.preBlurAmount} ` +
    `minPx=${SPLAT.minPixelRadius} maxPx=${SPLAT.maxPixelRadius} ` +
    `stdDev=√6.5 lodScale=${SPLAT.lodSplatScale} mobile=${DEVICE.isMobile} ` +
    `quality=${SPLAT.quality}`,
  );

  // ----- 4. Collider (peek, no physics yet) --------------------------------
  status('Analysing collider…');
  const collider = await peekColliderInfo(WORLD.paths.collider, xform.transform);
  scene.add(collider.debug);              // hidden unless ?wireframe=1
  GameState.worldBbox      = collider.bbox.clone();
  GameState.worldFloorY    = collider.floorY;
  GameState.colliderTriangles = collider.triangles;

  // ----- 5a. Fake floor (visual + Rapier static cuboid) --------------------
  status('Installing fake floor…');
  const fakeFloor = installFakeFloor(scene, physics, collider.bbox, collider.floorY);
  GameState.fakeFloorTopY = fakeFloor.topY;

  // ----- 5b. Walls / ceiling (Rapier static trimesh, floor-culled) ---------
  // Bake the collider GLB into a static trimesh body. floorCullY = top of
  // fake floor → all triangles below get dropped, so nothing pokes through.
  status('Baking collision trimesh…');
  await loadStaticTrimesh(WORLD.paths.collider, physics, xform.transform, {
    floorCullY: fakeFloor.topY,
  });

  // ----- 6. Splat ----------------------------------------------------------
  status('Loading splat…');
  const splat = await loadSplat(scene, xform.transform, (mesh) => {
    EventBus.emit(EVENTS.SPLAT_MESH_READY, mesh);
  });

  // ----- 7. Lightness sampler (loads bake if available; no-op otherwise) ---
  const lightness = new LightnessSampler();
  if (LIGHTNESS.enabled) {
    // Per-world bake first, fall back to shared. Both 404 silently.
    void lightness.load(LIGHTNESS.path, LIGHTNESS.fallbackPath);
  }

  GameState.worldLoaded = true;
  EventBus.emit(EVENTS.WORLD_LOADED, {
    meta,
    transform: xform.transform,
    scale: xform.scale,
    bbox: collider.bbox,
    floorY: collider.floorY,
    fakeFloorTopY: fakeFloor.topY,
  });

  return {
    spark,
    splat,
    collider,
    fakeFloor,
    lightness,
    transform: xform.transform,
    scale: xform.scale,
    meta,
  };
}
