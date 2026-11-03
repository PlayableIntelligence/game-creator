---
name: game-qa
description: Game QA testing with browser tests (Chrome over the DevTools protocol, no npm dependency) — visual regression, gameplay verification and performance for browser games. Use when writing or running game tests, debugging test failures, or building QA infrastructure. This is the reference skill — use qa-game for the user-facing command.
argument-hint: "[topic]"
license: MIT
compatibility: Requires Node.js 22+ (or Bun) and Google Chrome for browser-based game testing.
metadata:
  author: OpusGameLabs
  version: 1.3.0
  tags: [game, qa, testing, cdp]
---

# Game QA with Browser Tests

You are an expert QA engineer for browser games. You use the plugin's dependency-free browser helpers (`scripts/cdp.mjs` and `scripts/browser-test.mjs`, which drive the Chrome installed on the machine over the DevTools protocol) to write automated tests that verify visual correctness, gameplay behavior and performance.

## Performance Notes

- Take your time with each step. Quality is more important than speed.
- Do not skip validation steps — they catch issues early.
- Read the full context of each file before making changes.
- Write tests that verify gameplay, not just that the page loads.

## Reference Files

For detailed reference, see companion files in this directory:
- `test-patterns.md` — Custom fixture code, boot tests, gameplay verification tests, scoring tests
- `gameplay-invariants.md` — All 7 core gameplay invariant patterns (scoring, death, buttons, render_game_to_text, design intent, entity audit, mute)
- `visual-regression.md` — Screenshot comparison tests, masking dynamic elements, performance/FPS tests, deterministic testing patterns
- `clock-control.md` — `page.clock` API patterns for frame-precise testing
- `visual-inspection.md` — Screenshot-and-Read visual inspection, when to use it vs scripted tests, inspection flow
- `iterate-client.md` — Standalone iterate client usage, action JSON format, output interpretation
- `mobile-tests.md` — Mobile input simulation and responsive layout test patterns

## Tech Stack

- **Test Runner**: `scripts/browser-test.mjs` (`test`/`expect` on `node --test`), driving Chrome through `scripts/cdp.mjs`
- **Visual Regression**: `toHaveScreenshot()` from `browser-test.mjs`
- **Accessibility**: no automated scan (axe-core is not available)
- **Build Tool Integration**: Vite dev server via `webServer` config
- **Language**: JavaScript ES modules

## Project Setup

When adding browser tests to a game project, copy the helpers from the plugin (no npm install; needs Node 22+ or Bun and Google Chrome, or set `BOOP_CHROME=/path/to/chrome`):

```bash
mkdir -p scripts
cp <plugin-root>/scripts/cdp.mjs <plugin-root>/scripts/browser-test.mjs scripts/
```

Add to `package.json` scripts:

```json
{
  "scripts": {
    "test": "node --test --test-concurrency=1 \"tests/**/*.spec.js\"",
    "test:headed": "BROWSER_TEST_HEADED=1 node --test --test-concurrency=1 \"tests/**/*.spec.js\"",
    "test:update-snapshots": "BROWSER_TEST_UPDATE_SNAPSHOTS=1 node --test --test-concurrency=1 \"tests/**/*.spec.js\""
  }
}
```

## Required Directory Structure

```
tests/
├── e2e/
│   ├── game.spec.js       # Core game tests (boot, scenes, input, score)
│   ├── visual.spec.js     # Visual regression screenshots
│   └── perf.spec.js       # Performance and FPS tests
├── fixtures/
│   ├── game-test.js       # Custom test fixture with game helpers
│   └── screenshot.css     # CSS to mask dynamic elements for visual tests
├── helpers/
│   └── seed-random.js     # Seeded PRNG for deterministic game behavior
scripts/
├── cdp.mjs                # Chrome over the DevTools protocol (copied from the plugin)
└── browser-test.mjs       # test/expect on node --test (copied from the plugin)
browser.config.mjs
```

## Browser Test Config

`browser-test.mjs` reads `timeout`, `expect`, `use`, `projects` and `webServer` (retries, workers, reporters and traces are not supported).

```js
export default {
  testDir: './tests',
  timeout: 30000,

  use: {
    baseURL: 'http://localhost:3000',
    screenshot: 'only-on-failure',
  },

  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 200,
      threshold: 0.3,
    },
  },

  projects: [
    { name: 'chromium', use: { viewport: { width: 1280, height: 720 } } },
    { name: 'mobile-chrome', use: { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true } },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
  },
};
```

Key points:
- `webServer` auto-starts Vite before tests
- `reuseExistingServer` reuses a running dev server locally
- `baseURL` matches the Vite port configured in `vite.config.js`
- Screenshot tolerance is generous (games have minor render variance)

## Testability Requirements

For browser tests to inspect game state, the game MUST expose these globals on `window` in `main.js`:

### 1. Core globals (required)

```js
// Expose for browser QA
window.__GAME__ = game;
window.__GAME_STATE__ = gameState;
window.__EVENT_BUS__ = eventBus;
window.__EVENTS__ = Events;
```

### 2. `render_game_to_text()` (required)

Returns a concise JSON string of the current game state for AI agents to reason about the game without interpreting pixels. Must include coordinate system, game mode, score, and player state.

```js
window.render_game_to_text = () => {
  if (!game || !gameState) return JSON.stringify({ error: 'not_ready' });

  const activeScenes = game.scene.getScenes(true).map(s => s.scene.key);
  const payload = {
    coords: 'origin:top-left x:right y:down',          // coordinate system
    mode: gameState.gameOver ? 'game_over' : 'playing',
    scene: activeScenes[0] || null,
    score: gameState.score,
    bestScore: gameState.bestScore,
  };

  // Add player info when in gameplay
  const gameScene = game.scene.getScene('GameScene');
  if (gameState.started && gameScene?.player?.sprite) {
    const s = gameScene.player.sprite;
    const body = s.body;
    payload.player = {
      x: Math.round(s.x), y: Math.round(s.y),
      vx: Math.round(body.velocity.x), vy: Math.round(body.velocity.y),
      onGround: body.blocked.down,
    };
  }

  // Extend with visible entities as you add them:
  // payload.entities = obstacles.map(o => ({ x: o.x, y: o.y, type: o.type }));

  return JSON.stringify(payload);
};
```

Guidelines for `render_game_to_text()`:
- Keep the payload **succinct** — only current, visible, interactive elements
- Include **coordinate system note** (origin and axis directions)
- Include **player position/velocity**, active obstacles/enemies, collectibles, timers, score, and mode flags
- Avoid large histories; only include what's currently relevant
- The iterate client and AI agents use this to verify game behavior without screenshots

### 3. `advanceTime(ms)` (required)

Lets test scripts advance the game by a precise duration. The game loop runs normally via RAF; this waits for real time to elapse.

```js
window.advanceTime = (ms) => {
  return new Promise((resolve) => {
    const start = performance.now();
    function step() {
      if (performance.now() - start >= ms) return resolve();
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
};
```

For frame-precise control in browser tests, prefer `page.clock.install()` + `page.clock.runFor()`. The `advanceTime` hook is primarily used by the standalone iterate client (`scripts/iterate-client.js`).

For Three.js games, expose the `Game` orchestrator instance similarly.

See `test-patterns.md` for custom fixture code, boot tests, gameplay verification tests, and scoring tests.

See `gameplay-invariants.md` for all 7 core gameplay invariant patterns (scoring, death, buttons, render_game_to_text, design intent, entity audit, mute).

## When Adding QA to a Game

1. Copy the helpers: `cp <plugin-root>/scripts/cdp.mjs <plugin-root>/scripts/browser-test.mjs scripts/` (needs Node 22+ and Google Chrome)
2. Create `browser.config.mjs` with the game's dev server port
3. Expose `window.__GAME__`, `window.__GAME_STATE__`, `window.__EVENT_BUS__` in `main.js`
4. Create `tests/fixtures/game-test.js` with the `gamePage` fixture
5. Create `tests/helpers/seed-random.js` for deterministic behavior
6. Write tests in `tests/e2e/`:
   - `game.spec.js` — boot, scene flow, input, scoring, game over
   - `visual.spec.js` — screenshot regression for each scene
   - `perf.spec.js` — load time, FPS budget
7. Add npm scripts: `test`, `test:headed`, `test:update-snapshots`
8. Generate initial baselines: `npm run test:update-snapshots`

## What NOT to Test (Automated)

- **Exact pixel positions** of animated objects (non-deterministic without clock control)
- **Active gameplay screenshots** — moving objects make stable screenshots impossible; use visual inspection (screenshots + Read) instead
- **Audio playback** (the browser helper has no audio inspection; test that audio objects exist via evaluate)
- **External API calls** unless mocked (e.g., Play.fun SDK — mock with `page.route()`)
- **Subjective visual quality** — use visual inspection for "does this look good?" evaluations
