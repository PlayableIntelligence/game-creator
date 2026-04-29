import * as THREE from 'three';
import { WORLD } from '../core/Constants.js';

/**
 * Build the world transform for a Marble splat.
 *
 * Marble outputs splats in Y-down handedness with a per-scene metric scale
 * factor + ground-plane offset reported in meta.assets.splats.semantics_metadata.
 * Apply the SAME matrix to the SplatMesh and the collider GLB so render and
 * physics never drift.
 *
 * Order (right-to-left, applied to a vector):
 *
 *   1. translate by -ground_plane_offset → floor sits at y=0 in splat-local
 *   2. rotate 180° about X if WORLD.flipY → Y-down → Y-up
 *   3. scale by metric_scale_factor × WORLD.userScale → final metric units
 *
 * The splats demo decomposes this matrix into Object3D pos/quat/scale rather
 * than calling applyMatrix4 — Spark internally reads matrixWorld so the
 * standard Three.js auto-update flow stays correct with no one-frame delay.
 */
export function buildSplatTransform(meta) {
  const sem = meta?.assets?.splats?.semantics_metadata
    || meta?.semantics_metadata
    || null;

  const metricScale  = WORLD.applyMetric && sem ? sem.metric_scale_factor  : 1.0;
  const groundOffset = WORLD.applyMetric && sem ? sem.ground_plane_offset : 0.0;
  const finalScale   = metricScale * WORLD.userScale;

  // M = Scale × Rotate × Translate (right-to-left on a vector)
  const preTranslate = new THREE.Matrix4().makeTranslation(0, -groundOffset, 0);
  const rotate       = new THREE.Matrix4();
  if (WORLD.flipY) rotate.makeRotationX(Math.PI);
  const postScale    = new THREE.Matrix4().makeScale(finalScale, finalScale, finalScale);

  const transform = new THREE.Matrix4()
    .multiply(postScale)
    .multiply(rotate)
    .multiply(preTranslate);

  console.info(
    `[SplatTransform] metric_scale=${metricScale.toFixed(4)} ` +
    `ground_offset=${groundOffset.toFixed(4)} user_scale=${WORLD.userScale} ` +
    `flip=${WORLD.flipY} → final_scale=${finalScale.toFixed(4)}`,
  );

  return { transform, scale: finalScale, metricScale, groundOffset };
}

/** Decompose a Matrix4 into pos/quat/scale on an Object3D (the splat-demo
 *  pattern — keeps Three.js auto-update working, no one-frame matrixWorld lag). */
export function applyMatrixToObject(obj, m) {
  m.decompose(obj.position, obj.quaternion, obj.scale);
  obj.updateMatrixWorld(true);
}
