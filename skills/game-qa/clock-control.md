# Clock Control for Frame-Precise Testing

`page.clock` (from `scripts/cdp.mjs`) controls `requestAnimationFrame`, giving you frame-precise game control.

## Clock API Pattern

```js
test('bird falls after 1 second without input', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.waitForFunction(() => window.__GAME__?.isBooted);

  // Start game
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__GAME_STATE__.started);

  const yBefore = await page.evaluate(() => {
    return window.__GAME__.scene.getScene('GameScene').bird.y;
  });

  // Advance exactly 1 second
  await page.clock.runFor(1000);

  const yAfter = await page.evaluate(() => {
    return window.__GAME__.scene.getScene('GameScene').bird.y;
  });

  expect(yAfter).toBeGreaterThan(yBefore); // bird fell
});
```

## When to Use Clock Control

- When you need **exact frame timing** (e.g., "after exactly 1 second")
- For deterministic physics tests where real-time variance would cause flakes
- To test time-based mechanics (cooldowns, spawn timers, delays)

## Notes

- `page.clock.install()` must be called **before** `page.goto()`
- `page.clock.runFor(ms)` advances both `Date.now()` and `requestAnimationFrame` callbacks
- The standalone iterate client (`scripts/iterate-client.js`) uses `advanceTime(ms)` instead, which is real-time based
