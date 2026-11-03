# Test Patterns

Custom fixture code, boot tests, gameplay tests, and scoring tests for browser game QA.

## Custom Test Fixture

Create a reusable fixture with game-specific helpers:

```js
import { test as base, expect } from '../../scripts/browser-test.mjs';

export const test = base.extend({
  gamePage: async ({ page }, use) => {
    await page.goto('/');
    // Wait for Phaser to boot and canvas to render
    await page.waitForFunction(() => {
      const g = window.__GAME__;
      return g && g.isBooted && g.canvas;
    }, null, { timeout: 10000 });
    await use(page);
  },
});

export { expect };
```

## Core Testing Patterns

### 1. Game Boot & Scene Flow

Test that the game initializes and scenes transition correctly.

```js
import { test, expect } from '../fixtures/game-test.js';

test('game boots directly to gameplay', async ({ gamePage }) => {
  const sceneKey = await gamePage.evaluate(() => {
    return window.__GAME__.scene.getScenes(true)[0]?.scene?.key;
  });
  expect(sceneKey).toBe('GameScene');
});
```

### 2. Gameplay Verification

Test that game mechanics work — input affects state, scoring works, game over triggers.

```js
test('bird flaps on space press', async ({ gamePage }) => {
  // Start game
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started);

  // Record position before flap
  const yBefore = await gamePage.evaluate(() => {
    const scene = window.__GAME__.scene.getScene('GameScene');
    return scene.bird.y;
  });

  // Flap
  await gamePage.keyboard.press('Space');
  await gamePage.waitForTimeout(100);

  // Bird should have moved up (lower y)
  const yAfter = await gamePage.evaluate(() => {
    const scene = window.__GAME__.scene.getScene('GameScene');
    return scene.bird.y;
  });
  expect(yAfter).toBeLessThan(yBefore);
});

test('game over triggers on collision', async ({ gamePage }) => {
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started);

  // Don't flap — let bird fall to ground
  await gamePage.waitForFunction(
    () => window.__GAME_STATE__.gameOver,
    null,
    { timeout: 10000 }
  );

  expect(await gamePage.evaluate(() => window.__GAME_STATE__.gameOver)).toBe(true);
});
```

### 3. Scoring

```js
test('score increments when passing pipes', async ({ gamePage }) => {
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started);

  // Keep flapping to survive
  const flapInterval = setInterval(async () => {
    await gamePage.keyboard.press('Space').catch(() => {});
  }, 300);

  // Wait for at least 1 score
  await gamePage.waitForFunction(
    () => window.__GAME_STATE__.score > 0,
    null,
    { timeout: 15000 }
  );

  clearInterval(flapInterval);

  const score = await gamePage.evaluate(() => window.__GAME_STATE__.score);
  expect(score).toBeGreaterThan(0);
});
```
