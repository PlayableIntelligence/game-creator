import * as THREE from 'three';
import { RAPIER } from '../world/Physics.js';
import { CAPSULE, PLAYER, WORLD, CHARACTER } from '../core/Constants.js';
import { GameState } from '../core/GameState.js';
import { AnimatedCharacter } from './AnimatedCharacter.js';

/**
 * Capsule — kinematic Rapier capsule body + Rapier KinematicCharacterController
 * + a visible placeholder cylinder so we can see where the player is.
 *
 * Step 5 scope: spawn it, let gravity drop it onto the fake floor, expose
 * fixedUpdate(dt) for the render loop. NO input yet — the capsule has no
 * desired velocity, only gravity. Step 6 wires WASD/touch to set desired
 * velocity; step 7 swaps the placeholder for a GLB character.
 */
export class Capsule {
  /**
   * @param {Physics} physics
   * @param {THREE.Scene} scene
   * @param {{x:number,y:number,z:number}} spawn  position of capsule BOTTOM (feet)
   * @param {object} [opts]
   * @param {number} [opts.color=0xff5566]  placeholder mesh color
   */
  constructor(physics, scene, spawn, opts = {}) {
    this.physics = physics;
    this.scene = scene;

    const { halfHeight, radius } = CAPSULE;
    const halfTotal = halfHeight + radius;     // capsule centre → bottom

    // Body centre Y so capsule bottom sits at spawn.y
    const cy = spawn.y + halfTotal;

    const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(spawn.x, cy, spawn.z);
    this.body = physics.world.createRigidBody(bodyDesc);
    this.collider = physics.world.createCollider(
      RAPIER.ColliderDesc.capsule(halfHeight, radius),
      this.body,
    );

    // KinematicCharacterController — Rapier's built-in slope/snap/step-up.
    this.controller = physics.world.createCharacterController(CAPSULE.controllerOffset);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.setApplyImpulsesToDynamicBodies(true);
    this.controller.setSlideEnabled(true);
    this.controller.enableSnapToGround(CAPSULE.snapToGround);
    this.controller.enableAutostep(CAPSULE.autostepHeight, CAPSULE.autostepWidth, true);
    this.controller.setMaxSlopeClimbAngle(CAPSULE.maxSlopeClimb);
    this.controller.setMinSlopeSlideAngle(CAPSULE.minSlopeSlide);

    // Visible placeholder — pink-red capsule so we can spot it. Step 7
    // hides this and renders an animated GLB character at the same pos.
    const geom = new THREE.CapsuleGeometry(radius, halfHeight * 2, 4, 12);
    const mat  = new THREE.MeshStandardMaterial({
      color:     opts.color ?? 0xff5566,
      roughness: 0.55,
      metalness: 0.0,
    });
    this.indicator = new THREE.Mesh(geom, mat);
    this.indicator.position.set(spawn.x, cy, spawn.z);
    this.indicator.castShadow = true;
    this.indicator.receiveShadow = false;     // SkinnedMesh perf foot-gun is the
                                              // big one; we apply the same rule here
                                              // so the perf surface stays consistent
                                              // when step 7 swaps in the character.
    this.indicator.name = 'player-capsule';
    scene.add(this.indicator);

    // Internal kinematic state. Step 6 wires input → _desired.x/z.
    this._desired = new THREE.Vector3();
    this._verticalVel = 0;
    this._grounded = false;
    // Movement-intent flags drive the character animation state machine.
    // Tracked separately from Rapier's grounded flag (which can flicker).
    this._movingHoriz = false;
    this._sprinting  = false;

    // Set by main.js after construction so the Capsule can be used in
    // headless tests / different game configurations standalone.
    this.input = null;
    this.cameraMode = null;
    this.character = null;          // AnimatedCharacter — kicks off in spawn()

    GameState.player = {
      position: { x: spawn.x, y: cy, z: spawn.z },
      grounded: false,
      animState: 'idle',
    };
    console.info(
      `[Capsule] spawned at (${spawn.x.toFixed(2)}, ${cy.toFixed(2)}, ${spawn.z.toFixed(2)}) ` +
      `· half=${halfHeight} r=${radius}`,
    );

    // Kick off the character GLB load — non-blocking. The capsule indicator
    // stays visible until the character is ready, then it hides.
    if (CHARACTER.enabled) {
      void this._loadCharacter();
    }
  }

  async _loadCharacter() {
    try {
      this.character = new AnimatedCharacter();
      // No √userScale multiplier — the models are already human-sized at
      // scale 1.0. The cathedral is what's scaled big; the character stays
      // the same size and naturally reads as small in the room.
      await this.character.load(CHARACTER.url, CHARACTER.clipMap, {
        scale: CHARACTER.scale,
        facingOffset: CHARACTER.facingOffset,
      });
      this.scene.add(this.character.root);
      // Hide the placeholder capsule once the character is up
      if (this.indicator) this.indicator.visible = false;
      console.info('[Capsule] character ready, indicator hidden');
    } catch (err) {
      console.warn('[Capsule] character load failed; keeping indicator visible:', err);
      this.character = null;
    }
  }

  /**
   * Per-fixed-step (called inside Physics.step's onStep callback).
   *
   * Step 5: only gravity. _desired.x/z stay 0 → no horizontal motion. The
   * capsule falls until snap-to-ground kicks in on the fake floor.
   *
   * Step 6 will set _desired.x/z from input prior to this call.
   */
  fixedUpdate(dt) {
    const gravity = this.physics.world.gravity.y;

    // Horizontal: from input, projected through camera-mode movement basis
    let inputF = 0, inputR = 0, sprint = false, jumpQueued = false;
    if (this.input) {
      const s = this.input.consume();
      inputF = s.forward;
      inputR = s.right;
      sprint = s.sprint;
      jumpQueued = s.jumpQueued;
      // Pipe look deltas to camera mode (yaw + pitch update)
      if (this.cameraMode) this.cameraMode.applyLook(s.lookDx, s.lookDy);
    }

    this._desired.set(0, 0, 0);
    this._movingHoriz = (inputF !== 0 || inputR !== 0);
    this._sprinting   = sprint;
    if (this._movingHoriz && this.cameraMode) {
      const { forward, right } = this.cameraMode.getMovementBasis();
      this._desired.addScaledVector(forward, inputF);
      this._desired.addScaledVector(right,   inputR);
      // Speed scales with userScale so big rooms feel right
      const speed = PLAYER.walkSpeed * WORLD.userScale * (sprint ? PLAYER.sprintMultiplier : 1.0);
      this._desired.multiplyScalar(speed * dt);
    }

    // Vertical: gravity + jump. Apex height stays fraction of ceiling
    // height across userScale via √userScale jump speed scaling.
    if (jumpQueued && this._grounded) {
      this._verticalVel = PLAYER.jumpSpeed * Math.sqrt(WORLD.userScale);
      this._grounded = false;
    }
    if (!this._grounded) {
      this._verticalVel += gravity * dt;
    }
    this._desired.y = this._verticalVel * dt;

    this.controller.computeColliderMovement(this.collider, this._desired);
    const move = this.controller.computedMovement();

    // Suppress sub-cm Y jitter on flat ground from snap-to-ground
    let moveY = move.y;
    if (this._grounded && this._desired.y >= 0 && this._verticalVel >= 0 && Math.abs(moveY) < 0.01) {
      moveY = 0;
    }

    const cur = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: cur.x + move.x,
      y: cur.y + moveY,
      z: cur.z + move.z,
    });

    this._grounded = this.controller.computedGrounded();
    if (this._grounded && this._verticalVel < 0) this._verticalVel = 0;

    // Sync GameState
    const t = this.body.translation();
    GameState.player.position.x = t.x;
    GameState.player.position.y = t.y;
    GameState.player.position.z = t.z;
    GameState.player.grounded = this._grounded;
  }

  /** Per-render-frame (called outside the fixed step). Updates visible mesh
   *  + faces capsule along the camera yaw + advances animation mixer.
   *  dt = render-frame delta in seconds. */
  syncMesh(dt = 0) {
    const t = this.body.translation();
    const yaw = this.cameraMode ? this.cameraMode.getCapsuleYaw() : 0;

    // Indicator placeholder
    if (this.indicator?.visible) {
      this.indicator.position.set(t.x, t.y, t.z);
      this.indicator.rotation.y = yaw;
    }

    // Animated character — feet at capsule bottom. The character auto-
    // corrects its model so feet sit exactly at group.position.y (the
    // bbox.min.y compensation in AnimatedCharacter handles per-model
    // variation in foot pivot).
    if (this.character?.loaded) {
      const feetY = t.y - (CAPSULE.halfHeight + CAPSULE.radius);
      this.character.setPosition(t.x, feetY, t.z);
      this.character.setYaw(yaw);
      // Animation driver: if a CombatController is attached (capsule.combat),
      // it handles play() itself in Game.onUpdate so locked action animations
      // can override locomotion. Otherwise default locomotion picker runs.
      if (!this.combat) {
        const want = this._movingHoriz ? (this._sprinting ? 'run' : 'walk') : 'idle';
        this.character.play(want);
        GameState.player.animState = want;
      } else {
        GameState.player.animState = this.character.activeName ?? 'idle';
      }
      this.character.update(dt);
    }
  }
}
