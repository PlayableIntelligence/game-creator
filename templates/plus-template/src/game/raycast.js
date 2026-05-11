import * as THREE from 'three';

/**
 * raycast — pointer/touch event → world-space hit on the collider mesh.
 *
 * Returns the first intersection with the world geometry (the collider's
 * debug Group, which has every wall/floor triangle). When the pointer is
 * locked (typical in 1st/3rd-person play), the ray casts from screen centre
 * since the cursor is anchored there. When not locked (touch, top-down,
 * pause menu), it casts from the actual cursor position.
 *
 * Usage:
 *   const hit = raycastPointer(event, camera, world.collider.debug, locked);
 *   if (hit) console.log(hit.point.x, hit.point.y, hit.point.z);
 *
 * Returns:
 *   { point: Vector3, object: Mesh, distance: number, normal: Vector3 } | null
 */
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();

export function raycastPointer(event, camera, target, locked) {
  // NDC coords. When locked, the cursor is conceptually at the centre of
  // the canvas (where the crosshair lives), so ignore event coords.
  if (locked) {
    _ndc.set(0, 0);
  } else {
    const rect = event.target.getBoundingClientRect?.() || { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const x = (event.clientX ?? 0) - rect.left;
    const y = (event.clientY ?? 0) - rect.top;
    _ndc.x =  (x / rect.width)  * 2 - 1;
    _ndc.y = -(y / rect.height) * 2 + 1;
  }

  _raycaster.setFromCamera(_ndc, camera);
  const hits = _raycaster.intersectObject(target, true);
  if (hits.length === 0) return null;
  return hits[0];
}

/** Cast from camera centre — handy for "where am I looking?" queries (e.g.,
 *  highlighting an object under the crosshair every frame). */
export function raycastCenter(camera, target, maxDistance) {
  _ndc.set(0, 0);
  _raycaster.setFromCamera(_ndc, camera);
  if (maxDistance) _raycaster.far = maxDistance;
  const hits = _raycaster.intersectObject(target, true);
  if (hits.length === 0) return null;
  return hits[0];
}
