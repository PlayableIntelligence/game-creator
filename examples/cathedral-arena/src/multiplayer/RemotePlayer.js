import * as THREE from 'three';
import { AnimatedCharacter } from '../player/AnimatedCharacter.js';
import { attachWeapon } from '../combat/WeaponAttach.js';
import { CHARACTER, MULTIPLAYER, CAPSULE } from '../core/Constants.js';

// Greatsword tuning — must match CombatController's local-player numbers so
// the same sword reads identically in third-person whether you're looking
// at yourself or an opponent.
const SWORD_PATH      = '/assets/props/greatsword.fbx';
const SWORD_SCALE     = 0.0025;
const SWORD_POSITION  = [0.175, -0.0296, -0.1759];
const SWORD_ROTATION  = [Math.PI, 0.576, Math.PI / 2];

// Feet-Y conversion. Local player broadcasts capsule-CENTER Y in `state.y`;
// remote AnimatedCharacter wants its group origin at the FEET. Difference is
// half the capsule plus the radius cap.
const CENTER_TO_FEET = CAPSULE.halfHeight + CAPSULE.radius;

/**
 * RemotePlayer — a network-driven character. Mirrors a peer player's
 * position/yaw/HP from server broadcasts, lerps smoothly, plays a hit
 * flash on damage events.
 *
 * Stack: same AnimatedCharacter as the local player (VRM + locomotion
 * mixer), but driven from `applyState()` instead of input.
 */
export class RemotePlayer {
  constructor(scene, { playerId, floorY }) {
    this.scene = scene;
    this.playerId = playerId;
    this.alive = true;
    this.hp = 100;

    // Visual position (lerp target) and current rendered position
    this.position = new THREE.Vector3();
    this.targetPosition = new THREE.Vector3();
    this.lastTargetPosition = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this._floorY = floorY;
    this._haveFirstState = false;
    this._lastStateAt = 0;

    // AnimatedCharacter — mirrors what plus-template's Capsule does for
    // the local player. Use the same CHARACTER preset so remote players
    // visually match.
    this.character = new AnimatedCharacter();
    this._loaded = false;
    void this._load();

    // Hit-flash state — applied across all skinned mesh materials
    this._flashUntil = 0;
  }

  async _load() {
    try {
      await this.character.load(CHARACTER.url, CHARACTER.clipMap, {
        scale: CHARACTER.scale,
        facingOffset: CHARACTER.facingOffset,
      });
      this.scene.add(this.character.root);
      this._loaded = true;

      // Attach the same greatsword the local player has, so opponents
      // visibly carry a weapon (and so the sword's world position can be
      // queried for their swings if we later move hit detection
      // server-authoritative).
      try {
        if (this.character.vrm) {
          this.sword = await attachWeapon(this.character.vrm, {
            path: SWORD_PATH,
            scale: SWORD_SCALE,
            position: SWORD_POSITION,
            rotationEuler: SWORD_ROTATION,
            boneName: 'rightHand',
          });
        }
      } catch (err) {
        console.warn(`[RemotePlayer ${this.playerId.slice(0, 6)}] sword attach failed:`, err);
      }
    } catch (err) {
      console.warn(`[RemotePlayer ${this.playerId.slice(0, 6)}] load failed:`, err);
    }
  }

  applyState(state) {
    if (!state) return;
    // Track previous target so we can compute apparent velocity (used as a
    // fallback to pick idle/walk/run when the broadcast `animState` is not
    // a locomotion state).
    this.lastTargetPosition.copy(this.targetPosition);
    this.targetPosition.set(state.x ?? 0, state.y ?? this._floorY, state.z ?? 0);
    this.targetYaw = state.yaw ?? 0;
    this.hp = state.hp ?? this.hp;
    this.alive = state.alive ?? true;
    // Combat / locomotion state from the local player's CombatController.
    // null/undefined → fall back to inferred locomotion in update().
    this.animState = state.animState ?? null;
    if (!this._haveFirstState) {
      // Snap on first state so we don't lerp from origin (0,0,0)
      this.position.copy(this.targetPosition);
      this.lastTargetPosition.copy(this.targetPosition);
      this.yaw = this.targetYaw;
      this._haveFirstState = true;
    }
    this._lastStateAt = performance.now();
  }

  flashHit() {
    this._flashUntil = performance.now() + 250;
  }

  update(dt) {
    // Lerp position + yaw with exponential smoothing toward last server target
    const tau = MULTIPLAYER.REMOTE_LERP_TAU;
    const a = 1 - Math.exp(-dt / Math.max(tau, 0.001));
    this.position.lerp(this.targetPosition, a);

    // Yaw lerp on shortest arc
    let dy = this.targetYaw - this.yaw;
    while (dy >  Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.yaw += dy * a;

    // Animation state — prefer the broadcast animState (so remote attacks /
    // blocks / rolls play in lockstep with the source). Fall back to inferred
    // locomotion from apparent server-target velocity for old clients that
    // don't send animState. Thresholds tuned empirically: walking ~1.5 m/s,
    // running ~3.5 m/s.
    let want;
    if (this.animState) {
      want = this.animState;
    } else {
      const dxz = Math.hypot(
        this.targetPosition.x - this.lastTargetPosition.x,
        this.targetPosition.z - this.lastTargetPosition.z,
      );
      const speedHz = dxz * MULTIPLAYER.TICK_RATE_HZ;
      want = 'idle';
      if (speedHz > 2.5) want = 'run';
      else if (speedHz > 0.3) want = 'walk';
    }

    if (this._loaded && this.character?.loaded) {
      // Local player broadcasts capsule-CENTER y; AnimatedCharacter wants
      // FEET y at its group origin. Subtract the half-capsule offset so the
      // remote stands on the same floor we do.
      const feetY = this.position.y - CENTER_TO_FEET;
      this.character.setPosition(this.position.x, feetY, this.position.z);
      this.character.setYaw(this.yaw);
      this.character.play(want);
      this.character.update(dt);
    }

    // Hit flash decay
    if (this._flashUntil > 0) {
      const remaining = this._flashUntil - performance.now();
      if (remaining <= 0) {
        this._flashUntil = 0;
        this._setEmissive(null);
      } else {
        const k = Math.min(1, remaining / 250);
        this._setEmissive(new THREE.Color(0xff4444).multiplyScalar(k));
      }
    }
  }

  _setEmissive(colorOrNull) {
    if (!this.character?.root) return;
    this.character.root.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) {
        if (!m.emissive) continue;
        if (colorOrNull == null) {
          // Restore — three's MToon/StandardMaterial defaults to black emissive
          m.emissive.set(0x000000);
        } else {
          m.emissive.copy(colorOrNull);
        }
      }
    });
  }

  dispose() {
    if (this.character?.root) {
      this.scene.remove(this.character.root);
      this.character.root.traverse((child) => {
        child.geometry?.dispose?.();
        const mats = Array.isArray(child.material) ? child.material : [child.material].filter(Boolean);
        for (const m of mats) m?.dispose?.();
      });
    }
  }
}
