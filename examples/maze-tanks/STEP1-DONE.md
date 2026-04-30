# Step 1 — Scaffold complete

## Files

### Rewritten
- `src/core/Constants.js` — stripped portrait/dodger keys (PLAYER, GROUND, SKY, JUMP_VELOCITY, GRAVITY, FORCE_PORTRAIT, SPRITE_ASPECT, TOUCH). Added GAME (with DESIGN_W/H), MAZE, TANK, BULLET, BOT, ROUND, COLORS (RED/BLUE/GREEN/YELLOW + BG/WALL/FLOOR/BULLET), SPAWNS (4 corner spawn descriptors with facings toward center).
- `src/core/EventBus.js` — replaced PLAYER_*/SCORE_CHANGED with TANK_SPAWNED/FIRED/DIED, BULLET_RICOCHET/EXPIRED, ROUND_COUNTDOWN/STARTED/ENDED. Kept SPECTACLE_* and AUDIO_* / MUSIC_* hooks.
- `src/core/GameState.js` — replaced score/best/started/gameOver with roundState ('countdown'|'playing'|'round_over'), roundNumber, countdownEndsAt, restartAt, wins{RED,BLUE,GREEN,YELLOW}, lastWinnerColor. `reset()` clears round state but preserves wins; `resetWins()` available for full session reset.
- `src/core/GameConfig.js` — landscape config: GAME.WIDTH/HEIGHT, gravity y:0, scenes [BootScene, GameScene] (no GameOverScene), background COLORS.BG.
- `src/main.js` — `render_game_to_text()` rewritten to expose round state, per-color wins, full tanks array (id/color/x/y/rotation/alive/isBot), bulletsCount. `advanceTime(ms)` preserved. `__GAME__/__GAME_STATE__/__EVENT_BUS__/__EVENTS__` still exposed for tests.
- `src/scenes/GameScene.js` — full rewrite: centers maze in canvas via a `world` Phaser.Container at (mazeOffsetX, mazeOffsetY), instantiates MazeSystem, spawns 4 Tanks from SPAWNS, attaches BotAI to the 3 bots, runs RoundSystem state machine. Listens for TANK_FIRED → instantiates Bullets. Per-frame: player tank input → bot AI input → bullet movement → bullet vs tank collisions → cleanup → round end check. HUD text shows R{N} + per-color win tallies.

### New
- `src/entities/Tank.js` — chassis (color rect + treads) + turret base + barrel (perpendicular line + barrel pointing along +x in local space, rotated by `rotation`). Per-frame rotate / thrust forward / thrust back / fire (cooldown-gated). Drag (pow(DRAG, dt*60) for frame-independence) + max speed clamp. Wall collision via `MazeSystem.resolveCircle()` axis-separation. `kill(killerId)` flips alive=false, fades sprite to alpha 0.25, emits TANK_DIED + SPECTACLE_HIT.
- `src/entities/Bullet.js` — constant velocity, 2 substeps per frame to reduce tunneling. On wall hit: snap-out by overlap, axis-aligned reflect, increment bounce count, emit BULLET_RICOCHET. Despawns on lifetime (4s), bounce limit (>2 = MAX_BOUNCES), or hit. `canHit(tank)` enforces 200ms self-hit grace for the shooter.
- `src/systems/MazeSystem.js` — encodes 40x22 maze as a string array; renders floor + walls into the world container; provides `isWallTile()`, `isWallAtPixel()`, `resolveCircle()` (tank physics), `bulletCollision()` (axis-aligned normal + overlap), `raycastBlocked()` (DDA-ish for bot LOS).
- `src/systems/BotAI.js` — wander target picked every 2-4s (random non-wall tile >100px away); rotates toward target, thrusts when within 0.5 rad. LOS fire: enemy within ±15° forward cone + raycast clear → schedule fire after 250ms reaction → fire (gated by 1.2s cooldown). Adds ±6° aim jitter so bots aren't perfect.
- `src/systems/RoundSystem.js` — state machine: countdown (2s with banner "GET READY" + countdown digit) → playing (banner hidden) → round_over (banner "{COLOR} WINS" or "DRAW" + 3-2-1 restart counter) → calls `scene.beginNewRound()` to respawn. Emits ROUND_COUNTDOWN/STARTED/ENDED events.

### Deleted
- `src/entities/Player.js` (replaced by Tank.js)
- `src/systems/ScoreSystem.js` (wins tracked in GameState directly; trivial system added no value)
- `src/scenes/GameOverScene.js` (rounds auto-restart via RoundSystem; no separate scene needed)

## Maze layout (4-fold symmetric)

```
########################################
#......................................#
#......................................#
#......##......................##......#
#......##..####..........####..##......#
#......##..####..........####..##......#
#......##......................##......#
#......................................#
#......................................#
#............####......####............#
#............####......####............#
#............####......####............#
#............####......####............#
#......................................#
#......................................#
#......##......................##......#
#......##..####..........####..##......#
#......##..####..........####..##......#
#......##......................##......#
#......................................#
#......................................#
########################################
```

40 cols x 22 rows. 4-fold symmetric (mirrors horizontally + vertically), so all 4 corner spawns are mechanically identical. 6 distinct interior wall blocks (mirrored to make 24 visible groups but only 6 unique structures): four 2x4 columns flanking the spawn corners, four 4x2 wall pairs between corners and center, and four central 4x4 plaza walls. Spawns at tile (2,2), (37,2), (2,19), (37,19) — all clear of walls within a 5x5 area.

## Verification

I ran a Playwright smoke test against the live dev server (`http://localhost:3001/`) with `--use-gl=swiftshader` for stable WebGL:

- **Boot**: GameScene loads cleanly. 4 tanks spawn at corners with correct colors and facings toward maze center.
- **Countdown**: `mode: 'countdown'` for ~2s, then `mode: 'playing'`.
- **Player input**: WASD rotates and thrusts, Space fires (bullets emerge from barrel tip and travel).
- **Bots**: Wander randomly and fire occasionally; bullets ricochet off walls.
- **Round end**: Killing 3 bots transitions to `mode: 'round_over'`, increments `wins.RED` to 1, sets `lastWinner: 'RED'`. After 3s, `mode: 'playing'` resumes with `roundNumber: 2` and all tanks respawned. Wins persist.
- **Draw**: Killing all 4 tanks simultaneously sets `lastWinner: null` (DRAW banner shows).
- **Visual**: Maze, tanks, bullets, and HUD render correctly. Each tank has a distinct silhouette (color-coded chassis + treads + turret + barrel).
- **No console errors** (only harmless WebGL perf warnings under headless).

## Deviations from brief

1. **No `Wall.js` entity** — I encode walls in MazeSystem and compute collisions analytically against the tile grid (faster, easier ricochet math, sub-pixel accurate). Per the brief: "or just rectangles in the maze system" — chose this option.
2. **No GameOverScene file** — rounds auto-restart inside GameScene via RoundSystem, so a separate scene would be inert. The brief said "we may not need it (auto-restart)".
3. **Tank movement uses analytical collision, not Phaser arcade physics bodies.** Phaser arcade physics is awkward for rotating non-axis-aligned tank bodies; the analytical circle-vs-grid approach is simpler and cleaner for tanks + ricochet bullets. Phaser arcade gravity is still set to 0 in GameConfig as required.
4. **Reverse thrust constant** — added `TANK.REVERSE_THRUST = 80` (lower than forward THRUST = 110) for slightly more interesting movement; this was implicit in the brief ("thrust forward/backward with momentum").
5. **HUD overlaps top wall row** — the canvas is exactly 720 design tall, but the maze (22 rows × 32 = 704) leaves only 16 design pixels above. The HUD currently renders inside the wall border. Step 2 (design polish) should move the HUD into a dedicated UI scene above the maze, or shrink the maze to 20 rows.

## Loose ends / things to flag for QA

- **HUD overlap with top maze wall** (cosmetic, see deviation 5).
- **Bot LOS raycast doesn't account for bot's own body** — a bot's first raycast step might start inside the wall it's pressed against. In practice this hasn't caused phantom shots-through-walls because tanks never overlap walls (collision keeps them out), but worth verifying if bots ever appear to shoot through corners.
- **Bullet substepping is 2 — at very high frame drops bullets could still tunnel through 1-tile-thin walls.** Walls are at minimum 2 tiles wide in this layout, so unlikely to manifest, but worth noting.
- **Tank vs tank collision is not implemented.** Tanks can pass through each other. The brief didn't require it, but it might surprise testers; trivially added later by checking pairwise distances after wall collision.
- **No mute toggle UI.** GameState.isMuted reads from localStorage but there's no UI to flip it. Audio step (Step 3) will add this.
- **Player starts unable to fire toward maze center on first frame** because countdown blocks input, but bots also can't fire during countdown — verified by GameScene only running tank/bullet logic when `roundState === 'playing'`.
- **No score per-frame draw** — the HUD only updates on TANK_DIED / ROUND_ENDED events. That's deliberate (avoids per-frame text re-render) but if win counters need to animate, they won't.
