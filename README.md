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
# Design and build a real game project with milestones, ADRs, and multi-session iteration:
/game-creator:make-game

# Or scaffold a quick prototype with no doc rigor:
/game-creator:quick-game 2d my-game

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

`/make-game` is the canonical multi-session game-dev workflow: idea → scaffold → development phases with milestones, ADRs, `docs/STATE.md`-based handoff, and a `live-iterate` sub-pipeline that gives you a tight feedback loop after every change. See `skills/make-game/` for the full picture.

For point-fixes on an existing game, use the focused slash commands (`/add-feature`, `/add-assets`, `/design-game`, `/add-audio`, `/qa-game`, `/monetize-game`, `/improve-game`, `/review-game`, `/meme-game`). Each runs its own QA where applicable.

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
| `/make-game` | Multi-session game-dev workflow: idea → scaffold → development phases with milestones, ADRs, and `docs/STATE.md` |
| `/quick-game [2d\|3d] [name]` | Rapid prototype: scaffold + core loop only, no doc rigor |
| `/meme-game [path] [names]` | Public-figure pass on an existing game (photo-composite characters + reactive expressions) |
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
| `example-game` | Phaser 3 | Asteroid dodger (generated by an earlier pipeline test run) |
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

`/make-game` (and `/quick-game`, `/use-template`) copies a runnable starter project from `templates/` — not generated from scratch. Both templates include all dependencies, the full EventBus/GameState/Constants architecture, QA scripts, and procedural graphics (no asset files).

| Template | Engine | Includes |
|----------|--------|----------|
| `phaser-2d` | Phaser 3 | Boot/Game/GameOver scenes, Player entity, ScoreSystem, arcade physics, high-DPI support |
| `threejs-3d` | Three.js | Game orchestrator, Player mesh, LevelBuilder, HTML overlays, InputSystem (touch + keyboard) |

Both templates ship with `scripts/verify-runtime.mjs` (headless runtime check), `scripts/iterate-client.js` (action replay + screenshots), `scripts/validate-architecture.mjs` (pattern validator), and `scripts/example-actions.json` (default test actions).

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

The `/monetize-game` command registers games on [Play.fun](https://play.fun) and integrates the browser SDK:

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
