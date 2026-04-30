# Multiplayer Architecture

How the multiplayer layer fits into the game-creator architecture (EventBus, GameState, Constants, render_game_to_text, single-orchestrator).

## Layered View

```
┌────────────────────────────────────────────────────────────────┐
│  Phaser Scene / Three.js Game.js (orchestrator)                │
│  • renders local entity                                        │
│  • renders remote players from RemotePlayerRegistry            │
│  • emits local game events (e.g. player:moved, card:played)    │
└────────────────────┬───────────────────────────────────────────┘
                     │ EventBus only — no direct imports
                     ▼
┌────────────────────────────────────────────────────────────────┐
│  src/systems/NetworkManager.js                                 │
│  • subscribes to local game events (turn-based)                │
│    OR samples GameState at TICK_RATE_HZ (realtime)             │
│  • forwards via MultiplayerClient                              │
│  • on receive → updates RemotePlayerRegistry                   │
│  • emits network:* events for the rest of the game             │
└────────────────────┬───────────────────────────────────────────┘
                     │ wraps partysocket
                     ▼
┌────────────────────────────────────────────────────────────────┐
│  src/multiplayer/MultiplayerClient.js                          │
│  • backend-agnostic API: connect / send / onMessage /          │
│    disconnect / isConnected                                    │
│  • the only file that knows about partysocket                  │
└────────────────────┬───────────────────────────────────────────┘
                     │ WSS
                     ▼
┌────────────────────────────────────────────────────────────────┐
│  PartyKit Room (Cloudflare Durable Object, one per roomId)     │
│  • onConnect / onMessage / onClose                             │
│  • room.broadcast(message, [excludeIds])                       │
│  • per-connection rate limiting                                │
└────────────────────────────────────────────────────────────────┘
```

The `RemotePlayerRegistry` lives client-side as a plain `Map`. Scenes/systems read from it (or listen to `network:*` events) to render remote entities. They never call MultiplayerClient or the server directly.

## Event Taxonomy

All events use the existing `domain:action` form. Append these constants to `src/core/EventBus.js` under a `// === Multiplayer ===` banner.

| Constant | Value | Direction | Payload | Purpose |
|---|---|---|---|---|
| `NETWORK_CONNECTED` | `network:connected` | NM → game | `{ roomId, playerId }` | Fired once `MultiplayerClient.connect()` succeeds |
| `NETWORK_DISCONNECTED` | `network:disconnected` | NM → game | `{ reason: 'closed' \| 'error' \| 'timeout' }` | Fired on socket close or unrecoverable error |
| `NETWORK_PLAYER_JOINED` | `network:player-joined` | NM → game | `{ playerId, name? }` | Server reported a new peer |
| `NETWORK_PLAYER_LEFT` | `network:player-left` | NM → game | `{ playerId }` | Server reported a peer left or peer pruned by stale-timeout |
| `NETWORK_STATE_RECEIVED` | `network:state-received` | NM → game | `{ playerId, state }` | Remote state delta, shape mode-dependent (see below) |
| `MULTIPLAYER_JOIN_ROOM` | `multiplayer:join-room` | game → NM | `{ roomId }` | Request to leave current room and join `roomId` |
| `MULTIPLAYER_LEAVE_ROOM` | `multiplayer:leave-room` | game → NM | `{}` | Request to disconnect cleanly |

The game emits `MULTIPLAYER_JOIN_ROOM` to switch rooms (e.g., a private match). NetworkManager listens, calls `client.disconnect()`, then `client.connect(newRoomId)`.

### `state` shape per mode

**realtime mode** — `state` carries position and minimal kinematics:

```js
{
  x: number,
  y: number,
  z?: number,        // 3D games only
  vx?: number,       // optional velocity for client-side interpolation
  vy?: number,
  vz?: number,
  score: number,
  alive: boolean,
  ts: number,        // server tick timestamp (ms since epoch)
}
```

**The wire schema is open.** Games may extend `state` with their own fields (e.g. `rotation` for top-down games, `weapon` for shooters). The server's `isValidState` only enforces the required core (`x`, `y`, `score`, `alive`) — unknown fields pass through to all peers untouched. This lets games add gameplay-specific state without forking the skill.

**Coordinate space convention.** Broadcast positions in **design pixels** (the canvas-independent logical coordinate system the game's Constants are written in), not raw canvas pixels. Receivers multiply by their own `PX` when applying. This makes the wire format independent of each client's window size / DPR — without it, two clients with different viewports see each other's positions at proportionally wrong locations. The local entity's `tank.x` is typically in canvas pixels; divide by `PX` before sending and multiply by `PX` on receive.

**turn-based mode** — `state` carries the move and the resulting authoritative state:

```js
{
  type: string,           // 'move' | 'card-played' | game-defined action name
  payload: object,        // game-defined move data
  resultingState: object, // server's authoritative post-move state
  turn: number,           // monotonic move counter
  ts: number,
}
```

## GameState Schema

Append to `src/core/GameState.js`:

```js
multiplayer: {
  // Persistent across reset() — preserved so /reset rejoins the same room
  roomId: null,
  playerId: null,

  // Transient — cleared by reset()
  connected: false,
  remotePlayers: {},  // { [playerId]: { x, y, z?, score, name?, lastSeenTs } }
}
```

`reset()` semantics:

```js
reset() {
  // ...existing single-player resets...
  if (this.multiplayer) {
    this.multiplayer.connected = false;
    this.multiplayer.remotePlayers = {};
  }
  // roomId and playerId persist so the next session rejoins automatically
}
```

**Constructor ordering footgun.** Many GameState classes call `this.reset()` from the constructor. If you naively put `this.multiplayer = {...}` *after* the `this.reset()` call, the first reset runs against `undefined` and crashes. Two safe patterns:

1. Initialize `this.multiplayer = {...}` **before** calling `this.reset()` in the constructor, OR
2. Guard the multiplayer block with `if (this.multiplayer)` (shown above) so the first reset is a no-op until the field exists.

Pattern 2 is simpler when patching existing GameState files additively.

`remotePlayers` is owned by `RemotePlayerRegistry`; GameState is the canonical home so `render_game_to_text()` can serialize it with one read.

## Constants Schema

**Detect the file's export convention before patching.** Two shapes are common:

- **Umbrella export** — `export const Constants = { GAME: {...}, PLAYER: {...} }`. Append a new top-level key inside the object: `MULTIPLAYER: {...}`. Consumers reference `Constants.MULTIPLAYER.X`.
- **Per-block named exports** — `export const GAME = {...}; export const PLAYER = {...};`. Append a new sibling export: `export const MULTIPLAYER = {...}`. Consumers reference `MULTIPLAYER.X` directly.

Both are valid game-creator outputs. Read `src/core/Constants.js` first to decide which pattern to use, then mirror it in `NetworkManager.js`'s import (`import { Constants } from '...'` vs `import { MULTIPLAYER } from '...'`). Don't force one onto the other.

The block to append (using umbrella shape; trivially adapts to per-block):

```js
MULTIPLAYER: {
  // Filled by the deploy step. Falls back to localhost in dev (see main.js).
  SERVER_URL: 'https://<project>.<user>.partykit.dev',
  DEFAULT_ROOM: 'lobby',

  // Caps
  MAX_PLAYERS: 4,
  MAX_MESSAGE_BYTES: 4096,

  // Realtime tick
  TICK_RATE_HZ: 20,                  // 50ms broadcast cadence
  STATE_INTERPOLATE_MS: 100,         // smoothing window for remote positions

  // Reconnect
  RECONNECT_BACKOFF_MS: 1000,
  RECONNECT_MAX_BACKOFF_MS: 16000,
  RECONNECT_MAX_ATTEMPTS: 10,

  // Stale player eviction (no state received for this long → emit player-left)
  STALE_PLAYER_MS: 5000,

  // Wire protocol version — bump on breaking server/client changes
  PROTOCOL_VERSION: 1,
}
```

The dev fallback in `main.js` reads `import.meta.env.VITE_MULTIPLAYER_SERVER_URL` first, then falls back to `Constants.MULTIPLAYER.SERVER_URL`. This lets local dev point at `http://127.0.0.1:1999` without committing dev URLs to source.

## NetworkManager Contract

Public API:

```js
class NetworkManager {
  constructor(eventBus, gameState, constants);

  async init(roomId = constants.MULTIPLAYER.DEFAULT_ROOM);
  destroy();              // disconnects, clears intervals, removes listeners

  isConnected();          // boolean
  getPlayerId();          // string | null
  getRoomId();            // string | null
}
```

Lifecycle:

1. Constructor stores references; subscribes to `MULTIPLAYER_JOIN_ROOM` and `MULTIPLAYER_LEAVE_ROOM`. **Does not throw.**
2. `init(roomId)` calls `MultiplayerClient.connect(roomId)`. On success, emits `NETWORK_CONNECTED`, starts the broadcast tick (realtime mode only), and starts the `STALE_PLAYER_MS` prune interval. On failure, catches the error, emits `NETWORK_DISCONNECTED { reason: 'error' }`, and schedules a reconnect with exponential backoff.
3. `MultiplayerClient.onMessage` callback dispatches by `message.type`:
   - `welcome { playerId, peers }` → set `gameState.multiplayer.playerId`, seed `remotePlayers` with existing peers, emit `NETWORK_CONNECTED`.
   - `player-joined { playerId, name? }` → registry.upsert, emit `NETWORK_PLAYER_JOINED`.
   - `player-left { playerId }` → registry.remove, emit `NETWORK_PLAYER_LEFT`.
   - `state { playerId, state }` → registry.upsert, emit `NETWORK_STATE_RECEIVED`.
4. `destroy()` clears intervals, calls `client.disconnect()`, and removes EventBus listeners.

**Error handling rule (Principle 1):** every `try/catch` catches `Error` and logs a warning. The class never throws out of any public method. Single-player gameplay must work even if `init()` is called and fails.

## Phaser Integration Pattern

In the active GameScene (the one that owns the local entity):

```js
create() {
  // ...existing creation...

  this.remoteSprites = new Map();  // playerId → Phaser.Sprite

  eventBus.on(Events.NETWORK_PLAYER_JOINED, ({ playerId }) => {
    const sprite = this.add.sprite(0, 0, 'player');
    sprite.setAlpha(0.7);  // visual hint that this is a remote player
    this.remoteSprites.set(playerId, sprite);
  });

  eventBus.on(Events.NETWORK_STATE_RECEIVED, ({ playerId, state }) => {
    const sprite = this.remoteSprites.get(playerId);
    if (!sprite) return;  // sprite created on join only — race condition tolerant
    // Wire format is design-pixel coordinates; multiply by PX to get the
    // local canvas pixels. Without this, remote players land at the wrong
    // position on any client whose DPR/viewport differs from the sender's.
    sprite.setPosition(state.x * PX, state.y * PX);
    if (typeof state.alive === 'boolean') sprite.setVisible(state.alive);
  });

  eventBus.on(Events.NETWORK_PLAYER_LEFT, ({ playerId }) => {
    const sprite = this.remoteSprites.get(playerId);
    if (sprite) {
      sprite.destroy();
      this.remoteSprites.delete(playerId);
    }
  });
}

shutdown() {
  this.remoteSprites.forEach(s => s.destroy());
  this.remoteSprites.clear();
  // ...EventBus.off() for all subscriptions...
}
```

For client-side interpolation in `realtime` mode, store `{ targetX, targetY, lastUpdateTs }` on each sprite and lerp toward target in the scene's `update()` loop using `STATE_INTERPOLATE_MS`. See `client-integration.md`.

## Three.js Integration Pattern

In the orchestrator (typically `src/core/Game.js`):

```js
this.remoteMeshes = new Map();  // playerId → THREE.Object3D

eventBus.on(Events.NETWORK_PLAYER_JOINED, ({ playerId }) => {
  const mesh = createRemotePlayerMesh();  // game-specific
  mesh.userData.playerId = playerId;
  this.scene.add(mesh);
  this.remoteMeshes.set(playerId, mesh);
});

eventBus.on(Events.NETWORK_STATE_RECEIVED, ({ playerId, state }) => {
  const mesh = this.remoteMeshes.get(playerId);
  if (!mesh) return;
  mesh.position.set(state.x, state.y, state.z ?? 0);
});

eventBus.on(Events.NETWORK_PLAYER_LEFT, ({ playerId }) => {
  const mesh = this.remoteMeshes.get(playerId);
  if (mesh) {
    this.scene.remove(mesh);
    mesh.geometry?.dispose();
    mesh.material?.dispose();
    this.remoteMeshes.delete(playerId);
  }
});
```

Three.js cleanup is more involved than Phaser — always dispose geometries and materials in `network:player-left` to avoid GPU memory leaks.

## Sequence: Two clients in one room (realtime)

```
Client A                     PartyKit Room                    Client B
   │                              │                              │
   ├── connect(room=lobby) ──────►│                              │
   │   (welcome: A-id, peers=[]) ◄┤                              │
   │                              │◄──────── connect(room=lobby) ┤
   │                              │ (welcome: B-id, peers=[A-id])►
   │   (player-joined: B-id) ◄────┤── (broadcast except B) ──────│
   │                              │                              │
   ├── tick (state {x,y,...}) ───►│── (broadcast except A) ─────►│
   │                              │   (state from A) ◄────       │
   │                              │                              │
   │                              │◄───── tick (state {...}) ────┤
   │   (state from B) ◄───────────┤── (broadcast except B) ──────│
   │                              │                              │
   ├── close ─────────────────────►                              │
   │                              ├──── (player-left: A-id) ────►│
```

`welcome` is sent only to the joining socket and includes the current peer list. `player-joined` is broadcast to existing peers. `player-left` is broadcast on `onClose`.

## Sequence: Turn-based move

```
Client A (mover)             PartyKit Room                  Client B (waiter)
   │                              │                              │
   ├── send {type:'move',         │                              │
   │   payload: {card: 'K♠'}}    ►│                              │
   │                              │ validate(move)               │
   │                              │ ├── valid → applyToRoomState │
   │                              │ ├── invalid → reject{reason} │
   │                              │                              │
   │   ◄── state {                │                              │
   │       playerId: A,           │                              │
   │       resultingState: ...,   │ ── broadcast (incl. sender) ►│
   │       turn: N+1 } ───────────┤                              │
   │                              │                              │
```

Turn-based broadcasts include the sender — they need to confirm the server accepted their move. Validation rejection comes back as `{type: 'reject', reason}` to the sender only.
