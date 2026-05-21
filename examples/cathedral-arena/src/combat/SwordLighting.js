import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// The scene's `environment` PMREM is baked from the dim cathedral pano, which
// is the right IBL for VRM skin (keeps characters grounded in the arena's
// colour palette). But greatsword steel NEEDS a bright studio env to read as
// metal — the tuner gets this right because it uses RoomEnvironment directly.
//
// Fix: give every sword mesh its OWN material.envMap (the RoomEnvironment
// PMREM) so it reflects the "studio" while the rest of the scene keeps the
// cathedral env. `envMap` on a MeshStandardMaterial overrides the scene
// environment for that specific material, so this is clean — no global
// visual side effect on the VRMs.
//
// Usage:
//   import { initSwordEnv, applySwordEnv } from './SwordLighting.js';
//   // once, at Game init (needs renderer):
//   initSwordEnv(renderer);
//   // after each sword attach:
//   applySwordEnv(player.sword);

let _swordEnv = null;
let _intensity = 1.8;

// Call once after the renderer exists. PMREM bake is ~100ms and the
// RoomEnvironment scene gets disposed immediately after.
export function initSwordEnv(renderer, { intensity = 1.8 } = {}) {
  if (_swordEnv) return _swordEnv;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  // The `sigma` arg (second param) is a mild pre-blur; 0.04 matches what
  // the tuner uses and keeps the reflection feeling "smooth studio" rather
  // than sharp/mirror which would read as plastic.
  _swordEnv = pmrem.fromScene(room, 0.04).texture;
  _intensity = intensity;
  pmrem.dispose();
  // RoomEnvironment is a Scene; no explicit dispose needed, GC handles it.
  console.log('[SwordLighting] RoomEnvironment PMREM ready, intensity=', intensity);
  return _swordEnv;
}

// Traverse a sword hierarchy (as returned by attachWeapon) and patch every
// PBR material to reflect the studio env. Safe to call on a sword that has
// MeshStandardMaterial, MeshPhysicalMaterial, or a mix. Materials that
// aren't PBR are left alone.
export function applySwordEnv(swordRoot) {
  if (!swordRoot || !_swordEnv) return;
  swordRoot.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!m) continue;
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) {
        m.envMap = _swordEnv;
        m.envMapIntensity = _intensity;
        // needsUpdate triggers a shader recompile — only needed the first
        // time envMap flips from null to a texture. Harmless subsequently.
        m.needsUpdate = true;
      }
    }
  });
}
