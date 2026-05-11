import { DEVICE } from '../core/Constants.js';

/**
 * MobileControls — virtual joystick (left) + look pad (right) + sprint/jump
 * buttons. Mounted only when `DEVICE.isTouchPrimary` is true.
 *
 * Pattern:
 *   - Joystick is a circular pad in the bottom-left. Drag from anywhere
 *     INSIDE it to set move axes. Release → axes return to 0.
 *   - Look pad is the entire right half of the screen. Drag anywhere on it
 *     to feed delta to InputRouter.applyTouchLook(). Release = drag ends.
 *   - Sprint button = bottom-left corner above joystick.
 *   - Jump button = bottom-right corner.
 *
 * All visuals are inline DOM (no images, no fonts). Translucent so the
 * scene shows through.
 */
export class MobileControls {
  constructor(input) {
    if (!DEVICE.isTouchPrimary) {
      this.mounted = false;
      return;
    }
    this.input = input;
    this.mounted = true;
    this._mountDom();
    this._wire();
    document.body.classList.add('is-touch');
    console.info('[MobileControls] mounted (touch primary)');
  }

  _mountDom() {
    const css = `
      .mc-joystick { position: fixed; left: 1.5rem; bottom: 1.5rem; width: 7rem; height: 7rem;
        border-radius: 50%; background: rgba(50,60,80,0.25); border: 1px solid rgba(180,200,220,0.3);
        touch-action: none; pointer-events: auto; z-index: 50; }
      .mc-joystick-knob { position: absolute; left: 50%; top: 50%; width: 3rem; height: 3rem;
        margin-left: -1.5rem; margin-top: -1.5rem; border-radius: 50%;
        background: rgba(180,200,220,0.6); pointer-events: none; transition: transform 0.05s linear; }
      .mc-look { position: fixed; right: 0; top: 0; bottom: 0; width: 50vw;
        touch-action: none; pointer-events: auto; z-index: 49; }
      .mc-button { position: fixed; width: 4rem; height: 4rem; border-radius: 50%;
        background: rgba(50,60,80,0.35); border: 1px solid rgba(180,200,220,0.4);
        color: #ccd; font: inherit; font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase;
        touch-action: none; pointer-events: auto; user-select: none; z-index: 50;
        display: flex; align-items: center; justify-content: center; }
      .mc-button:active { background: rgba(180,200,220,0.45); }
      .mc-sprint { left: 1.5rem; bottom: 9.5rem; }
      .mc-jump   { right: 1.5rem; bottom: 1.5rem; width: 5rem; height: 5rem; font-size: 0.8rem; }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    this.joystick      = el('div', 'mc-joystick');
    this.joystickKnob  = el('div', 'mc-joystick-knob');
    this.joystick.appendChild(this.joystickKnob);

    this.lookPad = el('div', 'mc-look');

    this.sprintBtn = el('button', 'mc-button mc-sprint', 'sprint');
    this.jumpBtn   = el('button', 'mc-button mc-jump',   'jump');

    document.body.appendChild(this.joystick);
    document.body.appendChild(this.lookPad);
    document.body.appendChild(this.sprintBtn);
    document.body.appendChild(this.jumpBtn);
  }

  _wire() {
    // Joystick
    let joyId = -1;
    let joyCx = 0, joyCy = 0, joyR = 0;
    const setJoy = (x, y) => {
      const dx = x - joyCx, dy = y - joyCy;
      const mag = Math.hypot(dx, dy);
      const clamp = Math.min(mag, joyR);
      const nx = mag > 0 ? (dx / mag) * (clamp / joyR) : 0;
      const ny = mag > 0 ? (dy / mag) * (clamp / joyR) : 0;
      this.joystickKnob.style.transform = `translate(${nx * joyR}px, ${ny * joyR}px)`;
      // ny is screen-Y (down=positive); forward should be UP (-screen-Y)
      this.input.setTouchMove(nx, -ny);
    };
    this.joystick.addEventListener('pointerdown', (e) => {
      const r = this.joystick.getBoundingClientRect();
      joyCx = r.left + r.width / 2;
      joyCy = r.top  + r.height / 2;
      joyR  = r.width / 2;
      joyId = e.pointerId;
      this.joystick.setPointerCapture(e.pointerId);
      setJoy(e.clientX, e.clientY);
      e.preventDefault();
    });
    this.joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== joyId) return;
      setJoy(e.clientX, e.clientY);
    });
    const joyEnd = (e) => {
      if (e.pointerId !== joyId) return;
      joyId = -1;
      this.joystickKnob.style.transform = '';
      this.input.setTouchMove(0, 0);
    };
    this.joystick.addEventListener('pointerup',     joyEnd);
    this.joystick.addEventListener('pointercancel', joyEnd);

    // Look pad
    let lookId = -1, lastX = 0, lastY = 0;
    this.lookPad.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      lastX  = e.clientX;
      lastY  = e.clientY;
      this.lookPad.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.lookPad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      this.input.applyTouchLook(dx, dy);
    });
    const lookEnd = (e) => { if (e.pointerId === lookId) lookId = -1; };
    this.lookPad.addEventListener('pointerup',     lookEnd);
    this.lookPad.addEventListener('pointercancel', lookEnd);

    // Sprint button (held)
    const sprintDown = (e) => { this.input.setTouchSprint(true);  e.preventDefault(); };
    const sprintUp   = (e) => { this.input.setTouchSprint(false); e.preventDefault(); };
    this.sprintBtn.addEventListener('pointerdown',   sprintDown);
    this.sprintBtn.addEventListener('pointerup',     sprintUp);
    this.sprintBtn.addEventListener('pointercancel', sprintUp);
    this.sprintBtn.addEventListener('pointerleave',  sprintUp);

    // Jump button (one-shot)
    this.jumpBtn.addEventListener('pointerdown', (e) => {
      this.input.requestJump();
      e.preventDefault();
    });
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
