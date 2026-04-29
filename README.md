# game-creator

**Go from game idea to deployed, monetized browser game in minutes — not hours.**

Tell your AI coding agent "make a space invaders game" and get a fully playable 2D or 3D browser game with pixel art, procedural audio, and automated QA. Deploy instantly to the web. Monetize with [Play.fun](https://play.fun). Share on [Moltbook](https://www.moltbook.com/).

Works with **40+ AI coding agents** — Claude Code, Cursor, Windsurf, Cline, and more via `npx skills add`.

**Owner**: [OpusGameLabs](https://github.com/OpusGameLabs)

## Install

```bash
npx skills add OpusGameLabs/game-creator
```

Target a specific agent:

```bash
npx skills add OpusGameLabs/game-creator -a claude-code
npx skills add OpusGameLabs/game-creator -a cursor
npx skills add OpusGameLabs/game-creator -a codex
npx skills add OpusGameLabs/game-creator -a antigravity
```

## Quick Start

```bash
# Build a complete 2D game (scaffold → pixel art → design → audio → deploy → monetize)
# QA subagent runs after every step (build, runtime, gameplay, architecture, visual)
/game-creator:make-game 2d my-game

# Build from a tweet
/game-creator:make-game https://x.com/user/status/123456

# Or run individual steps on an existing game:
/game-creator:add-assets          # Replace shapes with pixel art sprites
/game-creator:design-game         # Add visual polish (particles, juice, transitions)
/game-creator:add-audio           # Add chiptune music and sound effects
/game-creator:add-feature jetpack # Add a gameplay feature
/game-creator:improve-game        # Audit + implement highest-impact improvements
/game-creator:monetize-game       # Register on Play.fun, add SDK, get monetized URL
/game-creator:review-game         # Code review for architecture + best practices
/game-creator:qa-game             # Add Playwright QA tests
```

## How It Works

`/make-game` is an orchestrator that delegates all code writing to subagents and runs a QA subagent after every code-modifying step:

```
Step 0  Parse args, create task list                           ← main thread
Step 1  Scaffold game from template                            ← code subagent → QA subagent
Step 1.5 Add pixel art sprites (2D only)                       ← code subagent → QA subagent
Step 2  Visual polish (particles, juice, transitions)          ← code subagent → QA subagent
Step 3  Audio (Strudel.cc BGM + SFX)                           ← code subagent → QA subagent
Step 4  Deploy to here.now                                     ← main thread (instant publish)
Step 5  Monetize with Play.fun                                 ← main thread (interactive auth)
```

The QA subagent runs 5 phases per step: build check, runtime check (headless Chromium), gameplay verification (iterate client with game-specific actions), architecture validation, and visual review (Playwright MCP screenshots). If any phase fails, an autofix subagent patches the code and QA re-runs (up to 3 attempts per step).

## Architecture

Every game follows the same architecture, whether 2D or 3D:

```
src/
├── core/
│   ├── EventBus.js       # Singleton pub/sub — all cross-module communication
│   ├── GameState.js      # Centralized state with reset() for clean restarts
│   ├── Constants.js      # Every magic number, color, timing, speed
│   └── GameConfig.js     # Engine config (Phaser or Three.js)
├── scenes/               # Scene lifecycle (Phaser) or states (Three.js)
├── entities/             # Game objects (player, enemies, obstacles)
├── systems/              # Background, particles, spawners
├── sprites/              # Pixel art data (palette, matrices, tiles)
├── audio/                # Strudel.cc procedural audio
│   ├── AudioManager.js   # Init, play, stop wrapper
│   ├── AudioBridge.js    # Wires EventBus → AudioManager
│   ├── music.js          # Background music patterns
│   └── sfx.js            # Sound effect patterns
├── playfun.js            # Play.fun SDK integration
└── main.js               # Entry point + render_game_to_text() + advanceTime()
```

**EventBus** — Modules never import each other. All communication via pub/sub with `domain:action` event names.

**GameState** — Single source of truth. `reset()` gives a clean slate for restarts.

**Constants** — Zero hardcoded values in game logic. Sizes are proportional (`GAME.WIDTH * ratio`), with DPR-aware scaling for retina displays.

**`render_game_to_text()`** — Every game exposes `window.render_game_to_text()` returning a JSON string of current game state, so AI agents can read the game without interpreting pixels.

## Skills

### Reference Skills (loaded automatically by Claude when relevant)

| Skill | Purpose |
|-------|---------|
| `phaser` | 2D game patterns — Phaser 3 scenes, arcade physics, high-DPI rendering |
| `threejs-game` | 3D game patterns — Three.js event-driven architecture, modular systems |
| `game-assets` | Pixel art sprites — `renderPixelArt()`, `renderSpriteSheet()`, palette system |
| `game-designer` | Visual polish — gradients, particles, screen shake, transitions, juice |
| `game-audio` | Procedural audio — Strudel.cc BGM patterns + Web Audio SFX |
| `game-qa` | Playwright testing — gameplay, visual regression, performance, accessibility |
| `game-architecture` | Reference architecture patterns for event-driven games |
| `game-deploy` | Deployment — here.now (default), GitHub Pages, Vercel, Netlify, itch.io |
| `playdotfun` | Play.fun (OpenGameProtocol) — SDK, API, auth, leaderboards |
| `fetch-tweet` | Fetch tweet content for tweet-to-game conversion |

### Slash Commands (user-invocable)

| Command | Description |
|---------|-------------|
| `/make-game [2d\|3d] [name]` | Full pipeline: scaffold, pixel art, design, audio, deploy, monetize |
| `/improve-game [focus]` | Deep audit + implement highest-impact improvements |
| `/design-game [path]` | Audit and improve visual polish |
| `/add-feature [description]` | Add a gameplay feature following architecture patterns |
| `/add-assets [path]` | Replace geometric shapes with pixel art sprites |
| `/add-audio [path]` | Add Strudel.cc music and sound effects |
| `/monetize-game [path]` | Register on Play.fun, add SDK, get monetized URL |
| `/qa-game [path]` | Add Playwright QA tests |
| `/review-game [path]` | Code review for architecture + best practices |

All commands are prefixed with `game-creator:` when installed as a plugin (e.g., `/game-creator:make-game`).

## Agents

| Agent | Description | Preloaded Skills |
|-------|-------------|------------------|
| `game-creator` | Autonomous end-to-end pipeline with build/visual gates (no user confirmation between steps) | — (delegates to subagents) |
| `game-reviewer` | Reviews codebases for architecture compliance, performance, and monetization readiness | `game-architecture` |
| `game-qa-runner` | Runs Playwright test suites, diagnoses failures, fixes code, and re-runs until green | `game-qa`, `game-architecture` |
| `game-deploy` | Deploys games to here.now (default), GitHub Pages, Vercel, or itch.io with pre/post validation | `game-deploy` |

## Examples

8 complete example games in `examples/`, demonstrating both engines:

| Game | Engine | Description |
|------|--------|-------------|
| `flappy-bird` | Phaser 3 | Classic flappy clone — 5 scenes, 15 Playwright tests, full audio |
| `barn-defense` | Phaser 3 | Tower defense game |
| `vampire-survivors` | Phaser 3 | Survivors-like auto-attacking game |
| `example-game` | Phaser 3 | Asteroid dodger (generated by `/make-game` test run) |
| `flappy-bird-3d` | Three.js | 3D flappy bird variant |
| `flight-simulator` | Three.js | Flight sim with terrain |
| `labyrinth` | Three.js | 3D maze game |
| `singularity-run` | Three.js | Endless runner with matrix rain effects |

```bash
cd examples/flappy-bird
npm install
npm run dev        # http://localhost:3000
npm run test       # Playwright tests
npm run build      # Production build to dist/
```

## Templates

`/make-game` copies a runnable starter project from `templates/` — not generated from scratch. Both templates include all dependencies, the full EventBus/GameState/Constants architecture, QA scripts, and procedural graphics (no asset files).

| Template | Engine | Includes |
|----------|--------|----------|
| `phaser-2d` | Phaser 3 | Boot/Game/GameOver scenes, Player entity, ScoreSystem, arcade physics, high-DPI support |
| `threejs-3d` | Three.js | Game orchestrator, Player mesh, LevelBuilder, HTML overlays, InputSystem (touch + keyboard) |
| `plus-template` | Three.js + Spark 2 | **AI-generated 3D worlds** (Marble Labs splats + Meshy AI assets). Cathedral pattern, fake-floor physics, kinematic capsule, spring-arm camera, lightness bake, splat fog. Pairs with `game-creator-plus` skill + backend proxy. |

Both 2D/3D templates ship with `scripts/verify-runtime.mjs` (headless runtime check), `scripts/iterate-client.js` (action replay + screenshots), `scripts/validate-architecture.mjs` (pattern validator), and `scripts/example-actions.json` (default test actions).

## Premium Tier: game-creator-plus

For AI-generated 3D *worlds* and *characters*, the optional **`game-creator-plus`** skill calls Marble Labs (Gaussian splat environments) and Meshy AI (3D models + auto-rig + animations) on your behalf, routing through our hosted proxy at `gamecreator.dev`. Pay-as-you-go credits via Stripe; no subscription, no rev share. See [`skills/game-creator-plus/`](./skills/game-creator-plus/) for the skill and [`templates/plus-template/`](./templates/plus-template/) for the runtime. The proxy backend itself (NestJS + TypeORM + Stripe) lives in a separate private repo.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| 2D Engine | Phaser 3 (`^3.90.0`) |
| 3D Engine | Three.js (`^0.183.0`) |
| Audio | Strudel.cc (`@strudel/web ^1.3.0`) — AGPL-3.0 |
| Build | Vite (`^7.3.1`) |
| Testing | Playwright (`^1.58.0`) + axe-core (`^4.11.0`) |
| Monetization | [Play.fun](https://play.fun) (OpenGameProtocol) |
| Language | JavaScript ES modules |

## Quality Assurance

QA is built into every code-modifying step of the pipeline via a dedicated QA subagent:

1. **Build** — `npm run build` catches compilation errors
2. **Runtime** — Headless Chromium checks for WebGL errors, uncaught exceptions, console errors
3. **Gameplay** — Iterate client replays game-specific actions, verifies scoring works and death triggers
4. **Architecture** — Validates EventBus/GameState/Constants patterns, flags magic numbers
5. **Visual** — Playwright MCP screenshots check entity visibility, safe zone compliance, button labels

If any phase fails, an autofix subagent patches the code and QA re-runs (up to 3 attempts). Problems are caught when introduced, not at the end of the pipeline.

## Play.fun Integration

The `/monetize-game` command (and Step 5 of `/make-game`) registers games on [Play.fun](https://play.fun) and integrates the browser SDK:

1. Authenticate via web callback or manual paste
2. Register game with anti-cheat limits based on scoring system
3. Add CDN script + `src/playfun.js` (wires EventBus to `addPoints()`/`savePoints()`)
4. Rebuild and redeploy

The SDK is non-blocking — if it fails to load, the game still works. Points buffer locally during gameplay and sync on game over.

## License

MIT (games using `@strudel/web` for audio must use an AGPL-3.0-compatible license)

## Star History

<a href="https://www.star-history.com/?repos=OpusGameLabs%2Fgame-creator&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=OpusGameLabs/game-creator&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=OpusGameLabs/game-creator&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=OpusGameLabs/game-creator&type=date&legend=top-left" />
 </picture>
</a>
