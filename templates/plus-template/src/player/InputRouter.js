import { DEVICE, PLAYER } from '../core/Constants.js';
import { EventBus } from '../core/EventBus.js';

/**
 * InputRouter — keyboard + mouse + touch unified into a single per-frame
 * state object. Reads:
 *
 *   { forward, right, sprint, jumpQueued, lookDx, lookDy, locked }
 *
 *   - forward, right: axes in [-1, 1]. Camera-relative or world-relative
 *     interpretation is up to CameraMode.
 *   - sprint: held flag (Shift on desktop, sprint button on touch)
 *   - jumpQueued: one-shot, consumed by Capsule.fixedUpdate()
 *   - lookDx/Dy: pixel deltas since last consume(), reset to 0 each consume
 *   - locked: pointer lock state (only relevant on desktop; touch is always
 *     considered "locked" as long as the user is in the page)
 *
 * Pointer lock is requested on canvas click. On touch primary, lock is
 * skipped and the look pad provides direct deltas instead.
 */
export class InputRouter {
  /**
   * @param {HTMLElement} canvas  for pointer-lock + mouse-move filtering
   * @param {object} [opts]
   * @param {boolean} [opts.requestPointerLockOnClick=true]
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this._requestLockOnClick = opts.requestPointerLockOnClick !== false;

    this._keys = new Set();
    this._sprintHeld = false;
    this._jumpQueued = false;
    this._lookDx = 0;
    this._lookDy = 0;
    this._locked = false;

    // Touch joystick state — set by MobileControls
    this._touchMoveX = 0;        // [-1, 1]
    this._touchMoveY = 0;        // [-1, 1]   (forward = +1)
    this._touchSprintHeld = false;

    this._initKeyboardMouse();
  }

  _initKeyboardMouse() {
    // Skip mouse-look + pointer-lock on touch primary; MobileControls drives input
    if (DEVICE.isTouchPrimary) {
      this._initKeyboardOnly();
      return;
    }

    // Keyboard
    window.addEventListener('keydown', (e) => {
      const k = e.code;
      if (k === 'Space') { this._jumpQueued = true; e.preventDefault(); }
      if (k === 'ShiftLeft' || k === 'ShiftRight') this._sprintHeld = true;
      this._keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.code;
      if (k === 'ShiftLeft' || k === 'ShiftRight') this._sprintHeld = false;
      this._keys.delete(k);
    });

    // Mouse-look — only when locked
    window.addEventListener('mousemove', (e) => {
      if (!this._locked) return;
      this._lookDx += e.movementX * PLAYER.mouseSensitivity;
      this._lookDy += e.movementY * PLAYER.mouseSensitivity;
    });

    // Pointer lock
    document.addEventListener('pointerlockchange', () => {
      this._locked = document.pointerLockElement === this.canvas;
      EventBus.emit(this._locked ? 'pointer:locked' : 'pointer:unlocked');
    });

    if (this._requestLockOnClick) {
      this.canvas.addEventListener('click', () => {
        this.canvas.requestPointerLock?.();
      });
    }
  }

  /** Touch primary still wants keyboard if a Bluetooth keyboard is paired. */
  _initKeyboardOnly() {
    window.addEventListener('keydown', (e) => {
      const k = e.code;
      if (k === 'Space') { this._jumpQueued = true; e.preventDefault(); }
      if (k === 'ShiftLeft' || k === 'ShiftRight') this._sprintHeld = true;
      this._keys.add(k);
    });
    window.addEventListener('keyup', (e) => {
      const k = e.code;
      if (k === 'ShiftLeft' || k === 'ShiftRight') this._sprintHeld = false;
      this._keys.delete(k);
    });
    // Touch primary is always considered "locked" — input flows freely
    this._locked = true;
  }

  // ------- MobileControls API -----------------------------------------

  /** Virtual joystick: x = right (+1), y = forward (+1). Magnitudes <1 = sub-walk. */
  setTouchMove(x, y) {
    this._touchMoveX = x;
    this._touchMoveY = y;
  }

  /** Look-pad delta in pixels (mobile touch). Same accumulator as mouse-look,
   *  scaled by touch sensitivity. */
  applyTouchLook(dx, dy) {
    this._lookDx += dx * PLAYER.touchSensitivity;
    this._lookDy += dy * PLAYER.touchSensitivity;
  }

  setTouchSprint(on) { this._touchSprintHeld = !!on; }
  requestJump()      { this._jumpQueued = true; }

  // ------- Per-frame consume API --------------------------------------

  /**
   * Called once per render frame by Capsule + CameraMode. Returns the
   * accumulated state and resets one-shot accumulators (jumpQueued, lookDx/Dy).
   * Calling consume() twice in one frame is fine — second call returns zeros.
   */
  consume() {
    let f = 0, r = 0;
    if (this._keys.has('KeyW')) f += 1;
    if (this._keys.has('KeyS')) f -= 1;
    if (this._keys.has('KeyD')) r += 1;
    if (this._keys.has('KeyA')) r -= 1;
    f += this._touchMoveY;
    r += this._touchMoveX;

    // Clamp combined magnitude — keyboard + joystick can't exceed full speed
    const mag = Math.sqrt(f * f + r * r);
    if (mag > 1) {
      f /= mag;
      r /= mag;
    }

    const state = {
      forward:    f,
      right:      r,
      sprint:     this._sprintHeld || this._touchSprintHeld,
      jumpQueued: this._jumpQueued,
      lookDx:     this._lookDx,
      lookDy:     this._lookDy,
      locked:     this._locked,
    };
    // Reset one-shots
    this._jumpQueued = false;
    this._lookDx = 0;
    this._lookDy = 0;
    return state;
  }
}
