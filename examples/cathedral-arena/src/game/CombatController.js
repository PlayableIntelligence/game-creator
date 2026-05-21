import * as THREE from 'three';
import { attachWeapon } from '../combat/WeaponAttach.js';
import { COMBAT } from '../core/Constants.js';

/**
 * CombatController — souls-style state machine bolted on top of plus-template's
 * AnimatedCharacter. Owns:
 *
 *   - greatsword attachment to the right-hand bone
 *   - input → action mapping (LMB/RMB attacks, F block, Space roll)
 *   - locomotion vs. action arbitration (`_lock` field — non-null means a
 *     committed action animation owns the mixer; locomotion can't override)
 *   - stamina drain + regen
 *   - roll burst velocity (Capsule reads `_rollDir` + ROLL_SPEED)
 *   - sword-position-vs-body-sphere hit detection (souls-demo pattern)
 *   - root-motion absorb so heavy swings don't snap the body back to start
 *
 * The Capsule retains authority over translation. CombatController only
 * touches the AnimatedCharacter mixer + listens for input events.
 *
 * Animation states ride on top of the existing idle/walk/run mix that
 * AnimatedCharacter.play() already drives — when `_lock` is set, we override
 * Capsule's locomotion choice with the action clip until the timer expires.
 */

// Greatsword tuning — copied from souls-demo PROPS.greatsword.player.
const SWORD_PATH      = '/assets/props/greatsword.fbx';
const SWORD_SCALE     = 0.0025;
const SWORD_POSITION  = [0.175, -0.0296, -0.1759];
const SWORD_ROTATION  = [Math.PI, 0.576, Math.PI / 2];

// Per-state fallback durations (ms). Used when the loaded clip's wallclock
// duration isn't available (e.g. before the FBX finishes retargeting).
const FALLBACK_DURATIONS_MS = {
  lightAttack: 800,
  heavyAttack: 1200,
  roll:        650,
  hit:         400,
  death:       2000,
};

// Stamina costs.
const STAMINA_COST = {
  lightAttack: 18,
  heavyAttack: 32,
  roll:        25,
};

const STAMINA_REGEN_PER_SEC = 35;
const STAMINA_REGEN_DELAY_MS = 600;
const STAMINA_MAX = 100;

const _bodyTmp  = new THREE.Vector3();
const _swordTmp = new THREE.Vector3();

export class CombatController {
  constructor({ capsule, scene, onStateChange, isAlive, onHit }) {
    this.capsule = capsule;
    this.scene = scene;
    this.onStateChange = onStateChange ?? (() => {});
    this.isAlive = isAlive ?? (() => true);
    // Fired by the active-swing tracker when our sword body-sphere touches a
    // target. Game.js listens and applies damage + spawns hit FX.
    this.onHit = onHit ?? (() => {});

    // State
    this._lock = null;             // null | 'lightAttack' | 'heavyAttack' | 'roll' | 'hit' | 'death' | 'block'
    this._lockUntil = 0;
    this._blocking = false;
    this.stamina = STAMINA_MAX;
    this._staminaRegenAt = 0;

    // Animation state we report to the network.
    this._broadcastState = 'idle';

    // Sword
    this.sword = null;
    this._handBone = null;

    // Roll state (mirrors souls-demo Player). `_rollDir` is a unit XZ vector
    // captured on roll-start; Capsule.fixedUpdate drives the body in that
    // direction at ROLL_SPEED while `_lock === 'roll'`.
    this.invulnerable = false;
    this._rollDir = null;

    // Active-swing tracker — populated when an attack starts. Each frame in
    // update() we read sword.getWorldPosition(), test it against every
    // target's body sphere, and fire onHit() once per swing.
    this._activeSwing = null;     // { kind: 'light'|'heavy', action, hitWindow, fired, started }

    // Heavy-attack lunge — Capsule reads `isLunging()` and pushes the body
    // forward at LUNGE_SPEED through the character controller, so the swing
    // carries the player into the strike instead of staying rooted. Routed
    // through computeColliderMovement so walls still slide correctly (an
    // earlier setNextKinematicTranslation-based absorb embedded the capsule
    // in geometry next to walls and broke movement after the swing).
    this._lungeStart = 0;
    this._lungeUntil = 0;
  }

  /** True while the heavy-attack lunge window is active. Capsule reads this. */
  isLunging() {
    if (this._lock !== 'heavyAttack') return false;
    const now = performance.now();
    return now >= this._lungeStart && now < this._lungeUntil;
  }

  /** Call once after capsule.character.loaded === true. */
  async attachSword() {
    const character = this.capsule?.character;
    if (!character?.vrm) {
      console.warn('[Combat] no VRM on character — sword skipped');
      return;
    }
    try {
      this.sword = await attachWeapon(character.vrm, {
        path: SWORD_PATH,
        scale: SWORD_SCALE,
        position: SWORD_POSITION,
        rotationEuler: SWORD_ROTATION,
        boneName: 'rightHand',
      });
      this._handBone = character.vrm.humanoid?.getRawBoneNode?.('rightHand');
      console.info('[Combat] greatsword attached to right hand');
    } catch (err) {
      console.warn('[Combat] sword attach failed:', err?.message ?? err);
    }
  }

  // -------------------------------------------------------------------------
  // Input intents
  // -------------------------------------------------------------------------

  /** LMB → light attack. Returns true if the swing started. */
  lightAttack() {
    if (!this._canAct() || !this._drainStamina(STAMINA_COST.lightAttack)) return false;
    this._enterLock('lightAttack');
    this._beginSwing('light');
    return true;
  }

  /** RMB → heavy attack. */
  heavyAttack() {
    if (!this._canAct() || !this._drainStamina(STAMINA_COST.heavyAttack)) return false;
    this._enterLock('heavyAttack');
    this._beginSwing('heavy');
    // Heavy: schedule a short forward lunge so the swing carries the player
    // forward through the swing, instead of leaving them rooted (and the
    // visual then snapping back from clip hip-drift). The lunge runs through
    // Capsule's character controller — wall slide stays intact.
    const lockMs = this._computeLockMs('heavyAttack');
    const now = performance.now();
    this._lungeStart = now + lockMs * 0.18;        // start ~18% into the clip
    this._lungeUntil = now + lockMs * 0.55;        // stop ~55% in
    return true;
  }

  /** Space → dodge roll. Grants i-frames during the active part of the roll. */
  roll() {
    if (!this._canAct() || !this._drainStamina(STAMINA_COST.roll)) return false;

    // Direction snapshot: camera-relative WASD intent if held, else current
    // facing (so a stationary roll dodges forward, mirroring souls-demo).
    const cap = this.capsule;
    const yaw = cap?.cameraMode?.getCapsuleYaw?.() ?? 0;
    let dirX = Math.sin(yaw);
    let dirZ = Math.cos(yaw);
    if (cap?._movingHoriz && cap?.cameraMode) {
      const { forward, right } = cap.cameraMode.getMovementBasis();
      // We can read the raw input only via consume(), which would steal
      // the frame's input from the capsule. Instead reconstruct from the
      // capsule's last desired-velocity direction (set in fixedUpdate).
      const dx = cap._desired.x;
      const dz = cap._desired.z;
      const m = Math.hypot(dx, dz);
      if (m > 0.0001) { dirX = dx / m; dirZ = dz / m; }
      // Suppress unused-var warnings if movement basis isn't needed.
      void forward; void right;
    }
    this._rollDir = { x: dirX, z: dirZ };

    this._enterLock('roll');
    this.invulnerable = true;
    setTimeout(() => { this.invulnerable = false; }, COMBAT.ROLL_IFRAMES_MS);
    return true;
  }

  /** F (held) → block. Passive; reduces incoming damage when absorbing. */
  setBlocking(on) {
    const want = !!on;
    // Always track the held flag so a release during an attack lock still
    // exits block once the attack ends.
    this._blocking = want;
    // Lock manipulation only happens when no other action owns the mixer.
    if (this._lock && this._lock !== 'block') return;
    if (want && this._lock !== 'block') {
      this._lock = 'block';
      this._lockUntil = Infinity;
      this._setBroadcast('block');
      this._playOneShot('block');
    } else if (!want && this._lock === 'block') {
      this._lock = null;
      this._lockUntil = 0;
      this._setBroadcast('idle');
    }
  }

  /** External call when this player takes damage — plays hit animation. */
  takeHit() {
    if (this._lock === 'death' || this.invulnerable) return false;
    this._enterLock('hit');
    return true;
  }

  /** External call on death — plays death anim and locks input. */
  die() {
    this._enterLock('death');
    this._broadcastState = 'death';
    this.onStateChange('death');
  }

  /** External call on respawn — clears all state. */
  reset() {
    this._lock = null;
    this._lockUntil = 0;
    this._blocking = false;
    this.invulnerable = false;
    this._rollDir = null;
    this._activeSwing = null;
    this._lungeStart = 0;
    this._lungeUntil = 0;
    this.stamina = STAMINA_MAX;
    this._setBroadcast('idle');
  }

  /** Per-frame tick. Called from Game.onUpdate. */
  update(dt) {
    const now = performance.now();

    // Lock expiry. Death and block hold indefinitely; everything else expires.
    if (this._lock && now >= this._lockUntil && this._lock !== 'death' && this._lock !== 'block') {
      // Roll ends → drop the snapshotted direction so the capsule reverts to
      // input-driven movement.
      if (this._lock === 'roll') this._rollDir = null;
      this._lock = null;
      this._lockUntil = 0;
      this._setBroadcast('idle');
    }

    // Stamina regen
    if (this.stamina < STAMINA_MAX && now >= this._staminaRegenAt) {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_PER_SEC * dt);
    }

    // Drive the local character animation. CombatController is the sole
    // owner of character.play() while attached (Capsule.syncMesh defers).
    const character = this.capsule?.character;
    if (!character?.loaded) return;
    if (this._lock) {
      // Already started in _enterLock with reset(); keep the activeName
      // matching so play()'s identity guard treats this as a no-op.
      // (We intentionally don't call play() here.)
    } else {
      const moving = this.capsule._movingHoriz;
      const sprinting = this.capsule._sprinting;
      const want = moving ? (sprinting ? 'run' : 'walk') : 'idle';
      character.play(want);
      this._setBroadcast(want);
    }

    // Active swing tracker — sample sword position vs target body sphere
    // every frame inside the hit window, fire onHit() exactly once per swing.
    this._tickSwing();
  }

  // -------------------------------------------------------------------------
  // Network helpers
  // -------------------------------------------------------------------------

  /** Returns the current animation state to broadcast. Locomotion → idle/walk/run is
   *  derived from velocity by Capsule, so we only override here for actions. */
  getBroadcastState() {
    return this._broadcastState;
  }

  /** Damage multiplier (block reduces incoming damage). */
  blockMitigation() {
    return this._blocking ? COMBAT.BLOCK_MITIGATION : 0;
  }

  // -------------------------------------------------------------------------
  // Internal — locks + animation
  // -------------------------------------------------------------------------

  _canAct() {
    if (!this.isAlive()) return false;
    if (this._lock === 'death') return false;
    if (this._lock === 'hit') return false;
    if (this._lock && this._lock !== 'block') return false;
    return true;
  }

  /** Compute lock duration. Prefers the actual clip wallclock duration so
   *  state-machine timing stays in sync with what the user sees on screen,
   *  even after Mixamo retarget speeds vary across animations. */
  _computeLockMs(state) {
    const action = this.capsule?.character?.actions?.[state];
    if (action) {
      const clip = action.getClip?.();
      const dur = clip?.duration ?? 0;
      const ts = action.getEffectiveTimeScale?.() ?? 1;
      if (dur > 0) return (dur / Math.max(0.01, ts)) * 1000;
    }
    return FALLBACK_DURATIONS_MS[state] ?? 500;
  }

  _enterLock(state) {
    this._lock = state;
    this._blocking = false;  // cancel block on action commit
    this._setBroadcast(state);
    this._playOneShot(state);
    const dur = this._computeLockMs(state);
    this._lockUntil = performance.now() + dur;
  }

  /** Reset + play a one-shot clip. LoopOnce + clampWhenFinished mean the
   *  clip holds its final frame after one play; without reset() a second
   *  call would no-op (already-clamped) and we'd never see the swing again. */
  _playOneShot(state) {
    const character = this.capsule?.character;
    const action = character?.actions?.[state];
    if (!action || !character?.mixer) return;

    // Crossfade out whatever is currently active.
    if (character.activeAction && character.activeAction !== action) {
      character.activeAction.fadeOut(0.08);
    }

    // Special-case: roll plays slightly faster so it reads as a snap-dodge
    // rather than a sluggish tumble. Other clips run at 1.0×.
    action.timeScale = (state === 'roll') ? COMBAT.ROLL_TIMESCALE : 1.0;
    action.reset().setEffectiveWeight(1).fadeIn(0.08).play();

    character.activeAction = action;
    character.activeName = state;
  }

  _setBroadcast(state) {
    if (state === this._broadcastState) return;
    this._broadcastState = state;
    this.onStateChange(state);
  }

  _drainStamina(cost) {
    if (this.stamina < cost) return false;
    this.stamina -= cost;
    this._staminaRegenAt = performance.now() + STAMINA_REGEN_DELAY_MS;
    return true;
  }

  // -------------------------------------------------------------------------
  // Internal — sword swept-sphere hit detection (souls-demo CombatSystem)
  // -------------------------------------------------------------------------

  _beginSwing(kind) {
    const stateName = kind === 'heavy' ? 'heavyAttack' : 'lightAttack';
    const action = this.capsule?.character?.actions?.[stateName];
    if (!action) { this._activeSwing = null; return; }
    this._activeSwing = {
      kind,
      action,
      hitWindow: kind === 'heavy' ? COMBAT.HEAVY_HIT_WINDOW : COMBAT.LIGHT_HIT_WINDOW,
      fired: false,
    };
  }

  _tickSwing() {
    const a = this._activeSwing;
    if (!a) return;
    const action = a.action;
    if (!action || !action.isRunning?.()) {
      this._activeSwing = null;
      return;
    }
    const clip = action.getClip?.();
    const dur = clip?.duration ?? 0;
    if (dur <= 0) return;
    const progress = action.time / dur;
    const [open, close] = a.hitWindow;
    if (a.fired) {
      if (progress >= 0.98) this._activeSwing = null;
      return;
    }
    if (progress < open || progress > close) {
      if (progress >= 0.98) this._activeSwing = null;
      return;
    }

    // Inside the hit window — sample sword position vs the per-frame
    // target list provided by Game.js via onHit's lookup function.
    const sword = this.sword;
    if (!sword) return;
    sword.updateWorldMatrix(true, false);
    sword.getWorldPosition(_swordTmp);

    const fired = this.onHit({
      kind: a.kind,
      swordPos: _swordTmp,
      bodyOffset: _bodyTmp.set(0, COMBAT.BODY_Y_OFFSET, 0),
    });
    if (fired) a.fired = true;
  }

}
