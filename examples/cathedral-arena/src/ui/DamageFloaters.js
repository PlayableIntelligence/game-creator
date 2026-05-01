import * as THREE from 'three';
import { eventBus, Events } from '../core/EventBus.js';

// DOM-based damage number floaters. On each hit, a small div is created at
// the screen-projected impact point, animates upward and fades over ~700ms,
// then removes itself. No pooling yet — one burst per swing is rare enough
// that the DOM churn isn't measurable.
//
// Every frame we re-project each live floater's anchor point through the
// camera so the number "sticks" to where the hit was even as the camera
// moves. Behind-camera projections (z > 1) get opacity 0 instead of
// flipping to the other side of the screen.

const LIFE = 0.75;               // seconds
const RISE_PX = 56;              // vertical drift over LIFE
const BOSS_COLOR = '#f0b862';    // warm amber
const PLAYER_COLOR = '#e5504a';  // cold red — reads as bad news

export class DamageFloaters {
  constructor(camera) {
    this.camera = camera;
    this.live = [];
    this._tmp = new THREE.Vector3();

    eventBus.on(Events.BOSS_DAMAGE,   (p) => {
      if (!p || p.iframed || p.damage <= 0 || !p.point) return;
      this._spawn(p.point, p.damage, BOSS_COLOR, false);
    });
    eventBus.on(Events.PLAYER_DAMAGE, (p) => {
      if (!p || p.iframed || p.damage <= 0 || !p.point) return;
      this._spawn(p.point, p.damage, PLAYER_COLOR, p.blocked);
    });
  }

  _spawn(worldPoint, damage, color, blocked) {
    const el = document.createElement('div');
    Object.assign(el.style, {
      position: 'fixed',
      fontFamily: 'ui-serif, Georgia, "Times New Roman", serif',
      fontSize: blocked ? '1.2rem' : '1.8rem',
      fontWeight: '500',
      color,
      textShadow: '0 2px 8px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.4)',
      pointerEvents: 'none',
      userSelect: 'none',
      zIndex: '8',
      transform: 'translate(-50%, -100%)',
      willChange: 'transform, opacity',
      opacity: '1',
      letterSpacing: '0.05em',
    });
    el.textContent = blocked ? `(${damage})` : `-${damage}`;
    document.body.appendChild(el);
    this.live.push({
      el,
      anchor: worldPoint.clone(),
      elapsed: 0,
    });
  }

  update(delta) {
    if (this.live.length === 0) return;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const f = this.live[i];
      f.elapsed += delta;
      if (f.elapsed >= LIFE) {
        f.el.remove();
        this.live.splice(i, 1);
        continue;
      }
      const t = f.elapsed / LIFE;
      // Project world anchor to NDC, then to screen. >1 on z = behind camera.
      this._tmp.copy(f.anchor).project(this.camera);
      if (this._tmp.z > 1) { f.el.style.opacity = '0'; continue; }
      const sx = (this._tmp.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (1 - (this._tmp.y * 0.5 + 0.5)) * window.innerHeight;
      const ty = sy - t * RISE_PX;
      // Ease-out on opacity so the number holds readable for the first half
      // of its life then fades fast.
      const a = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      f.el.style.left = `${sx}px`;
      f.el.style.top  = `${ty}px`;
      f.el.style.opacity = `${a}`;
    }
  }
}
