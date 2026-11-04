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

// --- render_game_to_text: AI-readable game state snapshot ---
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const activeScenes = game.scene.getScenes(true).map(s => s.scene.key);
  const payload = {
    coords: 'origin:top-left x:right y:down',
    mode: gameState.gameOver ? 'game_over' : gameState.started ? 'playing' : 'menu',
    scene: activeScenes[0] || null,
    scenes: activeScenes,
    score: gameState.score,
    bestScore: gameState.bestScore,
  };

  // Add bird info when GameScene is active
  const gameScene = game.scene.getScene('GameScene');
  if (gameScene && gameScene.bird && gameScene.bird.sprite) {
    const bird = gameScene.bird;
    payload.bird = {
      x: Math.round(bird.sprite.x),
      y: Math.round(bird.sprite.y),
      vy: Math.round(bird.sprite.body?.velocity?.y || 0),
      alive: bird.alive,
    };
  }

  // Add visible pipe info
  if (gameScene && gameScene.pipeSpawner) {
    payload.pipes = gameScene.pipeSpawner.pipes
      .filter(p => p.top.x > -60 && p.top.x < game.config.width + 60)
      .map(p => ({
        x: Math.round(p.top.x),
        gapY: Math.round((p.top.y + p.top.height / 2 + p.bottom.y - p.bottom.height / 2) / 2),
        scored: p.scored,
      }));
  }

  return JSON.stringify(payload);
};

// --- advanceTime: controlled time progression for tests ---
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
