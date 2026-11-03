import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';

const game = new Phaser.Game(GameConfig);

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

  const activeScenes = game.scene.getScenes(true).map(s => s.scene.key);
  const payload = {
    // Coordinate system: origin top-left, x increases rightward, y increases downward
    coords: 'origin:top-left x:right y:down',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'menu',
    scene: activeScenes[0] || null,
    scenes: activeScenes,
    score: gameState.score,
    bestScore: gameState.bestScore,
    survivalTime: gameState.survivalTime,
    currentSpeed: Math.round(gameState.currentSpeed * 100) / 100,
    combo: gameState.combo,
    bestCombo: gameState.bestCombo,
  };

  // Add player info when in gameplay
  const gameScene = game.scene.getScene('GameScene');
  if (gameState.started && gameScene?.player?.container?.body) {
    const c = gameScene.player.container;
    const body = c.body;
    payload.player = {
      x: Math.round(c.x),
      y: Math.round(c.y),
      vx: Math.round(body.velocity.x),
    };
  }

  // Add visible bits
  if (gameScene?.bitSpawner) {
    const activeBits = gameScene.bitSpawner.getActiveBits();
    payload.bits = activeBits.slice(0, 10).map(bit => ({
      x: Math.round(bit.container.x),
      y: Math.round(bit.container.y),
      char: bit.text.text,
    }));
    payload.activeBitCount = activeBits.length;
  }

  return JSON.stringify(payload);
};

// --- Deterministic time-stepping hook ---
// Lets automated test scripts advance the game by a precise duration.
// The game loop runs normally via RAF; this just waits for real time to elapse.
// For frame-precise control in browser tests, prefer page.clock.install() + runFor() (scripts/cdp.mjs).
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
