import Phaser from 'phaser';
import { GameConfig } from './core/GameConfig.js';
import { PX } from './core/Constants.js';
import { eventBus, Events } from './core/EventBus.js';
import { gameState } from './core/GameState.js';
import { initAudioBridge } from './audio/AudioBridge.js';
import { NetworkManager } from './systems/NetworkManager.js';

initAudioBridge();

const game = new Phaser.Game(GameConfig);

// === Multiplayer ===
// Sampler reads the local human tank's state and broadcasts in DESIGN-PIXEL
// space (canvas-pixel value divided by this client's PX). PX varies across
// clients with different window sizes / DPRs, so canvas-pixel coords would
// land at offset positions on receivers. Receivers multiply by their own PX.
const networkManager = new NetworkManager({
  eventBus,
  gameState,
  mode: 'realtime',
  sampler: () => {
    const scene = game.scene?.getScene('GameScene');
    const local = scene?.player;
    if (!local) return null;
    return {
      x: local.x / PX,
      y: local.y / PX,
      rotation: local.rotation,
      score: gameState.wins?.[local.colorName] ?? 0,
      alive: !!local.alive,
    };
  },
});

networkManager.init().catch(err => console.warn('[main] NetworkManager init failed', err));

window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;
window.__NETWORK_MANAGER__ = networkManager;

window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const activeScenes = game.scene.getScenes(true).map(s => s.scene.key);
  const gameScene = game.scene.getScene('GameScene');

  const payload = {
    coords: 'origin:top-left x:right y:down',
    mode: gameState.roundState,
    scene: activeScenes[0] || null,
    scenes: activeScenes,
    round: {
      number: gameState.roundNumber,
      wins: { ...gameState.wins },
      lastWinner: gameState.lastWinnerColor,
    },
  };

  if (gameScene && gameScene.tanks) {
    payload.tanks = gameScene.tanks.map(t => ({
      id: t.id,
      color: t.colorName,
      role: t.role,
      x: Math.round(t.x),
      y: Math.round(t.y),
      rotation: Math.round(t.rotation * 100) / 100,
      alive: t.alive,
    }));
    payload.bulletsCount = gameScene.bullets ? gameScene.bullets.length : 0;
  }

  // === Multiplayer ===
  payload.multiplayer = {
    roomId: gameState.multiplayer.roomId,
    playerId: gameState.multiplayer.playerId,
    connected: gameState.multiplayer.connected,
  };
  payload.remotePlayers = Object.entries(gameState.multiplayer.remotePlayers).map(
    ([id, p]) => ({
      id,
      x: typeof p.x === 'number' ? Math.round(p.x) : null,
      y: typeof p.y === 'number' ? Math.round(p.y) : null,
      rotation: typeof p.rotation === 'number' ? Math.round(p.rotation * 100) / 100 : null,
      alive: p.alive ?? null,
      name: p.name,
    })
  );

  return JSON.stringify(payload);
};

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
