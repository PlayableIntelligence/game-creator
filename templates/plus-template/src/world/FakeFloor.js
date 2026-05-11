import * as THREE from 'three';
import { RAPIER } from './Physics.js';
import { FAKE_FLOOR } from '../core/Constants.js';

/**
 * FakeFloor — visual smooth slab over the bumpy scanned floor.
 *
 * Step 4 scope: VISUAL only. We compute and return `topY` (the spawn
 * reference height) so step 5's Rapier physics knows where to put the
 * cuboid collider. The collider trimesh in step 5 will use `topY` as its
 * `floorCullY` so real-floor triangles sitting below this Y are dropped
 * from the physics — nothing pokes up through the smooth floor.
 *
 * Why a textured slab and not just an invisible physics body:
 *   - Marble's scanned floor has visible photogrammetry artifacts (cracks,
 *     waviness, scattered density) that look bad up close
 *   - A neutral marble texture reads as "stage floor" and works for most
 *     indoor scenes (cathedral, dungeon, sci-fi corridor)
 *   - For outdoor scenes the splat floor is usually nicer — disable the
 *     visual via ?fakefloor=hidden
 *
 * `renderOrder = 10` so the slab draws AFTER the splat. Splats don't always
 * write depth, so a default-ordered opaque mesh underneath could end up
 * showing splats through the floor.
 *
 * Source pattern: ported from splats-repo fake-floor.ts, simplified (no
 * Rapier — that's step 5).
 */
export function installFakeFloor(scene, physics, bbox, floorY) {
  const center      = bbox.getCenter(new THREE.Vector3());
  const size        = bbox.getSize(new THREE.Vector3());
  const halfX       = (size.x * FAKE_FLOOR.coverage) / 2;
  const halfZ       = (size.z * FAKE_FLOOR.coverage) / 2;
  const halfY       = FAKE_FLOOR.halfY;
  const slabCentreY = floorY + FAKE_FLOOR.lift + halfY;
  // Top of the slab — capsule bottom sits here. The collider trimesh has
  // triangles below this Y culled out so nothing pokes through.
  const topY        = slabCentreY + halfY;

  // Rapier static cuboid — the smooth physics floor.
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
    center.x, slabCentreY, center.z,
  );
  const body = physics.world.createRigidBody(bodyDesc);
  physics.world.createCollider(
    RAPIER.ColliderDesc.cuboid(halfX, halfY, halfZ),
    body,
  );

  let mesh = null;

  if (FAKE_FLOOR.visible) {
    const tex = new THREE.TextureLoader().load(FAKE_FLOOR.textureUrl);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(halfX * 2 * FAKE_FLOOR.tilesPerMetre, halfZ * 2 * FAKE_FLOOR.tilesPerMetre);
    tex.anisotropy = 4;
    tex.colorSpace = THREE.SRGBColorSpace;

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      // Light cool grey — desaturates the warm Polyhaven marble texture
      // toward "wet flagstone" without crushing brightness. Was 0x707880
      // (too dark when the scene grade rolls off contrast).
      color: new THREE.Color(0xb0b8c0),
      roughness: 0.85,
      metalness: 0.0,
      envMapIntensity: 0.3,
    });

    mesh = new THREE.Mesh(
      new THREE.BoxGeometry(halfX * 2, halfY * 2, halfZ * 2),
      mat,
    );
    mesh.position.set(center.x, slabCentreY, center.z);
    mesh.receiveShadow = true;
    mesh.renderOrder = 10;            // after splat
    mesh.name = 'fake-floor';
    scene.add(mesh);
  }

  console.info(
    `[FakeFloor] real_floor_y=${floorY.toFixed(2)} → slab_centre=${slabCentreY.toFixed(2)} ` +
    `top_y=${topY.toFixed(2)}  ${(halfX * 2).toFixed(1)}×${(halfZ * 2).toFixed(1)} m  ` +
    `visible=${FAKE_FLOOR.visible}`,
  );

  return {
    mesh,
    body,
    topY,
    halfExtents: new THREE.Vector2(halfX, halfZ),
    center: new THREE.Vector2(center.x, center.z),
    slabCentreY,
  };
}
