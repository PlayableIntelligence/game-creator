---
name: add-multiplayer
description: Add real-time or turn-based multiplayer to an existing browser game using PartyKit (Cloudflare Durable Objects). Scaffolds a room-based server, a NetworkManager client, EventBus events, GameState fields, Constants, and extends render_game_to_text(). Use when the user says "add multiplayer", "make this multiplayer", "add real-time co-op", "add online play", "scaffold multiplayer", or "add netcode". Do NOT use for solo leaderboards (use monetize-game), single-player AI opponents (use add-feature), or peer-to-peer/WebRTC games.
argument-hint: "[game-path] [--mode=realtime|turn-based]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 0.1.0
  tags: [game, multiplayer, networking, partykit, websocket, realtime, turn-based]
compatibility: Requires an existing Phaser 3 or Three.js game with game-creator architecture (EventBus, GameState, Constants.js, render_game_to_text). Requires Node.js and a Cloudflare account for `npx partykit deploy` (free tier is sufficient).
---

# Add Multiplayer (PartyKit / Cloudflare Durable Objects)

Add real-time or turn-based multiplayer to an existing single-player browser game. This skill scaffolds:

1. A **PartyKit server** (one Durable Object per room) deployed to Cloudflare's edge.
2. A **client `NetworkManager`** wired through EventBus that mirrors the existing `playfun.js` external-service pattern.
3. **Additive edits** to `EventBus`, `GameState`, `Constants`, and `render_game_to_text()` — single-player gameplay must remain identical when the server is unreachable.

The default state is "single-player works." If the WebSocket connection fails, NetworkManager swallows the error and the game runs locally as before. When connected, remote players appear via `network:player-joined` and synchronize via `network:state-received`.

## Reference Files

- `architecture.md` — event taxonomy, GameState schema, NetworkManager contract, Phaser vs Three.js placement notes.
- `partykit-server.md` — server templates (`realtime.ts` and `turn-based.ts`), state shape, broadcast helpers, rate limiting.
- `client-integration.md` — `MultiplayerClient`, `NetworkManager`, `RemotePlayerRegistry` source, EventBus/GameState/Constants append patterns, `render_game_to_text` extension.
- `deploy.md` — `npx partykit dev` and `npx partykit deploy` walkthrough, capturing the deployed URL, `.env` handling, and client redeploy.

## Core Principles

These are rules, not guidelines:

1. **Single-player must work offline.** With the server unreachable, the game must boot, play, and reset normally. NetworkManager catches all connection errors and emits `network:disconnected` instead of throwing.
2. **Additive edits only.** Append to `EventBus.js`, `GameState.js`, `Constants.js`, `main.js`, and `render_game_to_text()` under a `// === Multiplayer ===` banner. Never rename, remove, or change existing fields.
3. **EventBus is the only seam.** NetworkManager talks to the rest of the game through events — no direct imports from scenes, systems, or entities into NetworkManager (or vice versa).
4. **Server is authoritative, but tolerant.** The PartyKit room owns the canonical room state. Clients send intents; the server validates and broadcasts. In `realtime` mode validation is light (last-write-wins). In `turn-based` mode validation is strict (rejects out-of-turn moves).
5. **Backend-agnostic client API.** All `partysocket` calls go through `MultiplayerClient`. If a future user wants Colyseus or fly.io+ws, only `MultiplayerClient.js` changes — game code does not.
6. **Default room is `'lobby'`.** No matchmaking UI in v1. Users override by emitting `multiplayer:join-room` with a custom room id.

## Prerequisites

- An existing Phaser 3 or Three.js game scaffolded with this plugin (has `src/core/EventBus.js`, `src/core/GameState.js`, `src/core/Constants.js`, `src/main.js` with `window.render_game_to_text()`).
- Node.js 18+.
- A Cloudflare account for `npx partykit deploy` (the CLI walks the user through login on first deploy; free tier is sufficient for prototyping).

## Instructions

The user wants to add multiplayer to the game at `$ARGUMENTS` (or the current directory if no path given). Optional `--mode=realtime` (default) or `--mode=turn-based` chooses the server template.

### Step 0: Locate and read the game

Parse `$ARGUMENTS` for the game path and `--mode` flag. If no path, use cwd. Verify it's a game by reading `package.json` and confirming Phaser or Three.js dependency.

Read these files in full before touching anything:

- `package.json` — engine + scripts.
- `src/main.js` — orchestrator, `window.render_game_to_text()`, `window.advanceTime()`.
- `src/core/EventBus.js` — exact event names already in use.
- `src/core/GameState.js` — current state shape and `reset()` semantics.
- `src/core/Constants.js` — config block conventions.
- `progress.md` if present — pipeline context.

Then tell the creator one sentence confirming what you saw:

> Game is **`<engine>`** with **`<N>`** events and a `<player|bird|ship>` entity. I'll add a multiplayer layer that broadcasts the local `<entity>`'s state at `TICK_RATE_HZ` and renders remote players from server broadcasts. Single-player will continue to work when the server is offline.

### Step 1: Choose sync mode

Pick the server template:

| Mode | When to use | Wire model |
|---|---|---|
| `realtime` (default) | Action games, runners, dodgers, platformers, anything with continuous movement | Local `setInterval` at `TICK_RATE_HZ` broadcasts the local entity's `{x, y, [z], score, state}`; server fans out; clients render last-known remote state |
| `turn-based` | Card games, board games, puzzles, anything with discrete moves | EventBus events (`player:moved`, `player:played-card`) forward as `{type, payload}` messages; server validates and broadcasts; clients apply on `network:state-received` |

If the user did not pass `--mode`, infer from the game's existing events. If you see continuous-position events (`bird:flap`, `player:moved`, position-updating physics), use `realtime`. If you see discrete actions (`card:played`, `move:submitted`), use `turn-based`. State the choice and proceed.

### Step 2: Scaffold the server

Create a sibling `multiplayer-server/` directory inside the game project. See `partykit-server.md` for the full template content.

Create:

- `multiplayer-server/partykit.json` — manifest with `name` (use the game's directory name), `main: "src/server.ts"`, `compatibilityDate`.
- `multiplayer-server/package.json` — `partykit` dep, `dev`/`deploy` scripts.
- `multiplayer-server/tsconfig.json` — minimal TypeScript config that PartyKit accepts.
- `multiplayer-server/src/server.ts` — paste the appropriate template from `partykit-server.md` (`realtime` or `turn-based`).
- `multiplayer-server/.gitignore` — `node_modules`, `.partykit`.

Run `cd multiplayer-server && npm install` to install `partykit` (which provides `partysocket` for the client too via npm workspaces, but we'll add `partysocket` explicitly to the client).

### Step 3: Scaffold the client

Create three new files. See `client-integration.md` for the full source.

- `src/multiplayer/MultiplayerClient.js` — backend-agnostic interface around `partysocket` (`connect`, `send`, `onMessage`, `disconnect`, `isConnected`).
- `src/multiplayer/RemotePlayerRegistry.js` — `Map<playerId, RemotePlayer>` with `upsert`, `remove`, `prune(staleMs)`, `list()`.
- `src/systems/NetworkManager.js` — wires MultiplayerClient ↔ EventBus, owns the broadcast tick (in `realtime` mode), handles reconnect with exponential backoff, emits `network:*` events.

Add `partysocket` to the game's `package.json` deps:

```bash
cd <game-path> && npm install partysocket
```

### Step 4: Append to existing core files

Make additive edits only. See `architecture.md` for full schemas and `client-integration.md` for the exact append blocks.

**`src/core/EventBus.js`** — append under `// === Multiplayer ===` banner:

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

**`src/core/GameState.js`** — append a `multiplayer` field with persistent (`roomId`, `playerId`) and transient (`connected`, `remotePlayers`) parts. Update `reset()` to clear only the transient parts so rejoin works after a game restart.

**`src/core/Constants.js`** — append a `MULTIPLAYER` block with `SERVER_URL` (filled by Step 6), `DEFAULT_ROOM`, `MAX_PLAYERS`, `TICK_RATE_HZ`, reconnect backoff, stale-player threshold, `PROTOCOL_VERSION`. No magic numbers — every value is a named constant.

**`src/main.js`** — instantiate NetworkManager after EventBus + GameState, before the engine starts. Expose `window.__NETWORK_MANAGER__` for tests. Extend `window.render_game_to_text()` to additively include `multiplayer: {...}` and `remotePlayers: [...]`.

### Step 5: Wire the local game into the network tick

Inspect existing events. The wiring depends on mode:

**`realtime`**: NetworkManager owns a `setInterval` at `TICK_RATE_HZ`. Each tick it reads the local entity from `GameState` and calls `client.send({type: 'state', payload: {...}})`. No EventBus subscription needed — it just samples GameState. Add a single `network:state-received` listener in the relevant scene/system that calls `RemotePlayerRegistry.upsert()` and triggers a re-render.

**`turn-based`**: NetworkManager subscribes to the game's existing move events (e.g., `card:played`, `move:submitted`) and forwards them. The scene/system listens for `network:state-received` and applies the validated remote move. Local optimistic UI is allowed, but the server is the source of truth.

In Phaser games, remote-player rendering happens in the active GameScene — instantiate sprites on `network:player-joined`, update positions on `network:state-received`, destroy on `network:player-left`. In Three.js games, the active orchestrator (`Game.js`) creates and updates remote-player meshes.

See `client-integration.md` for example scene patches for both engines.

### Step 6: Deploy the server

Run the dev server first to confirm everything works locally:

```bash
cd <game-path>/multiplayer-server && npx partykit dev
```

This starts a local CF Worker emulator on `http://127.0.0.1:1999`. In another terminal, set `VITE_MULTIPLAYER_SERVER_URL=http://127.0.0.1:1999` in `<game-path>/.env` and run the client (`cd <game-path> && npm run dev`).

For first-time deployment, the user must authenticate with PartyKit. **Always pass `--provider github`** — the default `clerk` flow is broken in 2026 (the dashboard.partykit.io callback was retired after Cloudflare absorbed PartyKit, and login hangs forever):

```bash
cd <game-path>/multiplayer-server && npx partykit login --provider github
```

This uses GitHub's device-code OAuth flow. The CLI prints a code; the user visits `https://github.com/login/device`, pastes it, and authorizes. Credentials persist in `~/.partykit/config.json`. See `deploy.md` for the full walkthrough and troubleshooting.

After login, deploy:

```bash
cd <game-path>/multiplayer-server && npx partykit deploy
```

Capture the deployed URL from the output (format: `https://<project>.<cloudflare-username>.partykit.dev`). The TLS cert may take 30-60 seconds to provision after the deploy reports success.

Update three places with the deployed URL:

1. `src/core/Constants.js` → `MULTIPLAYER.SERVER_URL`
2. `<game-path>/.env` → `VITE_MULTIPLAYER_SERVER_URL=https://...`
3. `<game-path>/.env.example` → `VITE_MULTIPLAYER_SERVER_URL=https://your-project.your-username.partykit.dev`

Add `.env` to `.gitignore` if not already present.

See `deploy.md` for the full walkthrough including offline-first authentication and troubleshooting.

### Step 7: Redeploy the client

Reuse the existing host detection logic (same as `monetize-game` Step 5):

1. If `.herenow/state.json` exists → redeploy via `~/.agents/skills/here-now/scripts/publish.sh dist/`.
2. Else if `gh` is configured and the repo has a GitHub Pages workflow → `npx gh-pages -d dist`.
3. Else if `vercel` is configured → `vercel --prod`.
4. Else ask the user how they want to redeploy.

Always run `npm run build` first.

### Step 8: Verify

**Build cleanly:**

```bash
cd <game-path> && npm run build
cd multiplayer-server && npm run build  # if a build script exists
```

**Single-player fallback (critical):** with the partykit dev server stopped, reload `http://localhost:3000`. The game must boot, play, and reset normally. Confirm `network:disconnected` fired and no uncaught errors in the console. **If the game depends on the server to start, you violated Principle 1 — revise.**

**Two-tab smoke test:** start `npx partykit dev` in one terminal and `npm run dev` in another. Open two browser tabs at `http://localhost:3000`. Confirm:

- Both tabs fire `network:connected` (check console).
- Each tab's `window.render_game_to_text()` includes the other tab in `remotePlayers`.
- Moving the local entity in tab A is reflected in tab B's remote-player rendering within `1000 / TICK_RATE_HZ * 2` ms.

**Reconnect:** kill the partykit dev server, wait, restart it. The client should reconnect within `RECONNECT_MAX_BACKOFF_MS` and re-emit `network:connected`.

**Regression:** existing `tests/e2e/*.spec.js` must still pass. Single-player invariants (boot, score, game-over, reset) must hold whether the server is up or down.

### Step 9: Update `progress.md`

Append a `## Multiplayer` section:

```markdown
## Multiplayer

- **Backend**: PartyKit (Cloudflare Durable Objects)
- **Server URL**: https://<project>.<user>.partykit.dev
- **Mode**: realtime | turn-based
- **Max players per room**: 4
- **Tick rate**: 20 Hz (realtime mode)
- **Default room**: lobby
- **Known limitations (v1)**: no matchmaking UI, no spectator mode, no persistent accounts, server-side rate limiting only.
```

## Output

Tell the user:

1. **What was added** — server in `multiplayer-server/`, client in `src/multiplayer/` + `src/systems/NetworkManager.js`, additive edits to four core files.
2. **The server URL** — `https://<project>.<user>.partykit.dev`. Already wired into Constants and `.env`.
3. **How to test locally** — `cd multiplayer-server && npx partykit dev` then `npm run dev`, open two tabs.
4. **The single seam for backend swaps** — point at `src/multiplayer/MultiplayerClient.js`. Future Colyseus or fly.io migration only changes that one file.
5. **Costs** — free on Cloudflare's Workers free tier (100k requests/day, 1GB DO storage). Mention the user owns the deployed Cloudflare project; PartyKit deploys to their CF account, not OpusGameLabs'.

## Example Usage

### Default (realtime mode in current directory)

```
/add-multiplayer
```

Result: detects engine, scaffolds `multiplayer-server/` with the realtime template, creates client networking files, deploys server, redeploys client, prints play URL and server URL.

### Turn-based explicit

```
/add-multiplayer ./examples/card-game --mode=turn-based
```

Result: uses the turn-based server template; NetworkManager forwards the game's existing move events instead of running a position-broadcast tick.

### Verbose dry-run for inspection

```
/add-multiplayer --dry-run
```

Result: prints the full file list and patches without writing or deploying. Useful for review before committing.

## Troubleshooting

### `npx partykit login` redirects to `dashboard.partykit.io/patience` and never completes
**Cause:** The default `clerk` provider was retired after Cloudflare absorbed PartyKit; the dashboard the OAuth callback expects is gone.
**Fix:** Use `npx partykit login --provider github` instead — GitHub device-code flow, prints a code, you paste at `https://github.com/login/device`. Credentials persist in `~/.partykit/config.json`.

### Remote players don't appear even though the connection succeeded
**Cause:** Welcome-race — the WebSocket `welcome` arrived before the scene's `create()` registered its `NETWORK_PLAYER_JOINED` listener. The events fired into the void.
**Fix:** After registering the listener, seed from `gameState.multiplayer.remotePlayers` directly. See `client-integration.md` → "Welcome-race gotcha" for the idempotent pattern.

### Two tabs connect but never see each other
**Cause:** They joined different rooms (random room IDs from URL parsing) or the server's broadcast logic excludes the sender by default.
**Fix:** Check the room id in `window.render_game_to_text().multiplayer.roomId` on both tabs — it should be the same (default `'lobby'`). If different, audit `NetworkManager.connect()` for stray query-string parsing. The server template's `room.broadcast(message, [sender.id])` excludes the sender, which is correct — each client renders only *remote* players, not itself.

### Remote players appear stuck at last position when a peer closes the tab
**Cause:** `onClose` did not fire (browser killed the tab without a clean close), or the client did not run `RemotePlayerRegistry.prune()`.
**Fix:** The server's `onClose` handler is the canonical "player left" signal. Additionally, NetworkManager runs `RemotePlayerRegistry.prune(STALE_PLAYER_MS)` on every tick — verify this is wired. If a remote player has not sent state in `STALE_PLAYER_MS`, prune emits `network:player-left` even without an explicit close.

### Game lags or stutters when many remote players are present
**Cause:** Either too-high `TICK_RATE_HZ` (you're broadcasting and rendering 60 times per second) or the scene re-creates remote-player sprites every frame instead of reusing them.
**Fix:** Lower `TICK_RATE_HZ` to 20 (default) or 10 for slow games. Confirm scenes maintain a `Map<playerId, sprite>` and only update positions on `network:state-received`, never recreate.

### Single-player tests fail after adding multiplayer
**Cause:** NetworkManager throws or blocks game boot when the server is unreachable. This violates Principle 1.
**Fix:** Audit `MultiplayerClient.connect()` and `NetworkManager.init()` — both must catch all errors, log a warning, emit `network:disconnected`, and return. The constructor and `init()` must never throw out of `main.js`.

### `render_game_to_text()` snapshot tests fail
**Cause:** Tests use exact `toEqual` on the output; you added new top-level fields.
**Fix:** Regenerate baselines — additions are intentional and backward-compatible. The fields added are `multiplayer` (object) and `remotePlayers` (array, may be empty).

### Cloudflare deploy succeeds but the WebSocket fails in the browser
**Cause:** Mixed content (HTTP page → WSS server) or the server URL was written without the `https://` scheme.
**Fix:** Confirm `Constants.MULTIPLAYER.SERVER_URL` is the full `https://...partykit.dev` URL. `partysocket` derives the WSS URL by replacing the scheme. The deployed game must also be served over HTTPS for the WSS connection to succeed (here.now and GitHub Pages both serve HTTPS by default).

### Free tier rate limit hit
**Cause:** Many concurrent rooms or chatty clients.
**Fix:** Cloudflare's Workers free tier allows 100k requests/day. Each client tick at 20 Hz is one request — that's `1.7M / day` for a single 24/7 player. For prototyping you'll never hit this; for production, lower `TICK_RATE_HZ` or upgrade to Workers Paid ($5/mo flat for 10M requests/day).

## Tips

> Run `/add-multiplayer` once per game. If you later change modes, edit `multiplayer-server/src/server.ts` directly — both templates are checked in and the switch is small.
>
> The default `'lobby'` room is suitable for a single open room. To support private rooms, emit `multiplayer:join-room` with a room id from a URL query string or invite code. NetworkManager listens for that event and reconnects to the new room.
>
> For graduation to a more featureful backend (matchmaking, schema sync, server-authoritative physics), the only file that needs to change is `src/multiplayer/MultiplayerClient.js`. Replace the `partysocket` calls with Colyseus's `colyseus.js` client; keep the same public API (`connect`, `send`, `onMessage`, `disconnect`, `isConnected`).
>
> The server runs in *your* Cloudflare account, not OpusGameLabs'. Costs and quotas accrue to you. PartyKit itself is open source and free; you only pay Cloudflare's pass-through pricing (free tier is generous).
