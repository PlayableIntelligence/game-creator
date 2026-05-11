import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { RAPIER } from '../world/Physics.js';

/**
 * AssetLoader — universal GLB/GLTF loader.
 *
 * Single API for every asset source:
 *   - library GLBs (Soldier, Robot, etc.)
 *   - Meshy AI generations (use MeshyLoader for the meta.json wrapper)
 *   - third-party CC0 model packs (Quaternius, Kenney, etc.)
 *   - opensourceavatars.com VRMs (use AnimatedCharacter for those)
 *
 * Features:
 *   - URL-keyed cache so loading the same asset twice is free
 *   - SkeletonUtils.clone-aware spawn — instances share geometry but have
 *     independent skeletons + materials, so per-instance state (animation
 *     pose, envMap modulation) doesn't bleed across instances
 *   - Optional AnimationMixer per instance
 *   - Per-instance shadow / frustum / receive-shadow defaults match the
 *     character pipeline (cast=true, receive=false, frustum=false on skinned)
 *
 * Returns:
 *   loadAsset(url) → { gltf, model: Object3D, animations: AnimationClip[] }
 *
 * Spawn:
 *   spawnAsset(asset, scene, { position, rotation, scale, withMixer })
 *     → { instance, mixer? }
 */

const _cache = new Map();    // url → Promise<gltf>

const _loader = new GLTFLoader();

/**
 * Load + parse a GLB. Cached by URL — subsequent calls return the same
 * GLTF instance immediately. Use spawnAsset() to instance it into the scene.
 */
export function loadAsset(url) {
  if (_cache.has(url)) return _cache.get(url);
  const promise = _loader.loadAsync(url).then((gltf) => ({
    gltf,
    model:      gltf.scene,
    animations: gltf.animations || [],
    url,
  }));
  _cache.set(url, promise);
  return promise;
}

/**
 * Spawn one instance of a previously-loaded asset.
 *
 * @param {Object} asset — return value of loadAsset()
 * @param {THREE.Scene} scene
 * @param {object} [opts]
 * @param {number[]|THREE.Vector3} [opts.position=[0,0,0]]
 * @param {number[]|THREE.Euler}   [opts.rotation=[0,0,0]]
 * @param {number|number[]}        [opts.scale=1]
 * @param {boolean} [opts.withMixer=false]  build an AnimationMixer for the instance
 * @param {boolean} [opts.castShadow=true]
 * @param {boolean} [opts.receiveShadow=false]
 * @param {object}  [opts.physics]            Rapier Physics wrapper — required if withCollider
 * @param {boolean|"trimesh"} [opts.withCollider=false]  build a static Rapier collider:
 *                                              true → cuboid sized from bbox (cheap, fine for boxy props)
 *                                              "trimesh" → full mesh trimesh (heavy, exact shape)
 * @returns {{ instance: THREE.Object3D, mixer?: THREE.AnimationMixer, actions?: Record<string, THREE.AnimationAction>, body?, collider? }}
 */
export function spawnAsset(asset, scene, opts = {}) {
  const instance = SkeletonUtils.clone(asset.model);

  // Position / rotation / scale
  if (opts.position) {
    if (Array.isArray(opts.position)) instance.position.fromArray(opts.position);
    else                              instance.position.copy(opts.position);
  }
  if (opts.rotation) {
    if (Array.isArray(opts.rotation)) instance.rotation.fromArray(opts.rotation);
    else                              instance.rotation.copy(opts.rotation);
  }
  if (opts.scale !== undefined) {
    if (Array.isArray(opts.scale))    instance.scale.fromArray(opts.scale);
    else                              instance.scale.setScalar(opts.scale);
  }

  // Per-mesh settings — same defaults as the character pipeline so behavior
  // is consistent regardless of asset source.
  const castShadow    = opts.castShadow    ?? true;
  const receiveShadow = opts.receiveShadow ?? false;
  instance.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow    = castShadow;
    child.receiveShadow = receiveShadow;
    if (child.isSkinnedMesh) child.frustumCulled = false;
    // Material clone so per-instance tweaks (envMap, color) don't leak
    if (child.material) child.material = child.material.clone();
  });

  scene.add(instance);

  // Optional: build a static Rapier collider sized to the model's world bbox.
  // - true     → axis-aligned cuboid, cheap, fine for props (boxes, anvils,
  //              barrels, simple sculptures). Player can't walk through.
  // - "trimesh"→ exact triangle mesh, heavier, use for complex geometry where
  //              the cuboid bbox would clip too aggressively (statues with
  //              thin extensions, terrain pieces).
  let body, collider;
  if (opts.withCollider) {
    if (!opts.physics) {
      console.warn('[AssetLoader] withCollider needs opts.physics to be set');
    } else {
      instance.updateMatrixWorld(true);
      const bbox = new THREE.Box3().setFromObject(instance);
      const center = bbox.getCenter(new THREE.Vector3());
      const half   = bbox.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(center.x, center.y, center.z);
      body = opts.physics.world.createRigidBody(bodyDesc);
      if (opts.withCollider === 'trimesh') {
        // Bake every Mesh's geometry into one trimesh
        const verts = [];
        const idxs  = [];
        let vertexOffset = 0;
        const scratch = new THREE.Vector3();
        instance.traverse((child) => {
          if (!child.isMesh) return;
          const pos = child.geometry.attributes.position;
          if (!pos) return;
          for (let i = 0; i < pos.count; i++) {
            scratch.fromBufferAttribute(pos, i).applyMatrix4(child.matrixWorld);
            // Trimesh vertices are in WORLD space, but the body is at `center`
            // — so subtract center so they're local to the body
            verts.push(scratch.x - center.x, scratch.y - center.y, scratch.z - center.z);
          }
          const idx = child.geometry.index;
          if (idx) {
            for (let i = 0; i < idx.count; i++) idxs.push(idx.getX(i) + vertexOffset);
          } else {
            for (let i = 0; i < pos.count; i++) idxs.push(i + vertexOffset);
          }
          vertexOffset += pos.count;
        });
        if (idxs.length > 0) {
          collider = opts.physics.world.createCollider(
            RAPIER.ColliderDesc.trimesh(new Float32Array(verts), new Uint32Array(idxs)),
            body,
          );
        }
      } else {
        collider = opts.physics.world.createCollider(
          RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z),
          body,
        );
      }
    }
  }

  // Optional: build an AnimationMixer and per-clip actions
  let mixer, actions;
  if (opts.withMixer && asset.animations.length > 0) {
    mixer = new THREE.AnimationMixer(instance);
    actions = {};
    for (const clip of asset.animations) {
      actions[clip.name] = mixer.clipAction(clip);
    }
  }

  return { instance, mixer, actions, body, collider };
}

/** Convenience — load + spawn in one call. */
export async function loadAndSpawn(url, scene, opts) {
  const asset = await loadAsset(url);
  return spawnAsset(asset, scene, opts);
}

/** Cache stats for HUD/debug. */
export function getAssetCacheStats() {
  return {
    cachedUrls: _cache.size,
    urls: Array.from(_cache.keys()),
  };
}

/** Clear cache + dispose. Call before swapping worlds if you want to
 *  reclaim GPU memory; otherwise leave alone (next loads are free). */
export function disposeAssetCache() {
  _cache.forEach((promise) => {
    promise.then(({ gltf }) => {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((m) => m?.dispose?.());
        }
      });
    });
  });
  _cache.clear();
}
