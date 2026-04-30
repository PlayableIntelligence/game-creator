import { gameState } from '../core/GameState.js';

const MASTER_VOLUME = 0.7;

class AudioManager {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.bgmGain = null;
    this.sfxGain = null;
    this._currentBgm = null;
    this._sfxRegistry = {};
    this._bgmRegistry = {};
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = gameState.isMuted ? 0 : MASTER_VOLUME;
      this.masterGain.connect(this.ctx.destination);

      this.bgmGain = this.ctx.createGain();
      this.bgmGain.gain.value = 0.6;
      this.bgmGain.connect(this.masterGain);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 1.0;
      this.sfxGain.connect(this.masterGain);
    } catch (err) {
      console.warn('[Audio] init failed:', err);
      this.ctx = null;
    }
  }

  isReady() {
    return !!this.ctx;
  }

  registerSfx(name, fn) {
    this._sfxRegistry[name] = fn;
  }

  registerBgm(name, fn) {
    this._bgmRegistry[name] = fn;
  }

  playSfx(name, opts) {
    if (!this.ctx || gameState.isMuted) return;
    const fn = this._sfxRegistry[name];
    if (!fn) return;
    try {
      fn(this.ctx, this.sfxGain, opts || {});
    } catch (err) {
      console.warn(`[Audio] sfx '${name}' failed:`, err);
    }
  }

  startBgm(name) {
    if (!this.ctx) return;
    if (this._currentBgm && this._currentBgm.name === name) return;
    this.stopBgm();
    const fn = this._bgmRegistry[name];
    if (!fn) return;
    try {
      const handle = fn(this.ctx, this.bgmGain);
      this._currentBgm = { name, handle };
    } catch (err) {
      console.warn(`[Audio] bgm '${name}' failed:`, err);
    }
  }

  stopBgm() {
    if (!this._currentBgm) return;
    try {
      this._currentBgm.handle && this._currentBgm.handle.stop && this._currentBgm.handle.stop();
    } catch (_) {}
    this._currentBgm = null;
  }

  setMuted(muted) {
    gameState.isMuted = muted;
    try { localStorage.setItem('muted', muted ? 'true' : 'false'); } catch (_) {}
    if (!this.masterGain || !this.ctx) return;
    const target = muted ? 0 : MASTER_VOLUME;
    const now = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.02);
  }
}

export const audioManager = new AudioManager();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    audioManager.stopBgm();
  });
}
