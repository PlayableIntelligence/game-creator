import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';
import { GAME } from './core/Constants.js';

initAudioBridge();

const game = new Phaser.Game(GameConfig);

// Expose for browser tests
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;

/**
 * Returns a concise JSON string of the current game state for AI agents.
 * Coordinate system: top-left origin, x-right, y-down.
 */
window.render_game_to_text = function () {
  const gs = gameState;
  const gameScene = game.scene.getScene('GameScene');
  const player = gameScene?.player;

  const state = {
    note: 'origin=top-left, x=right, y=down',
    canvas: { width: GAME.WIDTH, height: GAME.HEIGHT },
    mode: gs.gameOver ? (gs.won ? 'won' : 'game_over') : (gs.started ? 'playing' : 'idle'),
    score: gs.score,
    kills: gs.kills,
    time: Math.floor(gs.elapsedTime),
    level: gs.level,
    player: player ? {
      x: Math.round(player.sprite.x),
      y: Math.round(player.sprite.y),
      hp: Math.ceil(gs.hp),
      maxHp: gs.maxHp,
      vx: Math.round(player.sprite.body?.velocity?.x || 0),
      vy: Math.round(player.sprite.body?.velocity?.y || 0),
    } : null,
    weapons: gs.weapons.map(w => `${w}:${gs.weaponLevels[w] || 1}`),
    xp: { current: gs.xp, toNext: gs.xpToNext },
    enemies: gameScene?.enemySpawner
      ? gameScene.enemySpawner.getEnemies().length
      : 0,
  };

  return JSON.stringify(state);
};

/**
 * Advances the game by the given number of milliseconds.
 * Returns a Promise that resolves after the time has elapsed.
 */
window.advanceTime = function (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};
