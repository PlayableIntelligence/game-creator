// =============================================================================
// main.js — Entry point for GigaChad Gym Simulator
// Creates Game instance, exposes test globals and AI-readable state snapshot.
// =============================================================================

import { Game } from './core/Game.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';
import { MuteButton } from './ui/MuteButton.js';

// Initialize audio bridge (wires EventBus events to Web Audio API)
// Non-blocking — if audio fails, game still works
try {
  initAudioBridge();
} catch (e) {
  console.warn('[main] Audio bridge init failed (game will work without audio):', e);
}

const game = new Game();

// Create mute button UI (bottom-right, M key shortcut)
try {
  new MuteButton();
} catch (e) {
  console.warn('[main] Mute button creation failed:', e);
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
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'idle',
    score: gameState.score,
    bestScore: gameState.bestScore,
    lives: gameState.lives,
    combo: gameState.combo,
    bestCombo: gameState.bestCombo,
    multiplier: gameState.multiplier,
    multiplierTimer: Math.round(gameState.multiplierTimer * 10) / 10,
    difficulty: gameState.difficulty,
    totalLifts: gameState.totalLifts,
  };

  // Player position
  if (game.player?.mesh) {
    const pos = game.player.mesh.position;
    payload.player = {
      x: Math.round(pos.x * 100) / 100,
      y: Math.round(pos.y * 100) / 100,
      z: Math.round(pos.z * 100) / 100,
    };
  }

  // Active falling weights
  if (game.weightManager?.activeWeights) {
    payload.weights = game.weightManager.activeWeights
      .filter(w => !w.caught)
      .map(w => ({
        type: w.type.name,
        x: Math.round(w.group.position.x * 100) / 100,
        y: Math.round(w.group.position.y * 100) / 100,
        points: w.type.points,
      }));
  }

  // Active powerups
  if (game.powerupManager?.activePowerups) {
    payload.powerups = game.powerupManager.activePowerups.map(p => ({
      x: Math.round(p.group.position.x * 100) / 100,
      y: Math.round(p.group.position.y * 100) / 100,
    }));
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
