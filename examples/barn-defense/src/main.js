// =============================================================================
// Barn Defense - Entry Point
// Creates the Phaser game instance and exposes test globals.
// =============================================================================

import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { GAME } from './core/Constants.js';
import { initAudioBridge } from './audio/AudioBridge.js';

// Initialize audio bridge before Phaser game creation
initAudioBridge();

const game = new Phaser.Game(GameConfig);

// Expose for browser tests
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

// ---------------------------------------------------------------------------
// render_game_to_text()  --  AI-readable snapshot of current game state
// ---------------------------------------------------------------------------
window.render_game_to_text = function () {
  const state = {
    note: `Coordinate system: ${GAME.WIDTH}x${GAME.HEIGHT}, origin top-left, grid ${GAME.GRID_COLS}x${GAME.GRID_ROWS}`,
    mode: gameState.gameOver ? 'game_over' : gameState.levelComplete ? 'level_complete' : 'playing',
    level: gameState.currentLevel + 1,
    wave: `${gameState.currentWave}/${gameState.totalWaves}`,
    waveInProgress: gameState.waveInProgress,
    gold: gameState.corn,
    lives: gameState.lives,
    towersPlaced: gameState.towersPlaced.length,
    enemiesAlive: gameState.enemiesAlive,
    gameSpeed: gameState.gameSpeed,
  };
  return JSON.stringify(state);
};

// ---------------------------------------------------------------------------
// advanceTime(ms)  --  resolves after ms real-time milliseconds
// ---------------------------------------------------------------------------
window.advanceTime = function (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
