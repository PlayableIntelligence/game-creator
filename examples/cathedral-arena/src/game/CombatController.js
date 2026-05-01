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
 *   - per-action timers + auto-fall-through to idle when an anim wraps
 *
 * The Capsule retains authority over translation. CombatController only
 * touches the AnimatedCharacter mixer + listens for input events.
 *
 * Animation states ride on top of the existing idle/walk/run mix that
 * AnimatedCharacter.play() already drives — when `_lock` is set, we override
 * Capsule's locomotion choice with the action clip until the timer expires.
 */

// Greatsword tuning — copied from souls-demo PROPS.greatsword.player
const SWORD_PATH      = '/assets/props/greatsword.fbx';
const SWORD_SCALE     = 0.0025;
const SWORD_POSITION  = [0.175, -0.0296, -0.1759];
const SWORD_ROTATION  = [Math.PI, 0.576, Math.PI / 2];

// Per-state timing (ms) — tuned to feel snappy without clipping animations
const STATE_DURATIONS_MS = {
  lightAttack: 800,
  heavyAttack: 1200,
  roll:        650,
  hit:         400,
  death:       2000,   // hold final frame
};

// Stamina costs
const STAMINA_COST = {
  lightAttack: 18,
  heavyAttack: 32,
  roll:        25,
  // block is passive — drained on absorbed hits, not on press
};

const STAMINA_REGEN_PER_SEC = 35;
const STAMINA_REGEN_DELAY_MS = 600;
const STAMINA_MAX = 100;

export class CombatController {
  constructor({ capsule, scene, onStateChange, isAlive }) {
    this.capsule = capsule;
    this.scene = scene;
    this.onStateChange = onStateChange ?? (() => {});
    this.isAlive = isAlive ?? (() => true);

    // State
    this._lock = null;             // null | 'lightAttack' | 'heavyAttack' | 'roll' | 'hit' | 'death'
    this._lockUntil = 0;
    this._blocking = false;
    this.stamina = STAMINA_MAX;
    this._staminaRegenAt = 0;

    // Animation state we report to the network — locomotion is auto-driven by
    // AnimatedCharacter, but action overrides (attack/roll/etc) need to go
    // out as discrete events for remotes to mirror.
    this._broadcastState = 'idle';
    this._lastBroadcastState = 'idle';

    // Sword
    this.sword = null;
    this._handBone = null;

    // i-frames during roll (can't take damage)
    this.invulnerable = false;
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

  /** LMB → light attack. Returns true if the swing started (caller broadcasts). */
  lightAttack() {
    if (!this._canAct() || !this._drainStamina(STAMINA_COST.lightAttack)) return false;
    this._enterLock('lightAttack');
    return true;
  }

  /** RMB → heavy attack. */
  heavyAttack() {
    if (!this._canAct() || !this._drainStamina(STAMINA_COST.heavyAttack)) return false;
    this._enterLock('heavyAttack');
    return true;
  }

  /** Space → dodge roll. Grants i-frames during the roll window. */
  roll() {
    if (!this._canAct() || !this._drainStamina(STAMINA_COST.roll)) return false;
    this._enterLock('roll');
    this.invulnerable = true;
    setTimeout(() => { this.invulnerable = false; }, STATE_DURATIONS_MS.roll * 0.6);
    return true;
  }

  /** F (held) → block. Passive; reduces incoming damage when absorbing. */
  setBlocking(on) {
    if (this._lock && this._lock !== 'block') return;  // can't enter block mid-attack
    this._blocking = !!on;
    if (this._blocking) {
      this._lock = 'block';
      this._lockUntil = Infinity;
      this._setBroadcast('block');
      this.capsule?.character?.play?.('block');
    } else if (this._lock === 'block') {
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
    this.stamina = STAMINA_MAX;
    this._setBroadcast('idle');
  }

  /** Per-frame tick. Called from Game.onUpdate. */
  update(dt) {
    // Lock expiry
    const now = performance.now();
    if (this._lock && now >= this._lockUntil && this._lock !== 'death' && this._lock !== 'block') {
      this._lock = null;
      this._lockUntil = 0;
      this._setBroadcast('idle');
    }

    // Stamina regen
    if (this.stamina < STAMINA_MAX && now >= this._staminaRegenAt) {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN_PER_SEC * dt);
    }

    // CombatController is the sole driver of the local character's animation
    // when present (Capsule.syncMesh detects `capsule.combat` and skips its
    // own play()-call so we don't fight). When locked, play the action; when
    // unlocked, derive locomotion from the capsule's movement intent flags.
    const character = this.capsule?.character;
    if (!character?.loaded) return;
    if (this._lock) {
      character.play(this._lock);
    } else {
      const moving = this.capsule._movingHoriz;
      const sprinting = this.capsule._sprinting;
      const want = moving ? (sprinting ? 'run' : 'walk') : 'idle';
      character.play(want);
      // Keep the broadcast state in sync with locomotion so remotes mirror it.
      this._setBroadcast(want);
    }
  }

  // -------------------------------------------------------------------------
  // Network helpers
  // -------------------------------------------------------------------------

  /** Returns the current state to broadcast. Locomotion → idle/walk/run is
   *  derived from velocity by Capsule, so we only override here for actions. */
  getBroadcastState() {
    if (this._lock) return this._lock;
    // Defer to capsule locomotion
    return this.capsule?.character?.activeName ?? 'idle';
  }

  /** Returns true if local player should be considered "swinging" right now —
   *  used by Game.js to gate hitbox checks to a window during the swing. */
  isAttackActive() {
    if (this._lock !== 'lightAttack' && this._lock !== 'heavyAttack') return false;
    // Hitbox window is the middle 40% of the attack — early frames are
    // wind-up, late frames are recovery.
    const elapsed = STATE_DURATIONS_MS[this._lock] - (this._lockUntil - performance.now());
    const total = STATE_DURATIONS_MS[this._lock];
    const t = elapsed / total;
    return t > 0.30 && t < 0.70;
  }

  /** Damage multiplier (block reduces incoming damage). */
  blockMitigation() {
    return this._blocking ? COMBAT.BLOCK_MITIGATION : 0;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  _canAct() {
    if (!this.isAlive()) return false;
    if (this._lock === 'death') return false;
    if (this._lock === 'hit') return false;
    if (this._lock && this._lock !== 'block') return false;
    return true;
  }

  _enterLock(state) {
    this._lock = state;
    const dur = STATE_DURATIONS_MS[state] ?? 500;
    this._lockUntil = performance.now() + dur;
    this._blocking = false;  // cancel block on action commit
    this._setBroadcast(state);
    this.capsule?.character?.play?.(state);
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
}
