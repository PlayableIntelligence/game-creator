import { Game } from './core/Game.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';

// Load muted preference from localStorage
try {
  const savedMuted = localStorage.getItem('singularity-run-muted');
  if (savedMuted === 'true') {
    gameState.isMuted = true;
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
      muteBtn.textContent = 'MUTED';
      muteBtn.style.opacity = '0.3';
    }
  }
} catch (e) { /* localStorage unavailable */ }

// Initialize audio bridge before game so event listeners are ready
initAudioBridge();

const game = new Game();

// Init audio on first user interaction (browser autoplay policy)
function onFirstInteraction() {
  eventBus.emit(Events.AUDIO_INIT);
  eventBus.emit(Events.MUSIC_GAMEPLAY);
  document.removeEventListener('click', onFirstInteraction);
  document.removeEventListener('touchstart', onFirstInteraction);
}
document.addEventListener('click', onFirstInteraction);
document.addEventListener('touchstart', onFirstInteraction);

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
    // Coordinate system: x increases rightward, y increases upward, z toward camera (player runs in -Z)
    coords: 'origin:center x:right y:up z:toward-camera player-runs:-Z',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'idle',
    score: gameState.score,
    bestScore: gameState.bestScore,
  };

  // Add player info when in gameplay
  if (gameState.started && game.player) {
    const pos = game.player.mesh.position;
    payload.player = {
      lane: game.player.targetLane,
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      jumping: game.player.isJumping,
      sliding: game.player.isSliding,
    };
  }

  // Speed and distance
  payload.speed = Math.round(gameState.currentSpeed * 100) / 100;
  payload.distanceTraveled = Math.round(gameState.distanceTraveled * 100) / 100;

  // Nearest obstacle ahead
  if (game.obstacles && game.player) {
    const nearest = game.obstacles.getNearestObstacle(game.player.runZ);
    if (nearest) {
      payload.nearestObstacle = {
        type: nearest.type,
        z: Math.round(nearest.z * 100) / 100,
        lane: nearest.lane,
      };
    }
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
