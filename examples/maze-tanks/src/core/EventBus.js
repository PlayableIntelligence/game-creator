export const Events = {
  // Game lifecycle
  GAME_START: 'game:start',
  GAME_OVER: 'game:over',
  GAME_RESTART: 'game:restart',

  // Tanks
  TANK_SPAWNED: 'tank:spawned',
  TANK_FIRED: 'tank:fired',
  TANK_DIED: 'tank:died',
  TANK_THRUST_START: 'tank:thrust:start',
  TANK_THRUST_END: 'tank:thrust:end',

  // Bullets
  BULLET_RICOCHET: 'bullet:ricochet',
  BULLET_EXPIRED: 'bullet:expired',

  // Round
  ROUND_COUNTDOWN: 'round:countdown',
  ROUND_STARTED: 'round:started',
  ROUND_ENDED: 'round:ended',

  // Spawn slot assignments (multiplayer)
  SPAWN_ASSIGNMENTS_CHANGED: 'spawn:assignments-changed',

  // Particles
  PARTICLES_EMIT: 'particles:emit',

  // Spectacle (hooks for design / audio passes)
  SPECTACLE_ENTRANCE: 'spectacle:entrance',
  SPECTACLE_ACTION: 'spectacle:action',
  SPECTACLE_HIT: 'spectacle:hit',
  SPECTACLE_COMBO: 'spectacle:combo',
  SPECTACLE_STREAK: 'spectacle:streak',
  SPECTACLE_NEAR_MISS: 'spectacle:near_miss',

  // Audio (hooks for /add-audio)
  AUDIO_INIT: 'audio:init',
  MUSIC_MENU: 'music:menu',
  MUSIC_GAMEPLAY: 'music:gameplay',
  MUSIC_GAMEOVER: 'music:gameover',
  MUSIC_STOP: 'music:stop',
  AUDIO_TOGGLE_MUTE: 'audio:toggleMute',

  // === Multiplayer ===
  NETWORK_CONNECTED: 'network:connected',
  NETWORK_DISCONNECTED: 'network:disconnected',
  NETWORK_PLAYER_JOINED: 'network:player-joined',
  NETWORK_PLAYER_LEFT: 'network:player-left',
  NETWORK_STATE_RECEIVED: 'network:state-received',
  MULTIPLAYER_JOIN_ROOM: 'multiplayer:join-room',
  MULTIPLAYER_LEAVE_ROOM: 'multiplayer:leave-room',
};

class EventBus {
  constructor() {
    this.listeners = {};
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return this;
  }

  off(event, callback) {
    if (!this.listeners[event]) return this;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    return this;
  }

  emit(event, data) {
    if (!this.listeners[event]) return this;
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (err) {
        console.error(`EventBus error in ${event}:`, err);
      }
    });
    return this;
  }

  removeAll() {
    this.listeners = {};
    return this;
  }
}

export const eventBus = new EventBus();
