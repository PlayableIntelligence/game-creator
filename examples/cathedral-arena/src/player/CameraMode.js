import * as THREE from 'three';
import { CAMERA, CAPSULE, PLAYER, WORLD } from '../core/Constants.js';

/**
 * CameraMode — switchable camera placement + movement-basis logic.
 *
 *   first    — first-person at capsule eye. Yaw + pitch are camera direction
 *              AND character facing. Movement is camera-relative (W = forward
 *              into camera).
 *   third    — third-person orbit behind capsule. Same camera-relative
 *              movement; capsule visibly faces yaw direction.
 *   topdown  — fixed overhead. Yaw rotates camera around player; pitch
 *              clamped to prevent looking sideways. Movement is WORLD-axis-
 *              aligned (W = world -Z, A = world -X) so input doesn't change
 *              meaning when the player rotates the camera. Common for
 *              ARPG / RuneScape-style games + TCG sims.
 *   side     — fixed side view (camera at +X looking -X by default). Yaw is
 *              locked; movement is on the camera plane (W = up the screen,
 *              A = left). Common for tap-to-lift gigachad / 2.5D games.
 *
 * Switch via `?cam=first|third|topdown|side` URL param. Default 'third'.
 */
export class CameraMode {
  constructor(camera, capsule, physics, opts = {}) {
    this.camera = camera;
    this.capsule = capsule;
    this.physics = physics;          // for camera-vs-walls raycast in 3rd person
    this.mode = CAMERA.mode;

    // Camera-vs-walls clamping. Three.js Raycaster against the collider GLB's
    // wall geometry (always-loaded, hidden Group) — the most accurate way
    // to keep the camera inside the room regardless of room shape (handles
    // asymmetric bbox, thick walls, interior columns).
    //
    // bbox-based clamping was tried first (using fake-floor halfExtents) and
    // failed — Marble's cathedral isn't centered in its bbox, so 90%-shrink
    // bounds were too tight on some walls and too loose on others.
    this.colliderRoot  = opts.colliderRoot ?? null;
    // Y safety net only — keep camera above fake floor + below ceiling.
    this.fakeFloorTopY = opts.fakeFloorTopY ?? 0;
    this.ceilingY      = opts.ceilingY ?? 100;
    // Distance to back off from a hit wall. 0.3m is enough to keep the
    // camera clear of the splat-wall thickness without feeling artificial.
    this.wallOffset    = opts.wallOffset ?? 0.4;

    this._raycaster = new THREE.Raycaster();
    this._tmpDir    = new THREE.Vector3();
    this._tmpEye    = new THREE.Vector3();

    this._yaw = 0;
    this._pitch = -0.1;
    this._tmpVec = new THREE.Vector3();
    this._tmpVec2 = new THREE.Vector3();

    // Per-mode movement basis precomputed once for world-axis modes
    this._worldForward = new THREE.Vector3(0, 0, -1);
    this._worldRight   = new THREE.Vector3(1, 0,  0);

    console.info(`[CameraMode] mode=${this.mode}` + (this.colliderRoot ? ' · raycast-clamped' : ''));
  }

  /**
   * Three.js Raycaster against the collider's wall geometry. Returns a
   * clamped distance: at most maxDist if no wall hit, else (hit dist - wallOffset).
   *
   * Why Three.js Raycaster (not Rapier): collider.debug is the same wall
   * mesh as the Rapier trimesh, but accessed via Three's well-documented
   * Raycaster API — no version-arg-shape gotchas. The Group's Mesh children
   * have `visible=false` but Mesh.raycast checks geometry not visibility,
   * so the raycast hits regardless.
   *
   * Per-frame cost: ~1ms for 125k tris on M1, no BVH. 3rd-person only.
   */
  _raycastClamp(eyeX, eyeY, eyeZ, dirX, dirY, dirZ, maxDist) {
    if (!this.colliderRoot) return maxDist;
    this._tmpEye.set(eyeX, eyeY, eyeZ);
    this._tmpDir.set(dirX, dirY, dirZ);
    this._raycaster.set(this._tmpEye, this._tmpDir);
    this._raycaster.near = 0;
    this._raycaster.far  = maxDist;
    const hits = this._raycaster.intersectObject(this.colliderRoot, true);
    if (hits.length === 0) return maxDist;
    // Floor at 1.5m so a tight spring-arm hit doesn't collapse the camera
    // into the player (which reads as first-person and breaks souls feel).
    // Below 1.5m it's better to clip the wall slightly than to lose the
    // over-the-shoulder view.
    return Math.max(1.5, hits[0].distance - this.wallOffset);
  }

  /** Y-only safety clamp — never let camera dip below fake floor or punch
   *  through ceiling. XZ is handled by _raycastClamp. */
  _clampY(pos) {
    pos.y = Math.max(
      this.fakeFloorTopY + this.wallOffset,
      Math.min(this.ceilingY - this.wallOffset, pos.y),
    );
  }

  /** Apply look delta from InputRouter. */
  applyLook(dx, dy) {
    if (this.mode === 'side') return;     // side view: yaw locked
    this._yaw   -= dx;
    this._pitch -= dy;
    // Topdown: clamp pitch so we always look down
    if (this.mode === 'topdown') {
      this._pitch = Math.max(-1.4, Math.min(-0.5, this._pitch));
    } else {
      this._pitch = Math.max(PLAYER.pitchMin, Math.min(PLAYER.pitchMax, this._pitch));
    }
  }

  /**
   * Movement basis in world space (forward + right vectors). Capsule.fixedUpdate
   * uses these to translate input axes (forward, right) into a velocity vector.
   */
  getMovementBasis() {
    if (this.mode === 'topdown') {
      // World-aligned axes — W = north, A = west (regardless of yaw)
      return {
        forward: this._worldForward,
        right:   this._worldRight,
      };
    }
    if (this.mode === 'side') {
      // W = up the screen (world +Z if camera is at +X), A = left
      // Camera fixed at +X side looking -X → forward (away from camera) = -X
      // Up the screen = world +Y → not useful for ground motion. So WASD for
      // side maps to:  W = forward into screen (-X), S = back (+X),
      //                A = world +Z (toward viewer's left), D = -Z
      // This is the gym/lift convention.
      return {
        forward: new THREE.Vector3(-1, 0, 0),
        right:   new THREE.Vector3( 0, 0, 1),
      };
    }
    // first / third — camera-relative
    const f = this._tmpVec.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
    const r = this._tmpVec2.set(Math.cos(this._yaw), 0, -Math.sin(this._yaw));
    return { forward: f, right: r };
  }

  /** Capsule yaw — exposed for 3rd-person character facing. Returns the angle
   *  the character should face. For top-down/side, returns 0 (capsule keeps
   *  same orientation; movement determines visual facing in game code). */
  getCapsuleYaw() {
    return (this.mode === 'first' || this.mode === 'third') ? this._yaw : 0;
  }

  /** Per-render-frame: place the camera relative to the capsule. */
  update() {
    const t = this.capsule.body.translation();
    const cy = t.y;                                    // capsule centre Y
    const eyeY = cy + CAPSULE.eyeOffsetY;              // eye height
    const feetY = cy - (CAPSULE.halfHeight + CAPSULE.radius);  // capsule bottom

    switch (this.mode) {
      case 'first': {
        this.camera.position.set(t.x, eyeY, t.z);
        this._clampY(this.camera.position);
        const lookDir = this._tmpVec
          .set(0, 0, -1)
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), this._pitch)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), this._yaw);
        this.camera.lookAt(this.camera.position.x + lookDir.x, this.camera.position.y + lookDir.y, this.camera.position.z + lookDir.z);
        break;
      }
      case 'third': {
        const desiredDist = CAMERA.thirdDistance * Math.sqrt(WORLD.userScale);
        const cosP  = Math.cos(this._pitch);

        // Desired offset (already unit-length: sin²+cos² = 1 with cosP)
        const offX =  Math.sin(this._yaw) * cosP;
        const offY =  Math.sin(-this._pitch);
        const offZ =  Math.cos(this._yaw) * cosP;

        // Raycast against actual wall geometry — clamps camera distance to
        // (wall hit - wallOffset) so it sits just inside the room, never
        // embedded in the wall splat thickness. Spring-arm style.
        const dist = this._raycastClamp(t.x, eyeY, t.z, offX, offY, offZ, desiredDist);

        this.camera.position.set(
          t.x  + offX * dist,
          eyeY + offY * dist,
          t.z  + offZ * dist,
        );
        this._clampY(this.camera.position);
        this.camera.lookAt(t.x, eyeY, t.z);
        break;
      }
      case 'topdown': {
        const h = CAMERA.topdownHeight * Math.sqrt(WORLD.userScale);
        this.camera.position.set(t.x, t.y + h, t.z + 0.001);
        this._clampY(this.camera.position);
        this.camera.lookAt(t.x, feetY, t.z);
        break;
      }
      case 'side': {
        const off = CAMERA.sideOffset * Math.sqrt(WORLD.userScale);
        this.camera.position.set(t.x + off, eyeY, t.z);
        this._clampY(this.camera.position);
        this.camera.lookAt(t.x, eyeY, t.z);
        break;
      }
    }
  }
}
