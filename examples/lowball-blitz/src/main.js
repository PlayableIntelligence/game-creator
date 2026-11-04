import { Game } from './core/Game.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';
import { initPlayFun } from './playfun.js';

const game = new Game();

// --- Audio ---
initAudioBridge();

// --- Play.fun ---
initPlayFun().catch(err => console.warn('Play.fun init failed:', err));

// Init audio on first user interaction (browser autoplay policy)
let audioInitDone = false;
function initAudioOnce() {
  if (audioInitDone) return;
  audioInitDone = true;
  eventBus.emit(Events.AUDIO_INIT);
  // Start gameplay music after init (game auto-starts, no title screen)
  if (gameState.started && !gameState.gameOver) {
    eventBus.emit(Events.MUSIC_GAMEPLAY);
  }
}
window.addEventListener('click', initAudioOnce, { once: false });
window.addEventListener('touchstart', initAudioOnce, { once: false });
window.addEventListener('keydown', initAudioOnce, { once: false });

// M key toggles mute
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
  }
});

// Mute button click handler
const muteBtn = document.getElementById('mute-btn');
if (muteBtn) {
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
  });
  // Set initial icon based on persisted mute state
  if (gameState.isMuted) {
    muteBtn.textContent = '\u{1F507}';
    muteBtn.setAttribute('aria-label', 'Unmute audio');
  }
}

// On touch devices, shift mute button up above joystick zone
if (HAS_TOUCH) {
  if (muteBtn) {
    muteBtn.style.bottom = 'max(140px, calc(3vh + 120px))';
  }
}

// Expose for browser tests
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

// --- Combo HUD ---
// NOTE: Combo display updates (text, visible, mega classes) are handled
// by SpectacleSystem._onComboChanged via EventBus. No duplicate listener needed.

// --- Mobile UI ---
// Use touch capability detection (not user-agent) for consistent behavior
const HAS_TOUCH = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (HAS_TOUCH) {
  const throwBtn = document.getElementById('throw-btn');
  const hints = document.getElementById('mobile-hints');
  if (throwBtn) throwBtn.style.display = 'flex';
  if (hints) hints.style.display = 'block';

  // Throw button triggers throw via InputSystem (so Game.js auto-targeting works)
  // The throw button handler in InputSystem._setupThrowButton() already sets
  // _throwJustPressed, which Game.animate() reads to call _findThrowTarget().
  // No extra handler needed here — InputSystem owns the throw button.
}

// --- AI-readable game state snapshot ---
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const payload = {
    // Coordinate system: x increases rightward, y increases upward, z toward camera (player runs -Z)
    coords: 'origin:center x:right y:up z:toward-camera player-runs:-Z',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'menu',
    score: gameState.score,
    bestScore: gameState.bestScore,
    lives: gameState.lives,
    combo: gameState.combo,
    bestCombo: gameState.bestCombo,
    currentSpeed: Math.round(gameState.currentSpeed * 100) / 100,
    housesHit: gameState.housesHit,
    totalThrown: gameState.totalThrown,
  };

  // Add player info when in gameplay
  if (gameState.started && game.player?.mesh) {
    const pos = game.player.mesh.position;
    payload.player = {
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      invincible: game.player.isInvincible,
      envelopes: game.player.envelopes.length,
    };
  }

  // Nearby entities (within view distance of player)
  if (gameState.started && game.player?.mesh && game.streetGen) {
    const pz = game.player.mesh.position.z;

    // Nearby houses (within 30 units)
    const nearHouses = game.streetGen.houses
      .filter(h => Math.abs(h.mesh.position.z - pz) < 30)
      .map(h => ({
        x: Math.round(h.mesh.position.x),
        z: Math.round(h.mesh.position.z),
        hit: h.isHit,
        side: h.side,
      }));
    if (nearHouses.length > 0) payload.houses = nearHouses;

    // Nearby agents (within 20 units)
    const nearAgents = game.streetGen.agents
      .filter(a => a.alive && Math.abs(a.mesh.position.z - pz) < 20)
      .map(a => ({
        x: Math.round(a.mesh.position.x * 10) / 10,
        z: Math.round(a.mesh.position.z * 10) / 10,
      }));
    if (nearAgents.length > 0) payload.agents = nearAgents;

    // Nearby panic points (within 15 units)
    const nearPP = game.panicPoints
      .filter(pp => pp.alive && !pp.collected && Math.abs(pp.mesh.position.z - pz) < 15)
      .map(pp => ({
        x: Math.round(pp.mesh.position.x * 10) / 10,
        z: Math.round(pp.mesh.position.z * 10) / 10,
      }));
    if (nearPP.length > 0) payload.panicPoints = nearPP;
  }

  return JSON.stringify(payload);
};

// --- Deterministic time-stepping hook ---
window.advanceTime = (ms) => {
  return new Promise((resolve) => {
    const start = performance.now();
    function step() {
      if (performance.now() - start >= ms) return resolve();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
};
