# Client Integration

Source code for the three new client-side files plus the additive patches to existing core files.

## File: `src/multiplayer/MultiplayerClient.js`

The single seam between game code and the wire protocol. If a future user wants Colyseus or fly.io+ws, only this file changes.

```js
// src/multiplayer/MultiplayerClient.js
// Backend-agnostic WebSocket client. Wraps partysocket.
// Public API: connect, send, onMessage, onOpen, onClose, disconnect, isConnected.
// All errors are caught and routed through onClose/onError callbacks — never thrown.

import PartySocket from 'partysocket';

export class MultiplayerClient {
  constructor() {
    this.socket = null;
    this.handlers = {
      message: () => {},
      open: () => {},
      close: () => {},
      error: () => {},
    };
  }

  connect({ host, room }) {
    if (this.socket) this.disconnect();
    try {
      this.socket = new PartySocket({ host, room });
      this.socket.addEventListener('open', () => this.handlers.open());
      this.socket.addEventListener('close', (e) => this.handlers.close(e));
      this.socket.addEventListener('error', (e) => this.handlers.error(e));
      this.socket.addEventListener('message', (e) => {
        let parsed = null;
        try { parsed = JSON.parse(e.data); } catch { return; }
        this.handlers.message(parsed);
      });
    } catch (err) {
      console.warn('[MultiplayerClient] connect failed', err);
      this.handlers.error(err);
    }
  }

  send(message) {
    if (!this.isConnected()) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.warn('[MultiplayerClient] send failed', err);
      return false;
    }
  }

  onMessage(cb) { this.handlers.message = cb; }
  onOpen(cb) { this.handlers.open = cb; }
  onClose(cb) { this.handlers.close = cb; }
  onError(cb) { this.handlers.error = cb; }

  isConnected() {
    return this.socket?.readyState === 1;  // WebSocket.OPEN
  }

  disconnect() {
    if (!this.socket) return;
    try { this.socket.close(); } catch { /* ignore */ }
    this.socket = null;
  }
}
```

`partysocket` already implements automatic reconnect — but we run our own reconnect logic in `NetworkManager` so we can emit clear events and apply our own backoff. To disable partysocket's reconnect and rely solely on ours, pass `startClosed: true` to the constructor and call `socket.reconnect()` manually; for v1 we let partysocket handle reconnect and just observe via `open`/`close` events.

## File: `src/multiplayer/RemotePlayerRegistry.js`

Owns the `Map<playerId, RemotePlayer>` that the rest of the game reads. Keeps `gameState.multiplayer.remotePlayers` in sync (passed in by `NetworkManager`).

```js
// src/multiplayer/RemotePlayerRegistry.js
// Tracks remote players keyed by playerId. Mirrors entries into gameState.multiplayer.remotePlayers
// so render_game_to_text() can serialize with one read. Provides stale-eviction.

export class RemotePlayerRegistry {
  constructor(gameState) {
    this.gameState = gameState;
  }

  upsert(playerId, partial) {
    const existing = this.gameState.multiplayer.remotePlayers[playerId] ?? {};
    this.gameState.multiplayer.remotePlayers[playerId] = {
      ...existing,
      ...partial,
      lastSeenTs: Date.now(),
    };
  }

  remove(playerId) {
    delete this.gameState.multiplayer.remotePlayers[playerId];
  }

  has(playerId) {
    return playerId in this.gameState.multiplayer.remotePlayers;
  }

  list() {
    return Object.entries(this.gameState.multiplayer.remotePlayers).map(([id, p]) => ({ id, ...p }));
  }

  // Returns playerIds pruned (so caller can emit player-left events).
  prune(staleMs) {
    const now = Date.now();
    const pruned = [];
    for (const [id, p] of Object.entries(this.gameState.multiplayer.remotePlayers)) {
      if (now - (p.lastSeenTs ?? 0) > staleMs) {
        pruned.push(id);
        delete this.gameState.multiplayer.remotePlayers[id];
      }
    }
    return pruned;
  }

  clear() {
    this.gameState.multiplayer.remotePlayers = {};
  }
}
```

## File: `src/systems/NetworkManager.js`

Wires `MultiplayerClient` ↔ `EventBus` ↔ `RemotePlayerRegistry`. Owns the broadcast tick (realtime mode) and the prune interval. **Never throws out of any public method.**

```js
// src/systems/NetworkManager.js
// Single source of truth for network I/O. Subscribes to game events, forwards to server,
// dispatches server messages to EventBus + RemotePlayerRegistry.
// Single-player must work when init() fails — every error is caught and surfaced via
// network:disconnected. Gameplay never depends on the server being reachable.

import { Events } from '../core/EventBus.js';
// Adapt this import to match the game's Constants.js export shape:
//   - Umbrella:  import { Constants } from '../core/Constants.js'  →  Constants.MULTIPLAYER.X
//   - Per-block: import { MULTIPLAYER } from '../core/Constants.js' →  MULTIPLAYER.X
// (Most game-creator scaffolds use per-block. Read Constants.js first.)
import { Constants } from '../core/Constants.js';
import { MultiplayerClient } from '../multiplayer/MultiplayerClient.js';
import { RemotePlayerRegistry } from '../multiplayer/RemotePlayerRegistry.js';

const MODE_REALTIME = 'realtime';
const MODE_TURN_BASED = 'turn-based';

export class NetworkManager {
  // mode: 'realtime' | 'turn-based'
  // sampler: () => object   — only used in realtime mode; returns the local player's state slice
  // moveEvents: string[]    — only used in turn-based mode; EventBus event names whose payloads to forward
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

    this.boundHandlers = {};
  }

  async init(roomId = Constants.MULTIPLAYER.DEFAULT_ROOM) {
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

  // ---- private ----

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
      // Not connected → just connect, nothing to hand off.
      if (!this.client.isConnected()) {
        this._connect(roomId);
        return;
      }
      // Already connected — defer the new connect to _onSocketClosed via
      // pendingRoomId so we don't race the old socket's async close event.
      // Without this, a delayed close fires AFTER intentionalDisconnect is
      // already cleared, gets misclassified as an error, emits a spurious
      // network:disconnected, and schedules a duplicate reconnect.
      this.pendingRoomId = roomId;
      this.intentionalDisconnect = true;
      this.client.disconnect();  // _onSocketClosed performs the handoff
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
    // Guard `import.meta` for non-Vite contexts (some test runners, SSR, plain
    // Node). Without the typeof check, this throws a SyntaxError at parse time
    // in environments where import.meta isn't a thing.
    const envHost = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_MULTIPLAYER_SERVER_URL) || null;
    const host = envHost ?? Constants.MULTIPLAYER.SERVER_URL;
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
      this._scheduleReconnect();
    }
  }

  _onSocketClosed() {
    this._stopTick();
    this._stopPrune();
    this.gameState.multiplayer.connected = false;
    this.registry.clear();
    this.eventBus.emit(Events.NETWORK_DISCONNECTED, { reason: this.intentionalDisconnect ? 'closed' : 'error' });
    if (!this.intentionalDisconnect) this._scheduleReconnect();
    this.intentionalDisconnect = false;
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    if (this.reconnectAttempts >= Constants.MULTIPLAYER.RECONNECT_MAX_ATTEMPTS) {
      console.warn('[NetworkManager] reconnect attempts exhausted');
      return;
    }
    const base = Constants.MULTIPLAYER.RECONNECT_BACKOFF_MS;
    const max = Constants.MULTIPLAYER.RECONNECT_MAX_BACKOFF_MS;
    const delay = Math.min(base * Math.pow(2, this.reconnectAttempts), max);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect(this.gameState.multiplayer.roomId ?? Constants.MULTIPLAYER.DEFAULT_ROOM);
    }, delay);
  }

  _cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _onWelcome({ playerId, peers = [] }) {
    this.gameState.multiplayer.playerId = playerId;
    this.gameState.multiplayer.connected = true;
    for (const peer of peers) {
      this.registry.upsert(peer.playerId, { name: peer.name, ...(peer.state ?? {}) });
      this.eventBus.emit(Events.NETWORK_PLAYER_JOINED, { playerId: peer.playerId, name: peer.name });
    }
    this.eventBus.emit(Events.NETWORK_CONNECTED, {
      roomId: this.gameState.multiplayer.roomId,
      playerId,
    });
    if (this.mode === MODE_REALTIME) this._startTick();
    this._startPrune();
  }

  _onPlayerJoined({ playerId, name }) {
    this.registry.upsert(playerId, { name });
    this.eventBus.emit(Events.NETWORK_PLAYER_JOINED, { playerId, name });
  }

  _onPlayerLeft({ playerId }) {
    this.registry.remove(playerId);
    this.eventBus.emit(Events.NETWORK_PLAYER_LEFT, { playerId });
  }

  _onState({ playerId, state }) {
    if (playerId === this.gameState.multiplayer.playerId) return;  // never render self
    this.registry.upsert(playerId, state);
    this.eventBus.emit(Events.NETWORK_STATE_RECEIVED, { playerId, state });
  }

  _onTurn({ playerId, resultingState, turn }) {
    this.eventBus.emit(Events.NETWORK_STATE_RECEIVED, {
      playerId,
      state: { type: 'turn', resultingState, turn, ts: Date.now() },
    });
  }

  _startTick() {
    if (this.tickInterval) return;
    const intervalMs = 1000 / Constants.MULTIPLAYER.TICK_RATE_HZ;
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
    const intervalMs = 1000 / Constants.MULTIPLAYER.TICK_RATE_HZ;
    this.pruneInterval = setInterval(() => {
      const pruned = this.registry.prune(Constants.MULTIPLAYER.STALE_PLAYER_MS);
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
```

## EventBus.js — Append Block

Append to `src/core/EventBus.js` inside the `Events` constant, just before the closing `}`:

```js
// === Multiplayer ===
NETWORK_CONNECTED: 'network:connected',
NETWORK_DISCONNECTED: 'network:disconnected',
NETWORK_PLAYER_JOINED: 'network:player-joined',
NETWORK_PLAYER_LEFT: 'network:player-left',
NETWORK_STATE_RECEIVED: 'network:state-received',
MULTIPLAYER_JOIN_ROOM: 'multiplayer:join-room',
MULTIPLAYER_LEAVE_ROOM: 'multiplayer:leave-room',
```

## GameState.js — Append Block

Append to the GameState constructor / initial state object:

```js
// === Multiplayer ===
this.multiplayer = {
  // Persistent across reset() — preserved so /reset rejoins the same room.
  roomId: null,
  playerId: null,

  // Transient — cleared by reset().
  connected: false,
  remotePlayers: {},  // { [playerId]: { x, y, z?, score, name?, lastSeenTs } }
};
```

In `reset()`, append (with a `this.multiplayer` guard — `reset()` is often called from the GameState constructor, possibly *before* the `this.multiplayer = {...}` block runs):

```js
// === Multiplayer (transient only) ===
if (this.multiplayer) {
  this.multiplayer.connected = false;
  this.multiplayer.remotePlayers = {};
}
// roomId and playerId persist intentionally.
```

## Constants.js — Append Block

Append to the `Constants` object:

```js
// === Multiplayer ===
MULTIPLAYER: {
  SERVER_URL: 'https://<project>.<user>.partykit.dev',  // filled by deploy step
  DEFAULT_ROOM: 'lobby',

  MAX_PLAYERS: 4,
  MAX_MESSAGE_BYTES: 4096,

  TICK_RATE_HZ: 20,
  STATE_INTERPOLATE_MS: 100,

  RECONNECT_BACKOFF_MS: 1000,
  RECONNECT_MAX_BACKOFF_MS: 16000,
  RECONNECT_MAX_ATTEMPTS: 10,

  STALE_PLAYER_MS: 5000,

  PROTOCOL_VERSION: 1,
},
```

## main.js — Wiring Patches

Patch 1 — imports (top of file):

```js
import { NetworkManager } from './systems/NetworkManager.js';
```

Patch 2 — instantiate after EventBus + GameState are ready, before the engine starts.

For **realtime** games — the sampler reads the local entity from GameState:

```js
const networkManager = new NetworkManager({
  eventBus,
  gameState,
  mode: 'realtime',
  sampler: () => {
    // Replace `bird` with the game's local entity name from GameState.
    const e = gameState.bird;
    if (!e) return null;
    return {
      x: e.x,
      y: e.y,
      vx: e.vx ?? 0,
      vy: e.vy ?? 0,
      score: gameState.score ?? 0,
      alive: !gameState.gameOver,
    };
  },
});

networkManager.init().catch(err => console.warn('[main] NetworkManager init failed', err));
window.__NETWORK_MANAGER__ = networkManager;
```

For **turn-based** games — pass the move event names instead:

```js
const networkManager = new NetworkManager({
  eventBus,
  gameState,
  mode: 'turn-based',
  moveEvents: [Events.PLAYER_MOVED, Events.CARD_PLAYED],  // adapt to actual events
});

networkManager.init().catch(err => console.warn('[main] NetworkManager init failed', err));
window.__NETWORK_MANAGER__ = networkManager;
```

Patch 3 — extend `window.render_game_to_text()` additively. Find the existing payload object and add:

```js
payload.multiplayer = {
  roomId: gameState.multiplayer.roomId,
  playerId: gameState.multiplayer.playerId,
  connected: gameState.multiplayer.connected,
};
payload.remotePlayers = Object.entries(gameState.multiplayer.remotePlayers).map(
  ([id, p]) => ({
    id,
    x: p.x,
    y: p.y,
    ...(p.z !== undefined ? { z: p.z } : {}),
    score: p.score,
    name: p.name,
    alive: p.alive,
  })
);
```

## Phaser Scene Integration

### Welcome-race gotcha

Under fast local connections (and `npx partykit dev` in particular), the WebSocket `welcome` arrives before scene `create()` finishes registering listeners. The result: code that *only* listens for `NETWORK_CONNECTED` / `NETWORK_PLAYER_JOINED` to set up remote sprites silently misses the initial peers — `eventBus.on(...)` is called *after* the events have already fired, so the listener never runs.

**Fix pattern**: register the listener AND seed from current state right after registration. Both branches are idempotent so it's safe even when the race doesn't happen:

```js
// Subscribe…
this.eventBus.on(Events.NETWORK_PLAYER_JOINED, this._onRemoteJoined, this);

// …and seed from whatever's already in GameState (in case welcome was already processed)
if (this.gameState.multiplayer.connected) {
  for (const id of Object.keys(this.gameState.multiplayer.remotePlayers)) {
    this._onRemoteJoined({ playerId: id });
  }
}
```

The same pattern applies to `NETWORK_CONNECTED` listeners — also check `gameState.multiplayer.connected` after subscribing.

### Scene patch

In the active GameScene (typically `src/scenes/GameScene.js`):

```js
import { Events } from '../core/EventBus.js';
import { Constants } from '../core/Constants.js';

create() {
  // ...existing single-player creation...

  this.remoteSprites = new Map();

  this.eventBus.on(Events.NETWORK_PLAYER_JOINED, this._onRemoteJoined, this);
  this.eventBus.on(Events.NETWORK_STATE_RECEIVED, this._onRemoteState, this);
  this.eventBus.on(Events.NETWORK_PLAYER_LEFT, this._onRemoteLeft, this);

  // Welcome-race seed — handle peers that joined before listener registration.
  if (this.gameState.multiplayer.connected) {
    for (const [id, peer] of Object.entries(this.gameState.multiplayer.remotePlayers)) {
      this._onRemoteJoined({ playerId: id });
      if (peer.x !== undefined) this._onRemoteState({ playerId: id, state: peer });
    }
  }
}

_onRemoteJoined({ playerId }) {
  const sprite = this.add.sprite(0, 0, 'bird');  // adapt asset key
  sprite.setAlpha(0.7);
  sprite.setData('targetX', sprite.x);
  sprite.setData('targetY', sprite.y);
  this.remoteSprites.set(playerId, sprite);
}

_onRemoteState({ playerId, state }) {
  const sprite = this.remoteSprites.get(playerId);
  if (!sprite) return;
  sprite.setData('targetX', state.x);
  sprite.setData('targetY', state.y);
  if (state.alive === false) sprite.setVisible(false);
  else sprite.setVisible(true);
}

_onRemoteLeft({ playerId }) {
  const sprite = this.remoteSprites.get(playerId);
  if (sprite) sprite.destroy();
  this.remoteSprites.delete(playerId);
}

update(time, delta) {
  // ...existing local update...

  // Smooth remote players toward their target positions.
  const lerp = Math.min(1, delta / Constants.MULTIPLAYER.STATE_INTERPOLATE_MS);
  for (const sprite of this.remoteSprites.values()) {
    const tx = sprite.getData('targetX');
    const ty = sprite.getData('targetY');
    sprite.x += (tx - sprite.x) * lerp;
    sprite.y += (ty - sprite.y) * lerp;
  }
}

shutdown() {
  this.eventBus.off(Events.NETWORK_PLAYER_JOINED, this._onRemoteJoined, this);
  this.eventBus.off(Events.NETWORK_STATE_RECEIVED, this._onRemoteState, this);
  this.eventBus.off(Events.NETWORK_PLAYER_LEFT, this._onRemoteLeft, this);
  for (const sprite of this.remoteSprites.values()) sprite.destroy();
  this.remoteSprites.clear();
}
```

## Three.js Integration

In the orchestrator (typically `src/core/Game.js`):

```js
import * as THREE from 'three';
import { Events } from './EventBus.js';
import { Constants } from './Constants.js';

constructor(/* ... */) {
  // ...existing init...

  this.remoteMeshes = new Map();

  this.eventBus.on(Events.NETWORK_PLAYER_JOINED, ({ playerId }) => {
    const mesh = this._createRemotePlayerMesh();
    mesh.userData = { playerId, targetX: 0, targetY: 0, targetZ: 0 };
    this.scene.add(mesh);
    this.remoteMeshes.set(playerId, mesh);
  });

  this.eventBus.on(Events.NETWORK_STATE_RECEIVED, ({ playerId, state }) => {
    const mesh = this.remoteMeshes.get(playerId);
    if (!mesh || state?.x === undefined) return;
    mesh.userData.targetX = state.x;
    mesh.userData.targetY = state.y;
    mesh.userData.targetZ = state.z ?? 0;
  });

  this.eventBus.on(Events.NETWORK_PLAYER_LEFT, ({ playerId }) => {
    const mesh = this.remoteMeshes.get(playerId);
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.geometry?.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
    else mesh.material?.dispose();
    this.remoteMeshes.delete(playerId);
  });
}

_createRemotePlayerMesh() {
  // Replace with real model. This stub renders a translucent capsule.
  const geometry = new THREE.CapsuleGeometry(0.3, 1, 4, 8);
  const material = new THREE.MeshStandardMaterial({ color: 0x4488ff, transparent: true, opacity: 0.7 });
  return new THREE.Mesh(geometry, material);
}

update(deltaSec) {
  // ...existing local update...

  const lerp = Math.min(1, deltaSec * 1000 / Constants.MULTIPLAYER.STATE_INTERPOLATE_MS);
  for (const mesh of this.remoteMeshes.values()) {
    const u = mesh.userData;
    mesh.position.x += (u.targetX - mesh.position.x) * lerp;
    mesh.position.y += (u.targetY - mesh.position.y) * lerp;
    mesh.position.z += (u.targetZ - mesh.position.z) * lerp;
  }
}
```

Three.js cleanup is more involved than Phaser — always dispose geometries and materials in the `network:player-left` handler to avoid GPU memory leaks.

## `package.json` Diff

```json
{
  "dependencies": {
    "partysocket": "^1.0.0"
  }
}
```

Run `npm install partysocket` to add it. The version range follows the latest stable at scaffold time.

## `.env` and `.env.example`

Create `.env` (gitignored):

```
VITE_MULTIPLAYER_SERVER_URL=https://<project>.<user>.partykit.dev
```

Create `.env.example` (committed):

```
VITE_MULTIPLAYER_SERVER_URL=https://your-project.your-username.partykit.dev
```

The `VITE_` prefix is required for Vite to expose the variable to client code.
