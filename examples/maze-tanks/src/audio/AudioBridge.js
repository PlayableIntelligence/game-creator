import { eventBus, Events } from '../core/EventBus.js';
import { gameState } from '../core/GameState.js';
import { audioManager } from './AudioManager.js';
import './sfx.js';
import './music.js';

const ENGINE_HUM_TARGET_GAIN = 0.10;
const ENGINE_HUM_RAMP_SEC = 0.06;

const _activeThrustTanks = new Set();
let _engineNodes = null;

function ensureEngineNodes() {
  if (_engineNodes) return _engineNodes;
  if (!audioManager.isReady()) return null;
  const ctx = audioManager.ctx;

  const oscA = ctx.createOscillator();
  oscA.type = 'sawtooth';
  oscA.frequency.value = 90;
  const oscB = ctx.createOscillator();
  oscB.type = 'sawtooth';
  oscB.frequency.value = 92;
  const oscC = ctx.createOscillator();
  oscC.type = 'square';
  oscC.frequency.value = 45;

  const lpf = ctx.createBiquadFilter();
  lpf.type = 'lowpass';
  lpf.frequency.value = 380;
  lpf.Q.value = 2;

  const gain = ctx.createGain();
  gain.gain.value = 0.0001;

  oscA.connect(lpf);
  oscB.connect(lpf);
  oscC.connect(lpf);
  lpf.connect(gain).connect(audioManager.sfxGain);

  oscA.start();
  oscB.start();
  oscC.start();

  _engineNodes = { gain, ctx };
  return _engineNodes;
}

function updateEngineGain() {
  const nodes = ensureEngineNodes();
  if (!nodes) return;
  const count = _activeThrustTanks.size;
  // Square-root scaling so 4 tanks aren't 4x louder than 1 — softer mix.
  const target = count > 0 ? ENGINE_HUM_TARGET_GAIN * Math.sqrt(count) / 2 : 0.0001;
  const now = nodes.ctx.currentTime;
  nodes.gain.gain.cancelScheduledValues(now);
  nodes.gain.gain.setTargetAtTime(target, now, ENGINE_HUM_RAMP_SEC);
}

export function initAudioBridge() {
  eventBus.on(Events.AUDIO_INIT, () => {
    audioManager.init();
    if (gameState.roundState === 'playing') {
      audioManager.startBgm('gameplay');
    }
  });

  eventBus.on(Events.MUSIC_GAMEPLAY, () => audioManager.startBgm('gameplay'));
  eventBus.on(Events.MUSIC_STOP, () => audioManager.stopBgm());

  eventBus.on(Events.TANK_FIRED, () => audioManager.playSfx('bulletFire'));
  eventBus.on(Events.BULLET_RICOCHET, (data) => {
    audioManager.playSfx('ricochet', { bounceCount: (data && data.bounceCount) || 1 });
  });
  eventBus.on(Events.TANK_DIED, () => audioManager.playSfx('tankExplode'));

  eventBus.on(Events.ROUND_COUNTDOWN, ({ secondsLeft }) => {
    if (secondsLeft > 0) audioManager.playSfx('roundCountdownBeep');
  });
  eventBus.on(Events.ROUND_STARTED, () => {
    audioManager.playSfx('roundCountdownBeep', { pitchHz: 1200 });
  });
  eventBus.on(Events.ROUND_ENDED, ({ winnerColor }) => {
    audioManager.playSfx(winnerColor ? 'roundWinFanfare' : 'roundDraw');
  });

  // Engine hum — a single shared sawtooth bed whose gain scales with how
  // many tanks are currently thrusting. Per-tank oscillators would mean up
  // to 12 oscillators on at once just for hum (4 tanks × 3 layers). The
  // shared-bed approach is ~3 oscillators total and reads as "tank engines"
  // sufficiently in a cluttered mix. Loose end documented in STEP3-DONE.md.
  eventBus.on(Events.TANK_THRUST_START, ({ tankId }) => {
    if (gameState.isMuted) return;
    _activeThrustTanks.add(tankId);
    updateEngineGain();
  });
  eventBus.on(Events.TANK_THRUST_END, ({ tankId }) => {
    _activeThrustTanks.delete(tankId);
    updateEngineGain();
  });
  // When tanks die or rounds reset, clear the thrust set so the engine bed
  // doesn't hum forever if a TANK_THRUST_END event got missed.
  eventBus.on(Events.TANK_DIED, ({ tankId }) => {
    _activeThrustTanks.delete(tankId);
    updateEngineGain();
  });
  eventBus.on(Events.ROUND_ENDED, () => {
    _activeThrustTanks.clear();
    updateEngineGain();
  });

  eventBus.on(Events.AUDIO_TOGGLE_MUTE, () => {
    const next = !gameState.isMuted;
    audioManager.setMuted(next);
    if (next) {
      audioManager.stopBgm();
      _activeThrustTanks.clear();
      updateEngineGain();
    } else if (gameState.roundState === 'playing') {
      audioManager.startBgm('gameplay');
    }
  });
}
