---
name: qa-game
description: Add Playwright QA tests to a game — visual regression, gameplay verification, and performance. Use when the user says "add tests", "test my game", "add QA", "check for bugs", or "add visual regression tests". Do NOT use for manual playtesting or gameplay design.
argument-hint: "[path-to-game]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.3.0
  tags: [game, qa, testing, playwright, visual-regression]
---

# QA Game

Add automated QA testing with Playwright to an existing game project. Tests verify your game boots, scenes work, scoring functions, and visuals haven't broken — like a safety net for your game.

## Instructions

Analyze the game at `$ARGUMENTS` (or the current directory if no path given).

First, load the game-qa skill to get the full testing patterns and fixtures.

### Step 1: Audit testability

- Read `package.json` to identify the engine and dev server port
- Read `vite.config.js` for the server port
- Read `src/main.js` to check if `window.__GAME__`, `window.__GAME_STATE__`, `window.__EVENT_BUS__` are exposed
- Read `src/core/GameState.js` to understand what state is available
- Read `src/core/EventBus.js` to understand what events exist
- Read `src/core/Constants.js` to understand game parameters (rates, speeds, durations, max values)
- Read all scene files to understand the game flow
- Read `design-brief.md` if it exists — it documents expected mechanics, magnitudes, and win/lose reachability

### Step 2: Setup Playwright

1. Install dependencies: `npm install -D @playwright/test @axe-core/playwright && npx playwright install chromium`
2. Create `playwright.config.js` with the correct dev server port and webServer config
3. Expose `window.__GAME__`, `window.__GAME_STATE__`, `window.__EVENT_BUS__`, `window.__EVENTS__` in `src/main.js` if not already present
4. Create the test directory structure:
   ```
   tests/
   ├── e2e/
   │   ├── game.spec.js
   │   ├── visual.spec.js
   │   └── perf.spec.js
   ├── fixtures/
   │   └── game-test.js
   └── helpers/
       └── seed-random.js
   ```
5. Add npm scripts: `test`, `test:ui`, `test:headed`, `test:update-snapshots`

### Step 3: Generate tests

Write tests based on what the game actually does:

- **game.spec.js**: Boot test, scene transitions, input handling, scoring, game over, restart
- **visual.spec.js**: Screenshot regression for stable scenes (gameplay initial state, game over). Skip active gameplay screenshots — moving objects make them unstable.
- **perf.spec.js**: Load time budget, FPS during gameplay, canvas dimensions

Follow the game-qa skill patterns. Use `gamePage` fixture. Use `page.evaluate()` to read game state. Use `page.keyboard.press()` for input.

### Step 4: Design-intent tests

Add a `test.describe('Design Intent')` block to game.spec.js. These tests catch
mechanics that technically exist but are too weak to matter.

1. **Lose condition**: Detect deterministically whether the game has a lose state.
   Read `GameState.js` — if it has a `won`, `result`, or similar boolean/enum
   field, the game distinguishes win from loss. Also check `render_game_to_text()`
   in `main.js` — if it returns distinct outcome modes (e.g., `'win'` vs
   `'game_over'`), the game has a lose state.

   If a lose state exists: start the game, provide NO input, let it run to
   completion (use `page.waitForFunction` with the round duration from
   Constants.js). Assert the outcome is the losing one (e.g., `won === false`,
   `mode === 'game_over'`).

   **This assertion is non-negotiable.** Do NOT write a test that passes when the
   player wins by doing nothing. If the current game behavior is "player wins
   with no input," that is a bug — write the test to catch it.

2. **Opponent/AI pressure**: If an AI-driven mechanic exists (auto-climbing bar,
   enemy spawning, difficulty ramp), test that it produces substantial state
   changes. Run the game for half its duration without player input. Assert the
   opponent's state reaches at least 25% of its maximum. If `design-brief.md`
   exists, use its expected magnitudes for thresholds. Otherwise, derive from
   Constants.js: calculate `rate * duration` and assert it reaches meaningful
   levels.

3. **Win condition**: Test that active player input leads to a win. Provide rapid
   input throughout the round and assert the outcome is a win.

### Step 5: Entity interaction audit

Audit collision and interaction logic for asymmetries that would confuse a
first-time player.

If `design-brief.md` has an "Entity Interactions" section, use it as the
checklist. Otherwise, audit `GameScene.js` directly:

1. Find all collision handlers, overlap checks, or distance-based interactions
2. Map which entities interact with which others
3. Flag any visible moving entity that interacts with one side (player OR
   opponent) but not the other — add a `// QA FLAG: asymmetric interaction`
   comment in the test file noting the entity name and the asymmetry

This is a flag, not a hard fail. Some asymmetries are intentional (e.g.,
hazards that only affect the player). The flag ensures the asymmetry is a
conscious design choice, not an oversight.

### Step 6: Run and verify

1. Run `npx playwright test` to execute all tests
2. If visual tests fail on first run, that's expected — generate baselines with `npx playwright test --update-snapshots`
3. Run again to verify all tests pass
4. Summarize results

### Step 7: Report

Tell the user in plain English:

- How many tests were created and what they check
- How to run them: `npm test` (headless), `npm run test:headed` (see the browser), `npm run test:ui` (interactive dashboard)
- "These tests are your safety net. Run them after making changes to make sure nothing broke."

## Example Usage

```
/qa-game examples/flappy-bird
```
Result: Installs Playwright → creates 15 tests (boot, scene transitions, input, scoring, restart, game-over, visual regression, FPS, load time) → generates `tests/` directory with fixtures and helpers → all tests pass. Run `npm test` anytime after changes.

## Next Step

Tell the user:

> Your game now has automated tests! Finally, run `/game-creator:review-game` for a full architecture review — it checks your code structure, performance patterns, and gives you a score with specific improvement suggestions.
>
> **Pipeline progress:** ~~/make-game~~ → ~~/design-game~~ → ~~/add-audio~~ → ~~/qa-game~~ → `/review-game`
