import * as THREE from 'three';
import { LIGHTING } from '../core/Constants.js';

/**
 * installLighting — Souls-style PBR lighting for non-splat geometry.
 *
 * The splat is self-lit (lighting baked into the gaussians). These lights
 * only affect MeshStandardMaterial-family meshes (fake floor, character,
 * Meshy props). Three lights total:
 *
 *   - AmbientLight     — flat cool baseline so unlit sides aren't pure black
 *   - HemisphereLight  — sky/ground tint, ~50% intensity so areas the
 *                         directional doesn't reach still pick up tone
 *   - DirectionalLight — warm "stained-glass sun" with cast shadow. Position
 *                         scaled by bbox so the angle is the same in a small
 *                         room or a 100m cathedral
 *
 * Shadow camera is sized from bbox.size — at userScale=3 the cathedral is 3×
 * bigger and the shadow camera grows with it, keeping texel density constant.
 *
 * Source pattern: ported from splats-repo lighting.ts. The numbers are
 * tuned for the cathedral but work cleanly for forest/dungeon/sci-fi corridor
 * too — the cool baseline + warm key combo is genre-agnostic.
 */
export function installLighting(scene, bbox) {
  const center = bbox.getCenter(new THREE.Vector3());
  const size   = bbox.getSize(new THREE.Vector3());

  const ambient = new THREE.AmbientLight(
    LIGHTING.ambient.color,
    LIGHTING.ambient.intensity,
  );
  scene.add(ambient);

  const hemi = new THREE.HemisphereLight(
    LIGHTING.hemi.sky,
    LIGHTING.hemi.ground,
    LIGHTING.hemi.intensity,
  );
  hemi.position.set(center.x, bbox.max.y, center.z);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(
    LIGHTING.sun.color,
    LIGHTING.sun.intensity,
  );
  // Offset is fractions of bbox so it scales with userScale automatically.
  // (size.x*0.35, size.y*1.2, size.z*0.3) puts the sun high above + slightly
  // off-axis (NE in world coords), giving the cast shadow a flattering angle.
  const offset = new THREE.Vector3(size.x * 0.35, size.y * 1.2, size.z * 0.3);
  sun.position.copy(center).add(offset);
  sun.target.position.copy(center);
  scene.add(sun);
  scene.add(sun.target);

  // Shadow setup — sized from bbox
  sun.castShadow = true;
  sun.shadow.mapSize.set(LIGHTING.shadowMapSize, LIGHTING.shadowMapSize);
  const half = Math.min(size.x, size.z) * LIGHTING.shadowCoverage;
  sun.shadow.camera.left   = -half;
  sun.shadow.camera.right  =  half;
  sun.shadow.camera.top    =  half;
  sun.shadow.camera.bottom = -half;
  sun.shadow.camera.near   = 0.5;
  sun.shadow.camera.far    = size.y * 3;
  sun.shadow.bias          = LIGHTING.shadowBias;
  sun.shadow.normalBias    = LIGHTING.shadowNormalBias;
  sun.shadow.radius        = LIGHTING.shadowRadius;

  console.info(
    `[Lighting] ambient(${LIGHTING.ambient.intensity}) + ` +
    `hemi(${LIGHTING.hemi.intensity}) + warm key(${LIGHTING.sun.intensity}) · ` +
    `shadow ${LIGHTING.shadowMapSize}² covering ${(half * 2).toFixed(1)}×${(half * 2).toFixed(1)}m`,
  );

  return { ambient, hemi, sun };
}
