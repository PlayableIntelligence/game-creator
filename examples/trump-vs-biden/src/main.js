// =============================================================================
// main.js — Entry point. Creates Game instance, exposes test globals,
// provides render_game_to_text() and advanceTime() for AI agents.
// =============================================================================

import { Game } from './core/Game.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';

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
    // Coordinate system: x increases rightward, y increases upward, z toward camera
    coords: 'origin:center x:right y:up z:toward-camera',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'menu',
    score: gameState.score,
    bestScore: gameState.bestScore,
    health: gameState.health,
    combo: gameState.combo,
  };

  // Add player info
  if (gameState.started && game.player?.mesh) {
    const pos = game.player.mesh.position;
    payload.player = {
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
      throwCooldown: Math.round(game.player.throwCooldown * 100) / 100,
    };
  }

  // Add opponent info
  if (gameState.started && game.opponent?.mesh) {
    const pos = game.opponent.mesh.position;
    payload.opponent = {
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
    };
  }

  // Add active projectile count
  if (game.projectileManager) {
    payload.projectiles = game.projectileManager.projectiles.length;
  }

  return JSON.stringify(payload);
};

// --- Deterministic time-stepping hook ---
// Lets automated test scripts advance the game by a precise duration.
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
