# CLAUDE.md

## Project Overview

This is **game-creator**, the game studio for the agent internet. It provides skills and agents for scaffolding, designing, deploying, and monetizing 2D (Phaser 3) and 3D (Three.js) browser games. QA (build, runtime, visual review, autofix) runs at every step. Monetize with [Play.fun](https://play.fun) (OpenGameProtocol). Works with **40+ AI coding agents** (via `npx skills add`). Share your play.fun URL on [Moltbook](https://www.moltbook.com/).

## Repository Structure

```
.claude-plugin/
  plugin.json              # Plugin manifest (name, version, author)
  marketplace.json         # Marketplace metadata (owner: OpusGameLabs)
settings.json              # Default settings (activates game-creator agent)
skills/
  phaser/SKILL.md          # 2D game patterns (Phaser 3, scene-based, multi-file)
  threejs-game/SKILL.md    # 3D game patterns (Three.js, event-driven)
  threejs-perf/SKILL.md    # Three.js performance patterns with measured evidence (instancing static + moving)
  game-assets/SKILL.md     # Pixel art sprites (code-only, no external files)
  game-designer/SKILL.md   # Visual polish (gradients, particles, juice, transitions)
  game-audio/SKILL.md      # Procedural audio (Web Audio API BGM + SFX)
  game-qa/SKILL.md         # Playwright testing (gameplay, visual, perf)
  game-architecture/SKILL.md  # Reference architecture patterns
  game-deploy/SKILL.md     # Deployment (here.now default, GitHub Pages, Vercel, etc.)
  use-template/SKILL.md    # Clone a gallery template as a starting point
  playdotfun/SKILL.md      # Play.fun monetization (git submodule → submodules/playdotfun)
  promo-video/SKILL.md     # Autonomous 50 FPS gameplay recording (Playwright + FFmpeg)
  make-game/SKILL.md       # Full pipeline: scaffold → assets → design → promo video → audio → deploy (here.now) → monetize (QA at every step)
  improve-game/SKILL.md    # Holistic audit + implement highest-impact improvements
  design-game/SKILL.md     # Visual design audit + improvements
  add-feature/SKILL.md     # Add feature following patterns
  add-assets/SKILL.md      # Replace shapes with pixel art sprites
  game-3d-assets/SKILL.md  # 3D model pipeline (GLB download, AssetLoader, animated characters)
  meshyai/SKILL.md         # Meshy AI — generate 3D models from text/images, auto-rig, animate
  add-3d-assets/SKILL.md   # Replace 3D primitives with real GLB models
  add-audio/SKILL.md       # Add procedural audio (Web Audio API)
  record-promo/SKILL.md    # Record autonomous promo video (standalone command)
  monetize-game/SKILL.md   # Play.fun monetization (register, SDK, redeploy)
  scaffold-gateables/SKILL.md  # Add monetization-agnostic gateable features (isEntitled hooks + skin picker, continue, etc.)
  add-multiplayer/SKILL.md # Add real-time or turn-based multiplayer via PartyKit (Cloudflare Durable Objects)
  qa-game/SKILL.md         # Add Playwright QA tests
  sub-games/SKILL.md       # Sub.games community platform for finding players and supporters
  review-game/SKILL.md     # Code review for architecture + best practices
templates/
  phaser-2d/               # Runnable 2D starter project (Phaser 3)
  threejs-3d/              # Runnable 3D starter project (Three.js)
scripts/
  iterate-client.js        # Standalone Playwright iterate loop (action → screenshot → state → errors)
  example-actions.json     # Example action payloads for iterate-client.js
  find-3d-asset.mjs        # Search & download GLB models (Sketchfab, Poly Haven, Poly.pizza)
  meshy-generate.mjs       # Generate 3D models with Meshy AI (text-to-3d, image-to-3d, rig, animate)
assets/
  characters/              # 2D South Park-style spritesheets (photo-composite)
    manifest.json
    characters/
  3d-characters/           # Animated GLB characters with clip maps
    manifest.json
    models/                # Soldier.glb, Xbot.glb, RobotExpressive.glb, Fox.glb
site/
  manifest.json              # Source of truth: metadata for all templates
  build.js                   # Unified build → _site/index.html + _site/gallery/index.html
  capture-screenshots.js     # Playwright: auto-capture thumbnails for each game
  thumbnails/                # 400x225 PNGs (committed to git)
  telemetry/
    server.js                # Express telemetry API (ingestion + stats)
    schema.sql               # PostgreSQL schema
    Dockerfile               # Railway container
    package.json             # Express, pg, cors
submodules/
  playdotfun/              # Git submodule: github.com/OpusGameLabs/skills
agents/
  game-creator.md          # Autonomous game creation pipeline with build/visual gates
  game-deploy.md           # Deployment automation (preloads game-deploy skill)
  game-qa-runner.md        # Test runner + autofix (preloads game-qa, game-architecture)
  game-reviewer.md         # Code review agent (preloads game-architecture)
examples/
  flappy-bird/             # Complete example game (see below)
  nick-land-dodger/        # Dodge game with photo-composite character + promo video
  3d-asset-test/           # 3D asset pipeline demo (animated characters, model loading, OrbitControls)
  maze-tanks/              # 4-player multiplayer demo (PartyKit + Cloudflare DOs) — exercises the add-multiplayer skill
```

**Game creation directory**: When the `/make-game` pipeline is launched from within the `game-creator` repository (i.e., the current working directory is `game-creator/` or a subdirectory), new games **must be created in `examples/`** (e.g., `examples/<game-name>/`). This keeps the repo organized and ensures example games are versioned alongside the plugin. When launched from any other directory, games are created in the current working directory as normal.

## Architecture Rules

All games built with this plugin follow these mandatory patterns:

1. **EventBus singleton** — All cross-module communication via pub/sub. Modules never import each other directly. Events use `domain:action` naming (e.g., `bird:flap`, `game:over`).

2. **GameState singleton** — Single centralized state object. Systems read from it. Events trigger mutations. Has `reset()` for clean restarts.

3. **Constants.js** — Every magic number, color, timing, speed, and config value. Zero hardcoded values in game logic.

4. **Orchestrator** — One entry point (Game.js or GameConfig.js) initializes all systems and manages the game lifecycle.

5. **Directory structure** — `core/` (EventBus, GameState, Constants), `scenes/` or `systems/`, `entities/`, `ui/`, `audio/`.

6. **`render_game_to_text()`** — Every game exposes `window.render_game_to_text()` in `main.js`. Returns a concise JSON string of the current game state for AI agents to read without interpreting pixels. Must include: coordinate system note, game mode (`playing`/`game_over`), score, player position/velocity, and visible entities. Keep it succinct — only current, on-screen state. Games boot directly into gameplay (no title screen by default), so `playing` is the initial mode.

7. **`advanceTime(ms)`** — Every game exposes `window.advanceTime(ms)` in `main.js`. Returns a Promise that resolves after `ms` milliseconds of real time, allowing test scripts to advance the game in controlled increments. For frame-precise control in `@playwright/test`, prefer `page.clock.install()` + `runFor()`.

8. **`progress.md`** — Created at the project root by the game-creator agent. Records the original user prompt, TODOs, decisions, gotchas, and loose ends after each pipeline step. Enables multi-session continuity and agent handoff.

## Example Game: Flappy Bird

Located at `examples/flappy-bird/`. Demonstrates all patterns.

### Key files

- `src/main.js` — Entry point. Inits audio bridge, creates Phaser game, exposes test globals.
- `src/core/EventBus.js` — 13 events across bird, score, game, particles, and audio domains.
- `src/core/Constants.js` — All config: game dimensions, bird physics, pipe settings, colors, particles, transitions.
- `src/core/GameState.js` — score, bestScore, started, gameOver.
- `src/scenes/GameScene.js` — Main gameplay. Two-stage start (GET READY → playing). AABB collision. Death slow-mo.
- `src/scenes/UIScene.js` — Parallel overlay scene for HUD score display.
- `src/audio/AudioManager.js` — AudioContext init, master gain, BGM sequencer play/stop.
- `src/audio/music.js` — Three BGM patterns: menu (100 cpm), gameplay (130 cpm), game over (60 cpm).
- `src/audio/sfx.js` — Four SFX: flap, score, death, button click.

### Running

```bash
cd examples/flappy-bird
npm install
npm run dev          # Vite dev server on port 3000
npm run test         # 15 Playwright tests
npm run build        # Production build to dist/
```

### Test structure

```
tests/
  fixtures/game-test.js      # Custom fixture: waits for boot, provides startPlaying()
  helpers/seed-random.js     # Mulberry32 seeded PRNG for deterministic tests
  e2e/game.spec.js           # 10 tests: boot, scenes, input, scoring, restart
  e2e/visual.spec.js         # 2 tests: initial gameplay + game over screenshots (3000px tolerance)
  e2e/perf.spec.js           # 3 tests: load time, FPS, canvas dimensions
```

### Audio integration

Audio requires user interaction to start (browser autoplay policy). The flow:

1. GameScene first input → `AUDIO_INIT` event → AudioContext created/resumed
2. GameScene `startPlaying()` → `MUSIC_GAMEPLAY` → gameplay BGM
3. Bird dies → `BIRD_DIED` (death SFX) + `MUSIC_STOP`
4. GameOverScene create → `MUSIC_GAMEOVER` → somber theme

SFX fires on `BIRD_FLAP`, `SCORE_CHANGED`, `BIRD_DIED` via AudioBridge listeners.

BGM uses a Web Audio API step sequencer. SFX use one-shot OscillatorNodes. All audio routes through a master GainNode for mute control.

## Dependencies

| Package | Version  | Purpose                            |
| ------- | -------- | ---------------------------------- |
| phaser  | ^3.90.0  | 2D game engine (Phaser template)   |
| three   | ^0.183.0 | 3D game engine (Three.js template) |
| vite    | ^7.3.1   | Build tool (dev)                   |

Audio uses the built-in Web Audio API (zero dependencies). Strudel.cc (`@strudel/web`, AGPL-3.0) is available as an optional upgrade for richer BGM — see the game-audio skill.

## Skill Companion Files Convention

Skills use **progressive disclosure** via flat companion `.md` files alongside `SKILL.md`. This keeps `SKILL.md` concise (core patterns, decision trees, checklists) while detailed reference material lives in companion files that agents load on demand.

**Convention:**

- Companion files live in the same directory as `SKILL.md` (e.g., `skills/phaser/conventions.md`)
- Do NOT use a `references/` subdirectory — keep files flat
- Each `SKILL.md` has a `## Reference Files` section near the top listing all companions with descriptions
- In the body, reference extracted content with `See filename.md for [topic].`

**Example (`skills/phaser/`):**

```
skills/phaser/
  SKILL.md                    # Core patterns, process, checklist (~290 lines)
  conventions.md              # Coding conventions and style rules
  project-setup.md            # Vite config, responsive canvas, DPR handling
  scenes-and-lifecycle.md     # Scene management, transitions, parallel scenes
  game-objects.md             # Sprites, buttons, groups, physics
  events-and-state.md         # EventBus patterns, GameState management
  ui-patterns.md              # HUD, menus, score display
  testing-patterns.md         # Playwright test setup and fixtures
  performance.md              # Optimization tips, texture atlases, object pooling
```

**Skills with companion files:** `phaser` (8), `game-qa` (7), `game-audio` (6), `add-multiplayer` (4), `meshyai` (3), `game-assets` (3), `threejs-game` (3+), `threejs-perf` (2 + templates/), `make-game` (3).

## Reference vs User-Invocable Skills

Skills come in two flavors with a deliberate separation of concerns:

- **User-invocable skills** (19) — Triggered by slash commands (e.g., `/add-audio`). These handle the full user-facing workflow: detect the game, load reference skills, run the pipeline, validate output. They have `argument-hint` in frontmatter.
- **Reference skills** (11) — Deep domain knowledge loaded by other skills (or directly via `/load`). They contain patterns, code examples, and conventions but don't drive a workflow themselves.

Four domains have both a reference and a user-invocable skill:

| Reference Skill | User-Invocable Skill | Why Both Exist                                                                            |
| --------------- | -------------------- | ----------------------------------------------------------------------------------------- |
| `game-audio`    | `add-audio`          | `game-audio` has Web Audio API patterns reused by `add-audio` AND `make-game` step 3      |
| `game-qa`       | `qa-game`            | `game-qa` has Playwright patterns reused by `qa-game` AND the QA subagent in `make-game`  |
| `game-assets`   | `add-assets`         | `game-assets` has pixel art patterns reused by `add-assets` AND `make-game` step 1.5      |
| `game-designer` | `design-game`        | `game-designer` has visual polish patterns reused by `design-game` AND `make-game` step 2 |

This separation avoids duplicating domain knowledge across multiple skills. The reference skill is the single source of truth; the user-invocable skill orchestrates the workflow and loads the reference skill for domain knowledge.

## Common Tasks

**Add a new skill**: Create `skills/<name>/SKILL.md`. Follow existing skill format with tech stack, architecture, code examples, and checklist. For skills >300 lines, extract detailed code examples and reference material into companion files.

**Add a new user-invocable skill** (slash command): Create `skills/<name>/SKILL.md` with YAML frontmatter (`name`, `description`, `argument-hint`). Body contains the prompt instructions.

**Sync to plugin cache**: After editing skill files, copy to your agent's plugin cache directory (e.g. `~/.claude/plugins/cache/local-plugins/game-creator/1.3.0/` for Claude Code).

**Run the example**: `cd examples/flappy-bird && npm run dev` starts on port 3000.

**Run tests**: `cd examples/flappy-bird && npm run test`. Tests auto-start the Vite dev server.

**Quick iterate loop**: `node scripts/iterate-client.js --url http://localhost:3000 --actions-json '[{"buttons":["space"],"frames":4}]'` — captures screenshots, text state, and console errors. Use after every meaningful code change for tight feedback.

## Notes

- Playwright screenshot tests use high pixel tolerance (3000 maxDiffPixels) because parallax clouds scroll between captures.
- Headless Chromium reports low FPS (~7-9). FPS threshold in tests is set to 5. Use Playwright MCP for accurate FPS measurement.
- The `playdotfun` skill is a git submodule at `submodules/playdotfun` (repo: `github.com/playdotfun/skills`). The symlink `skills/playdotfun → ../submodules/playdotfun/skills` makes SKILL.md resolve correctly. After cloning, run `git submodule update --init` to pull the submodule.

## Site & Template Gallery

The site is built from `site/` and output to `_site/`. Two pages: landing page (`_site/index.html`) and template gallery (`_site/gallery/index.html`). Both share CSS, nav, and footer via a unified build script.

**Source of truth**: `site/manifest.json` — 20 entries with id, name, description, engine, genre, complexity, features, source path, thumbnail, and demoUrl.

**Build the site**: `npm run build:site` (runs `node site/build.js`). Generates both `_site/index.html` (landing page with data-driven game cards from manifest) and `_site/gallery/index.html` (filterable gallery). Copies thumbnails. Fetches telemetry stats.

**Capture thumbnails**: `npm run capture:thumbnails` (runs `node site/capture-screenshots.js`). For each template, reuses existing QA screenshots from `output/` or boots the game in headless Chromium. Output: 400x225 PNGs in `site/thumbnails/`.

**Clone a template**: `/use-template <template-id> [project-name]` — copies template source, updates package.json/title, runs npm install. 10-second copy vs 10-minute `/make-game` pipeline.

**Adding a new template to the gallery**: Add an entry to `site/manifest.json`, run `npm run capture:thumbnails`, then `npm run build:site`.

## Template Telemetry

Anonymous, append-only telemetry tracks template usage (clones and clicks). No user data or IPs logged.

**Backend**: `site/telemetry/` — Express + PostgreSQL, deployed on Railway.

**Endpoints**:

- `GET /t?event=clone|click&template=<id>&source=gallery|skill&v=1` — ingestion (returns 204)
- `GET /stats` — aggregated clone/click counts per template (cached 60s)
- `GET /health` — health check

**Telemetry sources**:

- Gallery page fires `click` event on "Use Template" button
- `/use-template` skill fires `clone` event after successful copy (respects `DO_NOT_TRACK` / `DISABLE_TELEMETRY` env vars)

**Gallery integration**: `site/build.js` fetches `/stats` at build time, enriches manifest with clone counts, and embeds them in the HTML. Sort controls (Default/Popular/Trending) re-order cards client-side.

**Environment**: Set `TELEMETRY_URL` to override the default Railway URL. `DATABASE_URL` is required for the backend.

## Play.fun (OpenGameProtocol) Integration

The `/monetize-game` command (and Step 5 of `/make-game`) registers games on [Play.fun](https://play.fun) and integrates the browser SDK.

**Flow**: Auth → Register game → Add SDK to `index.html` + create `src/playfun.js` → Rebuild → Redeploy (here.now or GitHub Pages) → Share play.fun URL on Moltbook

**Auth**: Uses `skills/playdotfun/scripts/playfun-auth.js` for credential management. Supports web callback (localhost:9876) and manual paste.

**SDK**: CDN script (`https://sdk.play.fun/latest`) + `src/playfun.js` that wires EventBus events (score changes, game over) to Play.fun points tracking. Non-blocking — if SDK fails to load, game still works.

**Anti-cheat**: Games are registered with `maxScorePerSession`, `maxSessionsPerDay`, and `maxCumulativePointsPerDay` based on the game's scoring system.

## Troubleshooting

See `TROUBLESHOOTING.md` for common issues including:

- Skill triggering (wrong skill loads, skill doesn't trigger, negative tests)
- Build failures (module not found, port conflicts, empty dist)
- Playwright/QA (browser not found, low FPS in headless, visual regression tolerance)
- Deployment (here.now failures, anonymous expiry, GitHub Pages blank page)
- Play.fun (auth failures, SDK not loading, anti-cheat rejections)
- 3D assets (T-pose, wrong facing, Meshy timeouts)
- Audio (autoplay policy, frequency issues)

## Trigger Test Suite

See `tests/trigger-tests.md` for manual test prompts (5-7 per skill) verifying correct trigger behavior. Covers all 19 user-invocable skills plus negative tests for prompts that should NOT trigger any skill.
