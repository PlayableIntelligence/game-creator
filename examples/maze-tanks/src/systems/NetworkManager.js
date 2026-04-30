import { Events } from '../core/EventBus.js';
import { MULTIPLAYER } from '../core/Constants.js';
import { MultiplayerClient } from '../multiplayer/MultiplayerClient.js';
import { RemotePlayerRegistry } from '../multiplayer/RemotePlayerRegistry.js';

const MODE_REALTIME = 'realtime';
const MODE_TURN_BASED = 'turn-based';

export class NetworkManager {
  constructor({ eventBus, gameState, mode, sampler, moveEvents = [] }) {
    this.eventBus = eventBus;
    this.gameState = gameState;
    this.mode = mode;
    this.sampler = sampler ?? (() => null);
    this.moveEvents = moveEvents;

    this.client = new MultiplayerClient();
    this.registry = new RemotePlayerRegistry(gameState);

    this.tickInterval = null;
    this.pruneInterval = null;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.intentionalDisconnect = false;
    // Set when we trigger a room switch — _onSocketClosed reads + clears it
    // to perform a clean handoff to the new room without racing the old
    // socket's async close event.
    this.pendingRoomId = null;

    this.boundHandlers = {};
    this._joinedAtCache = new Map();
  }

  async init(roomId = MULTIPLAYER.DEFAULT_ROOM) {
    this.gameState.multiplayer.roomId = roomId;
    this._wireClient();
    this._wireGameEvents();
    this._connect(roomId);
  }

  destroy() {
    this.intentionalDisconnect = true;
    this._stopTick();
    this._stopPrune();
    this._cancelReconnect();
    this._unwireGameEvents();
    this.client.disconnect();
    this.registry.clear();
    this.gameState.multiplayer.connected = false;
  }

  isConnected() {
    return this.client.isConnected();
  }

  getPlayerId() {
    return this.gameState.multiplayer.playerId;
  }

  getRoomId() {
    return this.gameState.multiplayer.roomId;
  }

  _wireClient() {
    this.client.onOpen(() => {
      this.reconnectAttempts = 0;
      this._cancelReconnect();
    });

    this.client.onMessage((msg) => {
      switch (msg?.type) {
        case 'welcome':       return this._onWelcome(msg);
        case 'player-joined': return this._onPlayerJoined(msg);
        case 'player-left':   return this._onPlayerLeft(msg);
        case 'state':         return this._onState(msg);
        case 'turn':          return this._onTurn(msg);
        case 'custom':        return this._onCustom(msg);
        case 'reject':        console.warn('[NetworkManager] server rejected', msg.reason); return;
        default:              return;
      }
    });

    this.client.onClose(() => this._onSocketClosed());
    this.client.onError(() => { /* close will follow */ });
  }

  _wireGameEvents() {
    this.boundHandlers.joinRoom = ({ roomId } = {}) => {
      if (!roomId || roomId === this.gameState.multiplayer.roomId) return;
      this.gameState.multiplayer.roomId = roomId;
      // If we're not connected, just connect; nothing to hand off.
      if (!this.client.isConnected()) {
        this._connect(roomId);
        return;
      }
      // Defer the connect to _onSocketClosed via pendingRoomId so we
      // don't race the old socket's async close event (which would
      // otherwise misclassify as an error and trigger an extra
      // reconnect on top of the new room connection).
      this.pendingRoomId = roomId;
      this.intentionalDisconnect = true;
      this.client.disconnect();
    };
    this.boundHandlers.leaveRoom = () => this.destroy();

    this.eventBus.on(Events.MULTIPLAYER_JOIN_ROOM, this.boundHandlers.joinRoom);
    this.eventBus.on(Events.MULTIPLAYER_LEAVE_ROOM, this.boundHandlers.leaveRoom);

    if (this.mode === MODE_TURN_BASED) {
      this.boundHandlers.move = (payload) => {
        if (!this.client.isConnected()) return;
        this.client.send({ type: 'move', payload });
      };
      for (const evt of this.moveEvents) {
        this.eventBus.on(evt, this.boundHandlers.move);
      }
    }
  }

  _unwireGameEvents() {
    this.eventBus.off(Events.MULTIPLAYER_JOIN_ROOM, this.boundHandlers.joinRoom);
    this.eventBus.off(Events.MULTIPLAYER_LEAVE_ROOM, this.boundHandlers.leaveRoom);
    if (this.mode === MODE_TURN_BASED) {
      for (const evt of this.moveEvents) {
        this.eventBus.off(evt, this.boundHandlers.move);
      }
    }
  }

  _connect(roomId) {
    const host = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MULTIPLAYER_SERVER_URL)
      || MULTIPLAYER.SERVER_URL;
    if (!host) {
      console.warn('[NetworkManager] no SERVER_URL configured — multiplayer disabled');
      this.gameState.multiplayer.connected = false;
      this.eventBus.emit(Events.NETWORK_DISCONNECTED, { reason: 'error' });
      return;
    }
    try {
      this.client.connect({ host, room: roomId });
    } catch (err) {
      console.warn('[NetworkManager] connect threw', err);
      // Surface the disconnect so single-player fallback runs even when
      // connect() throws synchronously (no socket callbacks will fire).
      this.gameState.multiplayer.connected = false;
      this.eventBus.emit(Events.NETWORK_DISCONNECTED, { reason: 'error' });
      this._scheduleReconnect();
    }
  }

  _onSocketClosed() {
    this._stopTick();
    this._stopPrune();
    this.gameState.multiplayer.connected = false;
    this.registry.clear();
    this.eventBus.emit(Events.NETWORK_DISCONNECTED, { reason: this.intentionalDisconnect ? 'closed' : 'error' });
    // Room-switch handoff: if joinRoom queued a pending room, connect
    // to it now (instead of triggering the regular reconnect path).
    if (this.pendingRoomId) {
      const next = this.pendingRoomId;
      this.pendingRoomId = null;
      this.intentionalDisconnect = false;
      this._connect(next);
      return;
    }
    if (!this.intentionalDisconnect) this._scheduleReconnect();
    this.intentionalDisconnect = false;
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= MULTIPLAYER.RECONNECT_MAX_ATTEMPTS) {
      console.warn('[NetworkManager] reconnect attempts exhausted');
      return;
    }
    const base = MULTIPLAYER.RECONNECT_BASE_BACKOFF_MS;
    const max = MULTIPLAYER.RECONNECT_MAX_BACKOFF_MS;
    const delay = Math.min(base * Math.pow(2, this.reconnectAttempts), max);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect(this.gameState.multiplayer.roomId ?? MULTIPLAYER.DEFAULT_ROOM);
    }, delay);
  }

  _cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _onWelcome({ playerId, peers = [], joinedAt }) {
    this.gameState.multiplayer.playerId = playerId;
    this.gameState.multiplayer.connected = true;
    if (typeof joinedAt === 'number') this.gameState.multiplayer.joinedAt = joinedAt;
    for (const peer of peers) {
      if (typeof peer.joinedAt === 'number') this._joinedAtCache.set(peer.playerId, peer.joinedAt);
      this.registry.upsert(peer.playerId, {
        name: peer.name,
        joinedAt: peer.joinedAt,
        ...(peer.state ?? {}),
      });
      this.eventBus.emit(Events.NETWORK_PLAYER_JOINED, {
        playerId: peer.playerId,
        name: peer.name,
        joinedAt: peer.joinedAt,
      });
    }
    this.eventBus.emit(Events.NETWORK_CONNECTED, {
      roomId: this.gameState.multiplayer.roomId,
      playerId,
      joinedAt,
    });
    if (this.mode === MODE_REALTIME) this._startTick();
    this._startPrune();
  }

  _onPlayerJoined({ playerId, name, joinedAt }) {
    if (typeof joinedAt === 'number') this._joinedAtCache.set(playerId, joinedAt);
    const cached = this._joinedAtCache.get(playerId);
    this.registry.upsert(playerId, { name, joinedAt: cached ?? joinedAt });
    this.eventBus.emit(Events.NETWORK_PLAYER_JOINED, { playerId, name, joinedAt: cached ?? joinedAt });
  }

  _onPlayerLeft({ playerId }) {
    this.registry.remove(playerId);
    this._joinedAtCache.delete(playerId);
    this.eventBus.emit(Events.NETWORK_PLAYER_LEFT, { playerId });
  }

  _onState({ playerId, state }) {
    if (playerId === this.gameState.multiplayer.playerId) return;
    const cached = this._joinedAtCache.get(playerId);
    const augmented = cached != null ? { ...state, joinedAt: cached } : state;
    this.registry.upsert(playerId, augmented);
    this.eventBus.emit(Events.NETWORK_STATE_RECEIVED, { playerId, state });
  }

  _onTurn({ playerId, resultingState, turn }) {
    this.eventBus.emit(Events.NETWORK_STATE_RECEIVED, {
      playerId,
      state: { type: 'turn', resultingState, turn, ts: Date.now() },
    });
  }

  _onCustom({ subtype, fromPlayerId, payload }) {
    if (!subtype) return;
    this.eventBus.emit(`network:${subtype}`, { fromPlayerId, payload });
  }

  sendCustom(subtype, payload) {
    if (!this.client.isConnected()) return false;
    return this.client.send({ type: 'custom', subtype, payload });
  }

  _startTick() {
    if (this.tickInterval) return;
    const intervalMs = 1000 / MULTIPLAYER.TICK_RATE_HZ;
    this.tickInterval = setInterval(() => {
      const sample = this.sampler();
      if (!sample) return;
      this.client.send({ type: 'state', state: { ...sample, ts: Date.now() } });
    }, intervalMs);
  }

  _stopTick() {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  _startPrune() {
    if (this.pruneInterval) return;
    const intervalMs = 1000 / MULTIPLAYER.TICK_RATE_HZ;
    this.pruneInterval = setInterval(() => {
      const pruned = this.registry.prune(MULTIPLAYER.STALE_PLAYER_MS);
      for (const id of pruned) this.eventBus.emit(Events.NETWORK_PLAYER_LEFT, { playerId: id });
    }, intervalMs);
  }

  _stopPrune() {
    if (this.pruneInterval) {
      clearInterval(this.pruneInterval);
      this.pruneInterval = null;
    }
  }
}
