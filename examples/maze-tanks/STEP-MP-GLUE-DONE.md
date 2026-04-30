# Step MP-Glue — Game-specific multiplayer integration

Wires Phaser maze-tanks gameplay into the realtime PartyKit netcode scaffold.
Spawns remote tanks per-corner, broadcasts bullets/deaths, hot-swaps bots ⇄
remotes, and survives offline single-player identically to pre-multiplayer.

## Files

### Created (4)

- `src/systems/SpawnSystem.js` — Sorts known players (self + remotes) by
  server-stamped `joinedAt` and assigns each to one of the 4 spawn corners
  (TL/TR/BL/BR → RED/BLUE/GREEN/YELLOW). Emits `spawn:assignments-changed`
  when assignments shift. Listens to `NETWORK_CONNECTED`,
  `NETWORK_PLAYER_JOINED`, `NETWORK_PLAYER_LEFT`, `NETWORK_DISCONNECTED`,
  AND `NETWORK_STATE_RECEIVED` (the last is a defense against the
  prune-then-restate registry resurrection — see "Bugs encountered" below).
- `src/systems/BulletNetSync.js` — Bridges local fire → broadcast → remote
  bullet rendering. Local human shooter sends `custom/bullet:fired`. All
  receivers spawn a `nonAuthoritative` bullet with the broadcast `{x, y, vx,
  vy}`; they ricochet locally with the deterministic axis-aligned reflect
  but cannot deal damage. When the local human kills a remote tank,
  broadcasts `custom/tank:died`. All receivers idempotently call
  `victim.kill(killerId)` to trigger the local death animation chain. Bot
  fire is **not** broadcast (each client runs its own bots).
- `src/systems/RoundSync.js` — On `ROUND_ENDED`, broadcasts
  `custom/round:over` so any peer that hasn't yet locally detected
  round_over snaps to it. Idempotent (skips if already in `round_over`).
  Round-restart timing is left to each client's local
  `RESTART_DELAY_MS` — drift across clients is bounded by ROUND_END
  broadcast latency.
- `STEP-MP-GLUE-DONE.md` — this file.

### Modified (5)

- `src/scenes/GameScene.js` — Major rewrite of `spawnTanks`. New helpers
  `_spawnAtCorner`, `_despawnAtCorner`, `_resolveRole`, `_applyAssignments`,
  `_onRemoteState`, `_updateRemoteTanks`. Tank instances now carry
  `role: 'local'|'remote'|'bot'` and `cornerIndex`. Stable corner ids
  `p1..p4` keyed to corner index (NOT to player), so hot-swap doesn't
  invalidate physics. Remote tanks are NOT physics-simulated — instead
  lerped toward `_remoteTargets[playerId]` over 100ms. Bot bullets cannot
  kill remote tanks (filter in collision loop). Small `P1/P2/P3/P4` label
  rendered above remote tanks for testers; bots get no label.
- `src/systems/NetworkManager.js` — (a) Added `'custom'` message handler
  that emits `network:<subtype>` on the EventBus (used for `bullet:fired`,
  `tank:died`, `round:over`). (b) Added `sendCustom(subtype, payload)`
  helper. (c) Threads `joinedAt` through welcome / player-joined messages
  into `gameState.multiplayer.joinedAt` and per-peer registry. (d) New
  `_joinedAtCache` Map preserves `joinedAt` across the prune-then-restate
  re-add path (state messages don't carry joinedAt; the cache fills it
  back in on upsert).
- `src/core/GameState.js` — Added `multiplayer.joinedAt` field.
- `src/entities/Bullet.js` — Two new optional params: `nonAuthoritative`
  (true for bullets spawned from a remote-fire broadcast — they ricochet
  but skip damage in GameScene's collision loop) and `networkBulletId` (so
  receivers dedupe identical bullet:fired messages).
- `src/main.js` — Sampler now picks the local tank by `role === 'local'`
  (or falls back to `scene.player`) instead of `!t.isBot` (which would
  match remote tanks too in the new model).
- `multiplayer-server/src/server.ts` — Now stamps each peer's `joinedAt =
  Date.now()` on connect. Welcome includes own `joinedAt`; welcome.peers
  and player-joined include peer `joinedAt`. New `'custom'` message type
  forwarded as `{type: 'custom', subtype, fromPlayerId, payload}` to all
  other peers. Subtype clamped to 64 chars.
- `multiplayer-server/src/types.ts` — `joinedAt` added to PlayerState
  carriers; `'custom'` ClientMessage and ServerMessage variants added.

## Authority model

| What | Authority | Sync mechanism |
|---|---|---|
| Local human's tank physics | Local client only | 20Hz `state` broadcast: `{x, y, rotation, alive, score}` |
| Remote players' tank rendering | Read-only on each client | Lerp toward last-received state (100ms duration) |
| Bots | Each client runs its OWN copy independently | NOT synced — accepted drift |
| Bullet spawn (human-fired) | Shooter's client broadcasts `bullet:fired` | All clients spawn a non-authoritative visual+ricochet bullet |
| Bullet spawn (bot-fired) | Local-only on the bot's client | NOT broadcast |
| Bullet hits | Shooter's client only | When shooter's authoritative bullet kills a tank, broadcasts `tank:died` |
| Tank death | Killer's client decides; broadcast to others | `tank:died` on EventBus → idempotent `tank.kill(killerId)` on each client |
| Round end (`alive ≤ 1`) | Each client computes locally; first to detect broadcasts | `round:over` snaps any straggler clients |
| Round restart timing | Each client's local 3000ms timer | Not synced; drift bounded by countdown duration |

**Constraint**: bots cannot kill remote tanks, even on the local screen
(filtered in GameScene's collision loop). This avoids the case where one
client's local bot phantom-kills another player who appears alive on their
own screen.

## Verification

| Check | Result |
|---|---|
| `npm run build` | PASS — 41 modules, 1.29 MB JS, no errors |
| Single-player offline (`partykit` OFF) | PASS — game boots, mode=`playing`, 4 tanks (1 local + 3 bots), `network:disconnected` fires per reconnect attempt, no uncaught errors |
| Two-tab realtime | PASS — both tabs connect, see each other in `remotePlayers`, lerp smoothly, fire bullets received as `bullet:fired`, deaths sync via `tank:died`, round end propagates via `round:over`, disconnect (closing tab B) reverts B's corner on tab A to a bot |
| Three-tab realtime | PASS — each tab sees `[1 local + 2 remote + 1 bot]`. SpawnSystem correctly assigns sorted-by-`joinedAt` corners |
| `render_game_to_text()` | PASS — multiplayer block + `remotePlayers` array populated correctly on each tab |
| HMR | PASS — Vite dev server (port 3001) ran continuously across all edits |

Test scripts at `/tmp/mt-test/test.mjs` (offline), `test-twotab.mjs`,
`test-mp-glue.mjs` (full flow: spawn assignments + bullet broadcast + tank
death sync + round-end propagation + disconnect → bot revert),
`test-3tab.mjs` (3-player), and `test-render.mjs` (render_game_to_text).

## Bugs encountered & fixed during implementation

These are noteworthy because they bear on the `add-multiplayer` skill spec.

### B1. Pruned player re-added by state message → SpawnSystem stale

**Symptom**: in 3-tab tests, A's `remotePlayers` registry contained C with
a valid `joinedAt`, but A's SpawnSystem assignments showed `playerId=null`
at C's expected corner. C effectively invisible to A.

**Root cause**:
1. NetworkManager prunes any peer whose `lastSeenTs > 3s ago`. During the
   first ~3s of C's life, C's local human tank may not exist (scene is
   booting, hot-swap is in flux), so C broadcasts no `state` messages.
2. A prunes C from the registry.
3. C's first state arrives. `_onState` calls `registry.upsert(C, state)`.
   This re-adds C — but the state payload has no `joinedAt`, so the
   registry entry is missing `joinedAt`.
4. SpawnSystem fell back to `Number.MAX_SAFE_INTEGER` for missing
   `joinedAt`, but more importantly, **`_recompute()` doesn't run on
   state-driven re-adds** (only on player-joined/left/connected events).

**Fix (two-pronged)**:
- NetworkManager keeps a `_joinedAtCache` Map of `playerId → joinedAt`,
  populated on welcome.peers and player-joined. `_onState` now augments the
  upsert payload with the cached joinedAt, so the registry entry never
  forgets it.
- SpawnSystem subscribes to `NETWORK_STATE_RECEIVED` too, recomputing
  whenever it sees a state from a `playerId` not in its `_knownIds` set.

This is a real footgun — should be added to the `add-multiplayer` skill's
"common pitfalls" section.

### B2. Welcome race (per dogfood finding #3 in STEP-MULTIPLAYER-DONE.md)

**Symptom**: scene.create() runs before/after WS welcome arrives → if
welcome arrives during the brief window between SpawnSystem construction
and `eventBus.on('spawn:assignments-changed', ...)`, the emit fires into
the void and the scene never hot-swaps to the right corner layout.

**Fix**: After registering the listener in scene.create(), explicitly call
`this._applyAssignments(this.spawnSystem.getAssignments())`. Idempotent
(diff-based) so safe to call regardless of the actual race outcome.

### B3. Bullet `id` collisions across clients

**Risk**: each client uses a module-level `_bulletIdSeq` counter. Two
clients' bullets could share the same id, breaking dedupe.

**Fix**: BulletNetSync constructs network bullet ids as
`${playerId}:${seq}` so they're globally unique. Bullet constructor accepts
an optional `networkBulletId` to use that exact id.

## Known limitations (acceptable for dogfood)

1. **Bot drift**: each client runs its own independent bot AI. Bots may
   wander differently across clients, fire at different moments, hit
   different things. Bot kills do NOT sync (intentional — server-
   authoritative bots are out of scope).
2. **Bot-bullet vs remote-tank**: blocked by collision filter (B1's
   sibling). A bot's bullet can kill the local human or other bots, but
   never a remote tank — that would phantom-kill someone alive on their
   own screen.
3. **Bullet cross-kill race**: if two human players' bullets approach the
   same target at the same instant on different clients, each shooter's
   client may attribute the kill differently. The first `tank:died`
   broadcast wins (both clients accept it idempotently). The losing
   shooter's bullet still expires (`hit()`) but doesn't get re-broadcast,
   so visually there's a "missed" hit on the loser's screen. Acceptable.
4. **Round-end drift (≤ ~100ms)**: each client locally decides round-end
   when `aliveTanks ≤ 1`. The first to broadcast `round:over` wins; others
   accept. Drift is bounded by the broadcast round-trip (~50-100ms LAN).
5. **Round-restart drift (≤ ~100ms)**: each client times its own 3-second
   restart locally, no network resync. Countdown will roughly align but
   the next round may start slightly out of phase across clients. Visible
   to players as "GET READY" appearing at slightly different moments.
6. **Initial-state flicker**: when a 3rd client joins, brief (~1 frame)
   visual flicker where the new client transitions through corner #1
   before settling at corner #2. Caused by `_onWelcome`'s peer-by-peer
   loop emitting one PLAYER_JOINED per peer; SpawnSystem recomputes after
   each. Could be fixed by deferring recompute to end-of-welcome, but the
   flicker is single-digit milliseconds and not worth the complexity.
7. **No reconciliation**: if a remote player teleports out of bounds
   (e.g., wall clip), the local client trustingly lerps toward that
   position. Server's `isValidState` only rejects NaN/Infinity, not
   geometric impossibility.
8. **No tank thrust visual on remotes**: remote tanks don't emit
   `TANK_THRUST_START/END`, so smoke trails don't appear behind them. The
   broadcast schema doesn't include thrust state. Could be added as a
   bool to the state payload.

## Loose ends / out of scope

- **No reconnect-mid-round verification**: tested initial connect + offline
  + disconnect-bot-revert, but didn't test "tab A drops then reconnects
  and resumes its corner". The `_joinedAtCache` is cleared on
  `intentionalDisconnect`, but an unintentional drop preserves it. Behavior:
  A's reconnect would generate a NEW `playerId` (server stamps a new conn
  id), so A appears as a "new" player to others — gets a different
  corner. This is fine but not formally tested.
- **No name display**: remote tanks just show `P1/P2/P3/P4`. Server-side
  name handling exists (`type: 'name'`) but no client UI for setting one.
- **HUD doesn't show "X players connected"**: render_game_to_text exposes
  it, but the on-screen HUD just shows scores. Not asked for.
- **Server prune (server-side)**: PartyKit handles dropped connections
  natively via `onClose`. We rely on that.
- **Score sync**: each client maintains its own `wins` counter. After a
  `tank:died` event, locally Constants-compute who won and call
  `recordWin()`. Drift between clients is theoretically possible if an
  early-arriving `round:over` from a peer has a different `winnerColor`
  than the local computation. The local scene's `RoundSystem.endRound`
  uses whatever `winnerColor` is passed in, so the broadcast wins.
  Acceptable.
