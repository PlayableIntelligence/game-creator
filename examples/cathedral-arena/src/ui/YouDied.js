import { eventBus, Events } from '../core/EventBus.js';

// Fullscreen "YOU DIED" overlay. Fades in on PLAYER_DEATH, holds, then fades
// out while emitting GAME_RESTART so the Player/Game can respawn cleanly.
// Pure DOM — no three.js dependency. Subscribe-once pattern: the event sub
// lives for the lifetime of the object.
export class YouDied {
  constructor({ text = 'YOU DIED', holdMs = 2500, fadeMs = 800, respawnMs = 600 } = {}) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', inset: '0',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, rgba(40,0,0,0.4) 0%, rgba(0,0,0,0.85) 80%)',
      color: '#a01f1f',
      fontFamily: 'ui-serif, Georgia, "Times New Roman", serif',
      fontSize: '4.5rem',
      fontWeight: '400',
      letterSpacing: '0.25em',
      textTransform: 'uppercase',
      textShadow: '0 4px 24px rgba(0,0,0,0.95), 0 0 40px rgba(120, 10, 10, 0.6)',
      pointerEvents: 'none',
      opacity: '0',
      transition: `opacity ${fadeMs}ms ease-out`,
      zIndex: '11',
    });
    this.root.textContent = text;
    document.body.appendChild(this.root);

    this.holdMs = holdMs;
    this.fadeMs = fadeMs;
    this.respawnMs = respawnMs;

    eventBus.on(Events.PLAYER_DEATH, () => this._run());
  }

  _run() {
    // Frame-coalescing: if we're in a death cycle already, don't double-fire.
    if (this._running) return;
    this._running = true;

    // Defer one frame so the opacity transition actually fires (start at 0
    // then write 1 — instantaneous writes collapse in the same frame).
    requestAnimationFrame(() => { this.root.style.opacity = '1'; });

    setTimeout(() => {
      this.root.style.opacity = '0';
      // Hand back control after the fade-out completes.
      setTimeout(() => {
        this._running = false;
        eventBus.emit(Events.GAME_RESTART, {});
      }, this.fadeMs + this.respawnMs);
    }, this.holdMs);
  }
}
