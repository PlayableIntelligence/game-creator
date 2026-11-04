import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { GAME } from './core/Constants.js';

const game = new Phaser.Game(GameConfig);

// Expose for browser tests
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

// --- AI-readable game state snapshot ---
// Returns a concise JSON string for automated agents to understand the game
// without interpreting pixels. Includes ship position, asteroid positions, score.
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const activeScenes = game.scene.getScenes(true).map(s => s.scene.key);
  const payload = {
    // Coordinate system: origin top-left, x increases rightward, y increases downward
    coords: 'origin:top-left x:right y:down',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'idle',
    scene: activeScenes[0] || null,
    scenes: activeScenes,
    score: gameState.score,
    bestScore: gameState.bestScore,
    gameWidth: GAME.WIDTH,
    gameHeight: GAME.HEIGHT,
  };

  // Add ship info when in gameplay
  const gameScene = game.scene.getScene('GameScene');
  if (gameState.started && gameScene?.ship?.sprite) {
    const s = gameScene.ship.sprite;
    payload.ship = {
      x: Math.round(s.x),
      y: Math.round(s.y),
      vx: Math.round(s.body.velocity.x),
    };
  }

  // Add visible asteroids
  if (gameScene?.asteroids) {
    const active = gameScene.asteroids.getChildren().filter(a => a.active);
    payload.asteroids = active.map(a => ({
      x: Math.round(a.x),
      y: Math.round(a.y),
      r: Math.round(a.asteroidRadius),
      vy: Math.round(a.body.velocity.y),
    }));
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
