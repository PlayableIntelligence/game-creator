# Step Multiplayer — PartyKit netcode scaffold

Realtime mode (20 Hz) PartyKit server + client NetworkManager wired through EventBus.
Single-player offline still works. Two tabs see each other via the registry. Remote
tank sprites are NOT rendered yet — that's the next step.

## Files

### Created (server side — 6)

- `multiplayer-server/partykit.json`
- `multiplayer-server/package.json`
- `multiplayer-server/tsconfig.json`
- `multiplayer-server/.gitignore`
- `multiplayer-server/src/server.ts` — realtime template, MAX_PLAYERS=4, hibernate, rate-limit 30/sec, `isValidState` rejects NaN/Infinity. Adapted to **carry `rotation`** in `PlayerState` (added to types) since maze-tanks tanks need rotation for facing. The validator only enforces x/y/score/alive — rotation is an optional pass-through field.
- `multiplayer-server/src/types.ts` — shared wire types

### Created (client side — 5)

- `src/multiplayer/MultiplayerClient.js` — partysocket wrapper, errors caught
- `src/multiplayer/RemotePlayerRegistry.js` — Map mirrored into `gameState.multiplayer.remotePlayers`
- `src/systems/NetworkManager.js` — owns 20 Hz broadcast tick, prune interval, reconnect with exponential backoff. Subscribes to `MULTIPLAYER_JOIN_ROOM` / `MULTIPLAYER_LEAVE_ROOM`. Catches every error.
- `.env` — `VITE_MULTIPLAYER_SERVER_URL=http://127.0.0.1:1999`
- `.env.example` — documented placeholder

### Modified (4 core files)

- `src/core/EventBus.js` — appended 7 multiplayer event constants under `// === Multiplayer ===`
- `src/core/GameState.js` — added `multiplayer` object (roomId='lobby', playerId, connected, remotePlayers). `reset()` clears connected + remotePlayers; preserves roomId/playerId.
- `src/core/Constants.js` — appended `MULTIPLAYER` block (named export, not nested in a `Constants` umbrella — see dogfood finding #2)
- `src/main.js` — instantiates NetworkManager, exposes `window.__NETWORK_MANAGER__`, extends `render_game_to_text()` with `multiplayer` + `remotePlayers` fields. Sampler reads the local human tank from `GameScene.tanks.find(t => !t.isBot)`.

### NOT modified (deliberately)

- `src/scenes/GameScene.js` — remote tank rendering is out of scope (next step). NetworkManager already populates the registry, so adding scene-level handlers would just double-upsert.
- Tank.js, BotAI.js, RoundSystem.js, audio, polish — untouched.

## Verification

| Check | Result |
|---|---|
| `npm run build` | PASS — 36 modules, 1.27 MB JS, no errors |
| Single-player offline (partykit OFF) | PASS — game boots, mode reaches `playing`, 4 tanks render, `network:disconnected` fires per reconnect attempt, NO uncaught errors. Console shows expected `WebSocket connection ... ERR_CONNECTION_REFUSED` warnings. |
| Partykit dev startup | PASS — `npx partykit dev` listens on `http://127.0.0.1:1999` cleanly |
| Two-tab smoke test (partykit ON) | PASS — both tabs `connected: true`, each sees the other in `remotePlayers` with `{x, y, rotation, alive}`. Tab A received 31 state messages, Tab B 40, in ~3s — confirms the 20Hz tick. Both rooms = `'lobby'`. No page errors. |
| Vite HMR | Did not break — dev server stayed up across edits |

The verification scripts live at `/tmp/mt-test/test.mjs` (offline) and `/tmp/mt-test/test-twotab.mjs` (two tabs). They use the standalone `playwright` package — not committed.

## Dogfood findings — frictions in the skill spec

These are real issues I hit. In rough priority order.

### 1. `Constants` umbrella import is assumed; maze-tanks uses named exports

The skill ships with `import { Constants } from '../core/Constants.js'` and code like `Constants.MULTIPLAYER.SERVER_URL`. Maze-tanks (and probably other scaffolded games) does **named exports per block**: `export const MAZE = {...}`, `export const TANK = {...}`. There is no `Constants` umbrella object.

I had to rewrite NetworkManager's import to `import { MULTIPLAYER } from '../core/Constants.js'` and replace every `Constants.MULTIPLAYER.X` with `MULTIPLAYER.X`. Same for `client-integration.md` Patch 3 (the Phaser scene example uses `Constants.MULTIPLAYER.STATE_INTERPOLATE_MS`).

**Fix the skill**: detect the convention by reading Constants.js once at Step 0. If it has a `Constants` umbrella export, generate `Constants.MULTIPLAYER.X`. If it uses per-block named exports (`MAZE`, `TANK`, ...), generate `MULTIPLAYER.X`. The architecture rule (CLAUDE.md #3) says "Constants.js" but doesn't mandate a single object — both shapes are valid game-creator outputs.

### 2. `Constants.RECONNECT_BACKOFF_MS` vs my prompt's `RECONNECT_BASE_BACKOFF_MS`

The user prompt said `RECONNECT_BASE_BACKOFF_MS: 500`. The skill's `architecture.md` and `client-integration.md` both use `RECONNECT_BACKOFF_MS: 1000` — different name AND different value. I followed the user's prompt (the explicit override), but the skill's own files disagree among themselves: NetworkManager source in `client-integration.md` calls it `RECONNECT_BACKOFF_MS`, while the user's prompt uses `RECONNECT_BASE_BACKOFF_MS`. **Fix**: pick one name and propagate.

### 3. `welcome` arrives before tests can subscribe to `network:connected`

In my two-tab test, Tab A's events array did NOT include the `connected` event because:

1. `main.js` runs `networkManager.init()` synchronously.
2. The WebSocket opens fast (~50ms locally).
3. `welcome` arrives and `_onWelcome` emits `NETWORK_CONNECTED`.
4. THEN the Playwright `page.evaluate` runs to register a listener.

By the time tests / scene `create()` / anything else subscribes, `NETWORK_CONNECTED` has already fired. **Result**: any code that says "wait for NETWORK_CONNECTED to set up remote sprites" will deadlock under fast local connections.

**Fix the skill**: NetworkManager should also expose `isConnected()` (it does) AND a "fire-on-subscribe" mode for `NETWORK_CONNECTED` — i.e., if a listener subscribes after we're already connected, call it once with the current state. This is a common pattern (RxJS `BehaviorSubject`). Or document the gotcha in `client-integration.md` and tell scenes to check `gameState.multiplayer.connected` on init in addition to the event.

This shows up the moment anyone writes `eventBus.on(NETWORK_CONNECTED, ...)` in a scene's `create()` — the connection already happened.

### 4. The `state` payload schema in architecture.md doesn't include `rotation`

Maze-tanks needs to broadcast tank rotation (turret facing). The architecture.md schema only lists `x, y, vx, vy, score, alive, ts`. I added `rotation?: number` to `types.ts` and the sampler, and the server's `isValidState` happily passes it through (it doesn't validate unknown fields). That's the right behavior, but the spec should explicitly say "the wire schema is open — games extend `state` with their own fields, the server only validates the required core."

### 5. `partykit.json` `compatibilityDate` is hardcoded `2025-01-01`

The skill says "latest compatibilityDate" but the template hard-codes `2025-01-01`. Today is 2026-04-29. Cloudflare's compatibility flags evolved past that date. For first-time deploys this MIGHT bite users with deprecated APIs. **Fix**: either pin to a known-good recent date (`2025-12-15`?) or document that the agent should update it to today's date at scaffold time.

### 6. partykit tooling is loud about npm audit vulnerabilities

`cd multiplayer-server && npm install` reported "4 vulnerabilities (3 moderate, 1 high)" right at scaffold time. They're transitive from `partykit` itself (which pulls in old wrangler / esbuild deps); nothing to fix client-side. Worth a note in the skill so users don't panic and run `npm audit fix --force` (which would break partykit).

### 7. `MULTIPLAYER` const had to be a separate `export` rather than appended to an existing object

Per the architecture-rule #3 ("Constants.js — every magic number"), and per the skill's own append guidance ("Append to the `Constants` object"), I expected to drop the block into an existing object. But maze-tanks' Constants.js is per-block-export, so I had to add `export const MULTIPLAYER = { ... }`. Worked fine. Just confirms finding #1.

### 8. `gameState.multiplayer` initialization is order-sensitive in reset()

The skill's recommended `reset()` does `this.multiplayer.connected = false` etc., but `reset()` is called from the constructor BEFORE `this.multiplayer` exists if you naively put the multiplayer init AFTER the `this.reset()` call.

I worked around it by:
1. Initializing `this.multiplayer = {...}` BEFORE `this.reset()` in the constructor.
2. Guarding the reset block with `if (this.multiplayer)`.

This is a footgun. The skill should explicitly call out the constructor ordering.

### 9. `import.meta.env` access pattern needs guarding

The skill writes `import.meta.env?.VITE_MULTIPLAYER_SERVER_URL`. In contexts where `import.meta` itself isn't available (some test runners, some bundlers), this throws. I changed it to `(typeof import.meta !== 'undefined' && import.meta.env?.X)`. Defensive, but minor.

### 10. Two of the listed files in `partykit-server.md` weren't strictly needed

The spec creates `src/types.ts` (good — shared types) but the realtime template's `import type { ClientMessage, ... } from './types'` makes it required, not optional. The skill text says `types.ts` is "shared message types"; clarify that it's required for the realtime template to compile.

### 11. `partykit dev` env loading

partykit picked up `.env` from the parent dir (`Loading environment variables from ../.env` in the log). That's actually convenient — the partykit server doesn't need any env vars from the client `.env`, so this is harmless. But worth noting that **partykit silently inherits the parent `.env`**. If the client `.env` ever contains a secret intended only for the client (unlikely with VITE_ vars but possible), it would leak into the partykit dev process's env. Document this.

## Loose ends

- **No reconnect verification.** I tested offline → fails → emits disconnected. I did NOT test offline → start server → reconnects. Spec mentions this as a separate verification step; deferred.
- **No `MULTIPLAYER_JOIN_ROOM` / `MULTIPLAYER_LEAVE_ROOM` test.** Wiring is in place; no test exercises it.
- **No turn-based path tested.** Maze-tanks is realtime-only by design.
- **The `welcome` race condition (finding #3) is unmitigated** — not in scope to fix here, but a real risk for the next step (game-specific glue) when GameScene tries to spawn remote tank sprites on `NETWORK_PLAYER_JOINED`. The next step needs to seed from `gameState.multiplayer.remotePlayers` AT SCENE CREATE if already connected, in addition to subscribing to the event.
- **Sampler returns null until GameScene exists.** The 20 Hz tick fires immediately on connect, but `game.scene.getScene('GameScene')` may return undefined for the first few hundred ms during boot. The sampler returns null in that case and the tick is a no-op (correct), but it does mean the first second or two of post-connect ticks are silently dropped. Fine for our use case.
- **`name: undefined`** in `network:player-joined` events. Server doesn't currently send a name; clients haven't called `client.send({ type: 'name', name: '...' })`. Optional feature, deferred.
- **HUD shows nothing about multiplayer.** The render_game_to_text exposes the multiplayer state, but the on-screen HUD doesn't show "connected" / "N peers". Not asked for; flag for design later.
