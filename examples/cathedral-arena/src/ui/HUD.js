import { HUD as HUD_CONFIG, DEVICE } from '../core/Constants.js';

/**
 * HUD — FPS counter + slot accessors for game UI.
 *
 * Slots are named by corner (#hud-tl, #hud-tr, #hud-bl, #hud-br) and the
 * top-right corner is reserved for the FPS counter. Game code can append
 * widgets to any slot via getSlot('tl' | 'tr' | 'bl' | 'br').
 *
 * The FPS counter exposes {calls, tris} setters so subsystems can pipe
 * accurate post-composer numbers in (see step 10 — renderer.info.reset()
 * before composer.render).
 */
export class HUD {
  constructor() {
    this.enabled = HUD_CONFIG.enabled;
    this.fpsEl = document.getElementById('hud-fps');
    this.slots = {
      tl: document.getElementById('hud-tl'),
      tr: document.getElementById('hud-tr'),
      bl: document.getElementById('hud-bl'),
      br: document.getElementById('hud-br'),
    };
    this._fpsSamples = [];
    this._lastDrawCalls = 0;
    this._lastTriangles = 0;
  }

  /** Game code uses this to drop UI into a corner. Mobile-friendly margins
   *  already applied via CSS. */
  getSlot(corner) {
    return this.slots[corner];
  }

  /** Subsystems pipe in renderer.info numbers (captured BEFORE composer's
   *  final blit so they reflect actual scene work, not the OutputPass). */
  setRenderStats(calls, triangles) {
    this._lastDrawCalls = calls;
    this._lastTriangles = triangles;
  }

  /** Per-frame tick. dt in seconds (from THREE.Clock.getDelta()). */
  update(dt) {
    if (!this.enabled || !this.fpsEl) return;

    this._fpsSamples.push(dt);
    if (this._fpsSamples.length > HUD_CONFIG.fpsSamples) this._fpsSamples.shift();

    const avg = this._fpsSamples.reduce((a, b) => a + b, 0) / this._fpsSamples.length;
    const fps = 1 / avg;
    const ms = avg * 1000;

    const tris = this._lastTriangles;
    const trisFmt = tris > 1e6
      ? `${(tris / 1e6).toFixed(1)}M`
      : tris > 0
        ? `${(tris / 1e3).toFixed(0)}k`
        : '—';

    const callsFmt = this._lastDrawCalls > 0 ? `${this._lastDrawCalls} calls` : '—';

    this.fpsEl.textContent = `${fps.toFixed(0)} fps · ${ms.toFixed(1)} ms · ${callsFmt} · ${trisFmt} tris`;
    this.fpsEl.className =
      fps < HUD_CONFIG.fpsBad ? 'bad' :
      fps < HUD_CONFIG.fpsWarn ? 'warn' : '';
  }

  /** Hide the boot overlay (call after all subsystems are ready). */
  static dismissBoot() {
    const boot = document.getElementById('boot');
    if (!boot) return;
    boot.classList.add('gone');
    setTimeout(() => { boot.style.display = 'none'; }, 500);
  }

  /** Update boot status text. */
  static setBootStatus(s) {
    const el = document.getElementById('boot-status');
    if (el) el.textContent = s;
  }

  /** Show device + renderer profile in console (debug aid for mobile testing). */
  static logDeviceProfile() {
    console.info(
      `[Device] touch=${DEVICE.isTouchPrimary} mobile=${DEVICE.isMobile} ` +
      `dpr=${DEVICE.pixelRatio} (cap ${DEVICE.dprCap}) ` +
      `viewport=${DEVICE.viewport.width}×${DEVICE.viewport.height}`,
    );
  }
}
