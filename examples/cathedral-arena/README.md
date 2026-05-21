# Cathedral Arena — multiplayer souls demo

Multiplayer PvP demo combining three game-creator pieces:

1. **`game-creator-plus`** runtime — Marble Labs splat world (cathedral), kinematic capsule, fake-floor physics, spring-arm camera, VRM character
2. **`add-multiplayer`** skill — PartyKit room with 4-player cap, position sync at 30Hz, attack event broadcast
3. **Souls aesthetic** — borrowed from the `souls-demo` showcase: greatsword, hit flash, "You Died" overlay (combat is intentionally lite for v1)

```
1-4 players  →  spawn around cathedral floor
LMB         →  light attack (2m reach, 60° cone, 25 dmg)
WASD/Shift  →  move/run
Space       →  jump
```

## Run locally (two terminals)

```bash
# Terminal 1 — multiplayer server (PartyKit dev runs on :1999)
cd multiplayer-server
npm install
npm run dev

# Terminal 2 — client
npm install
npm run dev
# → http://localhost:5180
```

Open the client URL in **two browser tabs** to see the multiplayer flow:
- Both tabs land in the cathedral
- Each player sees the other's VRM walk/run animation
- LMB to swing — if the other player is in your 2m / 60° cone, they take damage
- HP bar bottom-left, "You Died" overlay at 0 HP, 3s respawn at a random spawn point

## Architecture

```
src/
├── main.js                # boot orchestrator (renderer, scene, world, capsule, Game)
├── game/
│   ├── Game.js            # cathedral-arena gameplay (combat + multiplayer wiring)
│   └── raycast.js         # pointer-lock-aware raycast helper
├── core/                  # EventBus, GameState, Constants (ARENA / COMBAT / MULTIPLAYER blocks added)
├── world/                 # WorldLoader + SplatLoader + FakeFloor + Collision (from plus-template)
├── render/                # Renderer + PostPipeline + Lighting (from plus-template)
├── player/                # Capsule + CameraMode + AnimatedCharacter + VRMLoader (from plus-template)
├── multiplayer/
│   ├── NetworkManager.js  # partysocket wrapper, callbacks for connect/state/attack
│   └── RemotePlayer.js    # network-driven AnimatedCharacter, lerps to server-broadcast state
├── ui/
│   └── HUD.js             # slot-based overlay (from plus-template) — Game.js injects HP bar
└── combat/                # souls-demo combat code (kept for future depth — not all wired yet)

multiplayer-server/
└── src/server.ts          # PartyKit room (4-player cap, byte-checked message size, rate limit)
```

### Wire format (client ↔ server)

```ts
// client → server
{ type: "state",  state:  { x, y, z, yaw, hp, alive } }
{ type: "attack", attack: { origin, facing, reach, hits[], damage } }

// server → client
{ type: "welcome",       playerId, peers: [{ playerId, state? }] }
{ type: "player-joined", playerId }
{ type: "player-left",   playerId }
{ type: "state",         playerId, state }      // server-stamped ts
{ type: "attack",        playerId, attack }     // server-stamped ts
```

Authority model: **last-write-wins**. Clients send their own truth; server stamps + relays. Suitable for showcase demos but exploitable (a client could claim "I dealt 100 dmg"). For competitive play you'd flip to server-authoritative damage validation.

### Single-player fallback

If the multiplayer server is unreachable, `NetworkManager` catches the connect error, fires `onDisconnected`, and the game continues working locally (you just won't see other players).

## URL params

- `?slug=cathedral` (default) — world to load. Drop other Marble worlds into `public/assets/worlds/<slug>{,-100k,-500k}.spz` + `<slug>-collider.glb` to swap.
- `?room=foo` — join a non-default PartyKit room
- `?server=ws://localhost:1999` — override multiplayer server URL
- `?character=vrm|robot|soldier|xbot` — player model (default: VRM)
- `?cam=first|third|topdown|side` — camera mode

## What's not in v1 (good follow-ups)

- **Server-authoritative damage** — currently any client can claim a hit
- **Block + roll + stamina** — `combat/Player.js` from souls-demo has the state machine, just not wired
- **Sword on the player** — the greatsword.fbx ships unused; `combat/WeaponAttach.js` does the hand-bone attachment
- **Death animation + sword physics ragdoll** — souls-demo has both
- **Lobby / matchmaking UI** — currently everyone joins the `cathedral` room

## Deploy

PartyKit deploy:
```bash
cd multiplayer-server && npx partykit deploy
# → wss://cathedral-arena-multiplayer.<your-handle>.partykit.dev
```

Then point the client at the deployed URL via `VITE_MULTIPLAYER_SERVER` env var or `?server=` param.
