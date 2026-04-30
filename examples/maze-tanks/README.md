# Maze Tanks

Classic Atari Combat-style 4-player tanks-in-a-maze. Phaser 3 client + PartyKit
server (Cloudflare Durable Objects). Demonstrates the
[`add-multiplayer`](../../skills/add-multiplayer/) skill.

Live-players-only: empty corners stay empty (no NPC bots). Up to 4 humans share
a `lobby` room; first to join takes RED (top-left), second BLUE (top-right),
etc. Last tank standing wins the round.

## Controls

| Key | Action |
|---|---|
| `A` / `D` | Rotate tank chassis left / right |
| `W` / `S` | Thrust forward / backward |
| `Space` | Fire bullet (ricochets up to 2 walls) |
| `M` | Mute / unmute audio |

## Run locally

```bash
npm install

# Terminal 1: local PartyKit dev server (port 1999)
cd multiplayer-server && npm install && npx partykit dev

# Terminal 2: Vite dev server (port 3001)
npm run dev
```

The included `.env.example` ships with `VITE_MULTIPLAYER_SERVER_URL=http://127.0.0.1:1999`
so the client connects to local PartyKit. Copy it to `.env` to activate.

Open `http://localhost:3001/` in two tabs to test multiplayer locally.

## Deploy your own multiplayer server

The `SERVER_URL` constant ships as a placeholder
(`https://YOUR-PROJECT.YOUR-USER.partykit.dev`). To go live:

```bash
cd multiplayer-server
npx partykit login --provider github   # one-time GitHub OAuth
npx partykit deploy                    # prints the deployed URL
```

Then update `src/core/Constants.js`:

```js
export const MULTIPLAYER = {
  SERVER_URL: 'https://YOUR-PROJECT.YOUR-USER.partykit.dev',  // ← your URL
  // …
};
```

Rebuild and host the client (`npm run build` + your hosting provider). The
PartyKit server runs in your own Cloudflare account — free tier covers up to
100k requests/day.

## Architecture

Follows the game-creator [architecture rules](../../CLAUDE.md):

- `src/core/{EventBus,GameState,Constants}.js` — pub/sub, state, config
- `src/scenes/GameScene.js` — main arena
- `src/entities/{Tank,Bullet}.js` — entities
- `src/systems/{MazeSystem,RoundSystem,PolishSystem,SpawnSystem,BulletNetSync,RoundSync,NetworkManager}.js`
- `src/multiplayer/{MultiplayerClient,RemotePlayerRegistry}.js` — backend-agnostic netcode
- `multiplayer-server/src/server.ts` — PartyKit room (realtime mode, 20 Hz tick)

### Authority model

| What | Authority |
|---|---|
| Local tank physics | Local client (broadcast at 20Hz) |
| Remote tank rendering | Read-only, lerped over 100ms |
| Bullets | Shooter-authoritative — shooter broadcasts `bullet:fired`, only shooter detects hits |
| Tank deaths | Broadcast on death (any cause) — receivers idempotently apply |
| Round end | Local computation; first-to-detect broadcasts `round:over` |

### Wire format

All positions/velocities are broadcast in **design pixels** (PX-independent).
Receivers multiply by their own `PX` to render — this lets clients with
different DPRs/window sizes agree on positions.
