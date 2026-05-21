import * as THREE from 'three';
import { loadMixamoFbx } from './mixamoRetarget.js';

// Attach a weapon FBX to a VRM's right-hand bone. The weapon becomes a child
// of the bone so it follows all skinned animation automatically — no manual
// per-frame copy needed.
//
// Tuning (scale / position / rotationEuler) lives in Constants.PROPS.<slot>.*
// because the same sword needs different numbers on a 0.95× player vs a 3.5×
// boss: scales compose, so the sword would appear 3.7× bigger on the boss
// without per-character overrides.

export async function attachWeapon(vrm, {
  path,
  scale = 1,
  position = [0, 0, 0],
  rotationEuler = [0, 0, 0],
  boneName = 'rightHand',
}) {
  const fbx = await loadMixamoFbx(path);
  const weapon = fbx.clone(true);

  weapon.scale.setScalar(scale);
  weapon.position.set(...position);
  weapon.rotation.set(...rotationEuler);

  // FBX comes in with MeshPhongMaterial (or basic Lambert). Convert to PBR
  // so the blade catches highlights off the scene's environment map and
  // reads as steel, not matte paint. Keep original maps if the FBX had them.
  weapon.traverse((child) => {
    if (!child.isMesh) return;
    const old = Array.isArray(child.material) ? child.material : [child.material];
    const converted = old.map((m) => toPBR(m));
    child.material = converted.length === 1 ? converted[0] : converted;
    child.castShadow = true;
    child.receiveShadow = false;
  });

  // Raw bones match the VRM's actual rig (not the retarget-normalized graph),
  // which is what we need for parenting a child node.
  const bone = vrm.humanoid.getRawBoneNode(boneName)
            || vrm.humanoid.getNormalizedBoneNode(boneName);
  if (!bone) {
    console.warn(`[WeaponAttach] no "${boneName}" bone on VRM — weapon not attached`);
    return null;
  }
  bone.add(weapon);
  return weapon;
}

function toPBR(src) {
  if (!src || src.isMeshStandardMaterial || src.isMeshPhysicalMaterial) return src;
  // Heuristic: if the mesh has a color map it's probably the blade/grip
  // textured; if not, we default to metallic-ish steel. Tweakable at the
  // material level in DevTools via __GAME__.player.sword.traverse(...).
  const hasColorMap = !!src.map;
  const color = src.color ? src.color.clone() : new THREE.Color(0x9aa0a8);
  return new THREE.MeshStandardMaterial({
    name: src.name,
    color: hasColorMap ? new THREE.Color(0xffffff) : color,
    map: src.map || null,
    normalMap: src.normalMap || null,
    roughnessMap: src.roughnessMap || null,
    metalnessMap: src.metalnessMap || null,
    metalness: hasColorMap ? 0.6 : 0.85,
    roughness: hasColorMap ? 0.55 : 0.35,
  });
}
