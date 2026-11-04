// =============================================================================
// main.js — Entry point for Castle Siege Defense
// Inits game, exposes test globals, render_game_to_text, and advanceTime.
// =============================================================================

import { Game } from './core/Game.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';

// --- Audio system init ---
// Wire EventBus events to audio playback (BGM + SFX).
// Must happen before Game constructor so events are caught.
initAudioBridge();

const game = new Game();

// --- Audio unlock on first user interaction (browser autoplay policy) ---
let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  eventBus.emit(Events.AUDIO_INIT);
  // Start gameplay music after Strudel initializes
  setTimeout(() => eventBus.emit(Events.MUSIC_GAMEPLAY), 150);
}
window.addEventListener('click', unlockAudio, { once: false });
window.addEventListener('touchstart', unlockAudio, { once: false });
window.addEventListener('keydown', unlockAudio, { once: false });

// --- Mute toggle via M key ---
window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') {
    eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
    // Update mute button icon if present
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
      muteBtn.textContent = gameState.isMuted ? 'MUTED' : 'SOUND';
      muteBtn.title = gameState.isMuted ? 'Unmute (M)' : 'Mute (M)';
    }
  }
});

// --- Mute button click handler ---
const muteBtn = document.getElementById('mute-btn');
if (muteBtn) {
  // Set initial state from restored preference
  if (gameState.isMuted) {
    muteBtn.textContent = 'MUTED';
    muteBtn.title = 'Unmute (M)';
  }
  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Don't trigger projectile fire
    eventBus.emit(Events.AUDIO_TOGGLE_MUTE);
    muteBtn.textContent = gameState.isMuted ? 'MUTED' : 'SOUND';
    muteBtn.title = gameState.isMuted ? 'Unmute (M)' : 'Mute (M)';
  });
}

// Expose for browser tests
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

// --- AI-readable game state snapshot ---
// Returns a concise JSON string for automated agents to understand the game
// without interpreting pixels. Extend this as you add entities and mechanics.
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const payload = {
    // Coordinate system: x increases rightward, y increases upward, z toward camera
    coords: 'origin:center x:right y:up z:toward-camera',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'menu',
    score: gameState.score,
    bestScore: gameState.bestScore,
    wave: gameState.wave,
    castleHealth: gameState.castleHealth,
    maxCastleHealth: gameState.maxCastleHealth,
    enemiesKilled: gameState.enemiesKilled,
  };

  // Add active enemy info
  if (game.enemyManager) {
    const aliveEnemies = game.enemyManager.getAliveEnemies();
    payload.activeEnemies = aliveEnemies.length;
    payload.enemies = aliveEnemies.slice(0, 10).map(e => {
      const pos = e.getPosition();
      return {
        x: Math.round(pos.x * 10) / 10,
        z: Math.round(pos.z * 10) / 10,
      };
    });
  }

  // Active projectiles
  if (game.projectileManager) {
    payload.activeProjectiles = game.projectileManager.projectiles.length;
  }

  // Enemy castle presence
  if (game.enemyCastle) {
    payload.enemyCastle = {
      z: Math.round(game.enemyCastle.group.position.z * 10) / 10,
    };
  }

  return JSON.stringify(payload);
};

// --- Deterministic time-stepping hook ---
// Lets automated test scripts advance the game by a precise duration.
// The game loop runs normally via RAF; this just waits for real time to elapse.
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
