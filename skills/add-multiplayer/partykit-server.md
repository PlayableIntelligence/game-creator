# PartyKit Server Templates

Server-side scaffolding for the multiplayer skill. One Durable Object instance per room id (PartyKit's default). Pick the template that matches the chosen sync mode.

All templates use TypeScript — PartyKit transpiles automatically. JavaScript works too if the user prefers; rename to `.js` and drop the type annotations.

## File Layout

```
multiplayer-server/
  partykit.json
  package.json
  tsconfig.json
  .gitignore
  src/
    server.ts          # one of the templates below
    types.ts           # shared message types
```

## `partykit.json`

```json
{
  "name": "<game-name>-multiplayer",
  "main": "src/server.ts",
  "compatibilityDate": "2026-01-15"
}
```

Replace `<game-name>` with the game's directory name (kebab-case). PartyKit uses this as the project slug — the deployed URL will be `https://<game-name>-multiplayer.<cf-username>.partykit.dev`.

**`compatibilityDate`**: pin to a recent date (within the last ~6 months). Older dates lock you out of newer Workers runtime APIs; ones too far in the future may require flags that aren't yet available. Refresh this when scaffolding a new project — `YYYY-MM-DD` from when you ran the skill is a safe choice.

## `package.json`

```json
{
  "name": "<game-name>-multiplayer-server",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "partykit dev",
    "deploy": "partykit deploy",
    "build": "partykit build"
  },
  "devDependencies": {
    "partykit": "^0.0.114",
    "typescript": "^5.4.0"
  }
}
```

Pin `partykit` to whatever the latest stable is at scaffold time. `partykit build` is optional — deploy builds implicitly.

## `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["partykit/server"]
  },
  "include": ["src/**/*.ts"]
}
```

## `.gitignore`

```
node_modules/
.partykit/
dist/
.wrangler/
*.log
```

## `src/types.ts` (REQUIRED — shared wire types)

Both server templates `import type { ... } from './types'`. This file is **not optional** — without it the server won't compile. Keep it next to `server.ts`.

```ts
export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { type: 'state'; state: PlayerState }                 // realtime tick
  | { type: 'move'; payload: unknown }                    // turn-based
  | { type: 'name'; name: string };                       // optional display name

export type ServerMessage =
  | { type: 'welcome'; playerId: string; peers: Peer[]; protocolVersion: number }
  | { type: 'player-joined'; playerId: string; name?: string }
  | { type: 'player-left'; playerId: string }
  | { type: 'state'; playerId: string; state: PlayerState }
  | { type: 'turn'; playerId: string; resultingState: unknown; turn: number }
  | { type: 'reject'; reason: string };

export type PlayerState = {
  x: number;
  y: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  score: number;
  alive: boolean;
  ts: number;
};

export type Peer = {
  playerId: string;
  name?: string;
  state?: PlayerState;
};
```

Keep this file in sync with the client's wire types (mirror in `src/multiplayer/types.js` if you want, though PartyKit's shape is loose enough that JSDoc is sufficient).

## Realtime Template — `src/server.ts`

```ts
import type * as Party from 'partykit/server';
import type { ClientMessage, ServerMessage, Peer, PlayerState } from './types';
import { PROTOCOL_VERSION } from './types';

const MAX_PLAYERS = 4;
const MAX_MESSAGE_BYTES = 4096;
const RATE_LIMIT_PER_SEC = 30;     // hard cap on messages/sec/connection
const STALE_PEER_MS = 5000;

type Connection = Party.Connection<{ name?: string; lastState?: PlayerState }>;

export default class Room implements Party.Server {
  options: Party.ServerOptions = { hibernate: true };

  // playerId -> last-known state (for welcome payload to new joiners)
  peers = new Map<string, Peer>();

  // playerId -> rate-limit window
  rates = new Map<string, { windowStart: number; count: number }>();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Connection, ctx: Party.ConnectionContext): void | Promise<void> {
    if (this.peers.size >= MAX_PLAYERS) {
      conn.send(JSON.stringify({ type: 'reject', reason: 'room-full' } satisfies ServerMessage));
      conn.close();
      return;
    }

    const playerId = conn.id;
    this.peers.set(playerId, { playerId });

    const welcome: ServerMessage = {
      type: 'welcome',
      playerId,
      peers: [...this.peers.values()].filter(p => p.playerId !== playerId),
      protocolVersion: PROTOCOL_VERSION,
    };
    conn.send(JSON.stringify(welcome));

    const joined: ServerMessage = { type: 'player-joined', playerId };
    this.room.broadcast(JSON.stringify(joined), [playerId]);
  }

  onMessage(rawMessage: string, sender: Connection): void | Promise<void> {
    // UTF-8 byte length, not JS string `.length` — multibyte characters
    // (emoji, accented letters) inflate byte count vs char count.
    if (new TextEncoder().encode(rawMessage).byteLength > MAX_MESSAGE_BYTES) {
      sender.send(JSON.stringify({ type: 'reject', reason: 'message-too-large' } satisfies ServerMessage));
      return;
    }

    if (!this.rateLimitOk(sender.id)) {
      // Drop silently — don't reply (further amplifies abuse).
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      sender.send(JSON.stringify({ type: 'reject', reason: 'bad-json' } satisfies ServerMessage));
      return;
    }

    switch (msg.type) {
      case 'state': {
        if (!isValidState(msg.state)) {
          sender.send(JSON.stringify({ type: 'reject', reason: 'bad-state' } satisfies ServerMessage));
          return;
        }
        const peer = this.peers.get(sender.id);
        if (peer) peer.state = msg.state;

        const out: ServerMessage = {
          type: 'state',
          playerId: sender.id,
          state: { ...msg.state, ts: Date.now() },
        };
        this.room.broadcast(JSON.stringify(out), [sender.id]);
        return;
      }
      case 'name': {
        const name = String(msg.name ?? '').slice(0, 32);
        const peer = this.peers.get(sender.id);
        if (peer) peer.name = name;
        const out: ServerMessage = { type: 'player-joined', playerId: sender.id, name };
        this.room.broadcast(JSON.stringify(out), [sender.id]);
        return;
      }
      default:
        sender.send(JSON.stringify({ type: 'reject', reason: 'unknown-type' } satisfies ServerMessage));
    }
  }

  onClose(conn: Connection): void | Promise<void> {
    if (!this.peers.has(conn.id)) return;
    this.peers.delete(conn.id);
    this.rates.delete(conn.id);
    const left: ServerMessage = { type: 'player-left', playerId: conn.id };
    this.room.broadcast(JSON.stringify(left));
  }

  onError(conn: Connection, err: Error): void | Promise<void> {
    console.error('connection error', conn.id, err);
  }

  private rateLimitOk(playerId: string): boolean {
    const now = Date.now();
    const window = this.rates.get(playerId);
    if (!window || now - window.windowStart > 1000) {
      this.rates.set(playerId, { windowStart: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= RATE_LIMIT_PER_SEC;
  }
}

function isValidState(s: unknown): s is PlayerState {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return (
    typeof o.x === 'number' && Number.isFinite(o.x) &&
    typeof o.y === 'number' && Number.isFinite(o.y) &&
    typeof o.score === 'number' && Number.isFinite(o.score) &&
    typeof o.alive === 'boolean'
  );
}

Room satisfies Party.Worker;
```

Why these choices:

- **`hibernate: true`**: PartyKit hibernates idle DOs to keep CF billing low. Wakes on the next message in <100ms.
- **`peers` as `Map`**: needed so `welcome` can include current peers and their last-known state.
- **`room.broadcast(msg, [excludeIds])`**: PartyKit's built-in fan-out. Excluding the sender means each client renders only *remote* players, never itself.
- **Rate limiting per second per connection**: `RATE_LIMIT_PER_SEC = 30` is generous for a 20Hz tick (allows bursts). Drops silently to avoid amplification.
- **`isValidState`**: rejects NaN, Infinity, and missing fields — common sources of bugs in browser physics.

## Turn-Based Template — `src/server.ts`

Use this for card games, board games, puzzles. Replace the realtime template with this one.

```ts
import type * as Party from 'partykit/server';
import type { ClientMessage, ServerMessage } from './types';
import { PROTOCOL_VERSION } from './types';

const MAX_PLAYERS = 4;
const MAX_MESSAGE_BYTES = 4096;

type Connection = Party.Connection<{ name?: string }>;

type RoomState = {
  turn: number;
  currentPlayerIndex: number;
  playerOrder: string[];        // playerIds in turn order
  history: Array<{ playerId: string; payload: unknown; turn: number }>;
  // Game-specific state lives here. Replace `unknown` with a real type per game.
  gameState: unknown;
};

export default class Room implements Party.Server {
  options: Party.ServerOptions = { hibernate: true };

  state: RoomState = {
    turn: 0,
    currentPlayerIndex: 0,
    playerOrder: [],
    history: [],
    gameState: null,
  };

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Connection): void | Promise<void> {
    if (this.state.playerOrder.length >= MAX_PLAYERS) {
      conn.send(JSON.stringify({ type: 'reject', reason: 'room-full' } satisfies ServerMessage));
      conn.close();
      return;
    }

    this.state.playerOrder.push(conn.id);

    const welcome: ServerMessage = {
      type: 'welcome',
      playerId: conn.id,
      peers: this.state.playerOrder
        .filter(id => id !== conn.id)
        .map(playerId => ({ playerId })),
      protocolVersion: PROTOCOL_VERSION,
    };
    conn.send(JSON.stringify(welcome));

    const joined: ServerMessage = { type: 'player-joined', playerId: conn.id };
    this.room.broadcast(JSON.stringify(joined), [conn.id]);

    // Optional: replay history to bring the new joiner up to date.
    for (const entry of this.state.history) {
      const replay: ServerMessage = {
        type: 'turn',
        playerId: entry.playerId,
        resultingState: entry.payload,
        turn: entry.turn,
      };
      conn.send(JSON.stringify(replay));
    }
  }

  onMessage(rawMessage: string, sender: Connection): void | Promise<void> {
    // UTF-8 byte length, not JS string `.length` — multibyte characters
    // (emoji, accented letters) inflate byte count vs char count.
    if (new TextEncoder().encode(rawMessage).byteLength > MAX_MESSAGE_BYTES) {
      sender.send(JSON.stringify({ type: 'reject', reason: 'message-too-large' } satisfies ServerMessage));
      return;
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(rawMessage);
    } catch {
      sender.send(JSON.stringify({ type: 'reject', reason: 'bad-json' } satisfies ServerMessage));
      return;
    }

    if (msg.type !== 'move') {
      sender.send(JSON.stringify({ type: 'reject', reason: 'unknown-type' } satisfies ServerMessage));
      return;
    }

    const expectedPlayer = this.state.playerOrder[this.state.currentPlayerIndex];
    if (sender.id !== expectedPlayer) {
      sender.send(JSON.stringify({ type: 'reject', reason: 'not-your-turn' } satisfies ServerMessage));
      return;
    }

    // Game-specific validation. Replace this stub with real rules.
    const validation = validateMove(msg.payload, this.state.gameState);
    if (!validation.ok) {
      sender.send(JSON.stringify({ type: 'reject', reason: validation.reason } satisfies ServerMessage));
      return;
    }

    // Apply the move authoritatively.
    this.state.gameState = validation.next;
    this.state.turn += 1;
    this.state.history.push({ playerId: sender.id, payload: msg.payload, turn: this.state.turn });
    this.state.currentPlayerIndex =
      (this.state.currentPlayerIndex + 1) % Math.max(this.state.playerOrder.length, 1);

    const out: ServerMessage = {
      type: 'turn',
      playerId: sender.id,
      resultingState: this.state.gameState,
      turn: this.state.turn,
    };
    this.room.broadcast(JSON.stringify(out));  // include sender — they need confirmation
  }

  onClose(conn: Connection): void | Promise<void> {
    const idx = this.state.playerOrder.indexOf(conn.id);
    if (idx === -1) return;
    this.state.playerOrder.splice(idx, 1);
    if (this.state.currentPlayerIndex >= this.state.playerOrder.length) {
      this.state.currentPlayerIndex = 0;
    }
    const left: ServerMessage = { type: 'player-left', playerId: conn.id };
    this.room.broadcast(JSON.stringify(left));
  }
}

// Replace this stub with game-specific rules. Returns either {ok: true, next: newGameState}
// or {ok: false, reason: string}.
function validateMove(
  _payload: unknown,
  prevState: unknown,
): { ok: true; next: unknown } | { ok: false; reason: string } {
  return { ok: true, next: prevState };
}

Room satisfies Party.Worker;
```

Key differences from realtime:

- **No tick rate**: messages are user-driven (one per move), so no rate-limiting in the loop sense. A simple "max moves per minute" cap can be added if needed.
- **`playerOrder` enforces turns**: rejected if not the current player's turn.
- **`history` enables late-join replay**: new joiners receive every prior `turn` event so their UI can rebuild the game state without trusting peers.
- **Broadcast includes sender**: senders need server confirmation that their move was accepted.
- **`validateMove` is the game-specific seam**: every game replaces this stub.

## Persistence (Optional)

PartyKit DOs have `room.storage` (key-value, persists across hibernation). To survive a CF deploy / DO eviction:

```ts
async onStart(): Promise<void> {
  const saved = await this.room.storage.get<RoomState>('state');
  if (saved) this.state = saved;
}

async persist(): Promise<void> {
  await this.room.storage.put('state', this.state);
}

// Call persist() after each authoritative state change.
```

For prototype/v1 we recommend skipping persistence — ephemeral rooms are simpler and fit the "default room" model. Add this if the user asks for crash-resilience.

## Local Development

```bash
cd multiplayer-server
npm install
npx partykit dev
```

This starts a local Worker emulator at `http://127.0.0.1:1999`. The PartyKit dev server hot-reloads on save. To connect, use the same URL as `host` in `partysocket`:

```js
new PartySocket({
  host: 'http://127.0.0.1:1999',  // or the deployed https URL
  room: 'lobby',
});
```

`PartySocket` rewrites the scheme to `ws`/`wss` automatically.

## Deploy

```bash
cd multiplayer-server
npx partykit deploy
```

First run prompts a Cloudflare login (browser-based OAuth). The output prints the deployed URL — capture it for `Constants.MULTIPLAYER.SERVER_URL`. See `deploy.md` for the full walkthrough.
