// =============================================================================
// main.js — Entry point for Rock 'Em Sock 'Em Robots
//
// Creates the Game instance, exposes test globals, and provides
// render_game_to_text() and advanceTime() for AI agents / browser tests.
// =============================================================================

import { Game } from './core/Game.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { COMBAT } from './core/Constants.js';

const game = new Game();

// Expose for browser tests
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

// --- AI-readable game state snapshot ---
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const payload = {
    // Coordinate system: x increases rightward, y increases upward, z toward camera
    coords: 'origin:center x:right y:up z:toward-camera',
    mode: gameState.gameOver ? 'game_over' : gameState.roundOver ? 'round_over' : gameState.started ? 'playing' : 'idle',
    score: gameState.score,
    bestScore: gameState.bestScore,
    round: gameState.score + 1,
    player: {
      headHealth: gameState.playerHeadHealth,
      maxHealth: COMBAT.MAX_HEAD_HEALTH,
      blocking: gameState.playerBlocking,
      punching: gameState.playerPunching,
      headPopped: gameState.playerHeadPopped,
    },
    opponent: {
      headHealth: gameState.opponentHeadHealth,
      maxHealth: COMBAT.MAX_HEAD_HEALTH,
      blocking: gameState.opponentBlocking,
      punching: gameState.opponentPunching,
      headPopped: gameState.opponentHeadPopped,
    },
    combo: gameState.combo,
    bestCombo: gameState.bestCombo,
  };

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
