import { Game } from './core/Game.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudio } from './audio/AudioBridge.js';

// Wire EventBus -> audio playback (BGM + SFX + mute)
initAudio();

const game = new Game();

// Expose for browser tests
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

// --- AI-readable game state snapshot ---
// Returns a concise JSON string for automated agents to understand the game
// without interpreting pixels.
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const payload = {
    // Coordinate system: x increases rightward, y increases upward, z toward camera (player runs in -Z)
    coords: 'origin:center x:right y:up z:toward-camera player-runs:-Z',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'idle',
    score: gameState.score,
    bestScore: gameState.bestScore,
    distance: Math.round(gameState.distance),
    heartsCollected: gameState.heartsCollected,
    speed: Math.round(gameState.speed * 100) / 100,
  };

  // Add player info when in gameplay
  if (gameState.started && game.player?.mesh) {
    const pos = game.player.mesh.position;
    payload.player = {
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
    };
  }

  // Active entity counts
  if (game.crowdPool) {
    payload.activeCrowdPeople = game.crowdPool.activeCount();
  }
  if (game.heartPool) {
    payload.activeHearts = game.heartPool.activeCount();
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
