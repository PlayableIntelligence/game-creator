import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';

initAudioBridge();

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
    lives: gameState.lives,
    difficulty: gameState.difficulty,
    muted: gameState.isMuted,
  };

  // Add player info when in gameplay
  const gameScene = game.scene.getScene('GameScene');
  if (gameState.started && gameScene?.player?.sprite?.body) {
    const s = gameScene.player.sprite;
    const body = s.body;
    payload.player = {
      x: Math.round(s.x),
      y: Math.round(s.y),
      vx: Math.round(body.velocity.x),
    };
  }

  // Count active gems and skulls on screen
  if (gameScene && gameState.started) {
    payload.gems = gameScene.gems ? gameScene.gems.getLength() : 0;
    payload.skulls = gameScene.skulls ? gameScene.skulls.getLength() : 0;
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
