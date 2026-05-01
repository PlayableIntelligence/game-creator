import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RAPIER } from './Physics.js';
import { COLLIDER } from '../core/Constants.js';

/**
 * Collision — load Marble's collider GLB, apply the same world transform as
 * the splat, raycast for floor Y, and build a debug wireframe.
 *
 * Step 3 scope: NO physics. We just inspect the GLB. Step 5 will add a
 * Rapier static trimesh body using the same cached fetch.
 *
 * The fetched GLB is cached so step 5's Rapier-aware loader doesn't re-download
 * the 3.3 MB asset. Cache key includes the matrix elements so different
 * transforms get separate caches (rare, but correct).
 *
 * Source pattern: ported from splats-repo collision.ts, simplified by
 * splitting "peek" (this file) and "bake-trimesh" (step 5) into separate
 * functions.
 */

const _cache = new Map(); // key: url::matrix.elements.join(',')  →  Promise<{scene, bbox}>

async function fetchAndPrepare(url, worldTransform) {
  const key = `${url}::${worldTransform.elements.join(',')}`;
  let p = _cache.get(key);
  if (p) return p;

  p = (async () => {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;
    root.applyMatrix4(worldTransform);
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    return { root, bbox };
  })();
  _cache.set(key, p);
  return p;
}

/**
 * Inspect the collider — get its world-space bbox + actual floor Y.
 *
 * Why we raycast instead of using bbox.min.y: the collider includes the real
 * scanned floor (which usually sits a few cm above bbox.min — Marble pads
 * the bbox slightly). The raycast from bbox centre downward hits the highest
 * surface directly below the centre, which IS the floor.
 *
 * Returns:
 *   {
 *     bbox       : THREE.Box3       (world-space, post-transform)
 *     floorY     : number           (world-space y of the actual floor)
 *     debug      : THREE.Group      (green wireframe — add to scene if you want it)
 *     triangles  : number           (informational, for HUD/debug)
 *   }
 */
export async function peekColliderInfo(url, worldTransform) {
  const { root, bbox } = await fetchAndPrepare(url, worldTransform);

  // Raycast down from bbox centre to find actual floor Y
  const ctr = bbox.getCenter(new THREE.Vector3());
  const ray = new THREE.Raycaster(
    new THREE.Vector3(ctr.x, ctr.y, ctr.z),
    new THREE.Vector3(0, -1, 0),
  );
  const hits = ray.intersectObject(root, true);
  const floorY = hits.length > 0
    ? hits[0].point.y
    : (COLLIDER.fallbackToBboxMinY ? bbox.min.y : 0);

  // Build wireframe group from the same world-space data so the debug view
  // matches the physics view exactly. We re-use the loaded scene's geometry
  // but with a green wireframe material — no copy of vertex data needed.
  const debug = new THREE.Group();
  debug.name = 'collision-debug';
  debug.visible = COLLIDER.showWireframe;

  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    wireframe: true,
    transparent: true,
    opacity: 0.55,                    // bumped from 0.25 — was invisible against splat
    depthTest: false,                 // splats don't always write depth; force on top
    depthWrite: false,
  });

  let triangles = 0;
  root.traverse((obj) => {
    if (obj.isMesh) {
      const wire = new THREE.Mesh(obj.geometry, wireMat);
      // root.applyMatrix4 + updateMatrixWorld baked the transform into
      // descendants' world matrices. Mirror that into the wireframe by
      // disabling auto-update and copying matrixWorld directly.
      wire.matrixAutoUpdate = false;
      wire.matrix.copy(obj.matrixWorld);
      // Render after splat so it draws on top.
      wire.renderOrder = 999;
      debug.add(wire);

      const idx = obj.geometry.index;
      const count = idx ? idx.count : (obj.geometry.attributes.position?.count ?? 0);
      triangles += count / 3;
    }
  });

  console.info(
    `[Collider] ${triangles.toLocaleString()} tris · ` +
    `bbox (${bbox.min.x.toFixed(1)}, ${bbox.min.y.toFixed(1)}, ${bbox.min.z.toFixed(1)}) → ` +
    `(${bbox.max.x.toFixed(1)}, ${bbox.max.y.toFixed(1)}, ${bbox.max.z.toFixed(1)})  ` +
    `size ${(bbox.max.x - bbox.min.x).toFixed(1)}×${(bbox.max.y - bbox.min.y).toFixed(1)}×${(bbox.max.z - bbox.min.z).toFixed(1)} m  ` +
    `floor_y=${floorY.toFixed(2)}` + (hits.length === 0 ? ' (raycast missed; using bbox.min.y)' : ''),
  );

  return { bbox: bbox.clone(), floorY, debug, triangles };
}

/** Internal hook for step 5 — re-uses the cached fetch. Returns the prepared
 *  scene + bbox. Step 5's `loadCollision` will iterate root's meshes, bake
 *  vertices into a Float32Array, and hand to Rapier.world.createCollider. */
export async function _getPreparedCollider(url, worldTransform) {
  return fetchAndPrepare(url, worldTransform);
}

/**
 * Bake the collider GLB into a Rapier static trimesh body.
 *
 * Apply the SAME world transform the splat uses so render and physics
 * never drift. Optional `floorCullY` drops triangles whose all 3 vertices
 * sit below that Y — used to remove the bumpy real floor under the fake
 * floor cuboid (walls + ceiling, which span across the cut, survive intact).
 *
 * Returns:
 *   { body, triangles }   — body is the static Rapier rigid body
 */
export async function loadStaticTrimesh(url, physics, worldTransform, opts = {}) {
  const { floorCullY } = opts;
  const { root } = await fetchAndPrepare(url, worldTransform);

  const body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());

  let triangles = 0;
  const scratch = new THREE.Vector3();

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const positions = obj.geometry.attributes.position;
    if (!positions) return;

    // Bake world-space vertices once. Rapier wants a flat Float32Array.
    const verts = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
      scratch.fromBufferAttribute(positions, i).applyMatrix4(obj.matrixWorld);
      verts[i * 3 + 0] = scratch.x;
      verts[i * 3 + 1] = scratch.y;
      verts[i * 3 + 2] = scratch.z;
    }

    let srcIndices = obj.geometry.index
      ? new Uint32Array(obj.geometry.index.array)
      : Uint32Array.from({ length: positions.count }, (_, i) => i);

    // Floor-cull pre-pass: drop triangles with ALL THREE vertices below
    // floorCullY. Walls + ceiling (which span up across the cut) survive.
    if (floorCullY !== undefined) {
      const survivors = [];
      for (let t = 0; t < srcIndices.length; t += 3) {
        const y0 = verts[srcIndices[t    ] * 3 + 1];
        const y1 = verts[srcIndices[t + 1] * 3 + 1];
        const y2 = verts[srcIndices[t + 2] * 3 + 1];
        if (y0 >= floorCullY || y1 >= floorCullY || y2 >= floorCullY) {
          survivors.push(srcIndices[t], srcIndices[t + 1], srcIndices[t + 2]);
        }
      }
      srcIndices = new Uint32Array(survivors);
    }
    if (srcIndices.length === 0) return;

    physics.world.createCollider(
      RAPIER.ColliderDesc.trimesh(verts, srcIndices),
      body,
    );
    triangles += srcIndices.length / 3;
  });

  console.info(
    `[Collision] baked ${triangles.toLocaleString()} triangles into Rapier trimesh` +
    (floorCullY !== undefined ? ` (floor cull at y=${floorCullY.toFixed(2)})` : ''),
  );
  return { body, triangles };
}
