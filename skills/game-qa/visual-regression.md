# Visual Regression & Advanced Testing

Screenshot comparison tests, performance/FPS tests, basic accessibility checks, and deterministic testing patterns for browser games.

## Visual Regression Screenshots

Screenshot-based tests to catch unintended visual changes.

```js
test('gameplay scene renders correctly', async ({ gamePage }) => {
  // Wait a beat for animations to settle
  await gamePage.waitForTimeout(500);
  await expect(gamePage.locator('canvas')).toHaveScreenshot('gameplay-scene.png', {
    maxDiffPixels: 300,
  });
});

test('game over scene renders correctly', async ({ gamePage }) => {

  // Let bird die
  await gamePage.waitForFunction(
    () => window.__GAME_STATE__.gameOver,
    null,
    { timeout: 10000 }
  );

  // Wait for game over scene
  await gamePage.waitForFunction(() => {
    const scenes = window.__GAME__.scene.getScenes(true);
    return scenes.some(s => s.scene.key === 'GameOverScene');
  });
  await gamePage.waitForTimeout(600); // transitions

  await expect(gamePage.locator('canvas')).toHaveScreenshot('game-over-scene.png', {
    maxDiffPixels: 300,
  });
});
```

**Masking dynamic elements** — use `screenshot.css` to hide particles, clouds, or animated elements that cause non-deterministic screenshots:

```css
/* tests/fixtures/screenshot.css */
/* No CSS rules needed for canvas games — canvas is opaque to CSS.
   Instead, use window.__TEST_MODE__ flag in game code to freeze animations. */
```

## Performance & FPS Tests

```js
test('game loads within 3 seconds', async ({ page }) => {
  const start = Date.now();
  await page.goto('/');
  await page.waitForFunction(() => {
    const g = window.__GAME__;
    return g && g.isBooted && g.canvas;
  });
  const loadTime = Date.now() - start;
  expect(loadTime).toBeLessThan(3000);
});

test('game maintains 30+ FPS during gameplay', async ({ gamePage }) => {
  await gamePage.keyboard.press('Space');
  await gamePage.waitForFunction(() => window.__GAME_STATE__.started);

  const avgFps = await gamePage.evaluate(() => {
    return new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      function countFrame() {
        frames++;
        if (performance.now() - start < 2000) {
          requestAnimationFrame(countFrame);
        } else {
          resolve(frames / ((performance.now() - start) / 1000));
        }
      }
      requestAnimationFrame(countFrame);
    });
  });

  expect(avgFps).toBeGreaterThan(30);
});
```

## Accessibility Tests

Canvas games are inherently opaque to screen readers, but check the surrounding HTML. There is no axe-core scan any more; assert the basics with locators instead:

```js
test('menu buttons have accessible names', async ({ gamePage }) => {
  await expect(gamePage.getByRole('button', { name: /play/i })).toBeVisible();
  await expect(gamePage.locator('html')).toHaveAttribute('lang', /.+/);
});
```

## Deterministic Testing

For reproducible tests, seed the game's RNG before page load:

```js
// tests/helpers/seed-random.js
// Mulberry32 seeded PRNG — inject via page.addInitScript()
(function() {
  let seed = 42;
  Math.random = function() {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
```

Use it in tests:

```js
test.beforeEach(async ({ page }) => {
  await page.addInitScript({ content: readFileSync('./tests/helpers/seed-random.js', 'utf8') }); // import { readFileSync } from 'node:fs'
});
```

Phaser also supports seeded RNG via config:

```js
const config = {
  seed: ['qa-test-seed'],
  // ...
};
```
