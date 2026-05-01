import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';

// Souls-style player HUD in the top-left: slim HP bar + estus flask count.
// Styled to echo BossUI (thin black bar, muted gold fill, serifed accents)
// so both bars read as the same game's UI. Updated reactively via EventBus;
// no per-frame polling.
export class PlayerHUD {
  constructor() {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed', left: '28px', top: '26px',
      display: 'flex', flexDirection: 'column',
      gap: '6px', zIndex: '7',
      pointerEvents: 'none', userSelect: 'none',
      fontFamily: 'ui-serif, Georgia, "Times New Roman", serif',
      color: '#b39a70',
    });

    const hpWrap = document.createElement('div');
    Object.assign(hpWrap.style, {
      width: '280px', height: '11px', background: '#0a0a0c',
      border: '1px solid #2a231a',
      boxShadow: '0 2px 6px rgba(0,0,0,0.7)',
    });
    this.hpFill = document.createElement('div');
    Object.assign(this.hpFill.style, {
      width: '100%', height: '100%', background: '#b07d4a',
      transformOrigin: 'left',
      transition: 'width 180ms ease-out, background 200ms ease-out',
    });
    hpWrap.appendChild(this.hpFill);

    // Stamina — slightly shorter than HP to read as "secondary". Mossy
    // green when full, desaturates toward olive at low stamina so you can
    // tell "stamina dangerously low" at a glance.
    const staminaWrap = document.createElement('div');
    Object.assign(staminaWrap.style, {
      width: '220px', height: '7px', background: '#0a0a0c',
      border: '1px solid #1e2418',
      boxShadow: '0 2px 4px rgba(0,0,0,0.6)',
    });
    this.staminaFill = document.createElement('div');
    Object.assign(this.staminaFill.style, {
      width: '100%', height: '100%', background: '#6a8f4a',
      transition: 'width 140ms linear, background 200ms ease-out',
    });
    staminaWrap.appendChild(this.staminaFill);

    const estusRow = document.createElement('div');
    Object.assign(estusRow.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      fontSize: '0.72rem', letterSpacing: '0.3em', textTransform: 'uppercase',
      textShadow: '0 2px 6px rgba(0,0,0,0.9)',
    });
    this.estusLabel = document.createElement('span');
    this.estusLabel.textContent = 'ESTUS ×3';
    estusRow.appendChild(this.estusLabel);

    this.root.appendChild(hpWrap);
    this.root.appendChild(staminaWrap);
    this.root.appendChild(estusRow);
    document.body.appendChild(this.root);

    eventBus.on(Events.PLAYER_DAMAGE,   () => this._render());
    eventBus.on(Events.STAMINA_CHANGE,  () => this._renderStamina());
    eventBus.on(Events.GAME_RESTART,    () => this._render());

    this._render();
    this._estusPoll = setInterval(() => this._renderEstus(), 200);
  }

  _render() {
    const frac = Math.max(0, gameState.playerHP / gameState.playerMaxHP);
    this.hpFill.style.width = `${frac * 100}%`;
    // Subtle colour shift when low — amber → cold red as HP bleeds out.
    if (frac < 0.25)      this.hpFill.style.background = '#7a2a22';
    else if (frac < 0.5)  this.hpFill.style.background = '#9a5a32';
    else                  this.hpFill.style.background = '#b07d4a';
    this._renderStamina();
    this._renderEstus();
  }

  _renderStamina() {
    const frac = Math.max(0, gameState.stamina / gameState.staminaMax);
    this.staminaFill.style.width = `${frac * 100}%`;
    // Desaturate + yellow-shift at low stamina so you *see* the exhaustion
    // window before you feel it by failing to act.
    if (frac < 0.2)       this.staminaFill.style.background = '#8a7030';
    else if (frac < 0.5)  this.staminaFill.style.background = '#6f8640';
    else                  this.staminaFill.style.background = '#6a8f4a';
  }

  _renderEstus() {
    // Player.estus isn't in gameState (it's per-player). Read from window
    // reference; falls back to '—' if the game hasn't wired up yet.
    const p = globalThis.__GAME__?.player;
    const n = p?.estus ?? 0;
    this.estusLabel.textContent = `ESTUS ×${n}`;
    this.estusLabel.style.opacity = n > 0 ? '1' : '0.45';
  }
}
